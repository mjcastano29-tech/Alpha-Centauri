# Alpha Centauri

Proyecto de aterrizaje de cohete (Rocket Landing) con [Gymnasium](https://gymnasium.farama.org/) y el entorno [LunarLander](https://gymnasium.farama.org/environments/box2d/lunar_lander/).

## Instalación

Requiere Python 3.10+.

```bash
git clone https://github.com/mjcastano29-tech/Alpha-Centauri.git
cd Alpha-Centauri
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

Si la instalación de `box2d` falla al compilar, instala `swig` (`sudo apt install swig` en Linux, `brew install swig` en macOS) y repite el último paso.

## Comprobar el entorno

```bash
python check_env.py            # sin ventana
python check_env.py --render   # con ventana de la simulación
```

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

## Agente Q-learning y CLI

El agente ([agente_qlearning.py](agente_qlearning.py)) usa dos tablas Q: una para el motor (según altitud y velocidad vertical) y otra para la dirección (según hacia dónde deriva respecto a la plataforma). [cli.py](cli.py) es la forma de trabajar con él desde la terminal:

```bash
python cli.py entrenar                            # entrena 5000 épocas (~2 min) y dice cuántas tarda en aterrizar
python cli.py entrenar --epochs 10000 --detalle   # más épocas, una línea por época
python cli.py ver                                 # una época del modelo entrenado, paso a paso
python cli.py ver --agente heuristico --lento 0.3 # el controlador hecho a mano, con pausa entre pasos
python cli.py ver --viento 15                     # con viento lateral fuerte
python cli.py evaluar --viento 15                 # métricas en condiciones normales y con la perturbación
python cli.py transiciones                        # las cinco primeras transiciones en detalle
```

`entrenar` guarda la ejecución en `resultados/runs/<id>/` (ver *Versionado*) y genera dos páginas: `aprendizaje.html`, con las curvas de aprendizaje y la repetición de épocas, y `aprendizaje3d.html`, la escena three.js que reproduce las épocas grabadas (cada 100) y muestra cómo va aprendiendo el agente. `python entrenar.py` hace lo mismo sin la salida interactiva; `python entrenar.py --solo-pagina` regenera la página sin volver a entrenar.

## Versionado

Todo se versiona en git: código, ficha, modelos y datos de entrenamiento.

- **Ambiente**: `RocketLanding3DEnv.VERSION` (hoy `0.1`, la de la ficha). Cualquier cambio de reglas o constantes sube la versión y se anota en [docs/CHANGELOG.md](docs/CHANGELOG.md).
- **Ejecuciones de entrenamiento**: cada `python cli.py entrenar` crea `resultados/runs/<id>/` con `manifest.json` (commit de git, versión del ambiente, configuración, versiones de software y métricas), `modelo.npz` (tablas Q), `entrenamiento.json` (todas las épocas) y `vuelos.json.gz` (épocas grabadas). `resultados/registro.json` es el índice y apunta a la última. `python cli.py runs` las lista; `--run <id>` en `ver`, `evaluar`, `transiciones` o `entrenar.py --solo-pagina` usa una concreta.
- **Reproducibilidad**: el entrenamiento es determinista. Con el mismo commit, la misma versión del ambiente y la misma configuración (`--seed`, `--epochs`, …) sale exactamente la misma ejecución.
- **Páginas HTML**: se generan a partir de una ejecución y no se versionan (`python entrenar.py --solo-pagina --run <id>` las regenera).
