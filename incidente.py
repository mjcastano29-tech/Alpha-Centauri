"""Incidente controlado: cuánto se degrada un modelo cuando cambian las condiciones de operación.

Evalúa el modelo congelado de una ejecución en otro ambiente (por defecto el nivel 3: viento de hasta 15 m/s y
ráfagas el doble de fuertes) con la misma suite v1 de su evaluación propia (200 épocas, semillas desde 10 000 000,
condiciones normal y viento-15) y guarda el antes y el después época a época en
resultados/incidentes/<run_id>@<ambiente>.json. El pipeline usa ese archivo como referencia al decidir sobre el
primer candidato de un nivel nuevo (la intervención).

    python incidente.py                                    # recomendado del nivel 2 jugando en el nivel 3
    python incidente.py --run ppo-v2-v0.1-s1 --ambiente RocketLanding3D-N3-v0
"""
import argparse
import json
import time
from pathlib import Path

import catalogo
import rocket_env
from entrenar import FINAL_EPISODES, RUNS, ambiente_de, hacer_entorno, load_agent
from panel import evaluacion, evaluar_detalle, resumen

ROOT = Path(__file__).resolve().parent
INCIDENTES = ROOT / "resultados" / "incidentes"
VIENTO = 15.0  # condición viento-15 de la suite v1


def ruta(run_id, ambiente):
    return INCIDENTES / f"{run_id}@{ambiente}.json"


def medir(run_id, ambiente, rehacer=False):
    """Evalúa run_id en `ambiente` (normal y viento-15) y lo compara con su evaluación en su propio ambiente."""
    path = ruta(run_id, ambiente)
    if path.exists() and not rehacer:
        return json.loads(path.read_text(encoding="utf-8"))
    agent, run_path = load_agent(run_id)
    manifest = json.loads((run_path / "manifest.json").read_text(encoding="utf-8"))
    env = hacer_entorno(manifest, ambiente)
    rocket = env.unwrapped
    normal = evaluar_detalle(env, agent, FINAL_EPISODES)
    perturbado = evaluar_detalle(env, agent, FINAL_EPISODES, options={"viento": VIENTO})
    antes = evaluacion(run_id, VIENTO)
    data = {
        "run_id": run_id, "fecha": time.strftime("%Y-%m-%dT%H:%M:%S"), "suite": "suite-v1", "episodios": FINAL_EPISODES, "viento": VIENTO,
        "entrenado_en": ambiente_de(manifest),
        "ambiente": {"id": rocket.ID, "version": rocket.VERSION, "nivel": rocket.NIVEL, "viento_max": rocket.VIENTO_MAX, "rafagas": rocket.RAFAGAS},
        "adaptador": isinstance(env, rocket_env.AdaptadorN1),
        "antes": {"normal": antes["normal"]["resumen"], "perturbado": antes["perturbado"]["resumen"]},
        "despues": {"normal": {"resumen": resumen(normal), "filas": normal}, "perturbado": {"resumen": resumen(perturbado), "filas": perturbado}},
    }
    INCIDENTES.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False) + "\n", encoding="utf-8")
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", help="ejecución a evaluar (por defecto, el recomendado del nivel 2)")
    parser.add_argument("--ambiente", default=rocket_env.RocketLandingN3Env.ID, choices=list(rocket_env.AMBIENTES))
    parser.add_argument("--rehacer", action="store_true", help="vuelve a evaluar aunque exista el archivo")
    args = parser.parse_args()
    run_id = args.run or catalogo.leer()["niveles"]["N2"]["recomendado"]
    if not (RUNS / run_id).exists():
        raise SystemExit(f"No existe la ejecución {run_id}")
    d = medir(run_id, args.ambiente, args.rehacer)
    a, n, p = d["antes"]["normal"], d["despues"]["normal"]["resumen"], d["despues"]["perturbado"]["resumen"]
    print(f"{run_id} (entrenado en {d['entrenado_en']}) jugando en {d['ambiente']['id']} v{d['ambiente']['version']}"
          f"{' con AdaptadorN1' if d['adaptador'] else ''} · suite v1, {d['episodios']} épocas por condición")
    print(f"  antes, en su ambiente:        {a['aterrizajes']:6.1%} aterrizajes · resultados {a['resultados']}")
    print(f"  después, condiciones normales {n['aterrizajes']:6.1%} aterrizajes · resultados {n['resultados']}")
    print(f"  después, viento de {VIENTO:.0f} m/s     {p['aterrizajes']:6.1%} aterrizajes · resultados {p['resultados']}")
    print(f"  degradación: {n['aterrizajes'] - a['aterrizajes']:+.1%} · guardado en {ruta(run_id, args.ambiente).relative_to(ROOT)}")


if __name__ == "__main__":
    main()
