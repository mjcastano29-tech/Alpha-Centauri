"""Entorno de aterrizaje de un cohete en 3D con viento, temperatura y presión."""
import gymnasium as gym
import numpy as np
from gymnasium import spaces

from rocket_env.atmosphere import G0, Atmosphere


class RocketLanding3DEnv(gym.Env):
    """El cohete (una masa puntual) debe aterrizar suavemente en la plataforma del origen.

    El eje z apunta hacia arriba y el suelo está en z = 0.

    Pasos: el agente elige una acción y la mantiene hasta que el cohete se ha desplazado
    STEP_ALTITUDE metros en vertical (hacia abajo o hacia arriba), o hasta STEP_TIME_LIMIT
    segundos si no llega a recorrerlos. Tiene MAX_STEPS pasos para aterrizar. Un episodio
    completo (de la salida al final) es una "época" en este proyecto.

    Acción (Box de 5 valores):
        0     motor:      > 0 encendido, <= 0 apagado
        1     acelerador: 0..1, fracción del empuje máximo
        2-4   dirección:  vector (x, y, z) hacia el que empuja el motor (se normaliza)

    Observación (Box de 16 valores, en unidades físicas):
        0-2   posición (m)
        3-5   velocidad (m/s)
        6-8   viento en la posición actual (m/s)
        9     temperatura del aire (K)
        10    presión del aire (kPa)
        11    temperatura del motor (K)
        12    combustible restante (0..1)
        13    motor encendido (0 o 1)
        14    pasos restantes (0..1)
        15    inclinación del eje del cohete respecto a la vertical (grados)

    El eje del cohete apunta en la dirección del último empuje (el motor está alineado con
    el cuerpo), así que la inclinación la decide el agente con la dirección de la acción.

    Opciones de reset (perturbaciones para evaluar robustez):
        options={"viento": 15.0}  fija la velocidad del viento a 10 m (m/s) en vez de 0..10

    Reglas del entorno:
        - Viento: empuja al cohete a través del arrastre aerodinámico.
        - Temperatura y presión: fijan la densidad del aire (más densidad, más arrastre).
        - Presión: a más presión exterior, menos empuje da el motor.
        - Temperatura del motor: sube al acelerar y se enfría hacia la temperatura del aire;
          si pasa de MAX_ENGINE_TEMP el motor se apaga hasta enfriarse 100 K.

    Recompensas:
        - En cada paso: acercarse a la plataforma y a la velocidad de descenso segura
          (rápido arriba, despacio cerca del suelo) suma; alejarse de ellas y gastar
          combustible resta.
        - Al terminar: REWARDS[resultado], ver OUTCOMES.
    """

    metadata = {"render_modes": ["ansi"], "render_fps": 10}

    DT = 0.1  # paso de la simulación física (s)
    STEP_ALTITUDE = 20.0  # m de desplazamiento vertical por paso del agente
    STEP_TIME_LIMIT = 2.0  # s máximos por paso
    MAX_STEPS = 50
    START_ALTITUDE = 600.0  # m (30 pasos de 20 m, con margen para la aproximación lenta)

    # Cohete
    DRY_MASS = 1000.0  # kg
    FUEL_MASS = 500.0  # kg
    MAX_THRUST_VACUUM = 27000.0  # N
    NOZZLE_EXIT_AREA = 0.02  # m²
    ISP = 250.0  # impulso específico (s)
    DRAG_COEF = 0.8
    CROSS_AREA = 3.0  # m²

    # Motor
    HEAT_RATE = 30.0  # K/s a acelerador máximo
    COOLING_RATE = 0.05  # 1/s
    MAX_ENGINE_TEMP = 900.0  # K

    # Aterrizaje
    PAD_RADIUS = 10.0  # m
    MAX_LANDING_VERTICAL_SPEED = 3.0  # m/s
    MAX_LANDING_HORIZONTAL_SPEED = 2.0  # m/s
    MAX_LANDING_TILT = 10.0  # grados
    MAX_HORIZONTAL_DISTANCE = 300.0  # m, más lejos se considera fuera de zona
    MAX_ALTITUDE = 1200.0  # m

    # Resultado de la época -> recompensa final
    REWARDS = {
        "aterrizaje": 100.0,  # suave y dentro de la plataforma
        "fuera de plataforma": -50.0,  # suave pero fuera de la plataforma
        "choque": -100.0,  # toca el suelo demasiado rápido o demasiado inclinado
        "sin pasos": -100.0,  # agota los MAX_STEPS sin aterrizar
        "fuera de zona": -100.0,  # se aleja demasiado o sube demasiado
    }
    OUTCOMES = list(REWARDS)

    def __init__(self, render_mode=None):
        self.render_mode = render_mode
        self.action_space = spaces.Box(
            low=np.array([-1.0, 0.0, -1.0, -1.0, -1.0], dtype=np.float32),
            high=np.array([1.0, 1.0, 1.0, 1.0, 1.0], dtype=np.float32),
        )
        self.observation_space = spaces.Box(low=-1e4, high=1e4, shape=(16,), dtype=np.float32)

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        rng = self.np_random

        # Condiciones meteorológicas de la época
        wind_angle = rng.uniform(0.0, 2.0 * np.pi)
        options = options or {}
        wind_speed = float(options["viento"]) if "viento" in options else rng.uniform(0.0, 10.0)
        self.atmosphere = Atmosphere(
            rng,
            ground_temp_k=rng.uniform(263.0, 313.0),  # -10 °C .. 40 °C
            ground_pressure_pa=rng.uniform(98000.0, 104000.0),
            ground_wind=[wind_speed * np.cos(wind_angle), wind_speed * np.sin(wind_angle), 0.0],
            gust_strength=1.5,
        )

        self.position = np.array([rng.uniform(-50, 50), rng.uniform(-50, 50), self.START_ALTITUDE])
        self.velocity = np.array([rng.uniform(-3, 3), rng.uniform(-3, 3), rng.uniform(-20, -15)])
        self.fuel = self.FUEL_MASS
        self.engine_temp = self.atmosphere.temperature(self.position[2])
        self.engine_on = False
        self.overheated = False
        self.throttle = 0.0
        self.thrust_direction = np.array([0.0, 0.0, 1.0])
        self.time = 0.0
        self.steps = 0
        self.outcome = None
        self.prev_shaping = self._shaping()

        info = self._get_info()
        info["trajectory"] = [self._frame()]
        return self._get_obs(), info

    def step(self, action):
        action = np.clip(np.asarray(action, dtype=np.float64), self.action_space.low, self.action_space.high)
        direction = action[2:5]
        norm = np.linalg.norm(direction)
        direction = direction / norm if norm > 1e-6 else np.array([0.0, 0.0, 1.0])

        # Mantiene la acción hasta recorrer STEP_ALTITUDE metros en vertical
        start_altitude = self.position[2]
        start_time = self.time
        fuel_used = 0.0
        trajectory = []
        while True:
            fuel_used += self._simulate(action[0] > 0.0, action[1], direction)
            trajectory.append(self._frame())
            self.outcome = self._check_outcome()
            if (
                self.outcome is not None
                or abs(self.position[2] - start_altitude) >= self.STEP_ALTITUDE
                or self.time - start_time >= self.STEP_TIME_LIMIT - 1e-9
            ):
                break
        self.steps += 1
        if self.outcome is None and self.steps >= self.MAX_STEPS:
            self.outcome = "sin pasos"

        shaping = self._shaping()
        reward = shaping - self.prev_shaping - 0.1 * fuel_used
        self.prev_shaping = shaping
        terminated = self.outcome is not None
        if terminated:
            reward += self.REWARDS[self.outcome]

        info = self._get_info()
        info["trajectory"] = trajectory
        return self._get_obs(), float(reward), terminated, False, info

    def _simulate(self, engine_cmd, throttle, direction):
        """Avanza la física DT segundos. Devuelve el combustible gastado (kg)."""
        altitude = self.position[2]
        atm = self.atmosphere

        self.engine_on = bool(engine_cmd and self.fuel > 0.0 and not self.overheated)
        self.throttle = float(throttle) if self.engine_on else 0.0
        self.thrust_direction = direction

        max_thrust = self.MAX_THRUST_VACUUM - atm.pressure(altitude) * self.NOZZLE_EXIT_AREA
        thrust = max_thrust * self.throttle
        fuel_used = thrust / (self.ISP * G0) * self.DT
        if fuel_used > self.fuel:
            thrust *= self.fuel / fuel_used
            fuel_used = self.fuel

        # Fuerzas: empuje + arrastre (con el viento) + gravedad
        mass = self.DRY_MASS + self.fuel
        relative_velocity = self.velocity - atm.wind(altitude)
        drag = (
            -0.5 * atm.density(altitude) * self.DRAG_COEF * self.CROSS_AREA
            * np.linalg.norm(relative_velocity) * relative_velocity
        )
        acceleration = (thrust * direction + drag) / mass
        acceleration[2] -= G0

        self.velocity += acceleration * self.DT
        self.position += self.velocity * self.DT
        self.fuel -= fuel_used
        self.time += self.DT

        # Temperatura del motor
        heating = self.HEAT_RATE * self.throttle * (thrust > 0)
        self.engine_temp += (heating - self.COOLING_RATE * (self.engine_temp - atm.temperature(altitude))) * self.DT
        if self.engine_temp >= self.MAX_ENGINE_TEMP:
            self.overheated = True
        elif self.engine_temp < self.MAX_ENGINE_TEMP - 100.0:
            self.overheated = False

        atm.step(self.DT)
        return fuel_used

    def _check_outcome(self):
        horizontal_distance = np.hypot(self.position[0], self.position[1])
        if self.position[2] <= 0.0:
            self.position[2] = 0.0
            soft = (
                abs(self.velocity[2]) <= self.MAX_LANDING_VERTICAL_SPEED
                and np.hypot(self.velocity[0], self.velocity[1]) <= self.MAX_LANDING_HORIZONTAL_SPEED
                and self.tilt() <= self.MAX_LANDING_TILT
            )
            if not soft:
                return "choque"
            return "aterrizaje" if horizontal_distance <= self.PAD_RADIUS else "fuera de plataforma"
        if horizontal_distance > self.MAX_HORIZONTAL_DISTANCE or self.position[2] > self.MAX_ALTITUDE:
            return "fuera de zona"
        return None

    def render(self):
        if self.render_mode == "ansi":
            info = self._get_info()
            return (
                f"paso {self.steps:2d}/{self.MAX_STEPS}  "
                f"pos=({self.position[0]:7.1f}, {self.position[1]:7.1f}, {self.position[2]:7.1f}) m  "
                f"vel=({self.velocity[0]:6.1f}, {self.velocity[1]:6.1f}, {self.velocity[2]:6.1f}) m/s  "
                f"motor={'ON ' if self.engine_on else 'OFF'}  T_motor={self.engine_temp:5.0f} K  "
                f"combustible={self.fuel:5.1f} kg  aire={info['air_temp_c']:5.1f} °C "
                f"{info['pressure_kpa']:5.1f} kPa"
            )
        return None

    def tilt(self):
        """Inclinación del eje del cohete respecto a la vertical (grados)."""
        return float(np.degrees(np.arccos(np.clip(self.thrust_direction[2], -1.0, 1.0))))

    def safe_descent_speed(self, altitude):
        """Velocidad de bajada segura (m/s, negativa) según la altitud."""
        return -float(np.clip(0.08 * altitude, 1.5, 30.0))

    def _shaping(self):
        horizontal_distance = np.hypot(self.position[0], self.position[1])
        horizontal_speed = np.hypot(self.velocity[0], self.velocity[1])
        descent_error = abs(self.velocity[2] - self.safe_descent_speed(self.position[2]))
        return -horizontal_distance / 5.0 - horizontal_speed - descent_error - self.position[2] / 10.0

    def _get_obs(self):
        altitude = self.position[2]
        atm = self.atmosphere
        return np.concatenate([
            self.position,
            self.velocity,
            atm.wind(altitude),
            [
                atm.temperature(altitude),
                atm.pressure(altitude) / 1000.0,
                self.engine_temp,
                self.fuel / self.FUEL_MASS,
                float(self.engine_on),
                1.0 - self.steps / self.MAX_STEPS,
                self.tilt(),
            ],
        ]).astype(np.float32)

    def _frame(self):
        """Estado físico actual, para grabar la trayectoria de cada paso."""
        altitude = self.position[2]
        atm = self.atmosphere
        return {
            "t": self.time,
            "x": self.position[0], "y": self.position[1], "z": altitude,
            "vx": self.velocity[0], "vy": self.velocity[1], "vz": self.velocity[2],
            "wind": atm.wind(altitude).copy(),
            "air_t": atm.temperature(altitude) - 273.15,
            "p": atm.pressure(altitude) / 1000.0,
            "eng_t": self.engine_temp,
            "fuel": self.fuel,
            "on": self.engine_on,
            "thr": self.throttle,
            "dir": self.thrust_direction.copy(),
        }

    def _get_info(self):
        altitude = self.position[2]
        return {
            "step": self.steps,
            "altitude_m": float(altitude),
            "air_temp_c": float(self.atmosphere.temperature(altitude) - 273.15),
            "pressure_kpa": float(self.atmosphere.pressure(altitude) / 1000.0),
            "air_density": float(self.atmosphere.density(altitude)),
            "wind": self.atmosphere.wind(altitude).copy(),
            "fuel_kg": float(self.fuel),
            "engine_temp_k": float(self.engine_temp),
            "overheated": self.overheated,
            "tilt_deg": self.tilt(),
            "outcome": self.outcome,
            "landed": self.outcome == "aterrizaje",
        }
