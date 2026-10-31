# Alpha Centauri

Proyecto de aterrizaje de cohete (Rocket Landing) con [Gymnasium](https://gymnasium.farama.org/) y el entorno [LunarLander](https://gymnasium.farama.org/environments/box2d/lunar_lander/).

## Instalación

Requiere Python 3.10 a 3.13. Los modelos guardados se entrenaron con Python 3.10.12; `requirements.txt` fija las
mismas versiones de gymnasium, numpy, PyTorch (CPU) y Stable-Baselines3 para que las evaluaciones se reproduzcan.

```bash
git clone https://github.com/mjcastano29-tech/Alpha-Centauri.git
cd Alpha-Centauri
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

## Comprobar el entorno

```bash
python -m pytest               # contrato del ambiente y modelos guardados (~5 s)
python cli.py verificar        # huellas SHA-256 de los modelos y datos de cada ejecución
```

Las pruebas comprueban la interfaz de Gymnasium, la reproducibilidad con semilla, cada forma de terminar una época
con su recompensa, y que cada modelo guardado repite el resultado de misión de las primeras 20 épocas de su evaluación
registrada y su recompensa media. En otra máquina, la recompensa de una época concreta de `ppo-rel-v0.1-s0` puede
variar unos puntos por redondeo numérico (esa política vuela al límite de inclinación), sin cambiar el resultado; las
otras tres ejecuciones dan la misma recompensa al décimo. Una prueba
está marcada como pendiente: en la versión 0.1 agotar los 50 pasos devuelve `terminated`, y la guía del curso pide
`truncated` para el límite externo; cambiarlo es una versión nueva del ambiente.

`check_env.py` es la comprobación inicial con LunarLander; necesita además `pip install "gymnasium[box2d]==1.4.0"`
(y `swig` si box2d no compila).

## Entorno RocketLanding3D-v0

Entorno propio en [rocket_env/](rocket_env/): un cohete en 3D (masa puntual) sale a 600 m de altura y debe aterrizar en la plataforma del origen.

- **Acción** (5 valores): motor encendido/apagado, acelerador (0..1) y dirección del empuje (x, y, z).
- **Observación** (16 valores): posición, velocidad, viento, temperatura y presión del aire, temperatura del motor, combustible, estado del motor, pasos restantes e inclinación.
- **Pasos**: el agente decide una acción y la mantiene hasta desplazarse **20 m en vertical** (o 2 s si no los recorre). Tiene un **máximo de 50 pasos**. Un intento completo, de la salida al final, es una **época**.
- **Reglas físicas**: viento con ráfagas que crece con la altura; temperatura y presión según la atmósfera estándar (ISA) con condiciones de suelo aleatorias por época; la densidad del aire cambia el arrastre, la presión cambia el empuje, y el motor se apaga si se sobrecalienta.

### Recompensas

| Resultado | Cuándo | Puntos |
|---|---|---|
| aterrizaje | toca suelo a ≤ 3 m/s vertical, ≤ 2 m/s horizontal, inclinado ≤ 10° y a menos de 10 m del centro | +100 |
| fuera de plataforma | toca suelo suave pero fuera de la plataforma | −50 |
| choque | toca suelo demasiado rápido o demasiado inclinado | −100 |
| sin pasos | agota los 50 pasos sin aterrizar | −100 |
| fuera de zona | se aleja más de 300 m o sube por encima de 1200 m | −100 |

Además, en cada paso suma acercarse a la plataforma y a la velocidad de bajada segura para su altura, y resta gastar combustible.

```python
import gymnasium as gym
import rocket_env  # registra el entorno

env = gym.make("RocketLanding3D-v0")
```

## Ficha del ambiente (entrega del curso)

[docs/ambiente-v0.1.md](docs/ambiente-v0.1.md) describe el ambiente siguiendo la plantilla del profesor: misión y mapa, variables, observaciones y acciones, dinámica, recompensa, éxito y fracaso, métricas e incidente, cinco transiciones, trampas y decisiones pendientes. El mapa está en [docs/mapa-ambiente-v0.1.svg](docs/mapa-ambiente-v0.1.svg).

## Experimento 1

```bash
python experimento1.py               # agente aleatorio vs. controlador heurístico
python visualizar_experimento1.py    # genera experimento1.html con esas épocas en 3D
```

## Experimentos

| | Experimento 1 | Experimento 2 |
|---|---|---|
| Modelo | Q-learning con dos tablas ([agente_qlearning.py](agente_qlearning.py)) | PPO, red neuronal con Stable-Baselines3 ([agente_ppo.py](agente_ppo.py)) |
| Entrenar | `python cli.py entrenar` (~2 min) | `python cli.py entrenar-ppo` (~11 min en CPU) |
| Aterrizajes en 200 épocas de evaluación | 157 (78 %) | 194 (97 %) |
| Documento | [docs/ambiente-v0.1.md](docs/ambiente-v0.1.md) | [docs/experimento-2.md](docs/experimento-2.md) |

El ambiente es el mismo (versión 0.1) en los dos, para que los resultados sean comparables.

## CLI y páginas

```bash
python cli.py entrenar                            # exp. 1: Q-learning; dice cuántas épocas tarda en aterrizar
python cli.py entrenar-ppo --run-id mi-ppo        # exp. 2: PPO; acepta las opciones de entrenar_ppo.py
python cli.py runs                                # ejecuciones guardadas: experimento, commit y métricas
python cli.py ver                                 # una época del último modelo, paso a paso
python cli.py ver --run base-v0.1-s0 --lento 0.3  # cualquier ejecución; --agente heuristico|aleatorio
python cli.py evaluar --viento 15                 # métricas en condiciones normales y con la perturbación
python cli.py transiciones                        # las cinco primeras transiciones en detalle
python panel.py                                   # panel.html: compara todas las ejecuciones
python entrenar.py --solo-pagina --run <id>       # regenera aprendizaje.html y aprendizaje3d.html
```

Cada entrenamiento genera `aprendizaje.html` (curvas y repetición de épocas) y `aprendizaje3d.html`
(escena three.js que reproduce los vuelos grabados y muestra cómo aprende el agente). `panel.py` genera
`panel.html`, el panel de experimentos.

En `aprendizaje3d.html` (plantilla: [visualizacion/aprendizaje3d.html](visualizacion/aprendizaje3d.html)) se elige el
cohete (nave de acero o propulsor), la cámara (seguimiento, torre con teleobjetivo o a bordo), las guías, el sonido del
motor y la calidad (la ligera quita sombras y posproceso para equipos lentos). Es un *replay*: la posición se interpola
entre las muestras grabadas cada 0,1 s y nada de la escena cambia los datos; el giro suave del cohete, el vuelco tras un
choque y los sonidos son solo visuales.

## Versionado

Todo se versiona en git: código, fichas, modelos, datos de entrenamiento y el registro de MLflow.

- **Ambiente**: `RocketLanding3DEnv.VERSION` (hoy `0.1`). Cualquier cambio de reglas o constantes sube la versión y se anota en [docs/CHANGELOG.md](docs/CHANGELOG.md).
- **Ejecuciones**: cada entrenamiento crea `resultados/runs/<id>/` con `manifest.json` (commit de git, versión del ambiente, configuración, software y métricas), el modelo, `entrenamiento.json` (todas las épocas), `episodios.csv` (dataset: una fila por época), `vuelos.json.gz` (épocas grabadas) y `evaluacion.json` (200 épocas normales + 200 con viento). `resultados/registro.json` es el índice.
- **Huellas**: el manifest guarda en `sha256` la huella de la configuración resuelta y de cada archivo de la ejecución (modelo, normalizador, datos). `python cli.py verificar` las recalcula y avisa si algún artefacto cambió.
- **MLflow** ([seguimiento.py](seguimiento.py)): `mlflow.db` (SQLite) y `mlruns/` dentro del repo. Cada ejecución es una *run* del experimento correspondiente con parámetros, métricas, el dataset `episodios.csv` como entrada y el modelo registrado (`rocket-landing-qlearning`, `rocket-landing-ppo`) como modelo *pyfunc* cargable con `mlflow.pyfunc.load_model("models:/rocket-landing-ppo/3")`. Interfaz: `mlflow ui --backend-store-uri sqlite:///mlflow.db`. Con `MLFLOW_TRACKING_URI` se apunta a un servidor compartido (DagsHub) sin tocar código.
- **Hugging Face Hub** ([publicar_hf.py](publicar_hf.py)): `huggingface-cli login` y `python publicar_hf.py --repo usuario/alpha-centauri-rocket-landing --run ppo-v2-v0.1-s0` sube la ejecución con su tarjeta de modelo.
- **Reproducibilidad**: los entrenamientos son deterministas. Con el mismo commit, la misma versión del ambiente, la misma configuración y las versiones de `requirements.txt` sale exactamente la misma ejecución.
- **Páginas HTML**: se generan a partir de las ejecuciones y no se versionan.
