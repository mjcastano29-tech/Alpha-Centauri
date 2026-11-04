"""Publica una ejecución (modelo, manifest, datos) en Hugging Face Hub con su tarjeta de modelo.

Uso:
    huggingface-cli login            # una vez, con vuestro token (o exporta HF_TOKEN)
    python publicar_hf.py --repo usuario/alpha-centauri-rocket-landing            # la última ejecución
    python publicar_hf.py --repo usuario/alpha-centauri-rocket-landing --run base-v0.1-s0

Cada ejecución queda en ejecuciones/<id>/ dentro del repositorio del Hub, y el README (tarjeta del
modelo) se regenera con la tabla de todas las ejecuciones publicadas.
"""
import argparse
import json
import os
import tempfile
from pathlib import Path

from huggingface_hub import HfApi

from entrenar import load_registry, run_dir

ROOT = Path(__file__).parent


def tarjeta(ejecuciones):
    filas = "\n".join(
        f"| {r['run_id']} | {r.get('experimento', '—')} | {r['ambiente']} | {r['commit']} | {r['aterrizajes']:.0%} | "
        f"{(r['velocidad_contacto'] or 0):.2f} m/s | {r['error_posicion']:.1f} m |"
        for r in ejecuciones)
    return f"""---
license: mit
language: es
tags:
- reinforcement-learning
- rocket-landing
- gymnasium
- q-learning
- ppo
- stable-baselines3
---

# Alpha Centauri · Rocket Landing

Modelos de aterrizaje de un cohete en el entorno Gymnasium `RocketLanding3D-v0` (viento, temperatura y
presión; pasos de 20 m, máximo 50 por época). Proyecto del curso MLOps Autonomous Lab.
Código y ficha del ambiente: https://github.com/mjcastano29-tech/Alpha-Centauri

## Ejecuciones publicadas

| ejecución | experimento | ambiente | commit | aterrizajes | contacto | error de posición |
|---|---|---|---|---|---|---|
{filas}

Cada carpeta `ejecuciones/<id>/` contiene `manifest.json` (commit, versión del ambiente, configuración,
software y métricas), el modelo (`modelo.npz` para Q-learning; `modelo.zip` + `modelo_normalizador.pkl`
para PPO), `entrenamiento.json`, `episodios.csv` y `vuelos.json.gz`. Las métricas son sobre 200 épocas
de evaluación con meteorología que no aparece en el entrenamiento.

## Cómo usar un modelo

```python
from huggingface_hub import snapshot_download
from entrenar import load_agent  # del repositorio de código, en su carpeta

carpeta = snapshot_download("{{repo}}", allow_patterns="ejecuciones/base-v0.1-s0/*")
# copiar ejecuciones/base-v0.1-s0 a resultados/runs/ y luego:
agent, _ = load_agent("base-v0.1-s0")
```
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", required=True, help="repositorio del Hub, p. ej. usuario/alpha-centauri-rocket-landing")
    parser.add_argument("--run", help="id de la ejecución (por defecto la última)")
    parser.add_argument("--privado", action="store_true", help="crear el repositorio como privado")
    args = parser.parse_args()

    path = run_dir(args.run)
    api = HfApi(token=os.environ.get("HF_TOKEN"))
    api.create_repo(args.repo, repo_type="model", exist_ok=True, private=args.privado)
    api.upload_folder(folder_path=str(path), repo_id=args.repo, path_in_repo=f"ejecuciones/{path.name}",
                      commit_message=f"ejecución {path.name}")

    publicadas = [r for r in load_registry()["ejecuciones"]
                  if api.file_exists(args.repo, f"ejecuciones/{r['run_id']}/manifest.json")]
    with tempfile.TemporaryDirectory() as tmp:
        readme = Path(tmp) / "README.md"
        readme.write_text(tarjeta(publicadas).replace("{{repo}}", args.repo), encoding="utf-8")
        api.upload_file(path_or_fileobj=str(readme), path_in_repo="README.md", repo_id=args.repo,
                        commit_message=f"tarjeta del modelo: {len(publicadas)} ejecuciones")
    print(f"Publicado: https://huggingface.co/{args.repo}/tree/main/ejecuciones/{path.name}")


if __name__ == "__main__":
    main()
