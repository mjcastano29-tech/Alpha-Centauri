"""Pruebas del contrato del nivel 3 (ambiente 0.3, `RocketLanding3D-N3-v0`): el nivel 2 con viento fuerte."""
import gymnasium as gym
import numpy as np
import pytest
from gymnasium.utils.env_checker import check_env

import rocket_env  # noqa: F401  (registra los ambientes)
from entrenar import hacer_entorno
from rocket_env import AdaptadorN1, clase_ambiente
from rocket_env.nivel2 import RocketLandingN2Env as N2
from rocket_env.nivel3 import RocketLandingN3Env as N3
from rocket_env.rocket_landing import RocketLanding3DEnv as N1


def manifest_de(ambiente_id):
    return {"ambiente": {"id": ambiente_id}}


def test_cumple_el_contrato_de_gymnasium():
    check_env(N3(), skip_render_check=True)


def test_misma_familia_que_el_nivel_2_con_otras_condiciones():
    """Observación, acción, torres, recompensas y reglas de aterrizaje del nivel 2; solo cambia la meteorología."""
    n2, n3 = gym.make(N2.ID), gym.make(N3.ID)
    assert n3.observation_space.shape == n2.observation_space.shape == (25,) and n3.action_space.shape == (5,)
    assert N3.VERSION == "0.3" and N3.NIVEL == "N3" and clase_ambiente(N3.ID) is N3
    assert not N3.compatible(N2.VERSION) and not N2.compatible(N3.VERSION)  # reglas distintas: no se comparan retornos
    assert N3.OBSTACULOS == N2.OBSTACULOS and N3.REWARDS == N2.REWARDS and N3.OUTCOMES == N2.OUTCOMES
    for k in ("PAD_RADIUS", "MAX_STEPS", "START_ALTITUDE", "MAX_LANDING_VERTICAL_SPEED", "MAX_LANDING_TILT", "FUEL_MASS"):
        assert getattr(N3, k) == getattr(N2, k)
    assert (N3.VIENTO_MAX, N3.RAFAGAS) == (15.0, 3.0) and (N2.VIENTO_MAX, N2.RAFAGAS) == (10.0, 1.5)


def test_el_viento_llega_a_15_m_s_y_las_rafagas_son_el_doble():
    env = gym.make(N3.ID)
    vientos = []
    for seed in range(200):
        env.reset(seed=seed)
        atm = env.unwrapped.atmosphere
        vientos.append(float(np.hypot(*atm.ground_wind[:2])))
        assert atm.gust_strength == N3.RAFAGAS
    assert max(vientos) <= N3.VIENTO_MAX and max(vientos) > 14.0 and sum(v > 10.0 for v in vientos) > 40


def test_misma_semilla_misma_salida_que_el_nivel_2():
    """El sorteo de cada época usa la misma secuencia: con la misma semilla solo cambia el módulo del viento."""
    o2, _ = gym.make(N2.ID).reset(seed=7)
    o3, _ = gym.make(N3.ID).reset(seed=7)
    assert np.allclose(o2[:6], o3[:6]) and np.allclose(o2[9:], o3[9:])


def test_el_viento_fijo_de_la_suite_sigue_funcionando():
    env = gym.make(N3.ID)
    env.reset(seed=1, options={"viento": 15.0})
    assert np.hypot(*env.unwrapped.atmosphere.ground_wind[:2]) == pytest.approx(15.0)


def test_que_modelo_puede_jugar_en_el_nivel_3():
    """N2 → N3 tal cual (misma familia), N1 → N3 con adaptador, N3 → N1 imposible."""
    env = hacer_entorno(manifest_de(N2.ID), N3.ID)
    assert not isinstance(env, AdaptadorN1) and env.unwrapped.ID == N3.ID
    env = hacer_entorno(manifest_de(N1.ID), N3.ID)
    assert isinstance(env, AdaptadorN1) and env.observation_space.shape == (16,)
    assert isinstance(hacer_entorno(manifest_de(N1.ID), N2.ID), AdaptadorN1)
    with pytest.raises(SystemExit):
        hacer_entorno(manifest_de(N3.ID), N1.ID)
