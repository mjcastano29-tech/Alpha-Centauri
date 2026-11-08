"""Pruebas del contrato de los ambientes con pasarela (0.4 nivel 2 y 0.5 nivel 3): `RocketLanding3D-N2-v1` / `-N3-v1`."""
import gymnasium as gym
import numpy as np
import pytest
from gymnasium.utils.env_checker import check_env

import rocket_env  # noqa: F401  (registra los ambientes)
from rocket_env import AdaptadorN1, VIGENTES, clase_ambiente
from rocket_env.pasarela import RocketLandingPasarelaEnv as P, RocketLandingPasarelaVientoEnv as PV
from rocket_env.rocket_landing import RocketLanding3DEnv as N1

FLOTAR = np.array([1.0, 0.6, 0.0, 0.0, 1.0], dtype=np.float32)
CAER = np.array([1.0, 0.5, 0.0, 0.0, 1.0], dtype=np.float32)
H, A = P.PASARELA["altura"], P.PASARELA["abertura"]


@pytest.fixture
def env():
    e = gym.make(P.ID)
    yield e
    e.close()


def colocar(env, x, y, z, vz=-1.0):
    r = env.unwrapped
    r.position = np.array([x, y, z]); r.velocity = np.array([0.0, 0.0, vz]); r._z_antes = z; r.prev_shaping = r._shaping()


def test_cumple_el_contrato_de_gymnasium():
    check_env(P(), skip_render_check=True)
    check_env(PV(), skip_render_check=True)


def test_familia_nueva_con_las_reglas_de_vuelo_del_nivel_1(env):
    obs, _ = env.reset(seed=1)
    assert obs.shape == (20,) and env.action_space.shape == (5,)
    assert P.VERSION == "0.4" and PV.VERSION == "0.5" and P.NIVEL == "N2" and PV.NIVEL == "N3"
    assert VIGENTES == {"N1": N1.ID, "N2": P.ID, "N3": PV.ID} and clase_ambiente(P.ID) is P
    for k in ("PAD_RADIUS", "MAX_STEPS", "START_ALTITUDE", "MAX_LANDING_VERTICAL_SPEED", "MAX_LANDING_TILT", "FUEL_MASS"):
        assert getattr(P, k) == getattr(N1, k)
    assert P.OUTCOMES[:5] == N1.OUTCOMES and P.OUTCOMES[5] == "colisión"
    o1, _ = gym.make(N1.ID).reset(seed=1)
    assert np.allclose(obs[:16], o1)  # los 16 primeros valores son los del nivel 1
    assert obs[16] == pytest.approx(A["x"] - obs[0]) and obs[18] == pytest.approx(H - obs[2])  # en la salida el objetivo es la abertura
    assert P.TRANSFERENCIA_ENTRADAS == {16: (0, -1.0), 17: (1, -1.0)}
    assert PV.VIENTO_MAX == 15.0 and PV.RAFAGAS == 3.0 and P.VIENTO_MAX == 10.0


def test_geometria_de_la_pasarela():
    assert np.hypot(A["x"], A["y"]) + A["radio"] < P.PASARELA["radio"]  # la abertura está dentro de la pasarela
    assert np.hypot(A["x"], A["y"]) - A["radio"] > P.PAD_RADIUS  # y no cae sobre la plataforma: hay que trasladarse
    assert P.PASARELA["radio"] > 50 * np.sqrt(2)  # cubre todo el cuadrado de salida: no se puede rodear
    assert H < P.START_ALTITUDE
    for o in P.PILARES:
        assert np.hypot(o["x"], o["y"]) > 50 * np.sqrt(2) and o["altura"] == H


def test_bajar_sobre_la_plataforma_choca_con_la_pasarela(env):
    env.reset(seed=5, options={"viento": 0.0})
    colocar(env, 0.0, 0.0, H + 4.0, vz=-10.0)
    _, reward, terminated, truncated, info = env.step(CAER)
    assert info["outcome"] == "colisión" and terminated and not truncated and reward < P.REWARDS["colisión"] / 2


def test_la_abertura_deja_pasar_y_debajo_se_puede_aterrizar(env):
    env.reset(seed=5, options={"viento": 0.0})
    colocar(env, A["x"], A["y"], H + 4.0, vz=-10.0)
    obs, _, terminated, _, info = env.step(CAER)
    assert not terminated and info["outcome"] is None and not info["sobre_pasarela"]
    assert obs[16] == pytest.approx(-obs[0]) and obs[17] == pytest.approx(-obs[1])  # debajo, el objetivo pasa a ser la plataforma
    env.reset(seed=5, options={"viento": 0.0})
    colocar(env, 0.0, 0.0, 1.0, vz=-1.0)  # ya bajo la pasarela, sobre la plataforma
    _, _, terminated, _, info = env.step(CAER)
    assert terminated and info["outcome"] == "aterrizaje"


def test_los_pilares_tambien_son_obstaculo(env):
    o = P.PILARES[0]
    env.reset(seed=5, options={"viento": 0.0})
    colocar(env, o["x"], o["y"], 60.0)
    _, _, terminated, _, info = env.step(FLOTAR)
    assert terminated and info["outcome"] == "colisión"


def test_el_potencial_apunta_a_la_abertura_por_encima_y_a_la_plataforma_por_debajo(env):
    env.reset(seed=5, options={"viento": 0.0})
    r = env.unwrapped
    colocar(env, A["x"], A["y"], H + 100.0); sobre_abertura = r._shaping()
    colocar(env, 0.0, 0.0, H + 100.0); sobre_centro = r._shaping()
    assert sobre_abertura > sobre_centro  # arriba conviene estar sobre la abertura
    colocar(env, A["x"], A["y"], 60.0); bajo_abertura = r._shaping()
    colocar(env, 0.0, 0.0, 60.0); bajo_centro = r._shaping()
    assert bajo_centro > bajo_abertura  # abajo conviene estar sobre la plataforma
    colocar(env, 0.0, 0.0, H + 5.0); fuera = r._shaping()  # pegado a la pasarela, fuera de la abertura
    colocar(env, A["x"], A["y"], H + 5.0); dentro = r._shaping()  # a la misma altura, sobre la abertura
    assert dentro - fuera > np.hypot(A["x"], A["y"]) / 5.0 + P.PESO_PASARELA * 0.5  # además de la distancia, el castigo


def test_el_adaptador_deja_jugar_a_un_modelo_del_nivel_1():
    adaptado = AdaptadorN1(gym.make(P.ID))
    obs, _ = adaptado.reset(seed=3)
    assert obs.shape == (16,) and adaptado.step(FLOTAR)[0].shape == (16,)
