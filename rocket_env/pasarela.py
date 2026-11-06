"""Niveles 2 y 3 con pasarela (ambientes 0.4 y 0.5): `RocketLanding3D-N2-v1` y `RocketLanding3D-N3-v1`.

Sustituye a las torres de los ambientes 0.2 y 0.3 (que siguen registrados para los modelos históricos). Una pasarela
horizontal de 90 m de radio cubre la plataforma a 180 m de altura; la única forma de bajar es una abertura circular
de 12 m de radio desplazada 30 m del centro. La decisión nueva: alinearse con la abertura antes de llegar a la
pasarela y, una vez debajo, trasladarse en horizontal hasta la plataforma mientras se frena. Chocar con la pasarela
o con uno de sus cuatro pilares termina la época con "colisión" (−100).

Observación: los 16 valores del nivel 1 más 4 (posición relativa de la abertura, altura que queda hasta la pasarela
y margen hasta el borde de la abertura): familia nueva de modelos. `AdaptadorN1` (rocket_env/nivel2.py) deja jugar
a un modelo del nivel 1 a ciegas, que mide la dificultad del nivel. El nivel 3 es el mismo mundo con viento de hasta
15 m/s y ráfagas dobles, como en el ambiente 0.3.
"""
import numpy as np
from gymnasium import spaces

from .rocket_landing import RocketLanding3DEnv


class RocketLandingPasarelaEnv(RocketLanding3DEnv):
    """Nivel 2 (v1): pasarela con abertura desplazada. Hereda toda la física del nivel 1."""

    ID = "RocketLanding3D-N2-v1"
    NIVEL = "N2"
    VERSION = "0.4"
    RESUMEN = "El nivel 1 más una pasarela que cubre la plataforma a 180 m con una sola abertura, desplazada 30 m del centro: hay que entrar por ella y después trasladarse hasta la plataforma por debajo."
    NOVEDAD = "Decisión de ruta en dos tiempos (alinearse con la abertura, luego volver al centro); resultado nuevo \"colisión\" (−100); observación de 20 valores (familia nueva); el potencial apunta a la abertura mientras el cohete está por encima de la pasarela."
    FICHA = "docs/ambiente-v0.4.md"

    ROCKET_RADIUS = 3.0  # m: radio del fuselaje para la colisión
    PASARELA = {"nombre": "pasarela", "altura": 180.0, "radio": 90.0, "grosor": 3.0, "abertura": {"x": 28.0, "y": 12.0, "radio": 12.0}}
    # cuatro pilares en el borde de la pasarela (fuera del cuadrado de salida de ±50 m); chocar con ellos también es colisión
    PILARES = tuple(
        {"nombre": f"pilar {k + 1}", "x": round(float(np.cos(np.radians(az))) * 90.0, 2), "y": round(float(np.sin(np.radians(az))) * 90.0, 2), "radio": 2.5, "altura": 180.0}
        for k, az in enumerate((45.0, 135.0, 225.0, 315.0))
    )
    MARGEN_PASARELA = 20.0  # m por encima de la pasarela en los que el potencial castiga estar fuera de la abertura
    PESO_PASARELA = 8.0

    REWARDS = {**RocketLanding3DEnv.REWARDS, "colisión": -100.0}
    OUTCOMES = list(REWARDS)
    OBS_N1 = 16

    def __init__(self, render_mode=None):
        super().__init__(render_mode)
        self.observation_space = spaces.Box(low=-1e4, high=1e4, shape=(self.OBS_N1 + 4,), dtype=np.float32)
        self._z_antes = self.START_ALTITUDE

    @classmethod
    def obstaculos(cls):
        p, a = cls.PASARELA, cls.PASARELA["abertura"]
        return [{"tipo": "pasarela", "nombre": p["nombre"], "x": a["x"], "y": a["y"], "radio_abertura": a["radio"], "altura": p["altura"],
                 "radio": p["radio"], "grosor": p["grosor"]}] + [{"tipo": "torre", **o} for o in cls.PILARES]

    def distancia_abertura(self):
        """Distancia horizontal (m) del eje del cohete al centro de la abertura."""
        a = self.PASARELA["abertura"]
        return float(np.hypot(self.position[0] - a["x"], self.position[1] - a["y"]))

    def sobre_pasarela(self):
        return self.position[2] > self.PASARELA["altura"] + self.PASARELA["grosor"] / 2

    def reset(self, *, seed=None, options=None):
        obs, info = super().reset(seed=seed, options=options)
        self._z_antes = self.position[2]
        return obs, info

    def _simulate(self, engine_cmd, throttle, direction):
        self._z_antes = self.position[2]
        return super()._simulate(engine_cmd, throttle, direction)

    def _check_outcome(self):
        x, y, z = self.position
        if z > 0.0:
            p = self.PASARELA
            alto, bajo = p["altura"] + p["grosor"] / 2, p["altura"] - p["grosor"] / 2
            cruza = (self._z_antes >= alto and z <= alto) or (self._z_antes <= bajo and z >= bajo) or (bajo < z < alto)
            if cruza and np.hypot(x, y) <= p["radio"] and self.distancia_abertura() + self.ROCKET_RADIUS > p["abertura"]["radio"]:
                return "colisión"
            for o in self.PILARES:
                if z < o["altura"] and np.hypot(x - o["x"], y - o["y"]) <= o["radio"] + self.ROCKET_RADIUS:
                    return "colisión"
        return super()._check_outcome()

    def _shaping(self):
        """Potencial del nivel 1, pero mientras el cohete está por encima de la pasarela el objetivo horizontal es la
        abertura (no la plataforma), y acercarse a la pasarela fuera de la abertura cuesta hasta PESO_PASARELA puntos."""
        p = self.PASARELA
        encima = self.sobre_pasarela()
        objetivo = self.distancia_abertura() if encima else float(np.hypot(self.position[0], self.position[1]))
        horizontal_speed = float(np.hypot(self.velocity[0], self.velocity[1]))
        descent_error = abs(self.velocity[2] - self.safe_descent_speed(self.position[2]))
        castigo = 0.0
        if encima:
            margen_borde = p["abertura"]["radio"] - self.ROCKET_RADIUS - self.distancia_abertura()  # > 0: dentro de la abertura
            altura = self.position[2] - p["altura"]
            if margen_borde < 0.0 and altura < self.MARGEN_PASARELA:
                castigo = 1.0 - altura / self.MARGEN_PASARELA
        return -objetivo / 5.0 - horizontal_speed - descent_error - self.position[2] / 10.0 - self.PESO_PASARELA * castigo

    def _get_obs(self):
        p, a = self.PASARELA, self.PASARELA["abertura"]
        extra = [a["x"] - self.position[0], a["y"] - self.position[1], p["altura"] - self.position[2], a["radio"] - self.distancia_abertura()]
        return np.concatenate([super()._get_obs(), np.asarray(extra, dtype=np.float32)]).astype(np.float32)

    def _get_info(self):
        info = super()._get_info()
        info["distancia_abertura_m"] = self.distancia_abertura()
        info["sobre_pasarela"] = bool(self.sobre_pasarela())
        return info


class RocketLandingPasarelaVientoEnv(RocketLandingPasarelaEnv):
    """Nivel 3 (v1): la pasarela con viento de hasta 15 m/s y ráfagas el doble de fuertes."""

    ID = "RocketLanding3D-N3-v1"
    NIVEL = "N3"
    VERSION = "0.5"
    RESUMEN = "La pasarela del nivel 2 en condiciones de operación exigentes: viento de 0 a 15 m/s y ráfagas el doble de fuertes."
    NOVEDAD = "Misma observación y acción que el nivel 2 con pasarela (misma familia): un modelo de ese nivel juega aquí tal cual y se mide cuánto se degrada (incidente)."
    FICHA = "docs/ambiente-v0.5.md"

    VIENTO_MAX = 15.0
    RAFAGAS = 3.0
