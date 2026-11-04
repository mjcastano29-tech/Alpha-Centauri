"""Recuperación histórica: los artefactos guardados no cambiaron y cada modelo reproduce su evaluación registrada.

Las pruebas de los modelos PPO necesitan PyTorch y Stable-Baselines3; si no están instalados se omiten.
"""
import hashlib
import json

import gymnasium as gym
import pytest

import rocket_env  # noqa: F401  (registra RocketLanding3D-v0)
from entrenamiento import EVAL_SEED_BASE, run_epoch
from entrenar import RUNS, config_sha256, load_agent, load_registry, run_hashes, sha256_file

EJECUCIONES = [r["run_id"] for r in load_registry()["ejecuciones"]]
CASOS = 20  # primeras épocas de la evaluación guardada (evaluacion.json) que se vuelven a jugar


def manifest(run_id):
    return json.loads((RUNS / run_id / "manifest.json").read_text(encoding="utf-8"))


def test_las_huellas_de_una_ejecucion_nueva(tmp_path):
    (tmp_path / "modelo.zip").write_bytes(b"red")
    (tmp_path / "modelo_normalizador.pkl").write_bytes(b"normalizador")
    (tmp_path / "episodios.csv").write_text("epoca,recompensa\n1,-12.5\n", encoding="utf-8")
    archivos = {"modelo": ["modelo.zip", "modelo_normalizador.pkl"], "episodios": "episodios.csv"}
    huellas = run_hashes(tmp_path, archivos, {"seed": 0, "gamma": 0.99})
    assert set(huellas["archivos"]) == {"modelo.zip", "modelo_normalizador.pkl", "episodios.csv"}
    assert huellas["archivos"]["modelo.zip"] == hashlib.sha256(b"red").hexdigest()
    assert huellas["config"] == config_sha256({"gamma": 0.99, "seed": 0})  # el orden de las claves no cambia la huella
    assert huellas["config"] != config_sha256({"gamma": 0.98, "seed": 0})


@pytest.mark.parametrize("run_id", EJECUCIONES)
def test_los_artefactos_coinciden_con_sus_huellas(run_id):
    m = manifest(run_id)
    assert m["sha256"]["config"] == config_sha256(m["config"])
    for name, huella in m["sha256"]["archivos"].items():
        assert sha256_file(RUNS / run_id / name) == huella, f"{name} cambió desde que se registró"


@pytest.mark.parametrize("run_id", EJECUCIONES)
def test_el_modelo_reproduce_su_evaluacion(run_id):
    """Mismo resultado de misión época a época y misma recompensa media.

    La recompensa de una época concreta puede variar unos puntos entre máquinas en una política sensible
    (ppo-rel vuela al límite de inclinación y el redondeo de otra CPU o de otro numpy la desvía), sin
    cambiar el resultado de la misión; por eso se compara la media y no cada época.
    """
    if manifest(run_id)["agente"].get("clase") == "ppo":
        pytest.importorskip("stable_baselines3")
    agent, path = load_agent(run_id)
    registradas = json.loads((path / "evaluacion.json").read_text(encoding="utf-8"))["normal"]["filas"][:CASOS]
    env = gym.make("RocketLanding3D-v0")
    resultados, recompensas = [], []
    for k in range(CASOS):
        meta, _, _ = run_epoch(env, agent, seed=EVAL_SEED_BASE + k, learn=False, greedy=True)
        resultados.append(meta["reason"])
        recompensas.append(meta["reward"])
    assert resultados == [f["resultado"] for f in registradas]
    assert sum(recompensas) / CASOS == pytest.approx(sum(f["recompensa"] for f in registradas) / CASOS, abs=1.0)
