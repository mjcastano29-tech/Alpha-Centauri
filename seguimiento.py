"""Registro de experimentos con MLflow.

El seguimiento es local y vive en el repo (se versiona en git): mlflow.db (SQLite: experimentos,
parámetros, métricas y registro de modelos) y mlruns/ (artefactos). Con MLFLOW_TRACKING_URI se puede
apuntar a un servidor compartido (por ejemplo DagsHub) sin tocar el código. Cada
ejecución de resultados/runs/<id>/ se registra como una *run* de MLflow dentro de su experimento
("experimento-1-qlearning", "experimento-2-ppo", …) con:
  - parámetros: configuración del entrenamiento, versión y constantes del ambiente, agente, software
  - métricas: evaluación final y evaluaciones periódicas, curva de entrenamiento resumida
  - dataset: episodios.csv (una fila por época de entrenamiento) registrado como entrada
  - artefactos: manifest, episodios.csv y el modelo (los vuelos grabados ya están en resultados/runs)
  - registro de modelos: cada modelo se registra como versión de "rocket-landing-<agente>"
  - etiquetas: commit y rama de git, versión del ambiente, tipo de agente

Interfaz: `mlflow ui --backend-store-uri sqlite:///mlflow.db` y abrir http://127.0.0.1:5000.
"""
import json
import os
import shutil
import tempfile
from contextlib import nullcontext
from pathlib import Path

import mlflow
import numpy as np
import pandas as pd

ROOT = Path(__file__).parent
MLRUNS = ROOT / "mlruns"  # artefactos
DB = ROOT / "mlflow.db"  # experimentos, runs, métricas, registro de modelos
mlflow.set_tracking_uri(os.environ.get("MLFLOW_TRACKING_URI") or f"sqlite:///{DB}")


def experimento(nombre):
    """Activa el experimento (lo crea si no existe, con los artefactos dentro de mlruns/)."""
    if mlflow.get_experiment_by_name(nombre) is None:
        mlflow.create_experiment(nombre, artifact_location=(MLRUNS / nombre).as_uri())
    mlflow.set_experiment(nombre)

PUNTOS_CURVA = 200  # puntos de la curva de entrenamiento que se suben a MLflow


def _aplanar(d, prefijo=""):
    """Convierte un dict anidado en {clave.subclave: str(valor)} para log_params."""
    out = {}
    for k, v in d.items():
        key = f"{prefijo}{k}"
        if isinstance(v, dict):
            out.update(_aplanar(v, key + "."))
        else:
            out[key] = str(v)[:500]
    return out


def registrar_ejecucion(run_dir, experimento=None):
    """Registra una ejecución guardada. Si hay una run de MLflow activa, añade todo a ella."""
    run_dir = Path(run_dir).resolve()
    manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    training = json.loads((run_dir / "entrenamiento.json").read_text(encoding="utf-8"))
    from entrenamiento import CHECK_EPISODES, OUTCOMES  # import tardío: evita ciclos

    nombre_exp = experimento or manifest.get("experimento") or "sin-experimento"
    globals()["experimento"](nombre_exp)
    activa = mlflow.active_run()
    contexto = nullcontext(activa) if activa else mlflow.start_run(run_name=manifest["run_id"])
    with contexto as run:
        git = manifest["git"]
        mlflow.set_tags({
            "ejecucion": manifest["run_id"],
            "mlflow.source.git.commit": git["commit"] or "",
            "git.rama": git["branch"] or "",
            "git.cambios_sin_commit": str(git["cambios_sin_commit"]),
            "ambiente.version": manifest["ambiente"]["version"],
            "agente": manifest["agente"].get("nombre", manifest["agente"].get("tipo", "")),
            "formato": str(manifest["formato"]),
        })
        mlflow.log_params({
            **_aplanar(manifest["config"], "config."),
            **_aplanar(manifest["ambiente"], "ambiente."),
            **_aplanar(manifest["agente"], "agente."),
            **_aplanar(manifest["software"], "software."),
        })

        ev = manifest["resultado"]["evaluacion"]
        mlflow.log_metrics({
            "eval.aterrizajes": ev["landing_rate"],
            "eval.velocidad_contacto": ev["contact_speed"] if ev["contact_speed"] is not None else 0.0,
            "eval.error_posicion": ev["position_error"],
            "eval.combustible": ev["fuel_used"],
            "primer_aterrizaje": manifest["resultado"]["primer_aterrizaje"] or 0,
            "mejor_epoca": manifest["resultado"]["mejor_epoca"] or 0,
            "epocas": len(training["log"]["reward"]),
        })
        for epoch, landings in zip(training["checks"]["epoch"], training["checks"]["landings"]):
            mlflow.log_metric("eval_periodica.aterrizajes", landings / CHECK_EPISODES, step=int(epoch))

        # curva de entrenamiento resumida en PUNTOS_CURVA puntos (media móvil)
        log = training["log"]
        n = len(log["reward"])
        if n:
            reward = np.array(log["reward"], dtype=float)
            landed = np.array([OUTCOMES[o] == "aterrizaje" for o in log["outcome"]], dtype=float)
            window = max(1, n // PUNTOS_CURVA)
            for end in range(window, n + 1, window):
                mlflow.log_metrics({
                    "entrenamiento.recompensa": float(reward[end - window:end].mean()),
                    "entrenamiento.aterrizajes": float(landed[end - window:end].mean()),
                }, step=end)

        # dataset: una fila por época de entrenamiento
        csv = run_dir / "episodios.csv"
        if csv.exists():
            df = pd.read_csv(csv)
            mlflow.log_input(mlflow.data.from_pandas(df, source=str(csv.relative_to(ROOT)), name=f"episodios-{manifest['run_id']}"),
                             context="entrenamiento")
        for name in ("manifest.json", "episodios.csv"):
            mlflow.log_artifact(str(run_dir / name), artifact_path="ejecucion")
        # modelo ejecutable (pyfunc) + versión en el registro de modelos "rocket-landing-<agente>"
        modelo = manifest["archivos"]["modelo"]
        clase = manifest["agente"].get("clase", "qlearning")
        with tempfile.TemporaryDirectory() as tmp:
            carpeta = Path(tmp) / "modelo"
            carpeta.mkdir()
            for name in (modelo if isinstance(modelo, list) else [modelo]):
                shutil.copy(run_dir / name, carpeta / name)
            (carpeta / "clase.txt").write_text(clase, encoding="utf-8")
            try:
                from modelo_mlflow import ModeloAterrizaje
                info = mlflow.pyfunc.log_model(
                    name="modelo", python_model=ModeloAterrizaje(), artifacts={"modelo": str(carpeta)},
                    code_paths=[str(ROOT / f) for f in ("modelo_mlflow.py", "agente_qlearning.py", "agente_ppo.py", "rocket_env")],
                    pip_requirements=["gymnasium", "numpy", "stable-baselines3", "torch"],
                    registered_model_name=f"rocket-landing-{clase}",
                )
                print(f"Modelo registrado en MLflow: rocket-landing-{clase} versión {info.registered_model_version}")
            except Exception as e:  # el registro es un extra: no debe tumbar el entrenamiento
                print(f"Aviso: no se pudo registrar el modelo en MLflow ({e})")
        return run.info.run_id
