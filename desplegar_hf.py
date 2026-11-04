"""Despliega la API en un Space de Hugging Face (contenedor Docker con URL HTTPS).

Es el paso "publicar" del pipeline: sube el código y las ejecuciones del commit actual, fija en el Space la
variable COMMIT_SHA (lo que luego devuelve GET /version) y espera a que el contenedor arranque. Requiere
sesión de Hugging Face (`huggingface-cli login`) o la variable HF_TOKEN.

    python desplegar_hf.py                                   # Space <usuario>/alpha-centauri-api
    python desplegar_hf.py --space equipo/alpha-centauri-api --cors https://alpha-centauri.vercel.app
    python desplegar_hf.py --estado                          # solo consulta el estado y la URL
"""
import argparse
import os
import subprocess
import time
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parent
IGNORAR = [".git/*", ".venv/*", "web/*", "mlruns/*", "docs/*", "*.html", "__pycache__/*", "*/__pycache__/*", "*.pyc",
           ".pytest_cache/*", ".env", "node_modules/*"]


def commit_actual():
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()


def arbol_limpio():
    return subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT, text=True).strip() == ""


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--space", help="repositorio del Space (por defecto <usuario>/alpha-centauri-api)")
    parser.add_argument("--cors", default="*", help="orígenes permitidos, separados por coma")
    parser.add_argument("--privado", action="store_true")
    parser.add_argument("--estado", action="store_true", help="no desplegar: mostrar estado y URL")
    parser.add_argument("--permitir-sucio", action="store_true", help="desplegar aunque haya cambios sin commit")
    parser.add_argument("--espera", type=int, default=900, help="segundos máximos esperando a que arranque")
    args = parser.parse_args()

    api = HfApi(token=os.environ.get("HF_TOKEN"))
    usuario = api.whoami()["name"]
    space = args.space or f"{usuario}/alpha-centauri-api"
    url = f"https://{space.replace('/', '-').replace('_', '-').lower()}.hf.space"

    if args.estado:
        runtime = api.get_space_runtime(space)
        print(f"{space}: {runtime.stage} · {url}")
        return

    commit = commit_actual()
    if not arbol_limpio() and not args.permitir_sucio:
        raise SystemExit("Hay cambios sin commit: haz commit (o usa --permitir-sucio) para que COMMIT_SHA identifique lo desplegado")

    api.create_repo(space, repo_type="space", space_sdk="docker", exist_ok=True, private=args.privado)
    api.add_space_variable(space, "COMMIT_SHA", commit)
    api.add_space_variable(space, "CORS_ORIGENES", args.cors)
    api.add_space_variable(space, "MAX_EPISODIOS", "50")
    print(f"Subiendo el commit {commit[:12]} a https://huggingface.co/spaces/{space} …", flush=True)
    api.upload_folder(folder_path=str(ROOT), repo_id=space, repo_type="space", ignore_patterns=IGNORAR,
                      commit_message=f"deploy {commit[:12]}")
    print("Subido. Construyendo la imagen (la primera vez tarda varios minutos por PyTorch)…", flush=True)

    inicio, ultimo = time.time(), None
    while time.time() - inicio < args.espera:
        etapa = api.get_space_runtime(space).stage
        if etapa != ultimo:
            print(f"  {time.time() - inicio:4.0f} s · {etapa}", flush=True)
            ultimo = etapa
        if etapa == "RUNNING":
            print(f"\nAPI desplegada: {url}  (documentación: {url}/docs · identidad: {url}/version)")
            return
        if etapa in ("BUILD_ERROR", "RUNTIME_ERROR", "CONFIG_ERROR"):
            raise SystemExit(f"El Space terminó en {etapa}: revisa los registros en https://huggingface.co/spaces/{space}")
        time.sleep(10)
    raise SystemExit("Se agotó la espera; consulta el estado con: python desplegar_hf.py --estado")


if __name__ == "__main__":
    main()
