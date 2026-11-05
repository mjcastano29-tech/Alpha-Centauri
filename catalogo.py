"""Catálogo versionado de modelos: cuál se recomienda, cuál fue el anterior y por qué.

El catálogo vive en catalogo.json, dentro de git. La API lo lee; promover o restaurar un modelo se hace
con este script y se versiona con un commit, así el despliegue sirve exactamente lo que dice git y un
rollback es restaurar una versión identificada y comprobarla (`GET /version`).

    python catalogo.py ver
    python catalogo.py recomendar ppo-v2-v0.1-s0 --motivo "97 % en la suite v1 frente a 78 % del Q-learning"
    python catalogo.py restaurar --motivo "rollback: el candidato empeora con viento"
    python catalogo.py restaurar --nivel N2 --motivo "..."

Hay un modelo recomendado (y un anterior) por nivel: `niveles.N1`, `niveles.N2`… El nivel de una ejecución
lo dice resultados/registro.json. Las claves `recomendado`/`anterior` de primer nivel son las del nivel 1
(compatibilidad con la primera versión del catálogo).
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
        cat = json.loads(CATALOGO.read_text(encoding="utf-8"))
    else:
        cat = {"version": 0, "actualizado": None, "recomendado": None, "anterior": None, "historial": []}
    cat.setdefault("niveles", {})
    cat["niveles"].setdefault("N1", {"recomendado": cat.get("recomendado"), "anterior": cat.get("anterior")})
    return cat


def nivel_de(cat, run_id):
    """Nivel en el que compite una ejecución (recomendado y anterior se llevan por nivel)."""
    return next((n for n, v in cat["niveles"].items() if run_id in (v.get("recomendado"), v.get("anterior"))), None)


def estado_de(cat, run_id, nivel):
    """recomendado / anterior / historico de una ejecución dentro de su nivel."""
    v = cat["niveles"].get(nivel, {})
    return "recomendado" if v.get("recomendado") == run_id else "anterior" if v.get("anterior") == run_id else "historico"


def _sincronizar(cat):
    cat["recomendado"], cat["anterior"] = cat["niveles"]["N1"]["recomendado"], cat["niveles"]["N1"]["anterior"]


def guardar(cat):
    CATALOGO.write_text(json.dumps(cat, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def ejecuciones_conocidas():
    """{run_id: nivel} de resultados/registro.json (las ejecuciones anteriores al nivel 2 no traen nivel: N1)."""
    if not REGISTRO.exists():
        return {}
    return {e["run_id"]: e.get("nivel", "N1") for e in json.loads(REGISTRO.read_text(encoding="utf-8"))["ejecuciones"]}


def _anotar(cat, accion, run_id, motivo, nivel):
    cat["version"] += 1
    cat["actualizado"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    cat["historial"].append({"version": cat["version"], "fecha": cat["actualizado"], "accion": accion, "nivel": nivel,
                             "run_id": run_id, "motivo": motivo, "commit_base": commit_actual()})
    _sincronizar(cat)


def recomendar(run_id, motivo):
    """Promueve una ejecución a modelo recomendado de su nivel; la anterior queda disponible para restaurar."""
    conocidas = ejecuciones_conocidas()
    if run_id not in conocidas:
        raise SystemExit(f"La ejecución {run_id} no está en resultados/registro.json")
    nivel = conocidas[run_id]
    cat = leer()
    v = cat["niveles"].setdefault(nivel, {"recomendado": None, "anterior": None})
    if v["recomendado"] == run_id:
        raise SystemExit(f"{run_id} ya es el modelo recomendado del nivel {nivel}")
    v["anterior"], v["recomendado"] = v["recomendado"], run_id
    _anotar(cat, "recomendar", run_id, motivo, nivel)
    guardar(cat)
    return cat


def restaurar(motivo, nivel="N1"):
    """Rollback: el modelo anterior del nivel vuelve a ser el recomendado."""
    cat = leer()
    v = cat["niveles"].get(nivel) or {}
    if not v.get("anterior"):
        raise SystemExit(f"No hay un modelo anterior al que volver en el nivel {nivel}")
    v["anterior"], v["recomendado"] = v["recomendado"], v["anterior"]
    _anotar(cat, "restaurar", v["recomendado"], motivo, nivel)
    guardar(cat)
    return cat


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="accion", required=True)
    sub.add_parser("ver", help="muestra el catálogo")
    p = sub.add_parser("recomendar", help="promueve una ejecución a modelo recomendado")
    p.add_argument("run_id")
    p.add_argument("--motivo", required=True)
    p = sub.add_parser("restaurar", help="rollback al modelo anterior de un nivel")
    p.add_argument("--motivo", required=True)
    p.add_argument("--nivel", default="N1")
    args = parser.parse_args()

    if args.accion == "recomendar":
        cat = recomendar(args.run_id, args.motivo)
    elif args.accion == "restaurar":
        cat = restaurar(args.motivo, args.nivel)
    else:
        cat = leer()
    print(json.dumps(cat, indent=2, ensure_ascii=False))
    if args.accion != "ver":
        print("\nCatálogo actualizado en catalogo.json: haz commit y push para que el despliegue lo sirva.")


if __name__ == "__main__":
    main()
