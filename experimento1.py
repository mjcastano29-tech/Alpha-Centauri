"""Experimento 1: prueba básica del entorno RocketLanding3D-v0.

Compara un agente aleatorio con un controlador sencillo hecho a mano, para comprobar
que el entorno funciona y que aterrizar es posible.
"""
import argparse

import gymnasium as gym
import numpy as np
from gymnasium.utils.env_checker import check_env

import rocket_env  # noqa: F401  (registra RocketLanding3D-v0)
from rocket_env.atmosphere import G0


def random_agent(env, obs):
    return env.action_space.sample()


def heuristic_agent(env, obs):
    """Controlador de velocidad: decide a qué velocidad quiere ir y empuja para conseguirla."""
    position, velocity = obs[0:3], obs[3:6]
    rocket = env.unwrapped

    # Velocidad deseada: ir hacia la plataforma y bajar más despacio cuanto más cerca del suelo
    desired = np.zeros(3)
    desired[:2] = np.clip(-0.1 * position[:2], -8.0, 8.0)
    desired[2] = -np.clip(0.08 * position[2], 1.0, 30.0)

    # Aceleración necesaria (compensando la gravedad) y empuje para conseguirla.
    # Ganancias suaves porque cada acción se mantiene durante un paso de 20 m.
    acceleration = 0.3 * (desired - velocity) + np.array([0.0, 0.0, G0])
    mass = rocket.DRY_MASS + rocket.fuel
    force = mass * acceleration
    max_thrust = rocket.MAX_THRUST_VACUUM - obs[10] * 1000.0 * rocket.NOZZLE_EXIT_AREA
    throttle = np.clip(np.linalg.norm(force) / max_thrust, 0.0, 1.0)
    engine = 1.0 if throttle > 0.05 else -1.0
    direction = force / (np.linalg.norm(force) + 1e-8)
    return np.array([engine, throttle, *direction], dtype=np.float32)


def run_episode(env, agent, seed, verbose=False):
    obs, info = env.reset(seed=seed)
    total_reward = 0.0
    while True:
        obs, reward, terminated, truncated, info = env.step(agent(env, obs))
        total_reward += reward
        if verbose and env.unwrapped.render_mode == "ansi":
            print(env.render())
        if terminated or truncated:
            return total_reward, info


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--episodes", type=int, default=20)
    parser.add_argument("--verbose", action="store_true", help="mostrar cada paso del primer episodio")
    args = parser.parse_args()

    check_env(gym.make("RocketLanding3D-v0").unwrapped)
    print("check_env de Gymnasium: OK\n")

    env = gym.make("RocketLanding3D-v0", render_mode="ansi")
    for name, agent in [("aleatorio", random_agent), ("heurístico", heuristic_agent)]:
        env.action_space.seed(0)
        rewards, landings = [], 0
        for episode in range(args.episodes):
            reward, info = run_episode(env, agent, seed=episode, verbose=args.verbose and episode == 0)
            rewards.append(reward)
            landings += info["landed"]
        print(
            f"Agente {name:10s}: recompensa media {np.mean(rewards):7.1f} | "
            f"aterrizajes {landings}/{args.episodes}"
        )
    env.close()


if __name__ == "__main__":
    main()
