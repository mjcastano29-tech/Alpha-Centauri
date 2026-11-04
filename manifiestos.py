"""Genera manifests/<run_id>.json con el formato que pide el enunciado (sección 11) para cada ejecución.

Cada manifiesto se construye a partir de resultados/runs/<id>/manifest.json (lo que se guardó al entrenar),
configs/<id>.json (hipótesis, presupuesto y estado) y git (SHA completo). Son referencias inmutables: el
modelo se identifica por su SHA-256 y por una URL al commit exacto en GitHub.

    python manifiestos.py            # todas las ejecuciones del registro
    python manifiestos.py --run <id>
"""
import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUNS = ROOT / "resultados" / "runs"
CONFIGS = ROOT / "configs"
SALIDA = ROOT / "manifests"
REPO = "https://github.com/mjcastano29-tech/Alpha-Centauri"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def config_sha256(config):
    canonical = json.dumps(config, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=float)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def sha_completo(corto):
    try:
        return subprocess.check_output(["git", "rev-parse", corto], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return corto


def generar(run_id):
    carpeta = RUNS / run_id
    m = json.loads((carpeta / "manifest.json").read_text(encoding="utf-8"))
    cfg_path = CONFIGS / f"{run_id}.json"
    cfg = json.loads(cfg_path.read_text(encoding="utf-8")) if cfg_path.exists() else {}
    training = json.loads((carpeta / "entrenamiento.json").read_text(encoding="utf-8"))
    commit = sha_completo(m["git"]["commit"]) if m["git"]["commit"] else None
    modelo = m["archivos"]["modelo"]
    archivos = modelo if isinstance(modelo, list) else [modelo]
    pesos = archivos[0]
    normalizador = next((a for a in archivos[1:] if "normalizador" in a), None)
    ev = m["resultado"]["evaluacion"]
    url = lambda archivo: f"{REPO}/blob/{commit}/resultados/runs/{run_id}/{archivo}" if commit else None  # noqa: E731
    presupuesto = dict(cfg.get("presupuesto", {}))
    presupuesto.setdefault("epocas", len(training["log"]["reward"]))
    presupuesto.setdefault("pasos_agente", int(sum(training["log"]["steps"])))
    return {
        "run_id": run_id,
        "level_id": cfg.get("nivel", m.get("nivel", "N1")),
        "environment_version": f"{m['ambiente']['id']}@{m['ambiente']['version']}",
        "git_commit": commit,
        "git_branch": m["git"].get("branch"),
        "config_sha256": (m.get("sha256") or {}).get("config") or config_sha256(m["config"]),
        "model_uri": url(pesos),
        "model_sha256": sha256_file(carpeta / pesos),
        "normalization_uri": url(normalizador) if normalizador else None,
        "normalization_sha256": sha256_file(carpeta / normalizador) if normalizador else None,
        "model_registry": (m.get("mlflow") or None),
        "runtime_ref": {
            "python": m["software"].get("python"),
            "requirements": f"{REPO}/blob/{commit}/requirements.txt" if commit else "requirements.txt",
            "docker": f"{REPO}/blob/{commit}/Dockerfile" if commit else "Dockerfile",
            "paquetes": {k: v for k, v in m["software"].items() if k in ("gymnasium", "numpy", "torch", "stable_baselines3")},
        },
        "evaluation_suite_id": cfg.get("suite", "suite-v1"),
        "seed": m["config"].get("seed"),
        "parent_run_id": None,
        "experiment_id": m.get("experimento"),
        "agent": {"class": m["agente"].get("clase"), "name": m["agente"].get("nombre"), "action": m["agente"].get("accion")},
        "hypothesis": cfg.get("hipotesis"),
        "change": cfg.get("cambio"),
        "baseline_run_id": cfg.get("baseline"),
        "budget": presupuesto,
        "status": cfg.get("estado", "sin estado"),
        "decision": cfg.get("decision"),
        "evaluation": {
            "suite": cfg.get("suite", "suite-v1"), "episodes": ev["episodes"], "landing_rate": ev["landing_rate"],
            "contact_speed": ev["contact_speed"], "position_error": ev["position_error"], "fuel_used": ev["fuel_used"],
            "outcomes": ev["outcomes"], "per_case": url("evaluacion.json"),
        },
        "trained_at": m["fecha"],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run")
    args = parser.parse_args()
    registro = json.loads((ROOT / "resultados" / "registro.json").read_text(encoding="utf-8"))
    ids = [args.run] if args.run else [e["run_id"] for e in registro["ejecuciones"]]
    SALIDA.mkdir(exist_ok=True)
    for run_id in ids:
        manifiesto = generar(run_id)
        (SALIDA / f"{run_id}.json").write_text(json.dumps(manifiesto, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"manifests/{run_id}.json · {manifiesto['status']} · modelo {manifiesto['model_sha256'][:12]}… · commit {str(manifiesto['git_commit'])[:12]}")


if __name__ == "__main__":
    main()
