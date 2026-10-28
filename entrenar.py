"""Entrena el agente Q-learning en RocketLanding3D-v0 y genera la página de su aprendizaje.

Cada época es un intento completo: de la salida (600 m) hasta aterrizar, chocar, salirse de
la zona o agotar los 50 pasos. Cada paso dura 20 m de desplazamiento vertical.
Para seguir el entrenamiento en la terminal, usa `python cli.py entrenar`.
"""
import argparse
import collections
import json
import time
from pathlib import Path

import numpy as np

from entrenamiento import CHECK_EPISODES, EVAL_SEED_BASE, OUTCOMES, TrainConfig, episode_record, evaluate, run_epoch, train
from rocket_env.rocket_landing import RocketLanding3DEnv
from visualizacion.datos import write_page

ROOT = Path(__file__).parent
RESULTS = ROOT / "resultados"
FINAL_EPISODES = 200  # épocas de la evaluación del modelo final


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


def config_from_args(args):
    return TrainConfig(args.epochs, args.alpha, args.alpha_end, args.gamma, args.epsilon_end, args.epsilon_decay, args.seed)


def save_results(result, evaluation, out="aprendizaje.html"):
    """Guarda las tablas Q, los datos del entrenamiento y la página HTML."""
    env, agent = result["env"], result["agent"]
    final_runs = []
    for k in range(3):
        meta, frames, steps = run_epoch(env, agent, seed=EVAL_SEED_BASE + k, learn=False, greedy=True)
        final_runs.append(episode_record("modelo final", meta, frames, steps))

    RESULTS.mkdir(exist_ok=True)
    agent.save(RESULTS / "q_tablas.npz")
    rocket = env.unwrapped
    data = {
        "dt": rocket.DT,
        "pad_radius": rocket.PAD_RADIUS,
        "max_engine_temp": rocket.MAX_ENGINE_TEMP,
        "max_vz": rocket.MAX_LANDING_VERTICAL_SPEED,
        "max_steps": rocket.MAX_STEPS,
        "step_altitude": rocket.STEP_ALTITUDE,
        "start_altitude": rocket.START_ALTITUDE,
        "outcomes": OUTCOMES,
        "rewards": RocketLanding3DEnv.REWARDS,
        "params": result["config"],
        "first_landing": result["first_landing"],
        "best_epoch": result["best_epoch"],
        "checks": result["checks"],
        "check_episodes": CHECK_EPISODES,
        "log": result["log"],
        "evaluation": evaluation["outcomes"],
        "episodes": result["replays"] + final_runs,
    }
    (RESULTS / "datos_pagina.json").write_text(json.dumps(data, default=float), encoding="utf-8")
    write_page("aprendizaje.html", data, ROOT / out)
    return ROOT / out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    add_train_args(parser)
    parser.add_argument("--out", default="aprendizaje.html")
    parser.add_argument("--solo-pagina", action="store_true",
                        help="no entrenar: regenerar la página con el último entrenamiento guardado")
    args = parser.parse_args()

    if args.solo_pagina:
        data = json.loads((RESULTS / "datos_pagina.json").read_text(encoding="utf-8"))
        write_page("aprendizaje.html", data, ROOT / args.out)
        print(f"Página guardada en {ROOT / args.out}")
        return

    config = config_from_args(args)
    n = config.epochs
    record = {1, 10, 50, 100, 250, 500, n} | set(range(1000, n, 1000))
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
    print(f"Página guardada en {save_results(result, evaluation, args.out)}")


if __name__ == "__main__":
    main()
