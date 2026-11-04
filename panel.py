"""Panel de experimentos: compara todas las ejecuciones guardadas y genera panel.html.

Para cada ejecución reúne el manifest, la curva de entrenamiento (resumida en tramos) y las
evaluaciones periódicas, y evalúa el modelo final época a época en condiciones normales y con la
perturbación de viento (los detalles se guardan en resultados/runs/<id>/evaluacion.json para no
repetir el cálculo). Uso:

    python panel.py              # todas las ejecuciones del registro
    python panel.py --viento 15  # perturbación con otra velocidad de viento
"""
import argparse
import json
import time
from pathlib import Path

import gymnasium as gym
import numpy as np

import rocket_env  # noqa: F401  (registra RocketLanding3D-v0)
from entrenamiento import CHECK_EPISODES, EVAL_SEED_BASE, OUTCOMES, run_epoch
from entrenar import FINAL_EPISODES, RUNS, load_agent, load_registry
from rocket_env.rocket_landing import RocketLanding3DEnv
from visualizacion.datos import write_page

ROOT = Path(__file__).parent
TRAMOS = 120  # puntos de cada curva de entrenamiento


def evaluar_detalle(env, agent, episodes, options=None):
    """Evalúa sin explorar y devuelve una fila por época (resultado, contacto, posición, consumo)."""
    filas = []
    for k in range(episodes):
        meta, frames, _ = run_epoch(env, agent, seed=EVAL_SEED_BASE + k, learn=False, greedy=True, options=options)
        last = frames[-1]
        filas.append({
            "resultado": meta["reason"], "recompensa": round(meta["reward"], 1), "pasos": meta["steps"],
            "vz": round(float(last["vz"]), 2), "vh": round(float(np.hypot(last["vx"], last["vy"])), 2),
            "x": round(float(last["x"]), 1), "y": round(float(last["y"]), 1), "dist": round(meta["final_dist"], 1),
            "toca_suelo": bool(last["z"] <= 0.0), "combustible": round(meta["fuel_used"], 1),
            "inclinacion": round(float(np.degrees(np.arccos(np.clip(last["dir"][2], -1, 1)))), 1),
            "viento": round(float(meta["wind_speed"]), 1),
        })
    return filas


def resumen(filas):
    contacto = [abs(f["vz"]) for f in filas if f["toca_suelo"]]
    return {
        "episodios": len(filas),
        "aterrizajes": sum(f["resultado"] == "aterrizaje" for f in filas) / len(filas),
        "velocidad_contacto": float(np.mean(contacto)) if contacto else None,
        "error_posicion": float(np.mean([f["dist"] for f in filas])),
        "combustible": float(np.mean([f["combustible"] for f in filas])),
        "resultados": {name: sum(f["resultado"] == name for f in filas) for name in OUTCOMES},
    }


def evaluacion(run_id, viento):
    """Evaluación detallada del modelo final, con caché en la carpeta de la ejecución."""
    cache = RUNS / run_id / "evaluacion.json"
    if cache.exists():
        data = json.loads(cache.read_text(encoding="utf-8"))
        if data.get("viento") == viento and data.get("episodios") == FINAL_EPISODES:
            return data
    agent, _ = load_agent(run_id)
    env = gym.make("RocketLanding3D-v0")
    normal = evaluar_detalle(env, agent, FINAL_EPISODES)
    perturbado = evaluar_detalle(env, agent, FINAL_EPISODES, options={"viento": viento})
    data = {"episodios": FINAL_EPISODES, "viento": viento,
            "normal": {"resumen": resumen(normal), "filas": normal},
            "perturbado": {"resumen": resumen(perturbado), "filas": perturbado}}
    cache.write_text(json.dumps(data), encoding="utf-8")
    return data


def tramos(log, n=TRAMOS):
    """Resume la curva de entrenamiento en n tramos: época final del tramo, media de recompensa y % de aterrizajes."""
    total = len(log["reward"])
    size = max(1, total // n)
    x, reward, rate, fuel = [], [], [], []
    for end in range(size, total + 1, size):
        sl = slice(end - size, end)
        x.append(end)
        reward.append(round(float(np.mean(log["reward"][sl])), 1))
        rate.append(round(float(np.mean([OUTCOMES[o] == "aterrizaje" for o in log["outcome"][sl]])), 3))
        fuel.append(round(float(np.mean(log["fuel"][sl])), 1))
    return {"x": x, "recompensa": reward, "aterrizajes": rate, "combustible": fuel, "tramo": size}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--viento", type=float, default=15.0, help="velocidad del viento de la perturbación (m/s)")
    parser.add_argument("--out", default="panel.html")
    args = parser.parse_args()

    registro = load_registry()
    runs = []
    for k, entrada in enumerate(registro["ejecuciones"], start=1):
        run_id = entrada["run_id"]
        path = RUNS / run_id
        manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
        training = json.loads((path / "entrenamiento.json").read_text(encoding="utf-8"))
        print(f"evaluando {run_id}…", flush=True)
        ev = evaluacion(run_id, args.viento)
        experimento = manifest.get("experimento", "")
        numero = experimento.split("-")[1] if experimento.startswith("experimento-") else str(k)
        agente = manifest["agente"]
        corto = agente.get("nombre", "modelo").split(" (")[0]  # "PPO (red neuronal)" -> "PPO"
        accion = agente.get("accion", "") or ("relativa v1" if manifest["config"].get("accion") == "relativa" else "cruda" if agente.get("clase") == "ppo" else "")
        variante = " · acción cruda" if accion.startswith("cruda") else " · acción rel. v1" if "v1" in accion else " · acción v2" if "v2" in accion else ""
        runs.append({
            "id": run_id, "experimento": experimento, "numero": numero,
            "nombre": f"Exp. {numero} · {corto}{variante}",
            "agente": manifest["agente"].get("nombre", ""), "tipo": manifest["agente"].get("tipo", ""),
            "commit": manifest["git"]["commit"], "fecha": manifest["fecha"], "ambiente": manifest["ambiente"]["version"],
            "config": manifest["config"], "software": manifest["software"],
            "epocas": len(training["log"]["reward"]),
            "primer_aterrizaje": manifest["resultado"]["primer_aterrizaje"], "mejor_epoca": manifest["resultado"]["mejor_epoca"],
            "curva": tramos(training["log"]), "checks": training["checks"],
            "eval": ev,
        })

    data = {
        "generado": time.strftime("%Y-%m-%d %H:%M"),
        "outcomes": OUTCOMES, "rewards": RocketLanding3DEnv.REWARDS, "check_episodes": CHECK_EPISODES,
        "pad_radius": RocketLanding3DEnv.PAD_RADIUS, "max_vz": RocketLanding3DEnv.MAX_LANDING_VERTICAL_SPEED,
        "viento": args.viento, "runs": runs,
    }
    write_page("panel.html", data, ROOT / args.out)
    print(f"Panel guardado en {ROOT / args.out} ({len(runs)} ejecuciones)")


if __name__ == "__main__":
    main()
