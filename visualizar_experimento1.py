"""Genera una página HTML interactiva con épocas del experimento 1.

Graba varias épocas (controlador heurístico y agente aleatorio) y las inserta en
visualizacion/plantilla.html. El resultado se abre directamente en el navegador.
"""
import argparse
from pathlib import Path

import gymnasium as gym

import rocket_env  # noqa: F401  (registra RocketLanding3D-v0)
from experimento1 import heuristic_agent, random_agent
from visualizacion.datos import summary, trajectory_columns, weather, write_page

ROOT = Path(__file__).parent


def record_episode(env, agent_name, agent, seed):
    obs, info = env.reset(seed=seed)
    meta = {"agent": agent_name, "seed": seed, **weather(env)}
    frames = list(info["trajectory"])
    total_reward, steps = 0.0, 0
    while True:
        obs, reward, terminated, truncated, info = env.step(agent(env, obs))
        frames.extend(info["trajectory"])
        total_reward += reward
        steps += 1
        if terminated or truncated:
            break
    meta.update(summary(env, frames, info["outcome"], total_reward, steps))
    return {**meta, "f": trajectory_columns(frames)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--heuristic", type=int, default=5, help="épocas del controlador heurístico")
    parser.add_argument("--random", type=int, default=2, help="épocas del agente aleatorio")
    parser.add_argument("--out", default="experimento1.html")
    args = parser.parse_args()

    env = gym.make("RocketLanding3D-v0")
    env.action_space.seed(0)
    episodes = [record_episode(env, "heurístico", heuristic_agent, s) for s in range(args.heuristic)]
    episodes += [record_episode(env, "aleatorio", random_agent, s) for s in range(args.random)]
    env.close()

    rocket = env.unwrapped
    data = {
        "dt": rocket.DT,
        "pad_radius": rocket.PAD_RADIUS,
        "max_engine_temp": rocket.MAX_ENGINE_TEMP,
        "max_vz": rocket.MAX_LANDING_VERTICAL_SPEED,
        "episodes": episodes,
    }
    write_page("plantilla.html", data, ROOT / args.out)
    print(f"Visualización guardada en {ROOT / args.out} ({len(episodes)} épocas)")


if __name__ == "__main__":
    main()
