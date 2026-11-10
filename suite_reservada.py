"""Test final reservado: evalúa los modelos recomendados con una suite cuya semilla NO está en el repositorio.

La guía pide un conjunto de evaluación reservado, fuera del ajuste de hiperparámetros y fuera del repo público. La suite
tiene la misma estructura que la v1 (200 épocas por condición: normal y viento fijo de 15 m/s), pero la semilla base la
guarda el equipo y se pasa por la variable de entorno SUITE_RESERVADA_SEMILLA (o por un archivo local `.suite_reservada`,
ignorado por git). El resultado se guarda en resultados/suite-reservada/<run_id>.json SIN la semilla, solo con su huella
SHA-256, para poder demostrar después que la semilla usada es la que el equipo guardó.

    SUITE_RESERVADA_SEMILLA=<secreto> python suite_reservada.py            # los recomendados de cada nivel
    python suite_reservada.py --run ppo-v2-v0.1-s1 --episodios 200          # una ejecución concreta
"""
import argparse
import hashlib
import json
import os
import time
from pathlib import Path

import catalogo
import rocket_env  # noqa: F401
from entrenar import FINAL_EPISODES, RUNS, hacer_entorno, load_agent
from entrenamiento import evaluate

ROOT = Path(__file__).resolve().parent
SALIDA = ROOT / "resultados" / "suite-reservada"
ARCHIVO_SEMILLA = ROOT / ".suite_reservada"
VIENTO = 15.0


def semilla_reservada():
    valor = os.environ.get("SUITE_RESERVADA_SEMILLA") or (ARCHIVO_SEMILLA.read_text(encoding="utf-8").strip() if ARCHIVO_SEMILLA.exists() else None)
    if not valor:
        raise SystemExit("Falta la semilla reservada: exporta SUITE_RESERVADA_SEMILLA o escribe el número en .suite_reservada (ignorado por git)")
    semilla = int(valor)
    if 10_000_000 <= semilla < 10_000_000 + 10_000 or 20_000_000 <= semilla < 20_000_000 + 10_000:
        raise SystemExit("Esa semilla se solapa con la suite v1 o con la evaluación periódica del entrenamiento: elige otra")
    return semilla


def evaluar_reservada(run_id, semilla, episodios):
    agent, path = load_agent(run_id)
    manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    env = hacer_entorno(manifest)
    normal = evaluate(env, agent, episodios, seed_base=semilla)
    viento = evaluate(env, agent, episodios, seed_base=semilla, options={"viento": VIENTO})
    propia = manifest["resultado"]["evaluacion"]
    return {
        "run_id": run_id, "fecha": time.strftime("%Y-%m-%dT%H:%M:%S"), "suite": "suite-reservada", "episodios": episodios,
        "ambiente": manifest["ambiente"].get("id", "RocketLanding3D-v0"), "nivel": manifest.get("nivel", "N1"),
        "semilla_sha256": hashlib.sha256(str(semilla).encode()).hexdigest(),  # la semilla no se publica; esto permite comprobarla después
        "normal": normal, "viento_15": viento,
        "suite_v1": {"aterrizajes": propia["landing_rate"], "velocidad_contacto": propia["contact_speed"], "error_posicion": propia["position_error"]},
        "diferencia_con_suite_v1": round(normal["landing_rate"] - propia["landing_rate"], 4),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", action="append", help="ejecución a evaluar (por defecto, los recomendados del catálogo)")
    parser.add_argument("--episodios", type=int, default=FINAL_EPISODES)
    args = parser.parse_args()
    semilla = semilla_reservada()
    cat = catalogo.leer()
    runs = args.run or [v["recomendado"] for v in cat["niveles"].values() if v.get("recomendado")]
    SALIDA.mkdir(parents=True, exist_ok=True)
    for run_id in runs:
        if not (RUNS / run_id).exists():
            print(f"{run_id}: no existe"); continue
        r = evaluar_reservada(run_id, semilla, args.episodios)
        (SALIDA / f"{run_id}.json").write_text(json.dumps(r, indent=2, ensure_ascii=False, default=float) + "\n", encoding="utf-8")
        print(f"{run_id:48s} {r['nivel']}  reservada {r['normal']['landing_rate']:.1%} (viento {r['viento_15']['landing_rate']:.1%})"
              f"  suite v1 {r['suite_v1']['aterrizajes']:.1%}  diferencia {r['diferencia_con_suite_v1']:+.1%}  · {r['normal']['outcomes']}")


if __name__ == "__main__":
    main()
