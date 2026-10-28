"""Agente Q-learning para RocketLanding3D-v0.

El entorno es continuo, así que el agente trabaja con versiones discretas, y reparte la
decisión entre dos tablas Q que aprenden a la vez con la misma recompensa:

- Tabla del motor: según la altitud y la velocidad vertical, elige apagar el motor o
  encenderlo con un empuje relativo al peso actual del cohete (×1.0 = mantenerse en el aire).
- Tabla de dirección: según hacia dónde deriva el cohete respecto a la plataforma en cada eje
  horizontal, elige empujar recto hacia arriba o inclinarse hacia +x, -x, +y o -y.

Separarlas hace que cada tabla sea pequeña y se llene rápido de experiencia: con una sola
tabla conjunta el agente no llegaba a aprender a aterrizar en pocos miles de épocas.
El empuje relativo se traduce a acelerador con el combustible y la presión observados, así
la misma acción significa lo mismo con el depósito lleno o casi vacío.
"""
import numpy as np

from rocket_env.atmosphere import G0
from rocket_env.rocket_landing import RocketLanding3DEnv as Rocket

# ---------- acciones discretas ----------
ENGINE_ACTIONS = [0.0, 0.6, 0.9, 1.0, 1.1, 1.4]  # empuje / peso; 0 = motor apagado
TILT = 0.10  # componente lateral del empuje al inclinarse
DIRECTION_ACTIONS = {
    "arriba": (0.0, 0.0),
    "+x": (TILT, 0.0),
    "-x": (-TILT, 0.0),
    "+y": (0.0, TILT),
    "-y": (0.0, -TILT),
}
DIRECTION_NAMES = list(DIRECTION_ACTIONS)


def action_label(engine, direction):
    twr = ENGINE_ACTIONS[engine]
    if twr == 0.0:
        return "motor apagado"
    return f"empuje ×{twr} {DIRECTION_NAMES[direction]}"


def to_env_action(obs, engine, direction):
    """Convierte la pareja de acciones discretas en la acción continua del entorno."""
    twr = ENGINE_ACTIONS[engine]
    if twr == 0.0:
        return np.array([-1.0, 0.0, 0.0, 0.0, 1.0], dtype=np.float32)
    tx, ty = DIRECTION_ACTIONS[DIRECTION_NAMES[direction]]
    mass = Rocket.DRY_MASS + obs[12] * Rocket.FUEL_MASS
    max_thrust = Rocket.MAX_THRUST_VACUUM - obs[10] * 1000.0 * Rocket.NOZZLE_EXIT_AREA
    vector = np.array([tx, ty, 1.0])
    # Al inclinarse, se compensa para que el empuje vertical siga siendo twr × peso
    throttle = min(1.0, twr * mass * G0 / max_thrust * np.linalg.norm(vector))
    return np.array([1.0, throttle, *vector], dtype=np.float32)


# ---------- estados discretos ----------
ALTITUDE_BINS = [20.0, 60.0, 150.0, 350.0, 600.0]  # m
VERTICAL_SPEED_BINS = [-25.0, -12.0, -6.0, -3.0, -1.0, 1.0]  # m/s (negativo = bajando)
PREDICTION_TIME = 4.0  # s: dónde estará el cohete si mantiene su velocidad horizontal
DRIFT_BINS = [-6.0, 6.0]  # m: a un lado de la plataforma, centrado, o al otro lado


def engine_state(obs):
    return int(np.digitize(obs[2], ALTITUDE_BINS)), int(np.digitize(obs[5], VERTICAL_SPEED_BINS))


def direction_state(obs):
    x, y, vx, vy = obs[0], obs[1], obs[3], obs[4]
    return (
        int(np.digitize(x + PREDICTION_TIME * vx, DRIFT_BINS)),
        int(np.digitize(y + PREDICTION_TIME * vy, DRIFT_BINS)),
    )


class QLearningAgent:
    def __init__(self, alpha=0.1, gamma=0.99, epsilon=1.0, seed=0):
        self.q_engine = np.zeros((len(ALTITUDE_BINS) + 1, len(VERTICAL_SPEED_BINS) + 1, len(ENGINE_ACTIONS)))
        self.q_direction = np.zeros((len(DRIFT_BINS) + 1, len(DRIFT_BINS) + 1, len(DIRECTION_ACTIONS)))
        self.alpha = alpha
        self.gamma = gamma
        self.epsilon = epsilon
        self.rng = np.random.default_rng(seed)

    def _pick(self, values, greedy):
        """Política epsilon-greedy: explora al azar con probabilidad epsilon."""
        if not greedy and self.rng.random() < self.epsilon:
            return int(self.rng.integers(len(values)))
        return int(self.rng.choice(np.flatnonzero(values == values.max())))

    def choose(self, obs, greedy=False):
        """Devuelve (acción del motor, acción de dirección)."""
        return (
            self._pick(self.q_engine[engine_state(obs)], greedy),
            self._pick(self.q_direction[direction_state(obs)], greedy),
        )

    def learn(self, obs, action, reward, next_obs, terminated):
        for table, state_fn, a in (
            (self.q_engine, engine_state, action[0]),
            (self.q_direction, direction_state, action[1]),
        ):
            index = state_fn(obs) + (a,)
            target = reward if terminated else reward + self.gamma * table[state_fn(next_obs)].max()
            table[index] += self.alpha * (target - table[index])

    def save(self, path):
        np.savez(path, q_engine=self.q_engine, q_direction=self.q_direction)

    def load(self, path):
        data = np.load(path)
        self.q_engine, self.q_direction = data["q_engine"], data["q_direction"]
