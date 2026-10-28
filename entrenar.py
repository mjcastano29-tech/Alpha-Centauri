"""Entrena el agente Q-learning en RocketLanding3D-v0, versiona el resultado y genera las páginas.

Cada entrenamiento es una "ejecución" guardada en resultados/runs/<id>/ con todo lo necesario para
reproducirla y compararla:
  manifest.json       commit de git, versión del ambiente, configuración, software, métricas
  modelo.npz          las tablas Q de la mejor versión
  entrenamiento.json  recompensa, pasos, resultado, combustible y ε de cada época; evaluaciones periódicas
  vuelos.json.gz      las épocas grabadas (trayectoria completa), para las páginas HTML
resultados/registro.json es el índice de ejecuciones y apunta a la última.

Para seguir el entrenamiento en la terminal, usa `python cli.py entrenar`.
"""
import argparse
import collections
import gzip
import json
import platform
import subprocess
import time
from pathlib import Path

import gymnasium as gym
import numpy as np

import agente_qlearning as agente
from entrenamiento import CHECK_EPISODES, EVAL_SEED_BASE, OUTCOMES, TrainConfig, episode_record, evaluate, run_epoch, train
from rocket_env.rocket_landing import RocketLanding3DEnv
from visualizacion.datos import write_page

ROOT = Path(__file__).parent
RESULTS = ROOT / "resultados"
RUNS = RESULTS / "runs"
REGISTRY = RESULTS / "registro.json"
FINAL_EPISODES = 200  # épocas de la evaluación del modelo final
PAGES = ["aprendizaje.html", "aprendizaje3d.html"]  # plantillas en visualizacion/, salida en la raíz
DATA_FORMAT = 1  # versión del formato de las ejecuciones (ver docs/CHANGELOG.md)


def add_train_args(parser):
    defaults = TrainConfig()
    parser.add_argument("--epochs", type=int, default=defaults.epochs)
    parser.add_argument("--alpha", type=float, default=defaults.alpha, help="tasa de aprendizaje inicial")
    parser.add_argument("--alpha-end", type=float, default=defaults.alpha_end, help="tasa de aprendizaje final")
    parser.add_argument("--gamma", type=float, default=defaults.gamma, help="factor de descuento")
    parser.add_argument("--epsilon-end", type=float, default=defaults.epsilon_end, help="exploración mínima")
    parser.add_argument("--epsilon-decay", type=float, default=defaults.epsilon_decay,
                        help="fracción de épocas en la que la exploración baja de 1 al mínimo")
    parser.add_argument("--seed", type=int, default=defaults.seed)
    parser.add_argument("--run-id", help="nombre de la ejecución (por defecto fecha-hora-semilla)")


def config_from_args(args):
    return TrainConfig(args.epochs, args.alpha, args.alpha_end, args.gamma, args.epsilon_end, args.epsilon_decay, args.seed)


# ---------- registro de ejecuciones ----------
def git_info():
    def git(*args):
        try:
            return subprocess.check_output(["git", *args], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
        except (OSError, subprocess.CalledProcessError):
            return None
    return {"commit": git("rev-parse", "--short=12", "HEAD"), "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
            "cambios_sin_commit": bool(git("status", "--porcelain"))}


def load_registry():
    if REGISTRY.exists():
        return json.loads(REGISTRY.read_text(encoding="utf-8"))
    return {"formato": DATA_FORMAT, "ultimo": None, "ejecuciones": []}


def run_dir(run_id=None):
    """Carpeta de una ejecución; sin argumento, la última del registro."""
    run_id = run_id or load_registry()["ultimo"]
    if run_id is None:
        raise SystemExit("No hay ejecuciones en resultados/runs. Entrena primero con: python cli.py entrenar")
    path = RUNS / run_id
    if not path.exists():
        raise SystemExit(f"No existe la ejecución {run_id}. Lista las disponibles con: python cli.py runs")
    return path


def model_path(run_id=None):
    return run_dir(run_id) / "modelo.npz"


def save_run(result, evaluation, run_id=None):
    """Guarda la ejecución en resultados/runs/<id>/ y la apunta en el registro. Devuelve su carpeta."""
    env, agent, config = result["env"], result["agent"], result["config"]
    run_id = run_id or f"{time.strftime('%Y%m%d-%H%M%S')}-s{config['seed']}"
    path = RUNS / run_id
    if path.exists():
        raise SystemExit(f"Ya existe la ejecución {run_id}; elige otro --run-id")
    path.mkdir(parents=True)

    agent.save(path / "modelo.npz")
    (path / "entrenamiento.json").write_text(
        json.dumps({"log": result["log"], "checks": result["checks"]}), encoding="utf-8")
    final_runs = []
    for k in range(3):
        meta, frames, steps = run_epoch(env, agent, seed=EVAL_SEED_BASE + k, learn=False, greedy=True)
        final_runs.append(episode_record("modelo final", meta, frames, steps))
    with gzip.open(path / "vuelos.json.gz", "wt", encoding="utf-8") as f:
        json.dump({"episodes": result["replays"] + final_runs}, f, default=float)

    rocket = RocketLanding3DEnv
    manifest = {
        "run_id": run_id,
        "fecha": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "formato": DATA_FORMAT,
        "git": git_info(),
        "ambiente": {
            "id": "RocketLanding3D-v0", "version": rocket.VERSION,
            "step_altitude": rocket.STEP_ALTITUDE, "step_time_limit": rocket.STEP_TIME_LIMIT, "max_steps": rocket.MAX_STEPS,
            "start_altitude": rocket.START_ALTITUDE, "pad_radius": rocket.PAD_RADIUS,
            "max_landing_vertical_speed": rocket.MAX_LANDING_VERTICAL_SPEED,
            "max_landing_horizontal_speed": rocket.MAX_LANDING_HORIZONTAL_SPEED,
            "max_landing_tilt": rocket.MAX_LANDING_TILT, "rewards": rocket.REWARDS,
        },
        "agente": {
            "tipo": "Q-learning con dos tablas (motor y dirección)",
            "acciones_motor": agente.ENGINE_ACTIONS, "inclinacion_lateral": agente.TILT,
            "direcciones": agente.DIRECTION_NAMES,
            "intervalos": {"altitud": agente.ALTITUDE_BINS, "velocidad_vertical": agente.VERTICAL_SPEED_BINS,
                           "deriva": agente.DRIFT_BINS, "tiempo_prediccion": agente.PREDICTION_TIME},
        },
        "config": config,
        "software": {"python": platform.python_version(), "gymnasium": gym.__version__, "numpy": np.__version__},
        "resultado": {
            "primer_aterrizaje": result["first_landing"], "mejor_epoca": result["best_epoch"],
            "evaluacion": evaluation, "epocas_grabadas": len(result["replays"]),
        },
        "archivos": {"modelo": "modelo.npz", "entrenamiento": "entrenamiento.json", "vuelos": "vuelos.json.gz"},
    }
    (path / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False, default=float), encoding="utf-8")

    registry = load_registry()
    git = manifest["git"]
    registry["ejecuciones"].append({
        "run_id": run_id, "fecha": manifest["fecha"],
        "commit": (git["commit"] or "—") + ("*" if git["cambios_sin_commit"] else ""),
        "ambiente": rocket.VERSION, "epochs": config["epochs"], "seed": config["seed"],
        "aterrizajes": evaluation["landing_rate"], "velocidad_contacto": evaluation["contact_speed"],
        "error_posicion": evaluation["position_error"], "primer_aterrizaje": result["first_landing"],
    })
    registry["ultimo"] = run_id
    REGISTRY.write_text(json.dumps(registry, indent=2, ensure_ascii=False, default=float), encoding="utf-8")
    return path


def page_data(run_id=None):
    """Reúne los datos de una ejecución en el formato que usan las plantillas HTML."""
    path = run_dir(run_id)
    manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    training = json.loads((path / "entrenamiento.json").read_text(encoding="utf-8"))
    with gzip.open(path / "vuelos.json.gz", "rt", encoding="utf-8") as f:
        flights = json.load(f)
    rocket = RocketLanding3DEnv
    return {
        "dt": rocket.DT,
        "pad_radius": rocket.PAD_RADIUS,
        "max_engine_temp": rocket.MAX_ENGINE_TEMP,
        "max_vz": rocket.MAX_LANDING_VERTICAL_SPEED,
        "max_steps": rocket.MAX_STEPS,
        "step_altitude": rocket.STEP_ALTITUDE,
        "start_altitude": rocket.START_ALTITUDE,
        "outcomes": OUTCOMES,
        "rewards": rocket.REWARDS,
        "params": manifest["config"],
        "first_landing": manifest["resultado"]["primer_aterrizaje"],
        "best_epoch": manifest["resultado"]["mejor_epoca"],
        "checks": training["checks"],
        "check_episodes": CHECK_EPISODES,
        "log": training["log"],
        "evaluation": manifest["resultado"]["evaluacion"]["outcomes"],
        "episodes": flights["episodes"],
        "run": {"id": manifest["run_id"], "fecha": manifest["fecha"], "commit": manifest["git"]["commit"],
                "ambiente": manifest["ambiente"]["version"]},
    }


def write_pages(run_id=None):
    """Genera las páginas HTML de una ejecución en la raíz del repo. Devuelve sus rutas."""
    data = page_data(run_id)
    paths = []
    for name in PAGES:
        write_page(name, data, ROOT / name)
        paths.append(ROOT / name)
    return paths


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_train_args(parser)
    parser.add_argument("--solo-pagina", action="store_true", help="no entrenar: regenerar las páginas de una ejecución")
    parser.add_argument("--run", help="con --solo-pagina, qué ejecución usar (por defecto la última)")
    args = parser.parse_args()

    if args.solo_pagina:
        for path in write_pages(args.run):
            print(f"Página guardada en {path}")
        return

    config = config_from_args(args)
    n = config.epochs
    record = {1, 10, 50, 100, 250, 500, n} | set(range(100, n, 100))  # para ver la progresión en 3D
    start = time.time()
    recent = collections.deque(maxlen=max(1, n // 10))

    def on_epoch(epoch, meta, agent):
        recent.append(meta)
        if epoch % max(1, n // 10) == 0:
            window = collections.Counter(m["reason"] for m in recent)
            print(f"época {epoch:6d}  exploración {agent.epsilon:.2f}  "
                  f"recompensa media {np.mean([m['reward'] for m in recent]):7.1f}  {dict(window)}  "
                  f"({time.time() - start:.0f} s)")

    result = train(config, record_epochs=record, on_epoch=on_epoch)
    print(f"\nMejor versión: época {result['best_epoch']}")
    evaluation = evaluate(result["env"], result["agent"], FINAL_EPISODES)
    print(f"Modelo final ({FINAL_EPISODES} épocas sin explorar): {evaluation['outcomes']}")
    path = save_run(result, evaluation, args.run_id)
    print(f"Ejecución guardada en {path}")
    for page in write_pages(path.name):
        print(f"Página guardada en {page}")


if __name__ == "__main__":
    main()
