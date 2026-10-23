"""Comprueba que el entorno LunarLander funciona con un agente aleatorio."""
import argparse

import gymnasium as gym

parser = argparse.ArgumentParser()
parser.add_argument("--render", action="store_true", help="abrir ventana con la simulación")
args = parser.parse_args()

env = gym.make("LunarLander-v3", render_mode="human" if args.render else None)
obs, info = env.reset(seed=42)
total_reward = 0.0
terminated = truncated = False
while not (terminated or truncated):
    obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
    total_reward += reward
env.close()

print(f"Gymnasium {gym.__version__} OK - recompensa del episodio aleatorio: {total_reward:.1f}")
