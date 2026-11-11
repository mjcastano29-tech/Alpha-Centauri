"""Nivel 2 · ambiente 0.2: obstáculos junto a la plataforma (`RocketLanding3D-N2-v0`).

Mismo cohete, misma atmósfera, misma plataforma y mismas reglas de aterrizaje que el nivel 1, más tres
torres altas alrededor de la plataforma. Chocar con una torre termina la época con el resultado "colisión" (−100).
El agente las ve en la observación (posición relativa y altura que le queda por encima) y tiene que
decidir la ruta de aproximación: por qué hueco entre torres baja y cuándo alinearse con él.

Es una familia nueva de modelos: la observación pasa de 16 a 25 valores, así que una política del
nivel 1 no puede jugar aquí tal cual. `AdaptadorN1` recorta la observación a los 16 valores del nivel 1
para medir cuánto se degrada un modelo del nivel 1 que ignora las torres (mide la dificultad del nivel).
"""
import gymnasium as gym
import numpy as np
from gymnasium import spaces

from .rocket_landing import RocketLanding3DEnv


class RocketLandingN2Env(RocketLanding3DEnv):
    """Nivel 2: torres junto a la plataforma. Hereda toda la física del nivel 1."""

    ID = "RocketLanding3D-N2-v0"
    NIVEL = "N2"
    VERSION = "0.2"
    RESUMEN = "El nivel 1 más tres torres de 300 a 420 m alrededor de la plataforma: hay que elegir por qué hueco entrar antes de bajar de sus cimas."
    NOVEDAD = "Decisión de ruta; resultado nuevo \"colisión\" (−100); observación de 25 valores (familia nueva de modelos); castigo de proximidad en el potencial."
    FICHA = "docs/ambiente-v0.2.md"

    ROCKET_RADIUS = 3.0  # m: radio del fuselaje; chocar es que el eje pase a menos de radio + ROCKET_RADIUS de la torre
    # Tres torres altas alrededor de la plataforma, a 120° entre sí y a 28 m del centro: desde casi cualquier salida
    # la ruta recta hacia la plataforma choca con una, así que el agente tiene que elegir por qué hueco entra
    # (34 m libres entre torres) antes de bajar de sus cimas. Las tres tienen alturas distintas.
    OBSTACULOS = tuple(
        {"nombre": f"torre {letra}", "x": round(float(np.cos(np.radians(az))) * 28.0, 2), "y": round(float(np.sin(np.radians(az))) * 28.0, 2), "radio": 7.0, "altura": altura}
        for letra, az, altura in (("A", 15.0, 420.0), ("B", 135.0, 360.0), ("C", 255.0, 300.0))
    )
    MARGEN_OBSTACULO = 15.0  # m: a menos de esta distancia de una torre el shaping empieza a penalizar
    PESO_OBSTACULO = 8.0  # puntos de potencial que cuesta pegarse a una torre

    REWARDS = {**RocketLanding3DEnv.REWARDS, "colisión": -100.0}  # chocar con una torre
    OUTCOMES = list(REWARDS)
    OBS_N1 = 16  # tamaño de la observación del nivel 1 (los primeros valores son idénticos)

    def __init__(self, render_mode=None):
        super().__init__(render_mode)
        self.observation_space = spaces.Box(low=-1e4, high=1e4, shape=(self.OBS_N1 + 3 * len(self.OBSTACULOS),), dtype=np.float32)

    @classmethod
    def obstaculos(cls):
        return [dict(o) for o in cls.OBSTACULOS]

    def distancia_obstaculo(self, obstaculo):
        """Distancia horizontal (m) del eje del cohete a la superficie de la torre; negativa si está dentro."""
        return float(np.hypot(self.position[0] - obstaculo["x"], self.position[1] - obstaculo["y"]) - obstaculo["radio"] - self.ROCKET_RADIUS)

    def _check_outcome(self):
        z = self.position[2]
        if z > 0.0:
            for o in self.OBSTACULOS:
                if z < o["altura"] and self.distancia_obstaculo(o) <= 0.0:
                    return "colisión"
        return super()._check_outcome()

    def _shaping(self):
        """Potencial del nivel 1 menos un castigo por acercarse a una torre estando por debajo de su cima (+20 m)."""
        penalty = 0.0
        z = self.position[2]
        for o in self.OBSTACULOS:
            if z < o["altura"] + 20.0:
                penalty += max(0.0, 1.0 - self.distancia_obstaculo(o) / self.MARGEN_OBSTACULO)
        return super()._shaping() - self.PESO_OBSTACULO * penalty

    def _get_obs(self):
        extra = []
        for o in self.OBSTACULOS:  # posición relativa de cada torre y cuánta altura le queda por encima del cohete
            extra += [o["x"] - self.position[0], o["y"] - self.position[1], o["altura"] - self.position[2]]
        return np.concatenate([super()._get_obs(), np.asarray(extra, dtype=np.float32)]).astype(np.float32)

    def _get_info(self):
        info = super()._get_info()
        info["distancia_obstaculo_m"] = min(self.distancia_obstaculo(o) for o in self.OBSTACULOS)
        return info


class AdaptadorN1(gym.ObservationWrapper):
    """Deja que un modelo del nivel 1 juegue en el nivel 2: solo ve los 16 valores del nivel 1 (ignora las torres)."""

    def __init__(self, env):
        super().__init__(env)
        n = RocketLandingN2Env.OBS_N1
        base = env.observation_space
        self.observation_space = spaces.Box(low=base.low[:n], high=base.high[:n], dtype=np.float32)

    def observation(self, obs):
        return obs[: RocketLandingN2Env.OBS_N1]
