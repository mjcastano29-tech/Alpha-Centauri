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
import csv
import gzip
import json
import platform
import subprocess
import time
from pathlib import Path

import gymnasium as gym
import numpy as np

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
            # mlflow.db y mlruns/ cambian durante el propio entrenamiento (registro en directo): no cuentan
            "cambios_sin_commit": bool(git("status", "--porcelain", "--untracked-files=no", "--", ".", ":!mlflow.db", ":!mlruns"))}


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


def load_agent(run_id=None):
    """Carga el modelo de una ejecución, sea Q-learning o PPO. Devuelve (agente, carpeta)."""
    path = run_dir(run_id)
    manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    clase = manifest["agente"].get("clase", "qlearning")
    if clase == "ppo":
        from agente_ppo import PPOAgent  # import tardío: carga PyTorch solo si hace falta
        return PPOAgent.load(path / "modelo"), path
    from agente_qlearning import QLearningAgent
    return QLearningAgent.load(path / "modelo"), path


NOTAS_AGENTE = {
    "qlearning": [
        "Guarda dos tablas de valores: una para el motor (según altitud y velocidad vertical) y otra para la dirección (según hacia dónde deriva respecto a la plataforma).",
        "En cada paso elige la acción con más valor, salvo una fracción ε de las veces en que prueba una al azar para explorar. ε empieza en 1 (todo al azar) y baja con las épocas.",
        "Después de cada paso ajusta el valor de la acción elegida con los puntos recibidos más el valor de la mejor acción siguiente.",
    ],
    "ppo": [
        "Una red neuronal (perceptrón multicapa) recibe la observación normalizada y produce la media de una distribución sobre las 5 acciones continuas; otra cabeza de la red estima cuánto vale el estado.",
        "Juega en 8 entornos a la vez y cada 2048 pasos ajusta la red con PPO: sube la probabilidad de las acciones que salieron mejor de lo previsto, sin alejarse demasiado de la política anterior.",
        "La exploración viene del ruido de la distribución, no de una ε: por eso la gráfica de ε no aplica.",
        "Cada 20 000 pasos se evalúa sin ruido en 50 épocas y se conserva la mejor versión.",
    ],
}


def save_run(result, evaluation, run_id=None, experimento="experimento-1-qlearning", software_extra=None):
    """Guarda la ejecución en resultados/runs/<id>/ y la apunta en el registro. Devuelve su carpeta."""
    env, agent, config = result["env"], result["agent"], result["config"]
    run_id = run_id or f"{time.strftime('%Y%m%d-%H%M%S')}-s{config.get('seed', 0)}"
    path = RUNS / run_id
    if path.exists():
        raise SystemExit(f"Ya existe la ejecución {run_id}; elige otro --run-id")
    path.mkdir(parents=True)

    model_files = agent.save(path / "modelo")
    (path / "entrenamiento.json").write_text(
        json.dumps({"log": result["log"], "checks": result["checks"]}), encoding="utf-8")
    log = result["log"]
    with (path / "episodios.csv").open("w", newline="", encoding="utf-8") as f:
        columns = ["epoca", "recompensa", "pasos", "resultado", "combustible_kg"] + (["epsilon"] if log.get("epsilon") else [])
        writer = csv.writer(f)
        writer.writerow(columns)
        for k in range(len(log["reward"])):
            row = [k + 1, log["reward"][k], log["steps"][k], OUTCOMES[log["outcome"][k]], log["fuel"][k]]
            if log.get("epsilon"):
                row.append(log["epsilon"][k])
            writer.writerow(row)
    final_runs = []
    for k in range(3):
        meta, frames, steps = run_epoch(env, agent, seed=EVAL_SEED_BASE + k, learn=False, greedy=True)
        final_runs.append(episode_record("modelo final", meta, frames, steps))
    with gzip.open(path / "vuelos.json.gz", "wt", encoding="utf-8") as f:
        json.dump({"episodes": result["replays"] + final_runs}, f, default=float)

    rocket = RocketLanding3DEnv
    manifest = {
        "run_id": run_id,
        "experimento": experimento,
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
        "agente": agent.info(),
        "config": config,
        "software": {"python": platform.python_version(), "gymnasium": gym.__version__, "numpy": np.__version__,
                     **(software_extra or {})},
        "resultado": {
            "primer_aterrizaje": result["first_landing"], "mejor_epoca": result["best_epoch"],
            "evaluacion": evaluation, "epocas_grabadas": len(result["replays"]),
        },
        "archivos": {"modelo": model_files, "entrenamiento": "entrenamiento.json", "episodios": "episodios.csv",
                     "vuelos": "vuelos.json.gz"},
    }
    (path / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False, default=float), encoding="utf-8")

    registry = load_registry()
    git = manifest["git"]
    registry["ejecuciones"].append({
        "run_id": run_id, "experimento": experimento, "agente": agent.info().get("nombre", ""), "fecha": manifest["fecha"],
        "commit": (git["commit"] or "—") + ("*" if git["cambios_sin_commit"] else ""),
        "ambiente": rocket.VERSION, "epochs": len(log["reward"]), "seed": config.get("seed"),
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
        "agente": manifest["agente"].get("nombre", "Q-learning"),
        "agente_notas": NOTAS_AGENTE.get(manifest["agente"].get("clase", "qlearning"), []),
        "run": {"id": manifest["run_id"], "experimento": manifest.get("experimento"), "fecha": manifest["fecha"],
                "commit": manifest["git"]["commit"], "ambiente": manifest["ambiente"]["version"]},
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
    import seguimiento  # import tardío: MLflow tarda en cargar
    seguimiento.registrar_ejecucion(path)
    for page in write_pages(path.name):
        print(f"Página guardada en {page}")


if __name__ == "__main__":
    main()
