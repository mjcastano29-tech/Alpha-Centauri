# Historial de versiones

Qué cambia en cada versión del ambiente, del agente y del formato de las ejecuciones. Cada ejecución
de entrenamiento guarda en su `manifest.json` la versión del ambiente y el commit de git con el que se
hizo, así siempre se sabe con qué reglas se entrenó un modelo.

Regla del equipo: un cambio en las reglas o en las constantes del ambiente sube su versión (0.1 → 0.2)
y se anota aquí. Los modelos entrenados con versiones distintas del ambiente no se comparan entre sí.

## Ambiente RocketLanding3D-v0

### 0.1 · 2026-10-28
- Primera versión documentada en [ambiente-v0.1.md](ambiente-v0.1.md).
- Pasos de 20 m de desplazamiento vertical (o 2 s), máximo 50 pasos por época, salida a 600 m.
- Zona de vuelo: cilindro de 300 m de radio y 1200 m de techo. Plataforma de 10 m de radio.
- Aterrizaje: |vz| ≤ 3 m/s, v_h ≤ 2 m/s, inclinación ≤ 10°, distancia ≤ 10 m. Recompensas finales +100 / −50 / −100.
- Observación de 16 valores (incluye inclinación); acción continua de 5 valores.
- Atmósfera ISA con suelo aleatorio por época; viento con ley 1/7 y ráfagas; perturbación `options={"viento": v}`.

## Agente Q-learning

### 0.1 · 2026-10-28
- Dos tablas Q: motor (altitud × velocidad vertical × 6 acciones de empuje relativo al peso) y dirección
  (deriva prevista en x × en y × 5 direcciones con inclinación lateral 0,10).
- ε de 1 a 0,02 en el 60 % de las épocas; α de 0,1 a 0,01; γ 0,99; evaluación cada 5 % de las épocas y
  se conserva la mejor versión.

## Formato de las ejecuciones (`resultados/runs/<id>/`)

### 1 · 2026-10-28
- `manifest.json`, `modelo.npz`, `entrenamiento.json`, `vuelos.json.gz`; índice en `resultados/registro.json`.
