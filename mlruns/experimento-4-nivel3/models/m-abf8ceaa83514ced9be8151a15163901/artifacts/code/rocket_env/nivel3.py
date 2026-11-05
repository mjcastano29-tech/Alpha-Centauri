"""Nivel 3 · ambiente 0.3: operación exigente (`RocketLanding3D-N3-v0`).

El mundo del nivel 2 (mismas torres, misma plataforma, mismas reglas de aterrizaje y de colisión) con un cambio
de condiciones de operación: el viento a 10 m se sortea entre 0 y 15 m/s en vez de entre 0 y 10, y las ráfagas
duplican su intensidad (3 m/s en vez de 1,5). Es el incidente controlado del proyecto: el viento lateral fuerte
que en los niveles 1 y 2 solo era una condición de la suite pasa a ser la operación normal.

La observación (25 valores) y la acción son las del nivel 2, así que es la misma familia de modelos: un modelo del
nivel 2 juega aquí tal cual, sin adaptador, y eso mide la degradación al cambiar las condiciones. La intervención es
reentrenarlo en este ambiente partiendo de sus pesos (`--desde`).
"""
from .nivel2 import RocketLandingN2Env


class RocketLandingN3Env(RocketLandingN2Env):
    """Nivel 3: el nivel 2 con viento de hasta 15 m/s y ráfagas el doble de fuertes."""

    ID = "RocketLanding3D-N3-v0"
    NIVEL = "N3"
    VERSION = "0.3"

    VIENTO_MAX = 15.0  # m/s a 10 m (nivel 2: 10)
    RAFAGAS = 3.0  # m/s (nivel 2: 1,5)
