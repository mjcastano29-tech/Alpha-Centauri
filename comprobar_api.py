"""Comprueba qué sirve la API pública: commit, catálogo y modelo recomendado de un nivel, con una evaluación corta.

Es la comprobación de la etapa 8 del pipeline, suelta, para dejar evidencia de un rollback (o de una restauración)
hecho con `python catalogo.py restaurar`: espera a que la API sirva el commit indicado (por defecto HEAD de git),
comprueba que el recomendado del nivel es el esperado y lo evalúa con las primeras épocas de la suite v1.

    python comprobar_api.py --nivel N3 --esperado ppo-n3-transfer-1m5-v0.3-s0 --salida pipelines/ejecuciones/rollback-n3-1.json
"""
import argparse
import json
import subprocess
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
API_POR_DEFECTO = "https://alpha-centauri-api.onrender.com"


def pedir(url, cuerpo=None, timeout=300):
    data = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(url, data=data, headers={"content-type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--nivel", required=True)
    parser.add_argument("--esperado", required=True, help="run_id que debe servirse como recomendado del nivel")
    parser.add_argument("--commit", help="commit que debe servir la API (por defecto HEAD)")
    parser.add_argument("--api", default=API_POR_DEFECTO)
    parser.add_argument("--episodios", type=int, default=20)
    parser.add_argument("--espera", type=float, default=900, help="segundos máximos esperando el despliegue")
    parser.add_argument("--salida", help="archivo JSON de evidencia")
    args = parser.parse_args()
    api = args.api.rstrip("/")
    commit = args.commit or subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()

    inicio = time.time()
    while True:
        try:
            v = pedir(f"{api}/version", timeout=60)
            if v.get("commit") == commit:
                break
            print(f"la API sirve {str(v.get('commit'))[:7]}; esperando {commit[:7]} ({time.time() - inicio:.0f} s)", flush=True)
        except Exception as e:  # la API se despierta o se está redesplegando
            print(f"API no disponible todavía: {e}", flush=True)
        if time.time() - inicio > args.espera:
            raise SystemExit(f"La API no sirvió el commit {commit[:7]} en {args.espera:.0f} s")
        time.sleep(20)

    servido = v["catalogo"]["niveles"].get(args.nivel, {})
    e = pedir(f"{api}/evaluar", {"run_id": servido.get("recomendado"), "suite": "suite-v1", "episodios": args.episodios, "grabar": 0})
    evidencia = {
        "fecha": time.strftime("%Y-%m-%dT%H:%M:%S"), "api": api, "commit": v["commit"], "espera_s": round(time.time() - inicio),
        "catalogo": {"version": v["catalogo"]["version"], "actualizado": v["catalogo"]["actualizado"], "nivel": args.nivel, **servido},
        "esperado": args.esperado, "ok": servido.get("recomendado") == args.esperado and e["modelo"]["run_id"] == args.esperado,
        "evaluacion": {"run_id": e["modelo"]["run_id"], "ambiente": e["ambiente"]["id"], "suite": e["suite"], "resumen": e["resumen"],
                       "latencia_ms": e["latencia"]["total_ms"], "servido_por": e["servido_por"]},
    }
    print(json.dumps(evidencia, indent=2, ensure_ascii=False))
    if args.salida:
        Path(args.salida).write_text(json.dumps(evidencia, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if not evidencia["ok"]:
        raise SystemExit(f"La API sirve {servido.get('recomendado')} como recomendado de {args.nivel}; se esperaba {args.esperado}")


if __name__ == "__main__":
    main()
