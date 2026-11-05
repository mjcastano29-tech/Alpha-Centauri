"""Envoltorio pyfunc de MLflow: carga el modelo de una ejecución (Q-learning o PPO) y predice acciones.

Es lo que queda registrado en el Model Registry de MLflow. Se carga con
    modelo = mlflow.pyfunc.load_model("models:/rocket-landing-ppo/1")
    accion = modelo.predict(observacion)   # observación de 16 valores -> acción de 5 valores
"""
from pathlib import Path

import mlflow.pyfunc
import numpy as np


class ModeloAterrizaje(mlflow.pyfunc.PythonModel):
    def load_context(self, context):
        carpeta = Path(context.artifacts["modelo"])
        clase = (carpeta / "clase.txt").read_text(encoding="utf-8").strip()
        if clase == "ppo":
            from agente_ppo import PPOAgent as Agente
        else:
            from agente_qlearning import QLearningAgent as Agente
        self.agent = Agente.load(carpeta / "modelo")

    def predict(self, context, model_input, params=None):
        obs = np.asarray(model_input, dtype=np.float32)
        if obs.ndim == 1:
            obs = obs[None]
        return np.array([self.agent.act(o, greedy=True)[0] for o in obs])
