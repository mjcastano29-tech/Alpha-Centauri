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
from rocket_env.atmosphere import G0
from rocket_env.rocket_landing import RocketLanding3DEnv as Rocket

# Acción relativa (v2): la red emite 3 valores en [-1, 1]. El primero es el empuje alrededor de flotar
# (0 -> ×1.0 el peso, -1 -> motor apagado, +0.6 -> ×1.6); los otros dos, la inclinación en x e y hasta
# ±TILT_MAX por eje, que combinados no superan el límite de 10° del aterrizaje. Es la misma idea que
# hizo aprendible el Q-learning del experimento 1, y la red arranca flotando en vez de cayendo.
ACCION_RELATIVA = gym.spaces.Box(low=-np.ones(3, dtype=np.float32), high=np.ones(3, dtype=np.float32))
TILT_MAX = 0.12
TWR_MAX = 1.6
# v1 (ejecución ppo-rel-v0.1-s0): la red emitía el empuje/peso directo en [0, 1.6] e inclinación ±0.3
ACCION_RELATIVA_V1 = gym.spaces.Box(low=np.array([0.0, -0.3, -0.3], dtype=np.float32),
                                    high=np.array([1.6, 0.3, 0.3], dtype=np.float32))


def accion_relativa_a_entorno(obs, a, v1=False):
    """Convierte la acción relativa de la red en la acción continua de 5 valores del entorno."""
    if v1:
        twr, tx, ty = float(a[0]), float(a[1]), float(a[2])
    else:
        twr, tx, ty = min(TWR_MAX, 1.0 + float(a[0])), float(a[1]) * TILT_MAX, float(a[2]) * TILT_MAX
    if twr < 0.05:
        return np.array([-1.0, 0.0, 0.0, 0.0, 1.0], dtype=np.float32)
    mass = Rocket.DRY_MASS + float(obs[12]) * Rocket.FUEL_MASS
    max_thrust = Rocket.MAX_THRUST_VACUUM - float(obs[10]) * 1000.0 * Rocket.NOZZLE_EXIT_AREA
    vector = np.array([tx, ty, 1.0])
    throttle = min(1.0, twr * mass * G0 / max_thrust * float(np.linalg.norm(vector)))
    return np.array([1.0, throttle, *vector], dtype=np.float32)


class AccionRelativa(gym.ActionWrapper):
    """Envoltorio del entorno para entrenar con la acción relativa. El entorno no cambia."""

    def __init__(self, env):
        super().__init__(env)
        self.action_space = ACCION_RELATIVA
        self._obs = None

    def reset(self, **kwargs):
        obs, info = self.env.reset(**kwargs)
        self._obs = obs
        return obs, info

    def step(self, action):
        obs, reward, terminated, truncated, info = self.env.step(self.action(action))
        self._obs = obs
        return obs, reward, terminated, truncated, info

    def action(self, a):
        return accion_relativa_a_entorno(self._obs, np.clip(a, self.action_space.low, self.action_space.high))


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
        self.relativa = model.action_space.shape[0] == 3  # acción relativa (3) o cruda del entorno (5)
        self.v1 = self.relativa and float(model.action_space.high[0]) > 1.0  # parametrización antigua

    def act(self, obs, greedy=False):
        """Devuelve (acción para el entorno, acción de la red, etiqueta). greedy=True quita el ruido."""
        o = np.asarray(obs, dtype=np.float32)[None]
        if self.normalizer is not None:
            o = self.normalizer.normalize_obs(o)
        action, _ = self.model.predict(o, deterministic=greedy)
        action = np.asarray(action[0], dtype=np.float32)
        if self.relativa:
            env_action = accion_relativa_a_entorno(obs, action, self.v1)
            twr = float(action[0]) if self.v1 else min(TWR_MAX, 1.0 + float(action[0]))
            label = "motor apagado" if twr < 0.05 else f"empuje ×{twr:.2f} · " + describe_action(env_action).split(" · ")[1]
            return env_action, action, label
        return action, action, describe_action(action)

    def learn(self, *args):
        """No aprende paso a paso: PPO entrena por lotes dentro de model.learn()."""

    def info(self):
        return {
            "clase": self.TIPO,
            "nombre": "PPO (red neuronal)",
            "tipo": "PPO (Stable-Baselines3): red neuronal MLP sobre la acción continua del entorno",
            "red": str(getattr(self.model, "policy_kwargs", {}).get("net_arch")),
            "accion": ("relativa v1: empuje/peso en [0, 1.6] e inclinación ±0.3" if self.v1 else
                       f"relativa v2: 3 valores en [-1, 1]; empuje = 1 + a0 (máx. {TWR_MAX}), inclinación = a1, a2 × {TILT_MAX}")
                      if self.relativa else "cruda: los 5 valores del entorno",
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
