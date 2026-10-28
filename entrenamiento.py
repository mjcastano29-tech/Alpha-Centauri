"""Entrenamiento y evaluación del agente Q-learning, compartido por entrenar.py y cli.py."""
import collections
from dataclasses import asdict, dataclass

import gymnasium as gym
import numpy as np

import rocket_env  # noqa: F401  (registra RocketLanding3D-v0)
from agente_qlearning import QLearningAgent, action_label, to_env_action
from rocket_env.rocket_landing import RocketLanding3DEnv
from visualizacion.datos import summary, trajectory_columns, weather

OUTCOMES = RocketLanding3DEnv.OUTCOMES
CHECK_EPISODES = 50  # épocas de cada evaluación periódica
EVAL_SEED_BASE = 10_000_000  # semillas de evaluación: meteorología que no aparece al entrenar


@dataclass
class TrainConfig:
    epochs: int = 5000
    alpha: float = 0.1  # tasa de aprendizaje inicial
    alpha_end: float = 0.01  # tasa de aprendizaje final
    gamma: float = 0.99  # factor de descuento
    epsilon_end: float = 0.02  # exploración mínima
    epsilon_decay: float = 0.6  # fracción de épocas en la que la exploración baja de 1 al mínimo
    seed: int = 0


def run_epoch(env, agent, seed, learn=True, greedy=False, options=None, on_step=None):
    """Juega una época. Devuelve el resumen y la trayectoria con las marcas de cada paso.

    on_step(paso, obs, acción, recompensa, next_obs, info) se llama tras cada paso si se indica.
    """
    obs, info = env.reset(seed=seed, options=options)
    meta = weather(env)
    frames = list(info["trajectory"])
    steps = []
    total_reward = 0.0
    while True:
        action = agent.choose(obs, greedy=greedy)
        next_obs, reward, terminated, truncated, info = env.step(to_env_action(obs, *action))
        if learn:
            agent.learn(obs, action, reward, next_obs, terminated)
        frames.extend(info["trajectory"])
        total_reward += reward
        steps.append({"i": len(frames) - 1, "label": action_label(*action), "r": round(reward, 2)})
        if on_step:
            on_step(len(steps), obs, action, reward, next_obs, info)
        obs = next_obs
        if terminated or truncated:
            break
    meta.update(summary(env, frames, info["outcome"], total_reward, len(steps)))
    return meta, frames, steps


def evaluate(env, agent, episodes, seed_base=EVAL_SEED_BASE, options=None):
    """Juega sin explorar ni aprender. Devuelve resultados y métricas de evaluación."""
    outcomes = collections.Counter()
    contact_speeds, position_errors, fuel = [], [], []
    for k in range(episodes):
        meta, frames, _ = run_epoch(env, agent, seed=seed_base + k, learn=False, greedy=True, options=options)
        outcomes[meta["reason"]] += 1
        if frames[-1]["z"] <= 0.0:  # tocó el suelo
            contact_speeds.append(abs(meta["final_vz"]))
        position_errors.append(meta["final_dist"])
        fuel.append(meta["fuel_used"])
    return {
        "episodes": episodes,
        "outcomes": {name: outcomes.get(name, 0) for name in OUTCOMES},
        "landing_rate": outcomes["aterrizaje"] / episodes,
        "contact_speed": float(np.mean(contact_speeds)) if contact_speeds else None,
        "position_error": float(np.mean(position_errors)),
        "fuel_used": float(np.mean(fuel)),
    }


def episode_record(name, meta, frames, steps, epoch=None):
    return {**meta, "agent": name, "epoch": epoch, "f": trajectory_columns(frames), "step_marks": steps}


def train(config, record_epochs=(), on_epoch=None, on_check=None):
    """Entrena un agente nuevo. El modelo devuelto es la mejor versión de las evaluaciones periódicas.

    on_epoch(época, meta, agente) se llama al terminar cada época de entrenamiento.
    on_check(época, aterrizajes, mejora) se llama tras cada evaluación periódica.
    """
    env = gym.make("RocketLanding3D-v0")
    agent = QLearningAgent(alpha=config.alpha, gamma=config.gamma, seed=config.seed)
    n = config.epochs
    check_every = max(1, n // 20)

    log = {"reward": [], "steps": [], "outcome": [], "fuel": [], "epsilon": []}
    checks = {"epoch": [], "landings": []}
    best = (-1, None, 0)  # (aterrizajes, tablas Q, época)
    replays = []
    first_landing = None
    for epoch in range(1, n + 1):
        progress = (epoch - 1) / max(1, n - 1)
        agent.epsilon = max(config.epsilon_end, 1.0 - (epoch - 1) / (config.epsilon_decay * n))
        agent.alpha = config.alpha + (config.alpha_end - config.alpha) * progress
        meta, frames, steps = run_epoch(env, agent, seed=config.seed * 1_000_000 + epoch)

        log["reward"].append(round(meta["reward"], 1))
        log["steps"].append(meta["steps"])
        log["outcome"].append(OUTCOMES.index(meta["reason"]))
        log["fuel"].append(round(meta["fuel_used"], 1))
        log["epsilon"].append(round(agent.epsilon, 4))

        is_first_landing = meta["landed"] and first_landing is None
        if is_first_landing:
            first_landing = epoch
        if epoch in record_epochs or is_first_landing:
            replays.append(episode_record("entrenamiento", meta, frames, steps, epoch))
        if on_epoch:
            on_epoch(epoch, meta, agent)

        if epoch % check_every == 0:
            landings = evaluate(env, agent, CHECK_EPISODES, seed_base=20_000_000)["outcomes"]["aterrizaje"]
            checks["epoch"].append(epoch)
            checks["landings"].append(landings)
            improved = landings > best[0]
            if landings >= best[0]:  # en empate se queda la versión más reciente
                best = (landings, (agent.q_engine.copy(), agent.q_direction.copy()), epoch)
            if on_check:
                on_check(epoch, landings, improved)

    agent.q_engine, agent.q_direction = best[1]
    agent.epsilon = 0.0
    return {
        "env": env,
        "agent": agent,
        "config": asdict(config),
        "log": log,
        "checks": checks,
        "best_epoch": best[2],
        "first_landing": first_landing,
        "replays": sorted(replays, key=lambda e: e["epoch"]),
    }


def epochs_to_rate(outcomes, rate, window=100):
    """Primera época en la que la media móvil de aterrizajes alcanza `rate` (o None)."""
    landed = np.array([OUTCOMES[o] == "aterrizaje" for o in outcomes], dtype=float)
    if len(landed) < window:
        return None
    moving = np.convolve(landed, np.ones(window) / window, mode="valid")
    hits = np.flatnonzero(moving >= rate)
    return int(hits[0] + window) if len(hits) else None
