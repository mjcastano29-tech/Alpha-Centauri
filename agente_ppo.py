"""Agente PPO: una red neuronal (PyTorch, vía Stable-Baselines3) que actúa sobre la acción continua
del entorno. Es el modelo del experimento 2.

Aprende dentro de `entrenar_ppo.py`; aquí solo está el envoltorio que lo hace intercambiable con el
agente Q-learning del experimento 1: act / info / save / load.
"""
from pathlib import Path

import gymnasium as gym
import numpy as np
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv, VecNormalize

import rocket_env  # noqa: F401  (registra RocketLanding3D-v0)


def describe_action(action):
    """Etiqueta legible de una acción continua del entorno."""
    if action[0] <= 0:
        return "motor apagado"
    d = np.asarray(action[2:5], dtype=float)
    n = np.linalg.norm(d)
    d = d / n if n > 1e-6 else np.array([0.0, 0.0, 1.0])
    tilt = np.degrees(np.arccos(np.clip(d[2], -1.0, 1.0)))
    if tilt < 1.5:
        hacia = "recto"
    else:
        lado = ("+x" if d[0] > 0 else "-x") if abs(d[0]) >= abs(d[1]) else ("+y" if d[1] > 0 else "-y")
        hacia = f"{tilt:.0f}° hacia {lado}"
    return f"acelerador {action[1] * 100:.0f} % · {hacia}"


class PPOAgent:
    TIPO = "ppo"

    def __init__(self, model, normalizer, hiperparametros=None):
        self.model = model
        self.normalizer = normalizer  # VecNormalize: la red ve la observación normalizada
        self.hiperparametros = hiperparametros or {}

    def act(self, obs, greedy=False):
        """Devuelve (acción para el entorno, acción cruda, etiqueta). greedy=True quita el ruido."""
        o = np.asarray(obs, dtype=np.float32)[None]
        if self.normalizer is not None:
            o = self.normalizer.normalize_obs(o)
        action, _ = self.model.predict(o, deterministic=greedy)
        action = np.asarray(action[0], dtype=np.float32)
        return action, action, describe_action(action)

    def learn(self, *args):
        """No aprende paso a paso: PPO entrena por lotes dentro de model.learn()."""

    def info(self):
        return {
            "clase": self.TIPO,
            "nombre": "PPO (red neuronal)",
            "tipo": "PPO (Stable-Baselines3): red neuronal MLP sobre la acción continua del entorno",
            "red": str(getattr(self.model, "policy_kwargs", {}).get("net_arch")),
            "hiperparametros": self.hiperparametros,
        }

    def save(self, path):
        """Guarda <path>.zip (red y optimizador) y <path>_normalizador.pkl. Devuelve los nombres."""
        path = str(path)
        self.model.save(path + ".zip")
        self.normalizer.save(path + "_normalizador.pkl")
        return [Path(path).name + ".zip", Path(path).name + "_normalizador.pkl"]

    @classmethod
    def load(cls, path):
        path = str(path)
        model = PPO.load(path + ".zip", device="cpu")
        normalizer = VecNormalize.load(path + "_normalizador.pkl", DummyVecEnv([lambda: gym.make("RocketLanding3D-v0")]))
        normalizer.training = False
        normalizer.norm_reward = False
        return cls(model, normalizer)
