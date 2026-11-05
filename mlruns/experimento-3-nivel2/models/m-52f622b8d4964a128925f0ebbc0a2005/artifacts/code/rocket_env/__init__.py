from gymnasium.envs.registration import register

from .nivel2 import AdaptadorN1, RocketLandingN2Env
from .rocket_landing import RocketLanding3DEnv

# Sin max_episode_steps: el propio entorno termina la época al agotar sus 50 pasos.
register(id=RocketLanding3DEnv.ID, entry_point="rocket_env.rocket_landing:RocketLanding3DEnv")
register(id=RocketLandingN2Env.ID, entry_point="rocket_env.nivel2:RocketLandingN2Env")

# Un ambiente por nivel. Cada modelo se entrena y se evalúa en el suyo (lo dice su manifest).
AMBIENTES = {RocketLanding3DEnv.ID: RocketLanding3DEnv, RocketLandingN2Env.ID: RocketLandingN2Env}
# Resultados posibles de una época en cualquier nivel; los cinco primeros son los del nivel 1 y su índice no cambia
OUTCOMES = RocketLandingN2Env.OUTCOMES


def clase_ambiente(ambiente_id):
    """Clase del ambiente a partir de su id (p. ej. "RocketLanding3D-v0")."""
    try:
        return AMBIENTES[ambiente_id]
    except KeyError:
        raise KeyError(f"Ambiente desconocido: {ambiente_id}. Conocidos: {', '.join(AMBIENTES)}") from None


__all__ = ["AMBIENTES", "OUTCOMES", "AdaptadorN1", "RocketLanding3DEnv", "RocketLandingN2Env", "clase_ambiente"]
