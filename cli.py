"""CLI de Alpha Centauri: entrenar, ver y evaluar el agente de aterrizaje en la terminal.

Ejemplos:
    python cli.py entrenar                      # entrena y muestra cuántas épocas tarda en aterrizar
    python cli.py ver                           # una época del modelo entrenado, paso a paso
    python cli.py ver --agente aleatorio        # lo mismo con un agente al azar
    python cli.py evaluar --viento 15           # métricas con y sin viento lateral fuerte
    python cli.py transiciones                  # las primeras transiciones en detalle
    python cli.py runs                          # ejecuciones guardadas, con commit y métricas
    python cli.py ver --run 20261028-180000-s0  # cualquier comando con una ejecución concreta
"""
import argparse
import sys
import time
from pathlib import Path

import gymnasium as gym
import numpy as np

import rocket_env  # noqa: F401  (registra RocketLanding3D-v0)
from agente_qlearning import QLearningAgent, action_label, to_env_action
from entrenamiento import CHECK_EPISODES, EVAL_SEED_BASE, OUTCOMES, epochs_to_rate, evaluate, train
from entrenar import FINAL_EPISODES, add_train_args, config_from_args, load_registry, model_path, save_run, write_pages
from rocket_env.rocket_landing import RocketLanding3DEnv

# ---------- colores (solo si la salida es una terminal) ----------
IS_TTY = sys.stdout.isatty()
USE_COLOR = IS_TTY
COLORS = {"aterrizaje": "32", "fuera de plataforma": "33", "choque": "31", "sin pasos": "90", "fuera de zona": "35"}


def paint(text, code):
    return f"\033[{code}m{text}\033[0m" if USE_COLOR and code else text


def outcome_text(outcome):
    return paint(outcome, COLORS.get(outcome))


def bold(text):
    return paint(text, "1")


# ---------- agentes para `ver` y `transiciones` ----------
def make_policy(name, run_id=None):
    """Devuelve una función obs -> (acción continua, etiqueta legible)."""
    if name == "qlearning":
        agent = QLearningAgent()
        agent.load(model_path(run_id))

        def policy(env, obs):
            engine, direction = agent.choose(obs, greedy=True)
            return to_env_action(obs, engine, direction), action_label(engine, direction)
        return policy

    if name == "heuristico":
        from experimento1 import heuristic_agent

        def policy(env, obs):
            action = heuristic_agent(env, obs)
            return action, f"acelerador {action[1] * 100:.0f} %"
        return policy

    rng = np.random.default_rng(0)

    def policy(env, obs):
        engine, direction = int(rng.integers(6)), int(rng.integers(5))
        return to_env_action(obs, engine, direction), action_label(engine, direction)
    return policy


def announce(text):
    """Imprime un aviso en su propia línea, borrando antes la barra de progreso si la hay."""
    print(f"\r{' ' * 110}\r{text}" if IS_TTY else text)


def altitude_bar(z, top, width=24):
    filled = int(round(min(max(z, 0.0), top) / top * width))
    return "▕" + "█" * filled + " " * (width - filled) + "▏"


# ---------- comandos ----------
def cmd_entrenar(args):
    config = config_from_args(args)
    n = config.epochs
    window = 100
    recent = []
    milestones = {0.25: None, 0.50: None, 0.75: None}
    start = time.time()
    print(bold(f"Entrenando {n} épocas") + f" · α {config.alpha}→{config.alpha_end} · γ {config.gamma} · "
          f"ε 1→{config.epsilon_end} en el {config.epsilon_decay:.0%} de las épocas\n")

    def status_line(epoch, agent):
        rate = sum(m["landed"] for m in recent) / len(recent)
        reward = np.mean([m["reward"] for m in recent])
        bar = "█" * int(20 * epoch / n) + "░" * (20 - int(20 * epoch / n))
        return (f"\r{bar} época {epoch:>5}/{n}  ε {agent.epsilon:4.2f}  "
                f"aterrizajes (últimas {len(recent)}) {rate:4.0%}  recompensa media {reward:7.1f}  "
                f"{time.time() - start:4.0f} s ")

    def on_epoch(epoch, meta, agent):
        recent.append(meta)
        if len(recent) > window:
            recent.pop(0)
        if args.detalle:
            print(f"época {epoch:>5}  {outcome_text(meta['reason']):<28} pasos {meta['steps']:>2}  "
                  f"recompensa {meta['reward']:7.1f}  ε {agent.epsilon:4.2f}")
            return
        if meta["landed"] and result_first[0] is None:
            result_first[0] = epoch
            announce(f"  » {paint('Primer aterrizaje', '32')} en la época {epoch} "
                     f"({meta['steps']} pasos, recompensa {meta['reward']:.1f})")
        if len(recent) == window:
            rate = sum(m["landed"] for m in recent) / window
            for threshold, reached in milestones.items():
                if reached is None and rate >= threshold:
                    milestones[threshold] = epoch
                    announce(f"  » Aterriza el {threshold:.0%} de las veces "
                             f"(media de las últimas {window}) en la época {epoch}")
        if IS_TTY and (epoch % 10 == 0 or epoch == n):
            print(status_line(epoch, agent), end="", flush=True)
        elif not IS_TTY and epoch % max(1, n // 10) == 0:
            print(status_line(epoch, agent).strip())

    def on_check(epoch, landings, improved):
        if args.detalle:
            return
        mark = paint("  ← mejora", "32") if improved and landings > 0 else ""
        announce(f"  · evaluación sin explorar en la época {epoch}: {landings}/{CHECK_EPISODES} aterrizajes{mark}")

    result_first = [None]
    result = train(config, record_epochs={1, 10, 50, 100, 250, 500, n} | set(range(100, n, 100)),
                   on_epoch=on_epoch, on_check=on_check)
    print("\n" if IS_TTY else "")

    log = result["log"]
    print(bold("¿Cuántas épocas tarda en aterrizar?"))
    first = result["first_landing"]
    print(f"  Primer aterrizaje ........................ {'época ' + str(first) if first else 'nunca'}")
    for threshold in (0.25, 0.50, 0.75):
        e = epochs_to_rate(log["outcome"], threshold, window)
        print(f"  Aterriza el {threshold:.0%} de las veces (media de {window}) .. {'época ' + str(e) if e else 'no lo alcanza'}")
    print(f"  Mejor versión (evaluación periódica) ..... época {result['best_epoch']}")
    print(f"  Tiempo de entrenamiento .................. {time.time() - start:.0f} s\n")

    evaluation = evaluate(result["env"], result["agent"], FINAL_EPISODES)
    print_metrics(f"Modelo final en {FINAL_EPISODES} épocas nuevas sin explorar", evaluation)
    path = save_run(result, evaluation, args.run_id)
    print(f"\nEjecución guardada en {path}: modelo, datos de entrenamiento, vuelos grabados y manifest")
    page, page3d = write_pages(path.name)
    print(f"Página con las curvas de aprendizaje: {page}")
    print(f"Página 3D (three.js) de cómo aprende: {page3d}")


def print_metrics(title, ev):
    print(bold(title))
    print(f"  Aterrizajes seguros ........ {ev['outcomes']['aterrizaje']}/{ev['episodes']} ({ev['landing_rate']:.0%})")
    speed = f"{ev['contact_speed']:.2f} m/s" if ev["contact_speed"] is not None else "no tocó el suelo"
    print(f"  Velocidad de contacto ...... {speed} (media de las épocas que tocan suelo)")
    print(f"  Error de posición final .... {ev['position_error']:.1f} m (distancia al centro de la plataforma)")
    print(f"  Combustible gastado ........ {ev['fuel_used']:.1f} kg de 500")
    print("  Resultados: " + "  ".join(f"{outcome_text(k)} {v}" for k, v in ev["outcomes"].items()))


def cmd_ver(args):
    env = gym.make("RocketLanding3D-v0")
    rocket = env.unwrapped
    policy = make_policy(args.agente, args.run)
    options = {"viento": args.viento} if args.viento is not None else None
    obs, info = env.reset(seed=args.semilla, options=options)
    atm = rocket.atmosphere
    wind = np.hypot(*atm.ground_wind[:2])
    run_note = f" · ejecución {model_path(args.run).parent.name}" if args.agente == "qlearning" else ""
    print(bold(f"Época con el agente {args.agente}{run_note} · semilla {args.semilla}"))
    print(f"Meteorología: suelo {atm.t0 - 273.15:.1f} °C, {atm.p0 / 1000:.1f} kPa, viento a 10 m {wind:.1f} m/s")
    print(f"Salida: altitud {obs[2]:.0f} m, a {np.hypot(obs[0], obs[1]):.1f} m de la plataforma, "
          f"bajando a {-obs[5]:.1f} m/s\n")
    header = (f"{'paso':>4}  {'altitud':>22}  {'v. vert':>8}  {'v. horiz':>8}  {'dist':>6}  {'incl':>5}  "
              f"{'comb.':>6}  {'decisión':<22} {'puntos':>7} {'total':>7}")
    print(paint(header, "2"))
    total = 0.0
    while True:
        action, label = policy(env, obs)
        obs, reward, terminated, truncated, info = env.step(action)
        total += reward
        print(f"{info['step']:>4}  {altitude_bar(obs[2], rocket.START_ALTITUDE)}{obs[2]:6.1f} m"
              f"  {obs[5]:6.1f}  {np.hypot(obs[3], obs[4]):7.1f}  {np.hypot(obs[0], obs[1]):6.1f}"
              f"  {obs[15]:4.1f}°  {obs[12] * rocket.FUEL_MASS:5.0f}kg  {label:<22} {reward:7.1f} {total:7.1f}")
        if args.lento:
            time.sleep(args.lento)
        if terminated or truncated:
            break
    outcome = info["outcome"]
    print(f"\nResultado: {outcome_text(outcome)} ({RocketLanding3DEnv.REWARDS[outcome]:+.0f} puntos) tras "
          f"{info['step']} pasos · recompensa total {total:.1f}")
    if obs[2] <= 0.0:
        print(f"Contacto: {-obs[5]:.2f} m/s vertical (máx. {rocket.MAX_LANDING_VERTICAL_SPEED}), "
              f"{np.hypot(obs[3], obs[4]):.2f} m/s horizontal (máx. {rocket.MAX_LANDING_HORIZONTAL_SPEED}), "
              f"inclinación {obs[15]:.1f}° (máx. {rocket.MAX_LANDING_TILT:.0f}), "
              f"a {np.hypot(obs[0], obs[1]):.1f} m del centro (radio {rocket.PAD_RADIUS:.0f})")


def cmd_evaluar(args):
    path = model_path(args.run)
    env = gym.make("RocketLanding3D-v0")
    agent = QLearningAgent()
    agent.load(path)
    print(bold(f"Ejecución {path.parent.name}") + "\n")
    normal = evaluate(env, agent, args.episodios)
    print_metrics(f"Condiciones normales (viento 0–10 m/s) · {args.episodios} épocas", normal)
    if args.viento is not None:
        print()
        perturbed = evaluate(env, agent, args.episodios, options={"viento": args.viento})
        print_metrics(f"Perturbación: viento lateral de {args.viento} m/s · mismas {args.episodios} épocas", perturbed)
        drop = normal["landing_rate"] - perturbed["landing_rate"]
        print(f"\nCambio en aterrizajes seguros: {-drop:+.0%}")


def cmd_transiciones(args):
    env = gym.make("RocketLanding3D-v0")
    policy = make_policy(args.agente, args.run)
    obs, _ = env.reset(seed=args.semilla)

    def describe(o):
        return (f"pos=({o[0]:.1f}, {o[1]:.1f}, {o[2]:.1f}) m  vel=({o[3]:.1f}, {o[4]:.1f}, {o[5]:.1f}) m/s  "
                f"viento=({o[6]:.1f}, {o[7]:.1f}) m/s  aire={o[9] - 273.15:.1f} °C {o[10]:.1f} kPa  "
                f"motor={o[11]:.0f} K  comb={o[12]:.2f}  incl={o[15]:.1f}°  pasos rest.={o[14]:.2f}")

    for k in range(1, args.n + 1):
        action, label = policy(env, obs)
        next_obs, reward, terminated, truncated, info = env.step(action)
        print(bold(f"Transición {k}"))
        print(f"  observación : {describe(obs)}")
        print(f"  acción      : {label}  →  [motor {action[0]:+.0f}, acelerador {action[1]:.2f}, "
              f"dirección ({action[2]:.2f}, {action[3]:.2f}, {action[4]:.2f})]")
        print(f"  nuevo estado: {describe(next_obs)}  ({len(info['trajectory'])} pasos de física de 0,1 s)")
        print(f"  recompensa  : {reward:+.2f}")
        print(f"  fin         : {'sí, ' + info['outcome'] if terminated else 'no'}\n")
        obs = next_obs
        if terminated:
            break


def cmd_runs(args):
    registry = load_registry()
    if not registry["ejecuciones"]:
        print("No hay ejecuciones. Entrena con: python cli.py entrenar")
        return
    print(bold(f"{'ejecución':26s} {'fecha':19s} {'commit':14s} {'amb.':5s} {'épocas':>6s} {'sem.':>4s} "
               f"{'1er aterr.':>10s} {'aterrizajes':>11s} {'contacto':>8s} {'error':>7s}"))
    for r in registry["ejecuciones"]:
        mark = paint("  ← última", "32") if r["run_id"] == registry["ultimo"] else ""
        contact = f"{r['velocidad_contacto']:.2f}" if r["velocidad_contacto"] is not None else "—"
        first = str(r["primer_aterrizaje"]) if r.get("primer_aterrizaje") else "nunca"
        print(f"{r['run_id']:26s} {r['fecha'][:19]:19s} {r['commit']:14s} {r['ambiente']:5s} {r['epochs']:6d} {r['seed']:4d} "
              f"{first:>10s} {r['aterrizajes']:10.0%} {contact:>6s} m {r['error_posicion']:5.1f} m{mark}")
    print(paint("\ncommit con * = había cambios sin commit al entrenar", "2"))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("entrenar", help="entrena el agente y muestra cuántas épocas tarda en aterrizar")
    add_train_args(p)
    p.add_argument("--detalle", action="store_true", help="una línea por época en vez de la barra de progreso")
    p.set_defaults(func=cmd_entrenar)

    agents = ["qlearning", "heuristico", "aleatorio"]
    p = sub.add_parser("ver", help="juega una época y muestra cada paso")
    p.add_argument("--agente", choices=agents, default="qlearning")
    p.add_argument("--run", help="id de la ejecución (por defecto la última)")
    p.add_argument("--semilla", type=int, default=EVAL_SEED_BASE, help="semilla de la meteorología y la salida")
    p.add_argument("--viento", type=float, help="fija la velocidad del viento (m/s)")
    p.add_argument("--lento", type=float, default=0.0, help="segundos de pausa entre pasos")
    p.set_defaults(func=cmd_ver)

    p = sub.add_parser("evaluar", help="métricas del modelo, opcionalmente con viento lateral fuerte")
    p.add_argument("--run", help="id de la ejecución (por defecto la última)")
    p.add_argument("--episodios", type=int, default=FINAL_EPISODES)
    p.add_argument("--viento", type=float, help="velocidad del viento para la perturbación (m/s)")
    p.set_defaults(func=cmd_evaluar)

    p = sub.add_parser("transiciones", help="muestra las primeras transiciones en detalle")
    p.add_argument("--agente", choices=agents, default="qlearning")
    p.add_argument("--run", help="id de la ejecución (por defecto la última)")
    p.add_argument("--semilla", type=int, default=EVAL_SEED_BASE)
    p.add_argument("--n", type=int, default=5)
    p.set_defaults(func=cmd_transiciones)

    p = sub.add_parser("runs", help="lista las ejecuciones guardadas en resultados/runs")
    p.set_defaults(func=cmd_runs)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
