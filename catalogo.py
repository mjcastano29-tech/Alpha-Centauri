"""Catálogo versionado de modelos: cuál se recomienda, cuál fue el anterior y por qué.

El catálogo vive en catalogo.json, dentro de git. La API lo lee; promover o restaurar un modelo se hace
con este script y se versiona con un commit, así el despliegue sirve exactamente lo que dice git y un
rollback es restaurar una versión identificada y comprobarla (`GET /version`).

    python catalogo.py ver
    python catalogo.py recomendar ppo-v2-v0.1-s0 --motivo "97 % en la suite v1 frente a 78 % del Q-learning"
    python catalogo.py restaurar --motivo "rollback: el candidato empeora con viento"
"""
import argparse
import json
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CATALOGO = ROOT / "catalogo.json"
REGISTRO = ROOT / "resultados" / "registro.json"


def commit_actual():
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def leer():
    if CATALOGO.exists():
        return json.loads(CATALOGO.read_text(encoding="utf-8"))
    return {"version": 0, "actualizado": None, "recomendado": None, "anterior": None, "historial": []}


def guardar(cat):
    CATALOGO.write_text(json.dumps(cat, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def ejecuciones_conocidas():
    if not REGISTRO.exists():
        return set()
    return {e["run_id"] for e in json.loads(REGISTRO.read_text(encoding="utf-8"))["ejecuciones"]}


def _anotar(cat, accion, run_id, motivo):
    cat["version"] += 1
    cat["actualizado"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    cat["historial"].append({"version": cat["version"], "fecha": cat["actualizado"], "accion": accion,
                             "run_id": run_id, "motivo": motivo, "commit_base": commit_actual()})


def recomendar(run_id, motivo):
    """Promueve una ejecución a modelo recomendado; la anterior queda disponible para restaurar."""
    if run_id not in ejecuciones_conocidas():
        raise SystemExit(f"La ejecución {run_id} no está en resultados/registro.json")
    cat = leer()
    if cat["recomendado"] == run_id:
        raise SystemExit(f"{run_id} ya es el modelo recomendado")
    cat["anterior"], cat["recomendado"] = cat["recomendado"], run_id
    _anotar(cat, "recomendar", run_id, motivo)
    guardar(cat)
    return cat


def restaurar(motivo):
    """Rollback: el modelo anterior vuelve a ser el recomendado."""
    cat = leer()
    if not cat["anterior"]:
        raise SystemExit("No hay un modelo anterior al que volver")
    cat["anterior"], cat["recomendado"] = cat["recomendado"], cat["anterior"]
    _anotar(cat, "restaurar", cat["recomendado"], motivo)
    guardar(cat)
    return cat


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="accion", required=True)
    sub.add_parser("ver", help="muestra el catálogo")
    p = sub.add_parser("recomendar", help="promueve una ejecución a modelo recomendado")
    p.add_argument("run_id")
    p.add_argument("--motivo", required=True)
    p = sub.add_parser("restaurar", help="rollback al modelo anterior")
    p.add_argument("--motivo", required=True)
    args = parser.parse_args()

    if args.accion == "recomendar":
        cat = recomendar(args.run_id, args.motivo)
    elif args.accion == "restaurar":
        cat = restaurar(args.motivo)
    else:
        cat = leer()
    print(json.dumps(cat, indent=2, ensure_ascii=False))
    if args.accion != "ver":
        print("\nCatálogo actualizado en catalogo.json: haz commit y push para que el despliegue lo sirva.")


if __name__ == "__main__":
    main()
