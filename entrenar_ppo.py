"""Experimento 2: entrena un agente PPO (red neuronal) en RocketLanding3D-v0.

La ejecución se guarda en resultados/runs/<id>/ con el mismo formato que el experimento 1 (manifest,
modelo, entrenamiento.json, vuelos.json.gz, episodios.csv), se registra en MLflow (experimento
"experimento-2-ppo") con métricas en directo, y genera las mismas páginas HTML.

Diferencias con el Q-learning: la red actúa sobre la acción continua del entorno (sin catálogo
discreto), explora con el ruido de su distribución (no hay ε) y aprende por lotes cada 2048 pasos.
Una "época" sigue siendo un intento completo; aquí hay 8 entornos jugando en paralelo.
"""
import argparse
import platform
import tempfile
import time
from pathlib import Path

import gymnasium as gym
import mlflow
import numpy as np
import stable_baselines3 as sb3
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.vec_env import DummyVecEnv, VecMonitor, VecNormalize

import rocket_env  # noqa: F401  (registra RocketLanding3D-v0)
import seguimiento
from agente_ppo import AccionRelativa, PPOAgent
from entrenamiento import CHECK_EPISODES, EVAL_SEED_BASE, OUTCOMES, episode_record, evaluate, run_epoch
from entrenar import FINAL_EPISODES, save_run, write_pages
from rocket_env.rocket_landing import RocketLanding3DEnv

EXPERIMENTO = "experimento-2-ppo"
DEFAULTS = {
    "total_timesteps": 600_000,
    "n_envs": 8,
    "n_steps": 256,  # por entorno; 8 × 256 = 2048 pasos por actualización
    "batch_size": 256,
    "n_epochs": 10,
    "learning_rate": 3e-4,
    "gamma": 0.99,
    "gae_lambda": 0.95,
    "clip_range": 0.2,
    "ent_coef": 0.005,
    "net_arch": [128, 128],
    "eval_every": 20_000,  # pasos entre evaluaciones sin ruido
    "seed": 0,
    "accion": "relativa",  # relativa (empuje/peso e inclinación) o cruda (los 5 valores del entorno)
}


def make_env(seed, accion="relativa"):
    def _init():
        env = gym.make("RocketLanding3D-v0")
        if accion == "relativa":
            env = AccionRelativa(env)
        env.reset(seed=seed)
        return env
    return _init


class Seguimiento(BaseCallback):
    """Guarda cada época de entrenamiento, evalúa periódicamente y conserva la mejor versión."""

    def __init__(self, eval_env, eval_every, tmp_dir, start, verbose=0):
        super().__init__(verbose)
        self.eval_env, self.eval_every, self.tmp, self.start = eval_env, eval_every, Path(tmp_dir), start
        self.log = {"reward": [], "steps": [], "outcome": [], "fuel": [], "epsilon": None}
        self.checks = {"epoch": [], "landings": []}
        self.replays = []
        self.episodes = 0
        self.first_landing = None
        self.best = (-1, 0)  # (aterrizajes en la evaluación, época)
        self.next_eval = eval_every

    def _on_step(self):
        for i, done in enumerate(self.locals["dones"]):
            if not done:
                continue
            info = self.locals["infos"][i]
            ep = info["episode"]  # lo añade VecMonitor con la recompensa sin normalizar
            self.episodes += 1
            self.log["reward"].append(round(float(ep["r"]), 1))
            self.log["steps"].append(int(ep["l"]))
            self.log["outcome"].append(OUTCOMES.index(info["outcome"]))
            self.log["fuel"].append(round(RocketLanding3DEnv.FUEL_MASS - info["fuel_kg"], 1))
            if info["outcome"] == "aterrizaje" and self.first_landing is None:
                self.first_landing = self.episodes
                print(f"  » Primer aterrizaje en la época {self.episodes} (paso {self.num_timesteps})", flush=True)
        if self.num_timesteps >= self.next_eval:
            self.next_eval += self.eval_every
            self._evaluar()
        return True

    def _evaluar(self):
        agent = PPOAgent(self.model, self.model.get_vec_normalize_env())
        ev = evaluate(self.eval_env, agent, CHECK_EPISODES, seed_base=20_000_000)
        landings = ev["outcomes"]["aterrizaje"]
        self.checks["epoch"].append(self.episodes)
        self.checks["landings"].append(landings)
        meta, frames, steps = run_epoch(self.eval_env, agent, seed=EVAL_SEED_BASE, learn=False, greedy=True)
        self.replays.append(episode_record("entrenamiento", meta, frames, steps, epoch=self.episodes))

        recent = slice(-100, None)
        reward100 = float(np.mean(self.log["reward"][recent])) if self.log["reward"] else 0.0
        rate100 = float(np.mean([OUTCOMES[o] == "aterrizaje" for o in self.log["outcome"][recent]])) if self.log["outcome"] else 0.0
        mlflow.log_metrics({
            "ppo.eval_aterrizajes": landings / CHECK_EPISODES,
            "ppo.eval_velocidad_contacto": ev["contact_speed"] if ev["contact_speed"] is not None else 0.0,
            "ppo.eval_error_posicion": ev["position_error"],
            "ppo.recompensa_media_100": reward100,
            "ppo.aterrizajes_100": rate100,
            "ppo.episodios": self.episodes,
        }, step=self.num_timesteps)
        improved = landings > self.best[0]
        if landings >= self.best[0]:
            self.model.save(self.tmp / "mejor_modelo.zip")
            self.model.get_vec_normalize_env().save(str(self.tmp / "mejor_normalizador.pkl"))
            self.best = (landings, self.episodes)
        print(f"paso {self.num_timesteps:>7}  época {self.episodes:>6}  recompensa media (100) {reward100:7.1f}  "
              f"aterrizajes (100) {rate100:4.0%}  evaluación sin ruido {landings:2d}/{CHECK_EPISODES}"
              f"{'  ← mejora' if improved else ''}  ({time.time() - self.start:.0f} s)", flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for key, value in DEFAULTS.items():
        if key == "net_arch":
            parser.add_argument("--net-arch", type=int, nargs="+", default=value, help="neuronas por capa oculta")
        elif key == "accion":
            parser.add_argument("--accion", choices=["relativa", "cruda"], default=value, help="parametrización de la acción")
        else:
            parser.add_argument("--" + key.replace("_", "-"), type=type(value), default=value)
    parser.add_argument("--run-id", help="nombre de la ejecución (por defecto fecha-hora-semilla)")
    args = parser.parse_args(argv)
    config = {k: getattr(args, k) for k in DEFAULTS}

    torch.manual_seed(config["seed"])
    venv = DummyVecEnv([make_env(config["seed"] * 1_000_000 + k, config["accion"]) for k in range(config["n_envs"])])
    venv = VecNormalize(VecMonitor(venv), norm_obs=True, norm_reward=True, clip_obs=10.0, gamma=config["gamma"])
    eval_env = gym.make("RocketLanding3D-v0")
    model = PPO(
        "MlpPolicy", venv, seed=config["seed"], device="cpu", verbose=0,
        n_steps=config["n_steps"], batch_size=config["batch_size"], n_epochs=config["n_epochs"],
        learning_rate=config["learning_rate"], gamma=config["gamma"], gae_lambda=config["gae_lambda"],
        clip_range=config["clip_range"], ent_coef=config["ent_coef"],
        policy_kwargs={"net_arch": list(config["net_arch"])},
    )
    run_id = args.run_id or f"{time.strftime('%Y%m%d-%H%M%S')}-ppo-s{config['seed']}"
    print(f"Experimento 2 · PPO · acción {config['accion']} · red {config['net_arch']} · {config['total_timesteps']} pasos en {config['n_envs']} entornos "
          f"· evaluación cada {config['eval_every']} pasos · ejecución {run_id}\n")

    seguimiento.experimento(EXPERIMENTO)
    start = time.time()
    with tempfile.TemporaryDirectory() as tmp, mlflow.start_run(run_name=run_id):
        callback = Seguimiento(eval_env, config["eval_every"], tmp, start)
        model.learn(total_timesteps=config["total_timesteps"], callback=callback)
        if callback.best[0] < 0:
            callback._evaluar()

        # modelo final = la mejor versión de las evaluaciones periódicas
        best = PPO.load(Path(tmp) / "mejor_modelo.zip", device="cpu")
        normalizer = VecNormalize.load(str(Path(tmp) / "mejor_normalizador.pkl"), DummyVecEnv([make_env(0)]))
        normalizer.training = False
        normalizer.norm_reward = False
        agent = PPOAgent(best, normalizer, hiperparametros={k: v for k, v in config.items() if k not in ("seed", "net_arch", "accion")})
        print(f"\nMejor versión: época {callback.best[1]} ({callback.best[0]}/{CHECK_EPISODES} aterrizajes en la evaluación)")
        evaluation = evaluate(eval_env, agent, FINAL_EPISODES)
        print(f"Modelo final ({FINAL_EPISODES} épocas sin ruido): {evaluation['outcomes']}")

        result = {
            "env": eval_env, "agent": agent, "config": config, "log": callback.log, "checks": callback.checks,
            "best_epoch": callback.best[1], "first_landing": callback.first_landing, "replays": callback.replays,
        }
        path = save_run(result, evaluation, run_id, experimento=EXPERIMENTO,
                        software_extra={"torch": torch.__version__, "stable_baselines3": sb3.__version__,
                                        "hilos_cpu": torch.get_num_threads(), "maquina": platform.machine()})
        print(f"Ejecución guardada en {path}")
        seguimiento.registrar_ejecucion(path, EXPERIMENTO)
        for page in write_pages(path.name):
            print(f"Página guardada en {page}")
    print(f"Tiempo total: {time.time() - start:.0f} s · MLflow: mlflow ui --backend-store-uri sqlite:///mlflow.db")


if __name__ == "__main__":
    main()
