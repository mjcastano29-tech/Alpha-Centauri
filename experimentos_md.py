"""Genera EXPERIMENTOS.md: dónde se guarda cada modelo y qué se probó en cada experimento (variables, cambios y resultado).

Todo sale de lo que ya está versionado: resultados/registro.json, resultados/runs/<id>/manifest.json y evaluacion.json,
configs/<id>.json (hipótesis, cambio, decisión), manifests/<id>.json (sección 11: URL y SHA-256 del modelo), mlflow.db
(versión en el registro de modelos) y catalogo.json (qué se sirve). Vuelve a ejecutarlo tras cada ejecución nueva:

    python experimentos_md.py
"""
import json
import sqlite3
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUNS = ROOT / "resultados" / "runs"
SALIDA = ROOT / "EXPERIMENTOS.md"
REPO = "https://github.com/mjcastano29-tech/Alpha-Centauri"
MLFLOW_UI = "https://alpha-centauri-mlflow.onrender.com"
from experimentos import POR_ID  # noqa: E402

NOMBRE_EXPERIMENTO = {k: f"Experimento {v['numero']} · {v['titulo']}" for k, v in POR_ID.items()}


def leer(path, default=None):
    p = Path(path)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def versiones_mlflow():
    db = ROOT / "mlflow.db"
    if not db.exists():
        return {}
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    filas = con.execute("""select t.value, mv.name, mv.version, r.run_uuid, r.experiment_id, e.name from model_versions mv
                           join tags t on t.run_uuid = mv.run_id and t.key = 'ejecucion'
                           join runs r on r.run_uuid = mv.run_id join experiments e on e.experiment_id = r.experiment_id
                           order by mv.version""").fetchall()
    con.close()
    return {f[0]: {"modelo": f[1], "version": int(f[2]), "run_uuid": f[3], "experimento_id": f[4], "experimento": f[5]} for f in filas}


def pct(x):
    return "—" if x is None else f"{x * 100:.1f} %"


def valor(v):
    return " × ".join(str(x) for x in v) if isinstance(v, list) else str(v)


def main():
    registro = leer(ROOT / "resultados" / "registro.json")
    catalogo = leer(ROOT / "catalogo.json", {"niveles": {}})
    mlflow = versiones_mlflow()
    ejecuciones = []
    for e in registro["ejecuciones"]:
        rid = e["run_id"]
        m = leer(RUNS / rid / "manifest.json")
        ejecuciones.append({
            "id": rid, "manifest": m, "config": leer(ROOT / "configs" / f"{rid}.json", {}), "s11": leer(ROOT / "manifests" / f"{rid}.json", {}),
            "ev": leer(RUNS / rid / "evaluacion.json"), "mlflow": mlflow.get(rid), "registro": e,
        })
    por_id = {x["id"]: x for x in ejecuciones}

    def estado_catalogo(rid, nivel):
        v = catalogo.get("niveles", {}).get(nivel, {})
        return "recomendado (se sirve en la web)" if v.get("recomendado") == rid else "anterior (destino del rollback)" if v.get("anterior") == rid else "histórico"

    L = []
    L.append("# Experimentos y modelos de Alpha Centauri\n")
    L.append(f"Generado el {time.strftime('%Y-%m-%d %H:%M')} con `python experimentos_md.py` a partir de los archivos versionados del repositorio. "
             f"{len(ejecuciones)} ejecuciones en {len({x['manifest'].get('experimento') for x in ejecuciones})} experimentos.\n")
    L.append("## Dónde se guarda cada cosa\n")
    L.append("| Qué | Dónde | Cómo se identifica |\n|---|---|---|")
    L.append("| Modelo entrenado (pesos) | `resultados/runs/<run_id>/modelo.zip` (PPO: red y optimizador) o `modelo.npz` (Q-learning: tablas); PPO lleva además `modelo_normalizador.pkl` (normalización de observaciones) | SHA-256 en el manifest de la ejecución y en `manifests/<run_id>.json`; URL al archivo en el commit exacto de GitHub (`model_uri`) |")
    L.append(f"| Registro de modelos (MLflow) | `mlflow.db` + `mlruns/` dentro del repo; en línea en {MLFLOW_UI} | modelos registrados `rocket-landing-qlearning` y `rocket-landing-ppo`, una versión por ejecución; `mlflow.pyfunc.load_model(\"models:/rocket-landing-ppo/<versión>\")` |")
    L.append("| Manifiesto de la ejecución | `resultados/runs/<run_id>/manifest.json` | commit de git, versión del ambiente, configuración completa, software, métricas y huellas SHA-256 |")
    L.append("| Manifiesto con el formato de la guía (sección 11) | `manifests/<run_id>.json` | `run_id`, `level_id`, `environment_version`, `git_commit`, `config_sha256`, `model_uri`, `model_sha256`, `normalization_uri`, `runtime_ref`, `evaluation_suite_id`, `seed`, `parent_run_id` |")
    L.append("| Hipótesis, cambio, presupuesto y decisión | `configs/<run_id>.json` (y etiquetas `diseno.*` en la run de MLflow) | estado `seleccionado` / `rechazado` / `referencia` |")
    L.append("| Datos de entrenamiento | `resultados/runs/<run_id>/episodios.csv` (una fila por época), `entrenamiento.json` (curvas), `vuelos.json.gz` (trayectorias grabadas) | huellas SHA-256 en el manifest; `python cli.py verificar` las comprueba |")
    L.append("| Evaluación | `resultados/runs/<run_id>/evaluacion.json`: suite v1 (`configs/suites/suite-v1.json`), 200 épocas normales y 200 con viento de 15 m/s | semillas desde 10 000 000, nunca usadas al entrenar |")
    L.append("| Qué modelo se sirve | `catalogo.json` (recomendado y anterior por nivel, con historial y commit base) | la API lo lee; `GET /version` dice el commit y el catálogo servidos |")
    L.append("| Ambientes | `rocket_env/` (`rocket_landing.py` N1 0.1.1, `nivel2.py` N2 0.2, `nivel3.py` N3 0.3) con fichas en `docs/ambiente-v0.*.md` | cada manifest guarda `ambiente.id` y `ambiente.version` |")
    L.append("| Evidencia del pipeline | `pipelines/ejecuciones/<run_id>-<fecha>.json` | resultado de las ocho etapas, decisión y commit publicado |\n")

    L.append("## Resumen\n")
    L.append("| Ejecución | Experimento | Nivel · ambiente | Agente | Semilla | Presupuesto | Aterrizajes (suite v1) | Con viento 15 m/s | Colisiones | Estado | Catálogo | MLflow |\n|---|---|---|---|---|---|---|---|---|---|---|---|")
    for x in ejecuciones:
        m, c, ev = x["manifest"], x["config"], x["ev"]
        nivel = m.get("nivel", "N1"); amb = m["ambiente"]
        pres = f"{m['config']['total_timesteps']:,} pasos".replace(",", " ") if "total_timesteps" in m["config"] else f"{m['config'].get('epochs')} épocas"
        normal = ev["normal"]["resumen"] if ev else None
        viento = ev["perturbado"]["resumen"]["aterrizajes"] if ev else None
        col = normal["resultados"].get("colisión", 0) if normal and nivel != "N1" else "—"
        ml = f"{x['mlflow']['modelo']} v{x['mlflow']['version']}" if x["mlflow"] else "—"
        L.append(f"| `{x['id']}` | {m.get('experimento', '—')} | {nivel} · {amb.get('id', 'RocketLanding3D-v0')} {amb['version']} | {m['agente'].get('nombre', '')} | {m['config'].get('seed', '—')} | {pres} | **{pct(m['resultado']['evaluacion']['landing_rate'])}** | {pct(viento)} | {col} | {c.get('estado', 'sin config')} | {estado_catalogo(x['id'], nivel)} | {ml} |")
    L.append("")

    grupos = {}
    for x in ejecuciones:
        grupos.setdefault(x["manifest"].get("experimento", "sin-experimento"), []).append(x)
    for exp, lista in grupos.items():
        L.append(f"## {NOMBRE_EXPERIMENTO.get(exp, exp)}\n")
        L.append(f"Experimento de MLflow `{exp}` ({len(lista)} ejecuciones). Las ejecuciones van en orden cronológico; cada una dice qué cambió frente a su baseline.\n")
        if exp in POR_ID:
            L.append(f"**Pregunta.** {POR_ID[exp]['pregunta']}\n\n**Variables que se mueven.** {POR_ID[exp]['variables']}\n")
        for x in lista:
            m, c, s11, ev = x["manifest"], x["config"], x["s11"], x["ev"]
            nivel = m.get("nivel", "N1"); amb = m["ambiente"]; cfg = m["config"]
            L.append(f"### `{x['id']}` · {c.get('estado', 'sin config')} · {pct(m['resultado']['evaluacion']['landing_rate'])}\n")
            L.append(f"**Hipótesis.** {c.get('hipotesis') or '—'}\n")
            L.append(f"**Cambio frente a `{c.get('baseline') or '—'}`.** {c.get('cambio') or '—'}\n")
            # dónde está el modelo
            archivos = m["archivos"]["modelo"]; archivos = archivos if isinstance(archivos, list) else [archivos]
            commit = m["git"]["commit"] or "—"
            L.append("**Dónde está el modelo.**\n")
            for a in archivos:
                h = (m.get("sha256") or {}).get("archivos", {}).get(a, "—")
                L.append(f"- `resultados/runs/{x['id']}/{a}` · SHA-256 `{h}`")
            if s11.get("model_uri"):
                L.append(f"- En GitHub, en el commit de entrenamiento: {s11['model_uri']}")
            if x["mlflow"]:
                L.append(f"- MLflow: modelo `{x['mlflow']['modelo']}` versión {x['mlflow']['version']}, run `{x['mlflow']['run_uuid']}` ({MLFLOW_UI}/#/experiments/{x['mlflow']['experimento_id']}/runs/{x['mlflow']['run_uuid']})")
            L.append(f"- Commit de git: `{commit}`{' (había cambios sin commit al entrenar)' if m['git'].get('cambios_sin_commit') else ''} · manifiesto de la sección 11: `manifests/{x['id']}.json`")
            if cfg.get("desde"):
                L.append(f"- Parte de los pesos de `{cfg['desde']}` (transferencia)")
            L.append("")
            # variables
            L.append("**Variables.**\n")
            L.append(f"| Variable | Valor |\n|---|---|")
            L.append(f"| ambiente | {amb.get('id', 'RocketLanding3D-v0')} v{amb['version']} ({nivel}) |")
            L.append(f"| agente | {m['agente'].get('nombre', '')} · {m['agente'].get('accion') or m['agente'].get('tipo', '')} |")
            for k, v in cfg.items():
                if k != "ambiente":  # ya está en la primera fila
                    L.append(f"| {k} | {valor(v)} |")
            base = por_id.get(c.get("baseline") or "")
            if base:
                dif = [(k, base["manifest"]["config"].get(k, "—"), v) for k, v in cfg.items() if base["manifest"]["config"].get(k) != v]
                if base["manifest"]["ambiente"]["version"] != amb["version"]:
                    dif.insert(0, ("ambiente", base["manifest"]["ambiente"].get("id", "RocketLanding3D-v0") + " v" + base["manifest"]["ambiente"]["version"], amb.get("id") + " v" + amb["version"]))
                if base["manifest"]["agente"].get("accion") != m["agente"].get("accion"):
                    dif.insert(0, ("acción del agente", base["manifest"]["agente"].get("accion", base["manifest"]["agente"].get("nombre")), m["agente"].get("accion", m["agente"].get("nombre"))))
                L.append("")
                L.append(f"**Diferencias de variables con `{base['id']}`.** " + ("; ".join(f"{k}: {valor(a)} → {valor(b)}" for k, a, b in dif) if dif else "ninguna (solo cambia lo que dice el cambio: agente, semilla o datos)"))
            # resultados
            r = m["resultado"]
            L.append("")
            L.append("**Resultado.**\n")
            L.append("| Métrica | Normal (suite v1) | Viento 15 m/s |\n|---|---|---|")
            n = ev["normal"]["resumen"] if ev else None; p = ev["perturbado"]["resumen"] if ev else None
            L.append(f"| aterrizajes seguros | {pct(r['evaluacion']['landing_rate'])} | {pct(p['aterrizajes']) if p else '—'} |")
            vc = r["evaluacion"]["contact_speed"]; vc_n = f"{vc:.2f} m/s" if vc is not None else "—"
            vc_p = f"{p['velocidad_contacto']:.2f} m/s" if p and p["velocidad_contacto"] is not None else "—"
            err_p = f"{p['error_posicion']:.1f} m" if p else "—"
            L.append(f"| velocidad de contacto | {vc_n} | {vc_p} |")
            L.append(f"| error de posición | {r['evaluacion']['position_error']:.1f} m | {err_p} |")
            L.append(f"| cómo terminan | {', '.join(f'{k} {v}' for k, v in r['evaluacion']['outcomes'].items() if v)} | {', '.join(f'{k} {v}' for k, v in p['resultados'].items() if v) if p else '—'} |")
            L.append(f"| primer aterrizaje / mejor época | {r['primer_aterrizaje'] or 'nunca'} / {r['mejor_epoca']} | |")
            pres = c.get("presupuesto", {})
            if pres:
                L.append(f"| presupuesto | {', '.join(f'{k} {valor(v)}' for k, v in pres.items())} | |")
            L.append("")
            L.append(f"**Decisión ({c.get('fecha_decision') or '—'}).** {c.get('decision') or '—'}\n")
    SALIDA.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"{SALIDA.name}: {len(ejecuciones)} ejecuciones, {len(grupos)} experimentos")


if __name__ == "__main__":
    main()
