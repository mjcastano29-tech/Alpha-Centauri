"""Pruebas del contrato del ambiente RocketLanding3D-v0 (versión 0.1).

Comprueban la interfaz de Gymnasium, la reproducibilidad con semilla, cómo termina cada época
y la recompensa final de cada resultado. Ejecutar desde la raíz del repo: python -m pytest
"""
import gymnasium as gym
import numpy as np
import pytest
from gymnasium.utils.env_checker import check_env

import rocket_env  # noqa: F401  (registra RocketLanding3D-v0)
from rocket_env.rocket_landing import RocketLanding3DEnv as Rocket

MOTOR_APAGADO = np.array([-1.0, 0.0, 0.0, 0.0, 1.0], dtype=np.float32)
CASI_FLOTAR = np.array([1.0, 0.55, 0.0, 0.0, 1.0], dtype=np.float32)  # empuje vertical algo menor que el peso: baja despacio
FLOTAR = np.array([1.0, 0.6, 0.0, 0.0, 1.0], dtype=np.float32)  # empuje vertical algo mayor que el peso


@pytest.fixture
def env():
    e = gym.make("RocketLanding3D-v0")
    yield e
    e.close()


def colocar(env, x=0.0, z=1.0, vz=-1.0):
    """Pone el cohete en una posición y velocidad concretas para probar una regla del ambiente."""
    rocket = env.unwrapped
    rocket.position = np.array([x, 0.0, z])
    rocket.velocity = np.array([0.0, 0.0, vz])
    rocket.prev_shaping = rocket._shaping()


def test_cumple_el_contrato_de_gymnasium():
    check_env(Rocket(), skip_render_check=True)


def test_espacios_de_observacion_y_accion(env):
    obs, _ = env.reset(seed=1)
    assert obs.shape == (16,) and obs.dtype == np.float32
    assert env.action_space.shape == (5,)
    assert env.observation_space.contains(obs)
    obs, *_ = env.step(env.action_space.sample())
    assert env.observation_space.contains(obs)


def test_misma_semilla_mismo_vuelo():
    def vuelo(seed):
        e = gym.make("RocketLanding3D-v0")
        obs, _ = e.reset(seed=seed)
        e.action_space.seed(seed)
        traza = [obs]
        for _ in range(10):
            obs, reward, terminated, truncated, _ = e.step(e.action_space.sample())
            traza.append(np.append(obs, reward))
            if terminated or truncated:
                break
        return traza

    a, b = vuelo(7), vuelo(7)
    assert len(a) == len(b) and all(np.array_equal(x, y) for x, y in zip(a, b))
    assert not np.array_equal(vuelo(8)[0], a[0])


def test_caida_libre_termina_en_choque(env):
    env.reset(seed=3)
    for _ in range(Rocket.MAX_STEPS):
        _, _, terminated, truncated, info = env.step(MOTOR_APAGADO)
        if terminated or truncated:
            break
    assert terminated and not truncated
    assert info["outcome"] == "choque" and not info["landed"]


@pytest.mark.parametrize("x, vz, esperado", [
    (0.0, -1.0, "aterrizaje"),           # suave y dentro de la plataforma (radio 10 m)
    (20.0, -1.0, "fuera de plataforma"),  # suave pero fuera de la plataforma
    (0.0, -12.0, "choque"),              # demasiado rápido (límite 3 m/s)
])
def test_contacto_con_el_suelo_y_su_recompensa(env, x, vz, esperado):
    env.reset(seed=5, options={"viento": 0.0})
    rocket = env.unwrapped
    colocar(env, x=x, z=1.0, vz=vz)
    shaping, fuel = rocket.prev_shaping, rocket.fuel
    _, reward, terminated, truncated, info = env.step(CASI_FLOTAR)
    assert info["outcome"] == esperado and terminated and not truncated
    assert info["landed"] == (esperado == "aterrizaje")
    # recompensa = mejora del shaping - 0,1 × combustible gastado + recompensa final del resultado
    assert reward == pytest.approx(rocket._shaping() - shaping - 0.1 * (fuel - rocket.fuel) + Rocket.REWARDS[esperado])


def test_salir_de_la_zona_termina_la_epoca(env):
    env.reset(seed=5)
    colocar(env, x=Rocket.MAX_HORIZONTAL_DISTANCE + 5.0, z=300.0, vz=0.0)
    _, _, terminated, _, info = env.step(FLOTAR)
    assert terminated and info["outcome"] == "fuera de zona"


def agotar_pasos(env):
    """Juega el último paso permitido flotando a 300 m: no toca el suelo ni sale de la zona."""
    env.reset(seed=5, options={"viento": 0.0})
    colocar(env, z=300.0, vz=0.0)
    env.unwrapped.steps = Rocket.MAX_STEPS - 1
    return env.step(FLOTAR)


def test_agotar_los_pasos_termina_la_epoca(env):
    _, reward, terminated, truncated, info = agotar_pasos(env)
    assert info["outcome"] == "sin pasos"
    assert terminated or truncated
    assert reward < Rocket.REWARDS["sin pasos"] / 2


@pytest.mark.xfail(strict=True, reason="v0.1 marca 'sin pasos' como terminated; la guía pide truncated para el límite "
                                       "externo del episodio. Cambiarlo es una versión nueva del ambiente (0.2).")
def test_agotar_los_pasos_deberia_ser_truncated(env):
    _, _, terminated, truncated, _ = agotar_pasos(env)
    assert truncated and not terminated


def test_la_perturbacion_de_viento_fija_su_velocidad(env):
    env.reset(seed=11, options={"viento": 15.0})
    assert np.hypot(*env.unwrapped.atmosphere.ground_wind[:2]) == pytest.approx(15.0)
