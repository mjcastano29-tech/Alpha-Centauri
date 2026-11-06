"""Pipeline orquestado con Prefect: de una configuración nueva al catálogo servido, en ocho etapas.

    1 validar      el ambiente del nivel cumple el contrato de Gymnasium y la suite de evaluación existe
    2 probar       pruebas del contrato de los ambientes (pytest)
    3 entrenar     entrenamiento PPO (o se reutiliza una ejecución existente con --run-existente)
    4 evaluar      suite v1: 200 épocas normales + 200 con viento de 15 m/s (evaluacion.json)
    5 registrar    configs/<id>.json (hipótesis, cambio, presupuesto), manifests/<id>.json (sección 11), etiquetas en MLflow, huellas SHA-256
    6 decidir      criterio de aceptación frente al recomendado actual del nivel (en un nivel sin recomendado, frente a
                   --baseline jugando en este ambiente: incidente.py); estado seleccionado/rechazado en configs/
    7 publicar     catálogo (recomendar si se aceptó), commit con todos los artefactos y, con --push, push (dispara el despliegue)
    8 comprobar    la versión servida (GET /version, catálogo y una evaluación corta) coincide con el commit publicado

Cada etapa es un comando del proyecto ejecutado con el intérprete de .venv (el orquestador vive en .venv-prefect, porque
Prefect y la versión de FastAPI de la API no caben en el mismo entorno). La evidencia de cada ejecución queda en
pipelines/ejecuciones/<run_id>-<fecha>.json y en la interfaz de Prefect (prefect server start → http://127.0.0.1:4200).

Ejemplos:
    .venv-prefect/bin/python pipelines/entrenar_publicar.py --ambiente RocketLanding3D-v0 --seed 1 --run-id ppo-v2-v0.1-s1 \\
        --hipotesis "Con otra semilla, la configuración v2 queda a menos de 5 puntos del 97 % de la semilla 0" --push
    .venv-prefect/bin/python pipelines/entrenar_publicar.py --run-existente ppo-n2-transfer-1m5-v0.2-s0 --sin-commit   # ensayo sin git
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from prefect import flow, get_run_logger, task
from prefect.context import get_run_context

ROOT = Path(__file__).resolve().parents[1]
PYTHON = os.environ.get("ALPHA_PYTHON") or str(ROOT / ".venv" / "bin" / "python")
EVIDENCIA = ROOT / "pipelines" / "ejecuciones"
API_POR_DEFECTO = "https://alpha-centauri-api.onrender.com"
MARGEN_MEJORA = 0.02  # puntos de tasa de aterrizaje que debe ganar un candidato para sustituir al recomendado
TOLERANCIA_VIENTO = 0.05  # cuánto puede perder con viento de 15 m/s respecto al recomendado sin rechazarse
AMBIENTE_N1 = "RocketLanding3D-v0"


def correr(cmd, timeout=3600, cwd=ROOT):
    """Ejecuta un comando del proyecto; devuelve la salida (y la registra). Falla si el comando falla."""
    log = get_run_logger()
    log.info("$ " + " ".join(cmd))
    proc = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, timeout=timeout,
                          env={**os.environ, "MLFLOW_DISABLE_AGENT_HINT": "1", "PYTHONIOENCODING": "utf-8"})
    salida = (proc.stdout + proc.stderr).strip()
    for linea in salida.splitlines()[-12:]:
        log.info("  " + linea[:200])
    if proc.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd[:3])} terminó con código {proc.returncode}")
    return salida


def leer(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def escribir(path, data):
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


# ---------- etapas ----------
@task(name="1 validar ambiente")
def validar(ambiente):
    script = (
        "import json, gymnasium as gym, rocket_env\n"
        "from gymnasium.utils.env_checker import check_env\n"
        f"clase = rocket_env.clase_ambiente({ambiente!r}); check_env(clase(), skip_render_check=True)\n"
        f"env = gym.make({ambiente!r}); obs, _ = env.reset(seed=0)\n"
        "print(json.dumps({'id': clase.ID, 'version': clase.VERSION, 'nivel': clase.NIVEL, 'observacion': int(obs.shape[0]), "
        "'accion': int(env.action_space.shape[0]), 'obstaculos': len(clase.obstaculos())}))"
    )
    info = json.loads(correr([PYTHON, "-c", script], timeout=300).splitlines()[-1])
    suite = leer(ROOT / "configs" / "suites" / "suite-v1.json")
    assert suite["semilla_base"] == 10_000_000 and suite["episodios"] == 200, "la suite v1 no es la esperada"
    info["suite"] = suite["id"]
    sucio = subprocess.run(["git", "status", "--porcelain", "--untracked-files=no", "--", ".", ":!mlflow.db", ":!mlruns"], cwd=ROOT, text=True, capture_output=True).stdout.strip()
    info["git_limpio"] = not sucio
    if sucio:
        get_run_logger().warning("Hay cambios sin commit: el manifest de la ejecución lo marcará")
    return info


@task(name="2 probar contrato")
def probar():
    salida = correr([PYTHON, "-m", "pytest", "-q", "tests/test_ambiente.py", "tests/test_ambiente_n2.py", "tests/test_ambiente_n3.py"], timeout=900)
    return salida.splitlines()[-1]


@task(name="3 entrenar")
def entrenar(args, ambiente_info):
    if args.run_existente:
        get_run_logger().info(f"Se reutiliza la ejecución {args.run_existente} (sin entrenar)")
        return args.run_existente
    cmd = [PYTHON, "cli.py", "entrenar-ppo", "--ambiente", args.ambiente, "--seed", str(args.seed), "--run-id", args.run_id]
    if args.desde:
        cmd += ["--desde", args.desde]
    if args.total_timesteps:
        cmd += ["--total-timesteps", str(args.total_timesteps)]
    correr(cmd, timeout=6 * 3600)
    return args.run_id


@task(name="4 evaluar suite v1")
def evaluar(run_id):
    correr([PYTHON, "panel.py"], timeout=3600)  # evalúa (con caché) todas las ejecuciones: normal + viento 15
    ev = leer(ROOT / "resultados" / "runs" / run_id / "evaluacion.json")
    n, p = ev["normal"]["resumen"], ev["perturbado"]["resumen"]
    return {"episodios": ev["episodios"], "viento": ev["viento"],
            "aterrizajes": n["aterrizajes"], "colisiones": n["resultados"].get("colisión", 0), "velocidad_contacto": n["velocidad_contacto"],
            "error_posicion": n["error_posicion"], "resultados": n["resultados"],
            "aterrizajes_viento": p["aterrizajes"], "colisiones_viento": p["resultados"].get("colisión", 0)}


@task(name="5 registrar")
def registrar(run_id, args, ambiente_info, evaluacion):
    manifest = leer(ROOT / "resultados" / "runs" / run_id / "manifest.json")
    cfg_path = ROOT / "configs" / f"{run_id}.json"
    if not cfg_path.exists():
        training = leer(ROOT / "resultados" / "runs" / run_id / "entrenamiento.json")
        escribir(cfg_path, {
            "run_id": run_id, "experimento": manifest.get("experimento"), "nivel": manifest.get("nivel", ambiente_info["nivel"]),
            "ambiente": f"{ambiente_info['id']}@{manifest['ambiente']['version']}",
            "hipotesis": args.hipotesis, "cambio": args.cambio, "baseline": args.baseline, "comparacion_principal": args.baseline,
            "presupuesto": {"pasos_agente": manifest["config"].get("total_timesteps"), "epocas": len(training["log"]["reward"]),
                            "maquina": "pipeline Prefect en CPU de portátil (WSL2)"},
            "suite": "suite-v1", "estado": "candidato", "decision": None, "fecha_decision": None, "pipeline": True,
        })
    correr([PYTHON, "manifiestos.py", "--run", run_id], timeout=300)
    correr([PYTHON, "seguimiento.py", "etiquetar", run_id], timeout=600)
    correr([PYTHON, "cli.py", "verificar", "--run", run_id], timeout=600)
    return {"config": str(cfg_path.relative_to(ROOT)), "manifest": f"manifests/{run_id}.json", "sha256": "OK"}


@task(name="6 decidir")
def decidir(run_id, ambiente_info, evaluacion, baseline=None):
    nivel = ambiente_info["nivel"]
    cat = leer(ROOT / "catalogo.json")
    actual = (cat.get("niveles", {}).get(nivel) or {}).get("recomendado") or (cat.get("recomendado") if nivel == "N1" else None)
    if actual and actual != run_id:
        # el recomendado del nivel solo es referencia si juega en el mismo ambiente (una versión nueva del nivel, p. ej. la
        # pasarela frente a las torres, no es comparable: se trata como nivel nuevo y se compara con --baseline)
        amb_actual = leer(ROOT / "resultados" / "runs" / actual / "manifest.json")["ambiente"].get("id", AMBIENTE_N1)
        if amb_actual != ambiente_info["id"]:
            get_run_logger().info(f"el recomendado {actual} juega en {amb_actual}, no en {ambiente_info['id']}: no se compara con él")
            actual = None
    motivos = []
    referencia = None
    if actual and actual != run_id:
        ev_actual = leer(ROOT / "resultados" / "runs" / actual / "evaluacion.json")
        referencia = (ev_actual["normal"]["resumen"], ev_actual["perturbado"]["resumen"])
    elif not actual and baseline and baseline != run_id:
        # nivel nuevo: la referencia es el baseline (p. ej. el recomendado del nivel anterior) jugando en este ambiente
        correr([PYTHON, "incidente.py", "--run", baseline, "--ambiente", ambiente_info["id"]], timeout=3600)
        inc = leer(ROOT / "resultados" / "incidentes" / f"{baseline}@{ambiente_info['id']}.json")
        referencia = (inc["despues"]["normal"]["resumen"], inc["despues"]["perturbado"]["resumen"])
        actual = baseline
    if referencia:
        ra, rv = referencia[0]["aterrizajes"], referencia[1]["aterrizajes"]
        ca = referencia[0]["resultados"].get("colisión", 0)
        mejora = evaluacion["aterrizajes"] - ra
        if mejora < MARGEN_MEJORA:
            motivos.append(f"no mejora a {actual} en al menos {MARGEN_MEJORA:.0%} ({evaluacion['aterrizajes']:.1%} frente a {ra:.1%})")
        if evaluacion["aterrizajes_viento"] < rv - TOLERANCIA_VIENTO:
            motivos.append(f"con viento de 15 m/s pierde más de {TOLERANCIA_VIENTO:.0%} ({evaluacion['aterrizajes_viento']:.1%} frente a {rv:.1%})")
        if nivel != "N1" and evaluacion["colisiones"] > ca:
            motivos.append(f"más colisiones que {actual} ({evaluacion['colisiones']} frente a {ca})")
        comparacion = {"recomendado": actual, "aterrizajes": ra, "aterrizajes_viento": rv, "colisiones": ca}
        if actual == baseline and not (cat.get("niveles", {}).get(nivel) or {}).get("recomendado"):
            comparacion.update({"recomendado": None, "referencia": baseline, "jugando_en": ambiente_info["id"],
                                "nota": f"primer candidato del nivel: se compara con {baseline} jugando en {ambiente_info['id']} (incidente.py)"})
    elif actual == run_id:
        comparacion = {"recomendado": actual, "nota": "ya es el recomendado del nivel"}
    else:
        comparacion = {"recomendado": None, "nota": "primer candidato del nivel"}
    aceptado = not motivos and actual != run_id
    actual = comparacion.get("recomendado")
    cfg_path = ROOT / "configs" / f"{run_id}.json"
    cfg = leer(cfg_path)
    resumen = (f"{evaluacion['aterrizajes']:.1%} de aterrizajes en la suite v1 ({evaluacion['colisiones']} colisiones), "
               f"{evaluacion['aterrizajes_viento']:.1%} con viento de 15 m/s")
    if actual == run_id:
        decision = f"Sin cambio: ya es el recomendado del nivel {nivel}. {resumen}."
        estado = cfg.get("estado", "seleccionado")
    elif aceptado:
        estado, decision = "seleccionado", f"Seleccionado por el pipeline: {resumen}; supera {('al recomendado ' + actual) if actual else ('a ' + comparacion['referencia'] + ' en este ambiente') if comparacion.get('referencia') else 'sin referencia'} con el criterio de aceptación (+{MARGEN_MEJORA:.0%} de tasa, viento −{TOLERANCIA_VIENTO:.0%} como mucho{', no más colisiones' if nivel != 'N1' else ''})."
    else:
        estado, decision = "rechazado", f"Rechazado por el pipeline: {resumen}. " + "; ".join(motivos) + "."
    if cfg.get("estado") in (None, "candidato") or cfg.get("pipeline"):
        cfg.update({"estado": estado, "decision": decision, "fecha_decision": time.strftime("%Y-%m-%d")})
        escribir(cfg_path, cfg)
        correr([PYTHON, "manifiestos.py", "--run", run_id], timeout=300)
        correr([PYTHON, "seguimiento.py", "etiquetar", run_id], timeout=600)
    return {"aceptado": aceptado, "estado": estado, "decision": decision, "comparacion": comparacion, "criterio": {"margen_mejora": MARGEN_MEJORA, "tolerancia_viento": TOLERANCIA_VIENTO}}


@task(name="7 publicar catalogo")
def publicar(run_id, decision, args, evidencia_path):
    if decision["aceptado"]:
        correr([PYTHON, "catalogo.py", "recomendar", run_id, "--motivo", f"pipeline: {decision['decision']}"], timeout=120)
    if args.sin_commit:
        return {"commit": None, "nota": "sin commit (--sin-commit)"}
    rutas = ["catalogo.json", "configs", "manifests", "mlflow.db", "mlruns", "resultados/registro.json", f"resultados/runs/{run_id}", str(evidencia_path.relative_to(ROOT))]
    if (ROOT / "resultados" / "incidentes").exists():
        rutas.append("resultados/incidentes")
    subprocess.run(["git", "add", "-A", "--", *rutas], cwd=ROOT, check=True)
    mensaje = (f"pipeline: {run_id} {'seleccionado y recomendado' if decision['aceptado'] else decision['estado']} "
               f"({decision['comparacion'].get('recomendado') or 'sin recomendado previo'})\n\n{decision['decision']}\n\n"
               "Ejecutado con pipelines/entrenar_publicar.py (Prefect): validar, probar, entrenar, evaluar, registrar, decidir, publicar, comprobar.")
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode == 0:
        return {"commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(), "nota": "nada nuevo que publicar"}
    subprocess.run(["git", "commit", "-q", "-m", mensaje], cwd=ROOT, check=True)
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if args.push:
        correr(["git", "push", "-q", "origin", "HEAD"], timeout=300)
    return {"commit": commit, "push": bool(args.push)}


@task(name="8 comprobar version servida")
def comprobar(run_id, decision, publicacion, args, ambiente_info):
    log = get_run_logger()
    nivel = ambiente_info["nivel"]
    cat = leer(ROOT / "catalogo.json")
    esperado = (cat.get("niveles", {}).get(nivel) or {}).get("recomendado")
    if not (publicacion.get("push") and publicacion.get("commit")):
        # sin push: la API se comprueba en local con el mismo código que se desplegaría
        # (un nivel nuevo cuyo primer candidato se rechazó no tiene recomendado: se comprueba que la API tampoco lo sirva)
        script = (
            "import json; from fastapi.testclient import TestClient; from api.main import app\n"
            "c = TestClient(app); v = c.get('/version').json(); cat = c.get('/catalogo').json()['catalogo']\n"
            f"e = c.post('/evaluar', json={{'run_id': {esperado!r}, 'suite': 'suite-v1', 'episodios': 3}}).json() if {esperado!r} else None\n"
            f"print(json.dumps({{'commit': v['commit'], 'catalogo': cat['version'], 'recomendado': cat['niveles'].get({nivel!r}, {{}}).get('recomendado'), "
            "'evaluacion': e['resumen']['aterrizajes'] if e else None, 'compatible': e['ambiente']['compatible'] if e else None}))"
        )
        info = json.loads(correr([PYTHON, "-c", script], timeout=600).splitlines()[-1])
        info["modo"] = "local (sin push)"
        assert info["recomendado"] == esperado and (info["compatible"] or esperado is None), "la API local no sirve el catálogo esperado"
        return info
    api, commit, inicio = args.api.rstrip("/"), publicacion["commit"], time.time()
    while True:
        try:
            with urllib.request.urlopen(f"{api}/version", timeout=60) as r:
                v = json.load(r)
            if v.get("commit") == commit:
                break
            log.info(f"la API sirve {str(v.get('commit'))[:7]}; esperando {commit[:7]} ({time.time() - inicio:.0f} s)")
        except Exception as e:  # la API se despierta o se está redesplegando
            log.info(f"API no disponible todavía: {e}")
        if time.time() - inicio > args.espera_api:
            raise RuntimeError(f"La API no sirvió el commit {commit[:7]} en {args.espera_api:.0f} s. Si el despliegue falló: "
                               f"python catalogo.py restaurar --nivel {nivel} --motivo 'rollback' y volver a publicar.")
        time.sleep(30)
    with urllib.request.urlopen(f"{api}/catalogo", timeout=120) as r:
        cat_servido = json.load(r)["catalogo"]
    servido = cat_servido["niveles"].get(nivel, {}).get("recomendado")
    assert servido == esperado, f"la API sirve {servido} como recomendado de {nivel}; se esperaba {esperado}"
    if esperado is None:
        return {"modo": "público", "api": api, "commit": commit, "catalogo": cat_servido["version"], "recomendado": None,
                "nota": f"el nivel {nivel} sigue sin recomendado", "espera_s": round(time.time() - inicio)}
    req = urllib.request.Request(f"{api}/evaluar", data=json.dumps({"run_id": esperado, "suite": "suite-v1", "episodios": 3}).encode(),
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        e = json.load(r)
    return {"modo": "público", "api": api, "commit": commit, "catalogo": cat_servido["version"], "recomendado": servido,
            "evaluacion": e["resumen"]["aterrizajes"], "latencia_ms": e["latencia"]["total_ms"], "espera_s": round(time.time() - inicio)}


# ---------- flujo ----------
@flow(name="alpha-centauri · entrenar y publicar", log_prints=True)
def entrenar_y_publicar(args):
    ctx = get_run_context().flow_run
    inicio = time.time()
    run_id = args.run_existente or args.run_id
    EVIDENCIA.mkdir(exist_ok=True)
    evidencia_path = EVIDENCIA / f"{run_id}-{time.strftime('%Y%m%d-%H%M%S')}.json"
    evidencia = {"flujo": {"prefect_flow_run_id": str(ctx.id), "nombre": ctx.name, "inicio": time.strftime("%Y-%m-%dT%H:%M:%S")},
                 "parametros": {k: v for k, v in vars(args).items()}, "etapas": {}}

    def guardar(etapa, resultado):
        evidencia["etapas"][etapa] = resultado
        evidencia["flujo"]["duracion_s"] = round(time.time() - inicio)
        escribir(evidencia_path, evidencia)

    try:
        ambiente_info = validar(args.ambiente); guardar("1 validar", ambiente_info)
        guardar("2 probar", probar())
        run_id = entrenar(args, ambiente_info); guardar("3 entrenar", {"run_id": run_id, "reutilizada": bool(args.run_existente)})
        evaluacion = evaluar(run_id); guardar("4 evaluar", evaluacion)
        guardar("5 registrar", registrar(run_id, args, ambiente_info, evaluacion))
        decision = decidir(run_id, ambiente_info, evaluacion, args.baseline); guardar("6 decidir", decision)
        publicacion = publicar(run_id, decision, args, evidencia_path); guardar("7 publicar", publicacion)
        guardar("8 comprobar", comprobar(run_id, decision, publicacion, args, ambiente_info))
        evidencia["flujo"]["estado"] = "completado"
    except Exception as e:
        evidencia["flujo"]["estado"] = f"fallido: {e}"
        escribir(evidencia_path, evidencia)
        raise
    escribir(evidencia_path, evidencia)
    if not args.sin_commit and not subprocess.run(["git", "diff", "--quiet", "--", str(evidencia_path)], cwd=ROOT).returncode == 0 or \
            subprocess.run(["git", "ls-files", "--error-unmatch", str(evidencia_path)], cwd=ROOT, capture_output=True).returncode != 0:
        if not args.sin_commit:  # la evidencia de la etapa 8 va en un segundo commit pequeño
            subprocess.run(["git", "add", str(evidencia_path)], cwd=ROOT, check=True)
            subprocess.run(["git", "commit", "-q", "-m", f"pipeline: evidencia de {run_id} (comprobación de la versión servida)"], cwd=ROOT, check=True)
            if args.push:
                subprocess.run(["git", "push", "-q", "origin", "HEAD"], cwd=ROOT, check=True)
    print(f"\nEvidencia: {evidencia_path.relative_to(ROOT)} · decisión: {evidencia['etapas']['6 decidir']['estado']} · {evidencia['etapas']['6 decidir']['decision']}")
    return evidencia


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--ambiente", default=AMBIENTE_N1, help="id del ambiente (nivel) en el que entrenar")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--run-id", help="id de la ejecución nueva")
    parser.add_argument("--run-existente", help="saltar el entrenamiento y usar esta ejecución")
    parser.add_argument("--desde", help="transferencia desde otra ejecución PPO")
    parser.add_argument("--total-timesteps", type=int)
    parser.add_argument("--hipotesis", default="", help="hipótesis de la configuración (va a configs/<id>.json y a MLflow)")
    parser.add_argument("--cambio", default="", help="qué cambia frente al baseline")
    parser.add_argument("--baseline", default=None, help="run_id con el que se compara")
    parser.add_argument("--push", action="store_true", help="hacer push del commit (dispara el despliegue) y comprobar la API pública")
    parser.add_argument("--sin-commit", action="store_true", help="ensayo: no toca git; la comprobación se hace con la API en local")
    parser.add_argument("--api", default=os.environ.get("ALPHA_API_URL", API_POR_DEFECTO))
    parser.add_argument("--espera-api", type=float, default=900, help="segundos máximos esperando a que la API sirva el commit")
    args = parser.parse_args(argv)
    if not args.run_existente and not args.run_id:
        parser.error("hace falta --run-id (ejecución nueva) o --run-existente")
    if args.run_existente:
        args.ambiente = leer(ROOT / "resultados" / "runs" / args.run_existente / "manifest.json")["ambiente"].get("id", AMBIENTE_N1)
    entrenar_y_publicar(args)


if __name__ == "__main__":
    main()
