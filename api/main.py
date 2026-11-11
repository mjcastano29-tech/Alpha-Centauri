"""API de simulación e inferencia de Alpha Centauri (FastAPI + Uvicorn).

Python es la autoridad: el ambiente, los modelos y la evaluación son exactamente los del entrenamiento
(`rocket_env`, `entrenar.load_agent`, `entrenamiento.run_epoch`). La web solo muestra lo que devuelve
esta API. Es de solo lectura: promover o restaurar un modelo es un commit de catalogo.json
(`python catalogo.py`), y `GET /version` dice qué commit y qué catálogo se están sirviendo.

Arranque local:
    uvicorn api.main:app --reload --port 8000        # documentación interactiva en /docs
Variables de entorno (ver .env.example): CORS_ORIGENES, MAX_EPISODIOS, COMMIT_SHA.
"""
import collections
import json
import os
import platform
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import gymnasium as gym  # noqa: E402
import rocket_env  # noqa: E402, F401  (registra RocketLanding3D-v0)
import catalogo as catalogo_git  # noqa: E402
import uuid  # noqa: E402

from entrenamiento import CHECK_EPISODES, EVAL_SEED_BASE, OUTCOMES, episode_record, run_epoch  # noqa: E402
from visualizacion.datos import summary, trajectory_columns, weather  # noqa: E402
from entrenar import RUNS, ambiente_de, hacer_entorno, load_agent, load_registry, run_dir  # noqa: E402
from rocket_env import AMBIENTES, VIGENTES, AdaptadorN1, RocketLandingN2Env, clase_ambiente  # noqa: E402
from rocket_env.rocket_landing import RocketLanding3DEnv  # noqa: E402

from experimentos import EXPERIMENTOS  # noqa: E402


def _info_ambiente(c):
    env = c()
    return {"id": c.ID, "version": c.VERSION, "nivel": c.NIVEL, "obstaculos": c.obstaculos(), "resumen": getattr(c, "RESUMEN", ""),
            "novedad": getattr(c, "NOVEDAD", ""), "ficha": getattr(c, "FICHA", None), "observacion": int(env.observation_space.shape[0]),
            "accion": int(env.action_space.shape[0]), "resultados": list(c.OUTCOMES), "viento_max": getattr(c, "VIENTO_MAX", None),
            "rafagas": getattr(c, "RAFAGAS", None), "pasos": c.MAX_STEPS, "altitud_salida": c.START_ALTITUDE, "radio_plataforma": c.PAD_RADIUS,
            "familia": "pasarela" if c.ID.endswith("-v1") else "torres" if c.NIVEL in ("N2", "N3") else c.NIVEL,
            "vigente": VIGENTES.get(c.NIVEL) == c.ID}


AMBIENTES_INFO = [_info_ambiente(c) for c in AMBIENTES.values()]

VERSION_API = "0.2.0"
MLFLOW_UI_URL = os.environ.get("MLFLOW_UI_URL") or None
CONFIGS = ROOT / "configs"
MANIFESTS = ROOT / "manifests"
INCIDENTES = ROOT / "resultados" / "incidentes"
MAX_EPISODIOS = int(os.environ.get("MAX_EPISODIOS", "50"))
ARRANQUE = time.strftime("%Y-%m-%dT%H:%M:%S")
ARRANQUE_T = time.time()
EVALUACIONES = collections.deque(maxlen=100)  # telemetría de operación: últimas evaluaciones servidas (en memoria; se pierde al reiniciar)
EVIDENCIA_PIPELINE = ROOT / "pipelines" / "ejecuciones"


def commit_servido():
    """SHA completo del código servido: lo da la plataforma de despliegue o git en local."""
    for variable in ("COMMIT_SHA", "RENDER_GIT_COMMIT", "SOURCE_VERSION", "VERCEL_GIT_COMMIT_SHA"):
        if os.environ.get(variable):
            return os.environ[variable]
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


COMMIT = commit_servido()

app = FastAPI(
    title="Alpha Centauri · Rocket Landing",
    version=VERSION_API,
    description="Catálogo de ejecuciones, carga de modelos históricos y evaluación con el ambiente RocketLanding3D-v0.",
)
origenes = [o.strip() for o in os.environ.get("CORS_ORIGENES", "*").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origenes, allow_methods=["GET", "POST"], allow_headers=["*"])


# ---------- datos de las ejecuciones ----------
def leer_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def manifest(run_id):
    path = RUNS / run_id
    if not (path / "manifest.json").exists():
        raise HTTPException(404, f"No existe la ejecución {run_id}")
    return leer_json(path / "manifest.json")


def evaluacion_guardada(run_id):
    path = RUNS / run_id / "evaluacion.json"
    return leer_json(path) if path.exists() else None


def versiones_mlflow():
    """{run_id: {"modelo": nombre, "version": n}} leído de mlflow.db con sqlite3 (sin importar MLflow:
    la API debe caber en 512 MB). Cada versión registrada apunta a la run cuya etiqueta "ejecucion" es el run_id."""
    db = ROOT / "mlflow.db"
    if not db.exists():
        return {}
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        filas = con.execute("""select t.value, mv.name, mv.version, r.run_uuid, r.experiment_id from model_versions mv
                               join tags t on t.run_uuid = mv.run_id and t.key = 'ejecucion'
                               join runs r on r.run_uuid = mv.run_id
                               order by mv.version""").fetchall()
        con.close()
        return {ejecucion: {"modelo": nombre, "version": int(version), "run_uuid": run_uuid, "experimento_id": str(exp_id),
                            # página de la run en la interfaz de MLflow (etiquetas diseno.*, métricas, artefactos)
                            "url": f"{MLFLOW_UI_URL}/#/experiments/{exp_id}/runs/{run_uuid}" if MLFLOW_UI_URL else None}
                for ejecucion, nombre, version, run_uuid, exp_id in filas}
    except sqlite3.Error:  # el registro es informativo: no impide servir
        return {}


MLFLOW = versiones_mlflow()


def diseno(run_id):
    """Hipótesis, cambio, presupuesto y estado de la configuración (configs/<run_id>.json), si está documentada."""
    path = CONFIGS / f"{run_id}.json"
    if not path.exists():
        return None
    cfg = leer_json(path)
    return {k: cfg.get(k) for k in ("hipotesis", "cambio", "baseline", "comparacion_principal", "presupuesto", "suite", "estado", "decision", "fecha_decision")}


def suites():
    """Suites de evaluación con nombre (configs/suites/*.json). La reservada no trae semilla: vive fuera del repo."""
    return {s["id"]: s for s in (leer_json(p) for p in sorted((CONFIGS / "suites").glob("*.json")))}


def resumen_ejecucion(run_id, cat):
    m = manifest(run_id)
    ev = m["resultado"]["evaluacion"]
    detalle = evaluacion_guardada(run_id)
    modelo = m["archivos"]["modelo"]
    archivos = modelo if isinstance(modelo, list) else [modelo]
    clase = clase_ambiente(ambiente_de(m))
    return {
        "run_id": run_id,
        "experimento": m.get("experimento"),
        "nivel": m.get("nivel") or clase.NIVEL,
        "ambiente_id": clase.ID,
        "obstaculos": clase.obstaculos(),
        "agente": {"clase": m["agente"].get("clase", "qlearning"), "nombre": m["agente"].get("nombre"),
                   "accion": m["agente"].get("accion"), "red": m["agente"].get("red")},
        "ambiente": m["ambiente"]["id"] + " v" + m["ambiente"]["version"],
        "ambiente_version": m["ambiente"]["version"],
        "fecha": m["fecha"],
        "git": m["git"],
        "config": m["config"],
        "epocas": None,
        "primer_aterrizaje": m["resultado"]["primer_aterrizaje"],
        "mejor_epoca": m["resultado"]["mejor_epoca"],
        "evaluacion": {"episodios": ev["episodes"], "aterrizajes": ev["landing_rate"], "velocidad_contacto": ev["contact_speed"],
                       "error_posicion": ev["position_error"], "combustible": ev["fuel_used"], "resultados": ev["outcomes"]},
        "perturbado": ({"viento": detalle["viento"], "aterrizajes": detalle["perturbado"]["resumen"]["aterrizajes"],
                        "velocidad_contacto": detalle["perturbado"]["resumen"]["velocidad_contacto"],
                        "error_posicion": detalle["perturbado"]["resumen"]["error_posicion"],
                        "resultados": detalle["perturbado"]["resumen"]["resultados"]} if detalle else None),
        "sha256": m.get("sha256"),
        "mlflow": MLFLOW.get(run_id),
        "mlflow_ui": MLFLOW_UI_URL,
        "diseno": diseno(run_id),
        "manifiesto": f"/ejecuciones/{run_id}/manifiesto" if (MANIFESTS / f"{run_id}.json").exists() else None,
        "checkpoint": all((RUNS / run_id / a).exists() for a in archivos),
        "estado": catalogo_git.estado_de(cat, run_id, m.get("nivel") or clase.NIVEL),
    }


def tramos(log, n=120):
    total = len(log["reward"])
    size = max(1, total // n)
    out = {"x": [], "recompensa": [], "aterrizajes": [], "tramo": size}
    for end in range(size, total + 1, size):
        sl = slice(end - size, end)
        out["x"].append(end)
        out["recompensa"].append(round(float(np.mean(log["reward"][sl])), 1))
        out["aterrizajes"].append(round(float(np.mean([OUTCOMES[o] == "aterrizaje" for o in log["outcome"][sl]])), 3))
    return out


_agentes = {}


def agente(run_id):
    if run_id not in _agentes:
        manifest(run_id)  # 404 si no existe
        try:
            _agentes[run_id], _ = load_agent(run_id)
        except FileNotFoundError as e:
            raise HTTPException(409, f"La ejecución {run_id} no tiene checkpoint disponible: {e}")
    return _agentes[run_id]


# ---------- rutas ----------
@app.get("/", summary="Qué sirve esta API")
def raiz():
    cat = catalogo_git.leer()
    return {"nombre": app.title, "version_api": VERSION_API, "commit": COMMIT, "mlflow_ui": MLFLOW_UI_URL,
            "ambiente": {"id": RocketLanding3DEnv.ID, "version": RocketLanding3DEnv.VERSION}, "ambientes": AMBIENTES_INFO,
            "recomendado": cat["recomendado"], "documentacion": "/docs",
            "rutas": ["/salud", "/version", "/catalogo", "/ejecuciones/{run_id}", "/ejecuciones/{run_id}/vuelos",
                      "/ejecuciones/{run_id}/evaluacion", "/comparar?runs=a,b", "/incidentes", "POST /evaluar"]}


@app.get("/salud", summary="Comprobación de vida")
def salud():
    return {"ok": True, "arranque": ARRANQUE}


@app.get("/version", summary="Versión realmente servida: código, catálogo y modelo recomendado")
def version():
    cat = catalogo_git.leer()
    software = {"python": platform.python_version()}
    try:
        import torch, stable_baselines3  # noqa: E401
        software.update({"torch": torch.__version__, "stable_baselines3": stable_baselines3.__version__})
    except ImportError:
        pass
    return {"api": VERSION_API, "commit": COMMIT, "arranque": ARRANQUE, "mlflow_ui": MLFLOW_UI_URL, "suites": list(suites()),
            "ambiente": {"id": RocketLanding3DEnv.ID, "version": RocketLanding3DEnv.VERSION}, "ambientes": AMBIENTES_INFO,
            "catalogo": {"version": cat["version"], "actualizado": cat["actualizado"], "recomendado": cat["recomendado"], "niveles": cat["niveles"],
                         "anterior": cat["anterior"]},
            "modelos_cargados": sorted(_agentes), "software": software}


@app.get("/catalogo", summary="Todas las ejecuciones con sus métricas, estado e identidad")
def catalogo():
    cat = catalogo_git.leer()
    registro = load_registry()
    ejecuciones = []
    for e in registro["ejecuciones"]:
        r = resumen_ejecucion(e["run_id"], cat)
        r["epocas"] = e["epochs"]
        ejecuciones.append(r)
    return {"catalogo": cat, "ejecuciones": ejecuciones, "outcomes": OUTCOMES, "rewards": RocketLandingN2Env.REWARDS, "ambientes": AMBIENTES_INFO,
            "experimentos": EXPERIMENTOS}


@app.get("/comparar", summary="Resumen de varias ejecuciones lado a lado")
def comparar(runs: str = Query(..., description="ids separados por coma")):
    cat = catalogo_git.leer()
    epocas = {e["run_id"]: e["epochs"] for e in load_registry()["ejecuciones"]}
    return {"ejecuciones": [resumen_ejecucion(r, cat) | {"epocas": epocas.get(r)} for r in (x.strip() for x in runs.split(",")) if r]}


@app.get("/ejecuciones/{run_id}", summary="Detalle de una ejecución: manifest, curva de entrenamiento y evaluaciones")
def ejecucion(run_id: str):
    cat = catalogo_git.leer()
    m = manifest(run_id)  # 404 si no existe
    training = leer_json(RUNS / run_id / "entrenamiento.json")
    return {**resumen_ejecucion(run_id, cat), "epocas": len(training["log"]["reward"]), "manifest": m,
            "curva": tramos(training["log"]), "checks": training["checks"], "check_episodes": CHECK_EPISODES}


@app.get("/ejecuciones/{run_id}/manifest", summary="Manifest completo")
def ejecucion_manifest(run_id: str):
    return manifest(run_id)


@app.get("/suites", summary="Suites de evaluación con nombre (episodios, semillas y condiciones)")
def listar_suites():
    return {"suites": suites(), "maximo_por_peticion": MAX_EPISODIOS}


@app.get("/ejecuciones/{run_id}/manifiesto", summary="Manifiesto inmutable de la ejecución en el formato de la guía (sección 11)")
def ejecucion_manifiesto(run_id: str):
    path = MANIFESTS / f"{run_id}.json"
    if not path.exists():
        raise HTTPException(404, f"No hay manifests/{run_id}.json (genera: python manifiestos.py --run {run_id})")
    return leer_json(path)


@app.get("/ejecuciones/{run_id}/evaluacion", summary="Evaluación guardada época a época (normal y con viento)")
def ejecucion_evaluacion(run_id: str):
    manifest(run_id)
    detalle = evaluacion_guardada(run_id)
    if detalle is None:
        raise HTTPException(404, f"La ejecución {run_id} no tiene evaluacion.json (genera el panel: python panel.py)")
    return detalle


@app.get("/ejecuciones/{run_id}/vuelos", summary="Vuelos grabados durante el entrenamiento (replay)")
def ejecucion_vuelos(run_id: str):
    manifest(run_id)
    path = RUNS / run_id / "vuelos.json.gz"
    if not path.exists():
        raise HTTPException(404, "Sin vuelos grabados")
    return FileResponse(path, media_type="application/json", headers={"Content-Encoding": "gzip", "X-Modo": "replay"})


@app.get("/incidentes", summary="Incidente controlado: degradación de cada modelo al cambiar de nivel e intervenciones del nivel")
def incidentes():
    """Lee resultados/incidentes/<run_id>@<ambiente>.json (python incidente.py): el modelo en su nivel (antes) y en el
    nivel nuevo (después), normal y con viento de 15 m/s. Para cada nivel de destino añade las ejecuciones entrenadas en
    él (las intervenciones), con su decisión, para compararlas con las mismas métricas."""
    cat = catalogo_git.leer()
    medidas = []
    for path in sorted(INCIDENTES.glob("*.json")):
        d = leer_json(path)
        medidas.append({k: d[k] for k in ("run_id", "fecha", "suite", "episodios", "viento", "entrenado_en", "ambiente", "adaptador", "antes")}
                       | {"nivel_entrenado": clase_ambiente(d["entrenado_en"]).NIVEL,
                          "despues": {c: d["despues"][c]["resumen"] for c in ("normal", "perturbado")},
                          "estado": catalogo_git.estado_de(cat, d["run_id"], clase_ambiente(d["entrenado_en"]).NIVEL)})
    destinos = sorted({m["ambiente"]["id"] for m in medidas})
    intervenciones = {}
    for amb in destinos:
        nivel = clase_ambiente(amb).NIVEL
        filas = []
        for e in load_registry()["ejecuciones"]:
            if e.get("nivel") != nivel:
                continue
            r = resumen_ejecucion(e["run_id"], cat)
            filas.append({k: r[k] for k in ("run_id", "evaluacion", "perturbado", "diseno", "estado", "mlflow")})
        intervenciones[amb] = filas
    return {"medidas": medidas, "intervenciones": intervenciones, "outcomes": OUTCOMES}


class PeticionEvaluacion(BaseModel):
    run_id: str
    episodios: int = Field(20, ge=1, le=MAX_EPISODIOS, description=f"máximo {MAX_EPISODIOS} por petición")
    semilla_base: int = Field(EVAL_SEED_BASE, description="semilla de la primera época; la suite v1 usa 10 000 000")
    viento: float | None = Field(None, ge=0, le=30, description="viento fijo a 10 m (m/s); None = aleatorio entre 0 y el máximo del nivel (10 m/s; 15 en N3)")
    grabar: int = Field(1, ge=0, le=5, description="cuántas épocas devolver con su trayectoria completa")
    suite: str | None = Field(None, description="id de una suite de configs/suites (p. ej. suite-v1): fija semilla_base y viento")
    condicion: str = Field("normal", description="condición de la suite (normal, viento-15)")
    ambiente: str | None = Field(None, description="otro ambiente (nivel) distinto del de entrenamiento; un modelo de N2 juega en N3 tal cual y uno de N1 en N2 o N3 con AdaptadorN1")


# ---------- misión en vivo: la simulación avanza paso a paso y el viento se cambia entre pasos ----------
SESIONES = {}  # id -> estado de una misión interactiva (en memoria; caducan a los 15 min sin uso)
SESIONES_MAX = 20
SESION_TTL = 15 * 60


class NuevaSesion(BaseModel):
    run_id: str
    ambiente: str | None = Field(None, description="otro ambiente (nivel) distinto del de entrenamiento")
    semilla: int = Field(EVAL_SEED_BASE, ge=0, description="semilla de la meteorología y la salida")
    viento: float | None = Field(None, ge=0, le=30, description="viento inicial a 10 m (m/s); None = sorteado por el ambiente")


class PasoSesion(BaseModel):
    viento: float | None = Field(None, ge=0, le=30, description="viento a 10 m (m/s) que se aplica desde este paso; None = dejarlo como está")
    direccion_grados: float | None = Field(None, ge=-360, le=360, description="dirección hacia la que sopla, en grados desde +x; None = la actual")


def _viento_actual(env):
    g = env.unwrapped.atmosphere.ground_wind
    return {"velocidad": round(float(np.hypot(g[0], g[1])), 2), "direccion_grados": round(float(np.degrees(np.arctan2(g[1], g[0]))) % 360, 1)}


def _limpiar_sesiones():
    ahora = time.time()
    for sid in [k for k, s in SESIONES.items() if ahora - s["ultimo_uso"] > SESION_TTL]:
        SESIONES.pop(sid, None)
    while len(SESIONES) > SESIONES_MAX:
        SESIONES.pop(min(SESIONES, key=lambda k: SESIONES[k]["ultimo_uso"]), None)


def _vuelo_parcial(s, nombre="misión en vivo"):
    return {**s["meta"], "agent": nombre, "epoch": None, "reason": s["resultado"] or "en vuelo", "steps": len(s["pasos"]), "reward": round(s["recompensa"], 2),
            "duration": s["frames"][-1]["t"] if s["frames"] else 0.0, "landed": s["resultado"] == "aterrizaje",
            "f": trajectory_columns(s["frames"]), "step_marks": s["pasos"]}


@app.post("/sesiones", summary="Misión en vivo: crea una simulación paso a paso con el modelo congelado; el viento se cambia entre pasos")
def crear_sesion(p: NuevaSesion):
    _limpiar_sesiones()
    m = manifest(p.run_id)
    ag = agente(p.run_id)
    if p.ambiente and p.ambiente not in AMBIENTES:
        raise HTTPException(404, f"Ambiente desconocido: {p.ambiente}")
    try:
        env = hacer_entorno(m, p.ambiente)
    except SystemExit as e:
        raise HTTPException(422, str(e))
    obs, info = env.reset(seed=p.semilla, options={"viento": p.viento} if p.viento is not None else None)
    rocket = env.unwrapped
    sid = uuid.uuid4().hex[:12]
    SESIONES[sid] = {"env": env, "agente": ag, "obs": obs, "run_id": p.run_id, "frames": list(info["trajectory"]), "pasos": [], "recompensa": 0.0,
                     "resultado": None, "meta": weather(env), "creada": time.time(), "ultimo_uso": time.time(), "semilla": p.semilla}
    return {
        "sesion": sid, "modo": "mision en vivo",
        "modelo": {"run_id": p.run_id, "agente": m["agente"].get("nombre"), "accion": m["agente"].get("accion"), "commit": m["git"]["commit"], "mlflow": MLFLOW.get(p.run_id)},
        "ambiente": {"id": rocket.ID, "version": rocket.VERSION, "nivel": rocket.NIVEL, "obstaculos": rocket.obstaculos(), "entrenado_en": ambiente_de(m),
                     "adaptador": isinstance(env, AdaptadorN1), "viento_max": getattr(rocket, "VIENTO_MAX", None), "rafagas": getattr(rocket, "RAFAGAS", None),
                     "pasos": rocket.MAX_STEPS, "altitud_salida": rocket.START_ALTITUDE, "radio_plataforma": rocket.PAD_RADIUS},
        "semilla": p.semilla, "viento": _viento_actual(env), "vuelo": _vuelo_parcial(SESIONES[sid]), "caduca_s": SESION_TTL,
    }


@app.post("/sesiones/{sid}/paso", summary="Avanza un paso del agente (hasta 20 m o 2 s) con el viento indicado; devuelve los fotogramas nuevos")
def paso_sesion(sid: str, p: PasoSesion):
    s = SESIONES.get(sid)
    if not s:
        raise HTTPException(404, "La sesión no existe o caducó: crea otra con POST /sesiones")
    if s["resultado"]:
        raise HTTPException(409, f"La misión ya terminó: {s['resultado']}")
    env, rocket = s["env"], s["env"].unwrapped
    if p.viento is not None or p.direccion_grados is not None:
        actual = _viento_actual(env)
        v = actual["velocidad"] if p.viento is None else float(p.viento)
        a = np.radians(actual["direccion_grados"] if p.direccion_grados is None else float(p.direccion_grados))
        rocket.atmosphere.ground_wind = np.array([v * np.cos(a), v * np.sin(a), 0.0])  # el viento medio cambia; las ráfagas siguen su proceso
    t0 = time.perf_counter()
    env_action, _, etiqueta = s["agente"].act(s["obs"], greedy=True)
    obs, reward, terminated, truncated, info = env.step(env_action)
    nuevos = list(info["trajectory"])
    s["frames"].extend(nuevos); s["obs"] = obs; s["recompensa"] += float(reward); s["ultimo_uso"] = time.time()
    s["pasos"].append({"i": len(s["frames"]) - 1, "label": etiqueta, "r": round(float(reward), 2)})
    fin = bool(terminated or truncated)
    resumen = None
    if fin:
        s["resultado"] = info["outcome"]
        s["meta"].update(summary(env, s["frames"], info["outcome"], s["recompensa"], len(s["pasos"])))
        resumen = {k: s["meta"][k] for k in ("reason", "steps", "reward", "duration", "landed", "final_dist", "fuel_used") if k in s["meta"]}
        EVALUACIONES.append({"fecha": time.strftime("%Y-%m-%dT%H:%M:%S"), "run_id": s["run_id"], "ambiente": rocket.ID, "nivel": rocket.NIVEL, "episodios": 1,
                             "aterrizajes": 1.0 if info["outcome"] == "aterrizaje" else 0.0, "total_ms": 0, "por_paso_ms": 0.0,
                             "adaptador": isinstance(env, AdaptadorN1), "suite": "mision-en-vivo"})
    return {"paso": len(s["pasos"]), "f": trajectory_columns(nuevos), "marca": s["pasos"][-1], "recompensa": round(float(reward), 2),
            "acumulada": round(s["recompensa"], 2), "terminado": bool(terminated), "truncado": bool(truncated), "fin": fin, "resultado": info["outcome"],
            "viento": _viento_actual(env), "latencia_ms": round((time.perf_counter() - t0) * 1000, 1), "resumen": resumen}


@app.delete("/sesiones/{sid}", summary="Cierra una misión en vivo")
def cerrar_sesion(sid: str):
    return {"cerrada": SESIONES.pop(sid, None) is not None}


@app.get("/monitoreo", summary="Monitoreo de la operación: servicio, catálogo servido por nivel, decisiones del pipeline, evaluaciones recientes y alertas")
def monitoreo():
    """Lo que un operador mira: qué commit y catálogo se sirven, qué modelo atiende cada nivel y cómo se comporta (suite v1 y viento),
    qué decidió el pipeline en sus últimas ejecuciones (pipelines/ejecuciones/), qué latencia tienen las evaluaciones servidas por
    este proceso y qué merece atención (alertas)."""
    cat = catalogo_git.leer()
    registro = load_registry()
    alertas = []
    uptime = time.time() - ARRANQUE_T
    if uptime < 300:
        alertas.append({"nivel": None, "tipo": "arranque", "texto": f"La API arrancó hace {uptime:.0f} s: el plan gratuito la duerme tras 15 min sin uso; la primera evaluación carga el modelo."})
    niveles = []
    for nivel, v in cat.get("niveles", {}).items():
        rec = v.get("recomendado")
        fila = {"nivel": nivel, "ambiente_vigente": VIGENTES.get(nivel), "recomendado": rec, "anterior": v.get("anterior")}
        if rec and (RUNS / rec / "manifest.json").exists():
            r = resumen_ejecucion(rec, cat)
            viento = r["perturbado"]["aterrizajes"] if r["perturbado"] else None
            fila.update({"ambiente_modelo": r["ambiente_id"], "aterrizajes": r["evaluacion"]["aterrizajes"], "aterrizajes_viento": viento,
                         "colisiones": r["evaluacion"]["resultados"].get("colisión", 0), "velocidad_contacto": r["evaluacion"]["velocidad_contacto"],
                         "cambios_sin_commit": r["git"]["cambios_sin_commit"], "commit": r["git"]["commit"], "mlflow": r["mlflow"],
                         "fecha": r["fecha"], "modelo_cargado": rec in _agentes})
            if r["ambiente_id"] != VIGENTES.get(nivel):
                alertas.append({"nivel": nivel, "tipo": "ambiente", "texto": f"El recomendado de {nivel} ({rec}) juega en {r['ambiente_id']}, que no es el ambiente vigente del nivel ({VIGENTES.get(nivel)})."})
            if viento is not None and viento < 0.6:
                alertas.append({"nivel": nivel, "tipo": "viento", "texto": f"El recomendado de {nivel} baja a {viento:.0%} con viento de 15 m/s (suite v1): frágil ante la perturbación."})
            if r["git"]["cambios_sin_commit"]:
                alertas.append({"nivel": nivel, "tipo": "trazabilidad", "texto": f"El recomendado de {nivel} se entrenó con cambios sin commit (marcado con * en el catálogo); su ficha documenta qué archivo era."})
        elif rec:
            alertas.append({"nivel": nivel, "tipo": "catalogo", "texto": f"El catálogo recomienda {rec} para {nivel}, pero su ejecución no está en resultados/runs."})
        niveles.append(fila)
    pipeline = []
    if EVIDENCIA_PIPELINE.exists():
        for path in sorted(EVIDENCIA_PIPELINE.glob("*.json"), key=lambda q: q.stat().st_mtime, reverse=True)[:15]:
            try:
                e = leer_json(path)
            except (ValueError, OSError):
                continue
            if "flujo" not in e:  # otros archivos de evidencia (p. ej. rollback-*.json)
                pipeline.append({"archivo": path.name, "tipo": "rollback" if path.name.startswith("rollback") else "otro", "fecha": e.get("fecha"), "ok": e.get("ok"),
                                 "nivel": (e.get("catalogo") or {}).get("nivel"), "recomendado": (e.get("catalogo") or {}).get("recomendado"), "commit": e.get("commit")})
                continue
            par, et = e.get("parametros", {}), e.get("etapas", {})
            pipeline.append({"archivo": path.name, "tipo": "pipeline", "run_id": par.get("run_id") or par.get("run_existente"), "ambiente": par.get("ambiente"),
                             "inicio": e["flujo"].get("inicio"), "duracion_s": e["flujo"].get("duracion_s"), "estado": e["flujo"].get("estado"),
                             "etapas_completadas": len(et), "decision": et.get("6 decidir", {}).get("estado"), "aceptado": et.get("6 decidir", {}).get("aceptado"),
                             "commit": et.get("7 publicar", {}).get("commit"), "comprobacion": et.get("8 comprobar", {}).get("modo"),
                             "aterrizajes": et.get("4 evaluar", {}).get("aterrizajes")})
        ultimo = next((x for x in pipeline if x.get("tipo") == "pipeline"), None)
        if ultimo and str(ultimo.get("estado", "")).startswith("fallido"):
            alertas.append({"nivel": None, "tipo": "pipeline", "texto": f"La última ejecución del pipeline ({ultimo.get('run_id')}) terminó en fallo: {ultimo.get('estado')}"})
    sin_commit = [e["run_id"] for e in registro["ejecuciones"] if str(e.get("commit", "")).endswith("*")]
    return {
        "servicio": {"api": VERSION_API, "commit": COMMIT, "arranque": ARRANQUE, "uptime_s": round(uptime), "python": platform.python_version(),
                     "modelos_cargados": sorted(_agentes), "evaluaciones_servidas": len(EVALUACIONES), "max_episodios": MAX_EPISODIOS,
                     "mlflow_ui": MLFLOW_UI_URL, "versiones_mlflow": len(MLFLOW), "ambientes_vigentes": VIGENTES},
        "catalogo": {"version": cat["version"], "actualizado": cat["actualizado"], "historial": cat["historial"][-6:]},
        "niveles": niveles,
        "pipeline": pipeline,
        "evaluaciones": list(EVALUACIONES)[-25:],
        "resumen": {"ejecuciones": len(registro["ejecuciones"]), "con_cambios_sin_commit": sin_commit, "incidentes": len(list(INCIDENTES.glob("*.json"))) if INCIDENTES.exists() else 0,
                    "evidencias_pipeline": len(list(EVIDENCIA_PIPELINE.glob("*.json"))) if EVIDENCIA_PIPELINE.exists() else 0},
        "alertas": alertas,
    }


@app.post("/evaluar", summary="Ejecuta el modelo congelado de una ejecución en el ambiente (modo evaluación)")
def evaluar(p: PeticionEvaluacion):
    m = manifest(p.run_id)
    ag = agente(p.run_id)
    if p.ambiente and p.ambiente not in AMBIENTES:
        raise HTTPException(404, f"Ambiente desconocido: {p.ambiente}")
    try:
        env = hacer_entorno(m, p.ambiente)
    except SystemExit as e:
        raise HTTPException(422, str(e))
    rocket = env.unwrapped
    if p.suite:
        s = suites().get(p.suite)
        if s is None:
            raise HTTPException(404, f"Suite desconocida: {p.suite}")
        cond = next((c for c in s["condiciones"] if c["id"] == p.condicion), None)
        if cond is None:
            raise HTTPException(422, f"La suite {p.suite} no tiene la condición {p.condicion}")
        if not isinstance(s["semilla_base"], int):
            raise HTTPException(422, f"La suite {p.suite} no tiene semilla en el repositorio: pásala en semilla_base sin suite")
        p = p.model_copy(update={"semilla_base": s["semilla_base"], "viento": cond["viento"],
                                 "episodios": p.episodios if "episodios" in p.model_fields_set else min(s["episodios"], MAX_EPISODIOS)})
    options = {"viento": p.viento} if p.viento is not None else None
    t0 = time.perf_counter()
    filas, vuelos, pasos = [], [], 0
    for k in range(p.episodios):
        meta, frames, steps = run_epoch(env, ag, seed=p.semilla_base + k, learn=False, greedy=True, options=options)
        last = frames[-1]
        pasos += meta["steps"]
        filas.append({"epoca": k + 1, "semilla": p.semilla_base + k, "resultado": meta["reason"], "recompensa": round(meta["reward"], 1),
                      "pasos": meta["steps"], "duracion_s": round(meta["duration"], 1), "vz": round(float(last["vz"]), 2),
                      "vh": round(float(np.hypot(last["vx"], last["vy"])), 2), "distancia": round(meta["final_dist"], 1),
                      "inclinacion": round(float(np.degrees(np.arccos(np.clip(last["dir"][2], -1, 1)))), 1),
                      "combustible": round(meta["fuel_used"], 1), "viento": round(float(meta["wind_speed"]), 1),
                      "toca_suelo": bool(last["z"] <= 0.0)})
        if k < p.grabar:
            vuelos.append(episode_record("evaluacion", meta, frames, steps, epoch=None) | {"epoca_evaluacion": k + 1})
    latencia = time.perf_counter() - t0
    contacto = [abs(f["vz"]) for f in filas if f["toca_suelo"]]
    resumen = {
        "episodios": p.episodios,
        "aterrizajes": sum(f["resultado"] == "aterrizaje" for f in filas) / p.episodios,
        "velocidad_contacto": float(np.mean(contacto)) if contacto else None,
        "error_posicion": float(np.mean([f["distancia"] for f in filas])),
        "combustible": float(np.mean([f["combustible"] for f in filas])),
        "resultados": {name: sum(f["resultado"] == name for f in filas) for name in OUTCOMES},
    }
    respuesta = {
        "modo": "evaluacion",
        "modelo": {"run_id": p.run_id, "agente": m["agente"].get("nombre"), "accion": m["agente"].get("accion"),
                   "commit": m["git"]["commit"], "sha256": (m.get("sha256") or {}).get("archivos"), "mlflow": MLFLOW.get(p.run_id)},
        "ambiente": {"id": rocket.ID, "version": rocket.VERSION, "nivel": rocket.NIVEL, "obstaculos": rocket.obstaculos(),
                     "entrenado_en": ambiente_de(m), "entrenado_con": m["ambiente"]["version"], "nivel_entrenado": clase_ambiente(ambiente_de(m)).NIVEL,
                     "compatible": rocket.ID == ambiente_de(m) and rocket.compatible(m["ambiente"]["version"]),
                     "adaptador": isinstance(env, AdaptadorN1),
                     # otro nivel con la misma observación y acción (p. ej. un modelo de N2 en N3): mide la degradación
                     "misma_familia": rocket.ID != ambiente_de(m) and not isinstance(env, AdaptadorN1)},
        "suite": {"id": p.suite, "condicion": p.condicion if p.suite else None, "episodios": p.episodios, "semilla_base": p.semilla_base,
                  "viento": p.viento, "deterministico": True},
        "resumen": resumen,
        "episodios": filas,
        "vuelos": vuelos,
        "latencia": {"total_ms": round(latencia * 1000), "por_paso_ms": round(latencia * 1000 / max(1, pasos), 2), "pasos": pasos},
        "servido_por": {"api": VERSION_API, "commit": COMMIT},
    }
    EVALUACIONES.append({"fecha": time.strftime("%Y-%m-%dT%H:%M:%S"), "run_id": p.run_id, "ambiente": rocket.ID, "nivel": rocket.NIVEL,
                         "episodios": p.episodios, "aterrizajes": resumen["aterrizajes"], "total_ms": round(latencia * 1000),
                         "por_paso_ms": round(latencia * 1000 / max(1, pasos), 2), "adaptador": isinstance(env, AdaptadorN1), "suite": p.suite})
    return respuesta
