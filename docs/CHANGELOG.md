# Historial de versiones

Qué cambia en cada versión del ambiente, del agente y del formato de las ejecuciones. Cada ejecución
de entrenamiento guarda en su `manifest.json` la versión del ambiente y el commit de git con el que se
hizo, así siempre se sabe con qué reglas se entrenó un modelo.

Regla del equipo: un cambio en las reglas o en las constantes del ambiente sube su versión (0.1 → 0.2)
y se anota aquí. Los modelos entrenados con versiones distintas del ambiente no se comparan entre sí.

## Ambiente RocketLanding3D-N2-v0 (nivel 2)

### 0.2 · 2026-11-05
- Nivel 2 = nivel 1 + tres torres alrededor de la plataforma (a 28 m del centro, 120° entre sí, radio 7 m,
  alturas 420/360/300 m). Chocar con una torre es el resultado nuevo "colisión" (−100). Ficha:
  [ambiente-v0.2.md](ambiente-v0.2.md). Clase `RocketLandingN2Env` en `rocket_env/nivel2.py`, hereda la física.
- Observación de 16 + 3 × 3 = 25 valores (por torre: posición relativa x, y y altura que queda por encima);
  acción igual. Es una familia nueva de modelos: los del nivel 1 no juegan aquí salvo con `AdaptadorN1`
  (recorta la observación a los 16 valores del nivel 1), que sirve para medir la dificultad del nivel.
- Potencial de la recompensa = el del nivel 1 − 8 × (1 − d/15 m) por cada torre a menos de 15 m de la
  superficie y por debajo de su cima + 20 m. Lo demás (pasos, aterrizaje, viento, combustible) no cambia.
- Cada ejecución guarda en su manifest `ambiente.id`, `nivel` y `obstaculos`; la API y la CLI crean el
  ambiente que dice el manifest. Los manifests anteriores al nivel 2 no traen `ambiente.id`: se interpretan
  como `RocketLanding3D-v0`.

## Ambiente RocketLanding3D-v0

### 0.1 · 2026-10-28
- Primera versión documentada en [ambiente-v0.1.md](ambiente-v0.1.md).
- Pasos de 20 m de desplazamiento vertical (o 2 s), máximo 50 pasos por época, salida a 600 m.
- Zona de vuelo: cilindro de 300 m de radio y 1200 m de techo. Plataforma de 10 m de radio.
- Aterrizaje: |vz| ≤ 3 m/s, v_h ≤ 2 m/s, inclinación ≤ 10°, distancia ≤ 10 m. Recompensas finales +100 / −50 / −100.
- Observación de 16 valores (incluye inclinación); acción continua de 5 valores.
- Atmósfera ISA con suelo aleatorio por época; viento con ley 1/7 y ráfagas; perturbación `options={"viento": v}`.

### 0.1.1 · 2026-11-03
- "sin pasos" (agotar los 50 pasos sin tocar el suelo) se informa como `truncated=True` en vez de `terminated`,
  como pide la guía para el límite externo de la época. La recompensa (−100) y todas las reglas son las mismas.
- Tercer número de versión = señales que no cambian las reglas. `RocketLanding3DEnv.compatible(v)` compara solo
  mayor.menor: los modelos entrenados con 0.1 siguen siendo válidos y comparables en 0.1.x.

## Agente Q-learning

### 0.1 · 2026-10-28
- Dos tablas Q: motor (altitud × velocidad vertical × 6 acciones de empuje relativo al peso) y dirección
  (deriva prevista en x × en y × 5 direcciones con inclinación lateral 0,10).
- ε de 1 a 0,02 en el 60 % de las épocas; α de 0,1 a 0,01; γ 0,99; evaluación cada 5 % de las épocas y
  se conserva la mejor versión.

## Agente PPO (experimento 2)

### 0.1 · 2026-10-28
- Red MLP 128×128 (Stable-Baselines3, PyTorch) sobre la acción relativa v2: 3 valores en [−1, 1]
  (empuje = 1 + a₀, máximo ×1,6; inclinación = a₁, a₂ × 0,12). 600 000 pasos en 8 entornos,
  evaluación sin ruido cada 20 000 pasos, se conserva la mejor versión.
- Historia: la acción cruda (`--accion cruda`) y la relativa v1 (inclinación ±0,3) no aterrizan;
  ver docs/experimento-2.md.

## Formato de las ejecuciones (`resultados/runs/<id>/`)

### 1 · 2026-10-28
- `manifest.json`, `modelo.npz`, `entrenamiento.json`, `vuelos.json.gz`; índice en `resultados/registro.json`.
- Mismo día, ampliación compatible: `experimento`, `agente.clase/nombre` y `archivos.modelo` como lista en el
  manifest; `episodios.csv` (dataset) y `evaluacion.json` (evaluación detallada) en cada ejecución; registro
  en MLflow (`mlflow.db` + `mlruns/`).
- 2026-11-05, ampliación compatible: el catálogo lleva un recomendado y un anterior por nivel (`niveles.N1`,
  `niveles.N2`); `recomendado`/`anterior` de primer nivel siguen siendo los del nivel 1. `registro.json` y el
  manifest guardan `nivel`; `ambiente.id` y `ambiente.obstaculos` en el manifest. `OUTCOMES` global = los del
  nivel 2 (los cinco del nivel 1 conservan su índice en `entrenamiento.json`).
- 2026-11-03, ampliación compatible: `configs/<run_id>.json` (hipótesis, cambio frente al baseline, presupuesto,
  estado seleccionado/rechazado/referencia y decisión; también como etiquetas `diseno.*` y `presupuesto.*` de la run
  de MLflow), `manifests/<run_id>.json` con el formato de la sección 11 de la guía (`python manifiestos.py`: commit
  completo, SHA-256 del modelo, `model_uri`, suite, nivel) y suites de evaluación con nombre en `configs/suites/`
  (`suite-v1`; la reservada no lleva semilla en el repo). Los manifests nuevos guardan el SHA completo del commit.
- 2026-10-30, ampliación compatible: `sha256` en el manifest (huella de la configuración resuelta y de cada archivo
  de `archivos`), comprobable con `python cli.py verificar`. Las cuatro ejecuciones anteriores recibieron sus
  huellas ese día, con una nota que lo indica; sus copias en `mlruns/` conservan el manifest sin huellas.
