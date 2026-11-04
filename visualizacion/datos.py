"""Utilidades para convertir épocas grabadas en datos para las páginas HTML."""
import json
from pathlib import Path

import numpy as np

TEMPLATES = Path(__file__).parent

FIELDS = ["t", "x", "y", "z", "vx", "vy", "vz", "wx", "wy", "wz", "wh",
          "air_t", "p", "eng_t", "fuel", "on", "thr", "dx", "dy", "dz"]


def trajectory_columns(frames):
    """Convierte la lista de estados físicos (info["trajectory"]) en columnas compactas."""
    columns = {k: [] for k in FIELDS}
    for f in frames:
        wind, direction = f["wind"], f["dir"]
        values = {
            "t": f["t"], "x": f["x"], "y": f["y"], "z": f["z"],
            "vx": f["vx"], "vy": f["vy"], "vz": f["vz"],
            "wx": wind[0], "wy": wind[1], "wz": wind[2], "wh": np.hypot(wind[0], wind[1]),
            "air_t": f["air_t"], "p": f["p"], "eng_t": f["eng_t"], "fuel": f["fuel"],
            "on": float(f["on"]), "thr": f["thr"],
            "dx": direction[0], "dy": direction[1], "dz": direction[2],
        }
        for k in FIELDS:
            columns[k].append(round(float(values[k]), 3))
    return columns


def weather(env):
    """Condiciones meteorológicas de la época actual."""
    atm = env.unwrapped.atmosphere
    wind = atm.ground_wind
    return {
        "ground_temp_c": atm.t0 - 273.15,
        "ground_pressure_kpa": atm.p0 / 1000.0,
        "wind_speed": float(np.hypot(wind[0], wind[1])),
        "wind_dir_deg": float(np.degrees(np.arctan2(wind[1], wind[0])) % 360),
    }


def summary(env, frames, outcome, total_reward, steps):
    rocket = env.unwrapped
    last = frames[-1]
    return {
        "landed": outcome == "aterrizaje",
        "reason": outcome,
        "reward": total_reward,
        "steps": steps,
        "duration": last["t"],
        "fuel_used": rocket.FUEL_MASS - last["fuel"],
        "max_engine_temp": max(f["eng_t"] for f in frames),
        "final_vz": last["vz"],
        "final_vh": float(np.hypot(last["vx"], last["vy"])),
        "final_dist": float(np.hypot(last["x"], last["y"])),
    }


def write_page(template_name, data, out_path):
    html = (TEMPLATES / template_name).read_text(encoding="utf-8")
    html = html.replace("/*__DATA__*/null", json.dumps(data, separators=(",", ":"), default=float))
    Path(out_path).write_text(html, encoding="utf-8")
