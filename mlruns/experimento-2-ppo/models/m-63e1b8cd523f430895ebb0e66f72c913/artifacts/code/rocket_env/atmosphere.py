"""Modelo atmosférico sencillo: temperatura, presión, densidad y viento."""
import numpy as np

G0 = 9.80665  # gravedad estándar (m/s²)
R_AIR = 287.05  # constante específica del aire seco (J/(kg·K))
LAPSE_RATE = 0.0065  # cuánto baja la temperatura por cada metro de altura (K/m)


class Atmosphere:
    """Atmósfera estándar internacional (ISA) a partir de las condiciones en el suelo.

    - Temperatura: baja linealmente con la altura.
    - Presión: fórmula barométrica (baja con la altura).
    - Densidad: ley de los gases ideales, p / (R·T).
    - Viento: el viento medido a 10 m crece con la altura (ley potencial 1/7) y se le
      suman ráfagas aleatorias que cambian de forma suave (proceso de Ornstein-Uhlenbeck).
    """

    def __init__(self, rng, ground_temp_k, ground_pressure_pa, ground_wind, gust_strength):
        self.rng = rng
        self.t0 = ground_temp_k
        self.p0 = ground_pressure_pa
        self.ground_wind = np.asarray(ground_wind, dtype=np.float64)
        self.gust_strength = gust_strength
        self.gust = np.zeros(3)

    def temperature(self, altitude):
        return self.t0 - LAPSE_RATE * max(altitude, 0.0)

    def pressure(self, altitude):
        exponent = G0 / (R_AIR * LAPSE_RATE)
        return self.p0 * (self.temperature(altitude) / self.t0) ** exponent

    def density(self, altitude):
        return self.pressure(altitude) / (R_AIR * self.temperature(altitude))

    def wind(self, altitude):
        height_factor = (max(altitude, 1.0) / 10.0) ** (1.0 / 7.0)
        return self.ground_wind * height_factor + self.gust

    def step(self, dt, tau=3.0):
        """Hace evolucionar las ráfagas: tienden a cero con tiempo característico tau (s)."""
        noise = self.rng.normal(size=3) * np.array([1.0, 1.0, 0.3])  # ráfagas verticales más débiles
        self.gust += -self.gust / tau * dt + self.gust_strength * np.sqrt(2.0 * dt / tau) * noise
