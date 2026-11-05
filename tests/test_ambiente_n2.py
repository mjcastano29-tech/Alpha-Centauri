"""Pruebas del contrato del nivel 2 (ambiente 0.2, `RocketLanding3D-N2-v0`): torres junto a la plataforma."""
import gymnasium as gym
import numpy as np
import pytest
from gymnasium.utils.env_checker import check_env

import rocket_env  # noqa: F401  (registra los ambientes)
from rocket_env import AdaptadorN1, clase_ambiente
from rocket_env.nivel2 import RocketLandingN2Env as N2
from rocket_env.rocket_landing import RocketLanding3DEnv as N1

FLOTAR = np.array([1.0, 0.6, 0.0, 0.0, 1.0], dtype=np.float32)


@pytest.fixture
def env():
    e = gym.make(N2.ID)
    yield e
    e.close()


def colocar(env, x, y, z, vz=-1.0):
    rocket = env.unwrapped
    rocket.position = np.array([x, y, z])
    rocket.velocity = np.array([0.0, 0.0, vz])
    rocket.prev_shaping = rocket._shaping()


def test_cumple_el_contrato_de_gymnasium():
    check_env(N2(), skip_render_check=True)


def test_es_una_familia_nueva_con_las_mismas_reglas_de_vuelo(env):
    """Observación = las 16 del nivel 1 + 3 por torre, misma acción, mismas constantes de vuelo y aterrizaje."""
    obs, _ = env.reset(seed=1)
    assert obs.shape == (16 + 3 * len(N2.OBSTACULOS),) and env.action_space.shape == (5,)
    assert N2.VERSION == "0.2" and N2.NIVEL == "N2" and not N2.compatible(N1.VERSION) and not N1.compatible(N2.VERSION)
    for k in ("PAD_RADIUS", "MAX_STEPS", "START_ALTITUDE", "MAX_LANDING_VERTICAL_SPEED", "MAX_LANDING_TILT", "FUEL_MASS"):
        assert getattr(N2, k) == getattr(N1, k)
    assert N2.OUTCOMES[:5] == N1.OUTCOMES and N2.OUTCOMES[5] == "colisión" and N2.REWARDS["colisión"] == -100.0
    n1 = gym.make(N1.ID)
    o1, _ = n1.reset(seed=1)
    assert np.allclose(obs[:16], o1)  # misma semilla, misma salida y meteorología: los 16 primeros valores coinciden
    for k, o in enumerate(N2.OBSTACULOS):  # la observación extra es la posición relativa de cada torre y la altura que queda por encima
        assert obs[16 + 3 * k] == pytest.approx(o["x"] - obs[0]) and obs[18 + 3 * k] == pytest.approx(o["altura"] - obs[2])
    assert clase_ambiente(N2.ID) is N2 and [o["nombre"] for o in N2.obstaculos()] == ["torre A", "torre B", "torre C"]


def test_las_torres_no_tocan_la_plataforma_ni_salen_de_la_zona():
    for o in N2.OBSTACULOS:
        assert np.hypot(o["x"], o["y"]) - o["radio"] - N2.ROCKET_RADIUS > N2.PAD_RADIUS
        assert np.hypot(o["x"], o["y"]) + o["radio"] < 50.0 and 0 < o["altura"] < N2.START_ALTITUDE


def test_chocar_con_una_torre_es_colision(env):
    env.reset(seed=5, options={"viento": 0.0})
    o = N2.OBSTACULOS[0]
    colocar(env, o["x"] + o["radio"] + N2.ROCKET_RADIUS - 0.5, o["y"], o["altura"] / 2)
    _, reward, terminated, truncated, info = env.step(FLOTAR)
    assert info["outcome"] == "colisión" and terminated and not truncated
    assert reward < N2.REWARDS["colisión"] / 2
    assert info["distancia_obstaculo_m"] < 0


def test_pasar_por_encima_o_lejos_de_una_torre_no_es_colision(env):
    o = N2.OBSTACULOS[1]
    env.reset(seed=5, options={"viento": 0.0})
    colocar(env, o["x"], o["y"], o["altura"] + 30.0)  # justo encima de la torre, por encima de su cima
    _, _, terminated, _, info = env.step(FLOTAR)
    assert not terminated and info["outcome"] is None
    env.reset(seed=5, options={"viento": 0.0})
    colocar(env, o["x"] + o["radio"] + N2.ROCKET_RADIUS + 5.0, o["y"], o["altura"] / 2)  # al lado, con margen
    _, _, terminated, _, info = env.step(FLOTAR)
    assert not terminated and info["outcome"] is None


def test_el_shaping_castiga_acercarse_a_una_torre(env):
    """El potencial es el del nivel 1 menos un castigo que solo aparece cerca de una torre y por debajo de su cima."""
    o = N2.OBSTACULOS[0]
    env.reset(seed=5, options={"viento": 0.0})
    r = env.unwrapped
    castigo = lambda: r._shaping() - N1._shaping(r)  # noqa: E731
    colocar(env, o["x"] + o["radio"] + N2.ROCKET_RADIUS + 40.0, o["y"], 60.0)
    assert castigo() == pytest.approx(0.0)  # lejos: igual que el nivel 1
    colocar(env, o["x"] + o["radio"] + N2.ROCKET_RADIUS + 2.0, o["y"], 60.0)
    assert castigo() < -N2.PESO_OBSTACULO * 0.5  # pegado a la torre
    colocar(env, o["x"] + o["radio"] + N2.ROCKET_RADIUS + 2.0, o["y"], o["altura"] + 30.0)
    assert castigo() == pytest.approx(0.0)  # por encima de la cima no molesta


def test_el_adaptador_deja_jugar_a_un_modelo_del_nivel_1(env):
    adaptado = AdaptadorN1(gym.make(N2.ID))
    obs, _ = adaptado.reset(seed=3)
    assert obs.shape == (16,) and adaptado.observation_space.shape == (16,)
    full, _ = env.reset(seed=3)
    assert np.allclose(obs, full[:16])
    obs, *_ = adaptado.step(FLOTAR)
    assert obs.shape == (16,)
