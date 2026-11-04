"""API de simulación e inferencia de Alpha Centauri (FastAPI + Uvicorn).

Python es la autoridad: el ambiente, los modelos y la evaluación son exactamente los del entrenamiento
(`rocket_env`, `entrenar.load_agent`, `entrenamiento.run_epoch`). La web solo muestra lo que devuelve
esta API. Es de solo lectura: promover o restaurar un modelo es un commit de catalogo.json
(`python catalogo.py`), y `GET /version` dice qué commit y qué catálogo se están sirviendo.

Arranque local:
    uvicorn api.main:app --reload --port 8000        # documentación interactiva en /docs
Variables de entorno (ver .env.example): CORS_ORIGENES, MAX_EPISODIOS, COMMIT_SHA.
"""
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
from entrenamiento import CHECK_EPISODES, EVAL_SEED_BASE, OUTCOMES, episode_record, run_epoch  # noqa: E402
from entrenar import RUNS, load_agent, load_registry, run_dir  # noqa: E402
from rocket_env.rocket_landing import RocketLanding3DEnv  # noqa: E402

VERSION_API = "0.1.0"
MAX_EPISODIOS = int(os.environ.get("MAX_EPISODIOS", "50"))
ARRANQUE = time.strftime("%Y-%m-%dT%H:%M:%S")


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
        filas = con.execute("""select t.value, mv.name, mv.version from model_versions mv
                               join tags t on t.run_uuid = mv.run_id and t.key = 'ejecucion'
                               order by mv.version""").fetchall()
        con.close()
        return {ejecucion: {"modelo": nombre, "version": int(version)} for ejecucion, nombre, version in filas}
    except sqlite3.Error:  # el registro es informativo: no impide servir
        return {}


MLFLOW = versiones_mlflow()


def resumen_ejecucion(run_id, cat):
    m = manifest(run_id)
    ev = m["resultado"]["evaluacion"]
    detalle = evaluacion_guardada(run_id)
    modelo = m["archivos"]["modelo"]
    archivos = modelo if isinstance(modelo, list) else [modelo]
    return {
        "run_id": run_id,
        "experimento": m.get("experimento"),
        "nivel": m.get("nivel", "N1"),
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
        "checkpoint": all((RUNS / run_id / a).exists() for a in archivos),
        "estado": "recomendado" if cat["recomendado"] == run_id else "anterior" if cat["anterior"] == run_id else "historico",
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
    return {"nombre": app.title, "version_api": VERSION_API, "commit": COMMIT,
            "ambiente": {"id": "RocketLanding3D-v0", "version": RocketLanding3DEnv.VERSION},
            "recomendado": cat["recomendado"], "documentacion": "/docs",
            "rutas": ["/salud", "/version", "/catalogo", "/ejecuciones/{run_id}", "/ejecuciones/{run_id}/vuelos",
                      "/ejecuciones/{run_id}/evaluacion", "/comparar?runs=a,b", "POST /evaluar"]}


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
    return {"api": VERSION_API, "commit": COMMIT, "arranque": ARRANQUE,
            "ambiente": {"id": "RocketLanding3D-v0", "version": RocketLanding3DEnv.VERSION},
            "catalogo": {"version": cat["version"], "actualizado": cat["actualizado"], "recomendado": cat["recomendado"],
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
    return {"catalogo": cat, "ejecuciones": ejecuciones, "outcomes": OUTCOMES, "rewards": RocketLanding3DEnv.REWARDS}


@app.get("/comparar", summary="Resumen de varias ejecuciones lado a lado")
def comparar(runs: str = Query(..., description="ids separados por coma")):
    cat = catalogo_git.leer()
    return {"ejecuciones": [resumen_ejecucion(r.strip(), cat) for r in runs.split(",") if r.strip()]}


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


class PeticionEvaluacion(BaseModel):
    run_id: str
    episodios: int = Field(20, ge=1, le=MAX_EPISODIOS, description=f"máximo {MAX_EPISODIOS} por petición")
    semilla_base: int = Field(EVAL_SEED_BASE, description="semilla de la primera época; la suite v1 usa 10 000 000")
    viento: float | None = Field(None, ge=0, le=30, description="viento fijo a 10 m (m/s); None = aleatorio 0–10")
    grabar: int = Field(1, ge=0, le=5, description="cuántas épocas devolver con su trayectoria completa")


@app.post("/evaluar", summary="Ejecuta el modelo congelado de una ejecución en el ambiente (modo evaluación)")
def evaluar(p: PeticionEvaluacion):
    m = manifest(p.run_id)
    ag = agente(p.run_id)
    env = gym.make("RocketLanding3D-v0")
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
    return {
        "modo": "evaluacion",
        "modelo": {"run_id": p.run_id, "agente": m["agente"].get("nombre"), "accion": m["agente"].get("accion"),
                   "commit": m["git"]["commit"], "sha256": (m.get("sha256") or {}).get("archivos"), "mlflow": MLFLOW.get(p.run_id)},
        "ambiente": {"id": "RocketLanding3D-v0", "version": RocketLanding3DEnv.VERSION,
                     "compatible": m["ambiente"]["version"] == RocketLanding3DEnv.VERSION},
        "suite": {"episodios": p.episodios, "semilla_base": p.semilla_base, "viento": p.viento, "deterministico": True},
        "resumen": resumen,
        "episodios": filas,
        "vuelos": vuelos,
        "latencia": {"total_ms": round(latencia * 1000), "por_paso_ms": round(latencia * 1000 / max(1, pasos), 2), "pasos": pasos},
        "servido_por": {"api": VERSION_API, "commit": COMMIT},
    }
