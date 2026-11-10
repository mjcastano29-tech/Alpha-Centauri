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
otras tres ejecuciones dan la misma recompensa al décimo. Desde la versión 0.1.1 agotar
los 50 pasos se informa como `truncated`, como pide la guía para el límite externo de la época.

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

## Niveles

| Nivel | Ambiente | Qué cambia | Ficha |
|---|---|---|---|
| N1 · misión base | `RocketLanding3D-v0` (0.1.1) | plataforma, viento, temperatura, presión y combustible limitado | [docs/ambiente-v0.1.md](docs/ambiente-v0.1.md) |
| N2 · obstáculo | `RocketLanding3D-N2-v1` (0.4) | una pasarela a 180 m cubre la plataforma y el cuadrado de salida; la única abertura (16 m de radio) está desplazada 30 m del centro: hay que entrar por ella y trasladarse por debajo; chocar con la pasarela o sus pilares es "colisión" (−100); observación de 20 valores (familia nueva) | [docs/ambiente-v0.4.md](docs/ambiente-v0.4.md) |
| N3 · operación exigente | `RocketLanding3D-N3-v1` (0.5) | la pasarela con viento de 0–15 m/s y ráfagas el doble de fuertes; misma observación que N2 (misma familia). Incidente medido con `python incidente.py`, visible en la web (`#/incidente`) y en `GET /incidentes` | [docs/ambiente-v0.5.md](docs/ambiente-v0.5.md) |
| retirados (históricos) | `RocketLanding3D-N2-v0` (0.2) y `RocketLanding3D-N3-v0` (0.3) | tres torres de 300–420 m alrededor de la plataforma, y lo mismo con viento fuerte; el equipo las sustituyó por la pasarela el 6 de noviembre; sus modelos siguen siendo reproducibles y evaluables | [docs/ambiente-v0.2.md](docs/ambiente-v0.2.md), [docs/ambiente-v0.3.md](docs/ambiente-v0.3.md) |

Cada modelo se entrena y evalúa en el ambiente de su manifest (`ambiente.id`). `python cli.py entrenar-ppo --ambiente RocketLanding3D-N2-v1`
entrena en el nivel 2; `python cli.py evaluar --run ppo-v2-v0.1-s1 --ambiente RocketLanding3D-N2-v1` hace jugar a un modelo del
nivel 1 en el nivel 2 a través de `AdaptadorN1` (no ve los obstáculos): así se mide cuánto cuesta el nivel. El catálogo lleva un
recomendado y un anterior por nivel (`python catalogo.py recomendar <run>`, `python catalogo.py restaurar --nivel N2`).

## Ficha del ambiente (entrega del curso)

[docs/ambiente-v0.1.md](docs/ambiente-v0.1.md) describe el ambiente siguiendo la plantilla del profesor: misión y mapa, variables, observaciones y acciones, dinámica, recompensa, éxito y fracaso, métricas e incidente, cinco transiciones, trampas y decisiones pendientes. El mapa está en [docs/mapa-ambiente-v0.1.svg](docs/mapa-ambiente-v0.1.svg).

## Experimento 1

```bash
python experimento1.py               # agente aleatorio vs. controlador heurístico
python visualizar_experimento1.py    # genera experimento1.html con esas épocas en 3D
```

## Experimentos

| | Experimento 1 | Experimento 2 | Experimento 3 (nivel 2) |
|---|---|---|---|
| Modelo | Q-learning con dos tablas ([agente_qlearning.py](agente_qlearning.py)) | PPO, red neuronal con Stable-Baselines3 ([agente_ppo.py](agente_ppo.py)) | PPO con transferencia desde el modelo del nivel 1 (`--desde`) |
| Ambiente | N1 · `RocketLanding3D-v0` 0.1 | N1 · `RocketLanding3D-v0` 0.1 | N2 · `RocketLanding3D-N2-v0` 0.2 (tres torres) |
| Entrenar | `python cli.py entrenar` (~2 min) | `python cli.py entrenar-ppo` (~11 min en CPU) | `python cli.py entrenar-ppo --ambiente RocketLanding3D-N2-v0 --desde ppo-v2-v0.1-s0 --total-timesteps 1500000` (~43 min) |
| Aterrizajes en 200 épocas de evaluación | 157 (78 %) | 194 (97 %) con la semilla 0; 198 (99 %) con la semilla 1 | 172 (86 %) con 1,5 M de pasos; 153 (77 %) con 600 000; desde cero, 16 (8 %) |
| Documento | [docs/ambiente-v0.1.md](docs/ambiente-v0.1.md) | [docs/experimento-2.md](docs/experimento-2.md) | [docs/ambiente-v0.2.md](docs/ambiente-v0.2.md) |

Los experimentos 1 y 2 comparten ambiente (0.1) y son comparables entre sí; el 3 es otra familia de modelos (observación de 25 valores)
y se compara con el modelo del nivel 1 jugando a ciegas en el nivel 2 (72 %).

[EXPERIMENTOS.md](EXPERIMENTOS.md) reúne, ejecución por ejecución, dónde está guardado cada modelo (archivo, SHA-256, commit, versión en MLflow), sus variables, el cambio frente a su baseline, el resultado y la decisión. Se regenera con `python experimentos_md.py`.

### Diseño experimental: hipótesis, presupuesto y decisión

Cada configuración entrenada tiene su `configs/<run_id>.json` con la **hipótesis**, el **cambio** frente al baseline,
el **presupuesto** (épocas, pasos del agente, tiempo, máquina), la **suite** con la que se evaluó y el **estado**
(`seleccionado`, `rechazado` o `referencia`) con la decisión y su fecha. Lo mismo va como etiquetas de la run de MLflow
(`python seguimiento.py etiquetar`) y lo muestran la API (`diseno` en `/catalogo`) y la web.

| Configuración | Hipótesis (resumen) | Cambio | Estado |
|---|---|---|---|
| `base-v0.1-s0` | Q-learning tabular aterriza en < 5000 épocas | primer modelo aprendido | referencia (78 %) |
| `ppo-v0.1-s0` | PPO sobre la acción cruda supera al Q-learning | tabla → red MLP | rechazado (0 %) |
| `ppo-rel-v0.1-s0` | el fallo era la acción: empuje relativo al peso | acción relativa v1 (±23°) | rechazado (0 %, llega inclinado) |
| `ppo-v2-v0.1-s0` | acotar la inclinación al límite de aterrizaje lo hace aprendible | acción relativa v2 (±9,6°) | seleccionado (97 %) |
| `ppo-n2-v0.2-s0` | la receta del nivel 1 aprende el nivel 2 desde cero | ambiente N2 (torres) | rechazado (8 %: frena, pero fuera de la plataforma y choca con las torres) |
| `ppo-n2-transfer-v0.2-s0` | partir de la política del nivel 1 y aprender solo a esquivar | transferencia de pesos y normalización | referencia (77 %; las colisiones bajan poco: 42 frente a 53); anterior del nivel 2 |
| `ppo-n2-transfer-1m5-v0.2-s0` | el presupuesto era el cuello de botella | 1,5 M de pasos en vez de 600 000 | seleccionado N2 (86 %, 27 colisiones) |
| `ppo-v2-v0.1-s1` | con otra semilla, v2 queda a menos de 5 puntos del 97 % | solo la semilla (1); entrenada y publicada por el pipeline | seleccionado N1 (99 %, 72 % con viento): el criterio del pipeline la promovió; s0 pasa a anterior |
| `ppo-v2-v0.1-s2` | tercera semilla de v2: queda a menos de 5 puntos de s0 y s1 | solo la semilla (2); pipeline | rechazado (97,5 %: no supera en 2 puntos al recomendado s1) |
| `ppo-n3-transfer-v0.3-s0` | intervención ante el viento: reentrenar el recomendado de N2 en N3 recupera ≥ 2 puntos frente a él jugando en N3 (72 %) sin más colisiones | ambiente N3 y transferencia desde `ppo-n2-transfer-1m5-v0.2-s0`; 600 000 pasos | rechazado (81,5 %, 0 choques, pero 37 colisiones frente a 35) |
| `ppo-n3-transfer-1m5-v0.3-s0` | las colisiones eran falta de presupuesto, como en N2 | 1,5 M de pasos en vez de 600 000 | seleccionado N3 (86,5 %, 24 colisiones, 67,5 % con viento); anterior desde el catálogo v8 |
| `ppo-n3-transfer-1m5-desde-s1-v0.3-s0` | partir del nuevo recomendado de N2 (s1) mejora al recomendado de N3 sin más colisiones | modelo de partida N2-s1 en vez de N2-s0 | seleccionado N3 (92,0 %, 15 colisiones, 79,0 % con viento) |
| `ppo-n3-transfer-1m5-desde-s1-v0.3-s1` | con otra semilla, la configuración seleccionada en N3 queda a menos de 5 puntos del 92 % | solo la semilla (1); pipeline | rechazado (91,5 %, 16 colisiones, 87,5 % con viento): se cumple la hipótesis, no mejora al recomendado |
| `ppo-n3-transfer-1m5-desde-s1-v0.3-s2` | ídem con la semilla 2 | solo la semilla (2); pipeline | rechazado (84,5 %, 18 colisiones): no se cumple la hipótesis. Las tres semillas: 89,3 ± 4,2 % |
| `ppo-pasarela-transfer-1m5-v0.4-s0` | partir del recomendado de N1 con los pesos de posición heredados aprende la pasarela (N1 a ciegas: 5 %) | ambiente N2 v1 (pasarela) y transferencia desde `ppo-v2-v0.1-s1`; 1,5 M de pasos | seleccionado N2 (91,5 %, 14 colisiones) |
| `ppo-pasarela-transfer-1m5-v0.4-s1` / `-s2` | con otra semilla queda a menos de 5 puntos del 91,5 % | solo la semilla | seleccionados al mejorar en 2 puntos: s2 recomendado de N2 (100 %, 0 colisiones). Tres semillas: 96,3 ± 4,4 % |
| `ppo-pasarela-viento-transfer-1m5-v0.5-s0` | reentrenar el recomendado de N2 v1 en N3 v1 lo mejora en 2 puntos sin más colisiones | ambiente N3 v1 y transferencia desde N2-s0; 1,5 M de pasos | seleccionado N3 (94,5 % frente a 64,5 %) |
| `ppo-pasarela-viento-transfer-1m5-v0.5-s1` / `-s2` | con otra semilla queda a menos de 5 puntos | solo la semilla | rechazados (94,0 % y 92,5 %). Tres semillas: 93,7 ± 1,0 % |
| `ppo-pasarela-viento-transfer-1m5-desde-s2-v0.5-s0` | partir del nuevo recomendado de N2 (s2) mejora al recomendado de N3 | modelo de partida N2-s2 | seleccionado N3 (97,5 %, 3 colisiones, 85,5 % con viento) |

Suites: [configs/suites/suite-v1.json](configs/suites/suite-v1.json) (200 épocas, semillas desde 10 000 000, condiciones
`normal` y `viento-15`) y `suite-reservada` (misma estructura, semilla fuera del repo, solo para los finalistas).
`POST /evaluar` acepta `suite` y `condicion`. Propuesta del nivel 2: [docs/nivel-2-propuesta.md](docs/nivel-2-propuesta.md).

## CLI y páginas

```bash
python manifiestos.py                             # manifests/<id>.json (sección 11) para todas las ejecuciones
python seguimiento.py etiquetar                   # aplica configs/<id>.json como etiquetas de las runs de MLflow
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

## Pipeline orquestado (Prefect)

[pipelines/entrenar_publicar.py](pipelines/entrenar_publicar.py) encadena las ocho etapas que pide la guía: validar el ambiente,
probar el contrato, entrenar, evaluar en la suite v1, registrar (configs, manifiesto de la sección 11, MLflow, huellas), decidir
con un criterio de aceptación frente al recomendado del nivel, publicar el catálogo (commit y push) y comprobar la versión servida
por la API. La evidencia de cada ejecución queda en `pipelines/ejecuciones/`. Detalles y uso en [pipelines/README.md](pipelines/README.md).
El orquestador tiene su propio entorno (`requirements-pipeline.txt`, carpeta `.venv-prefect`).

## Web y API (entrega del proyecto final)

- **Web publicada**: https://alpha-centauri-five.vercel.app (Vercel, rama `main`, Root Directory `web`).
- **API**: Render, servicio `alpha-centauri-api` definido en [render.yaml](render.yaml) (URL `https://alpha-centauri-api.onrender.com` salvo que Render asigne otro sufijo; `GET /version` identifica el commit servido).

```
┌────────────────────────────┐   HTTPS + CORS   ┌──────────────────────────────────┐
│ web/  Vite + TypeScript +  │ ───────────────► │ api/  FastAPI + Uvicorn (Python   │
│ Three.js, publicada en     │  catálogo,       │ es la autoridad): mismo ambiente, │
│ Vercel (Root Directory web)│  evaluar, replay │ mismos modelos y evaluación que   │
└────────────────────────────┘                  │ el entrenamiento                  │
                                                │  resultados/runs/ · catalogo.json │
                                                │  mlflow.db (versiones de modelo)  │
                                                └──────────────────────────────────┘
```

- **API** ([api/main.py](api/main.py)): `GET /version` (commit, catálogo y software servidos), `GET /monitoreo` (operación: servicio, niveles, pipeline, evaluaciones recientes, alertas), `GET /catalogo`, `GET /ejecuciones/{id}` (+ `/manifest`, `/evaluacion`, `/vuelos`), `GET /comparar?runs=a,b`, `GET /incidentes` (degradación al cambiar de nivel e intervenciones), `POST /evaluar` (modelo congelado en el ambiente, modo `evaluacion`, trayectorias para replay). Documentación interactiva en `/docs`.
  ```bash
  pip install -r requirements-api.txt
  uvicorn api.main:app --reload --port 8000
  python -m pytest tests/test_api.py
  ```
- **Catálogo y rollback** ([catalogo.py](catalogo.py), [catalogo.json](catalogo.json)): `python catalogo.py recomendar <run_id> --motivo "…"` promueve un modelo; `python catalogo.py restaurar --motivo "…"` es el rollback al anterior. Rollback demostrado en producción con el nivel 3 de torres (0.3), con la evidencia de `python comprobar_api.py` (ver [docs/ambiente-v0.3.md](docs/ambiente-v0.3.md#rollback-demostrado-en-producción)). Ambos se versionan con un commit y `GET /version` confirma qué catálogo y qué commit se sirven.
- **Web** ([web/](web/)): vista **Monitoreo** (`#/monitoreo`, con `GET /monitoreo` en la API: commit y catálogo servidos, recomendado de cada nivel y su comportamiento, últimas decisiones del pipeline y rollbacks, latencia de las evaluaciones servidas y alertas); vista **Experimentos** (`#/experimentos`) con la progresión de complejidad entre niveles, un selector para pasar de un experimento a otro y, por experimento, sus configuraciones, las variables que cambian y las decisiones; catálogo con estado de cada modelo (recomendado, anterior, histórico), detalle con identidad (commit, huellas, versión en MLflow), comparación, evaluación en vivo contra la API y replay 3D con la etiqueta de modo (replay de vuelos grabados o evaluación en vivo). El visor 3D ([web/src/escena.ts](web/src/escena.ts)) es la misma escena cinematográfica de la fase 3D: cielo de Alfa Centauri, terreno de regolito, losa de aterrizaje, dos cohetes (nave de acero y propulsor), penacho con diamantes de choque, polvo, bola de fuego al chocar, tres cámaras (seguimiento, torre, a bordo), fantasmas de los vuelos anteriores y posproceso; interpola entre muestras con las velocidades grabadas.
  ```bash
  cd web && npm ci && npm run dev        # http://localhost:5173, usa VITE_API_BASE_URL de .env.development
  npm run build && npm run preview       # compila a dist/
  ```
- **Despliegue**: Vercel con Root Directory `web`, Build Command `npm run build`, Output Directory `dist` y la variable `VITE_API_BASE_URL` apuntando a la API HTTPS. La API se sirve como contenedor ([Dockerfile](Dockerfile)) o como servicio Python: [render.yaml](render.yaml) la despliega en Render (plan gratuito, 512 MB; por eso la API no importa MLflow y lee `mlflow.db` con sqlite3). `python desplegar_hf.py` haría lo mismo en un Space de Hugging Face, pero los Spaces con Docker exigen suscripción PRO. Variables en [.env.example](.env.example). Versiones verificadas: Node 24, npm 11, Vite 8, three 0.187, FastAPI 0.162, Uvicorn 0.54.

## Informe, defensa y test reservado

- [docs/informe-final.md](docs/informe-final.md): qué construimos, los niveles y su complejidad, la cadena de hipótesis, pipeline, incidente, intervención, rollback, límites y contribuciones.
- [docs/guion-defensa.md](docs/guion-defensa.md): guion de 15 minutos sobre la web pública, con preguntas probables.
- [docs/diagnostico-proyecto-final.md](docs/diagnostico-proyecto-final.md): diagnóstico frente al enunciado, actualizado en cada hito.
- `python suite_reservada.py`: test final reservado (misma estructura que la suite v1, semilla guardada por el equipo fuera del repo en `.suite_reservada` o `SUITE_RESERVADA_SEMILLA`); resultados sin la semilla en `resultados/suite-reservada/`.

## Versionado

Todo se versiona en git: código, fichas, modelos, datos de entrenamiento y el registro de MLflow.

- **Ambiente**: `RocketLanding3DEnv.VERSION` (hoy `0.1.1`). Cualquier cambio de reglas o constantes sube mayor.menor y se anota en [docs/CHANGELOG.md](docs/CHANGELOG.md); el tercer número es para señales que no cambian las reglas y `compatible()` lo ignora.
- **Manifiestos (sección 11 de la guía)**: `python manifiestos.py` genera `manifests/<run_id>.json` a partir de la ejecución y de `configs/<run_id>.json`: `run_id`, `level_id`, `environment_version`, `git_commit` completo, `config_sha256`, `model_uri` (URL al archivo en el commit exacto) y `model_sha256`, `normalization_uri`, `runtime_ref`, `evaluation_suite_id`, `seed`, hipótesis, presupuesto y estado. La API los sirve en `/ejecuciones/<id>/manifiesto`.
- **Ejecuciones**: cada entrenamiento crea `resultados/runs/<id>/` con `manifest.json` (commit de git, versión del ambiente, configuración, software y métricas), el modelo, `entrenamiento.json` (todas las épocas), `episodios.csv` (dataset: una fila por época), `vuelos.json.gz` (épocas grabadas) y `evaluacion.json` (200 épocas normales + 200 con viento). `resultados/registro.json` es el índice.
- **Huellas**: el manifest guarda en `sha256` la huella de la configuración resuelta y de cada archivo de la ejecución (modelo, normalizador, datos). `python cli.py verificar` las recalcula y avisa si algún artefacto cambió.
- **MLflow** ([seguimiento.py](seguimiento.py)): `mlflow.db` (SQLite) y `mlruns/` dentro del repo. Cada ejecución es una *run* del experimento correspondiente con parámetros, métricas, etiquetas `diseno.*` (hipótesis, estado, decisión) y `presupuesto.*`, el dataset `episodios.csv` como entrada y el modelo registrado (`rocket-landing-qlearning`, `rocket-landing-ppo`) como modelo *pyfunc* cargable con `mlflow.pyfunc.load_model("models:/rocket-landing-ppo/3")`. Interfaz: `mlflow ui --backend-store-uri sqlite:///mlflow.db`. En línea (Render, `render.yaml`, servicio `alpha-centauri-mlflow`): https://alpha-centauri-mlflow.onrender.com; la API publica esa URL en `mlflow_ui` y la web enlaza a ella. Con `MLFLOW_TRACKING_URI` se apunta a un servidor compartido (DagsHub) sin tocar código.
- **Hugging Face Hub** ([publicar_hf.py](publicar_hf.py)): `huggingface-cli login` y `python publicar_hf.py --repo usuario/alpha-centauri-rocket-landing --run ppo-v2-v0.1-s0` sube la ejecución con su tarjeta de modelo.
- **Reproducibilidad**: los entrenamientos son deterministas. Con el mismo commit, la misma versión del ambiente, la misma configuración y las versiones de `requirements.txt` sale exactamente la misma ejecución.
- **Páginas HTML**: se generan a partir de las ejecuciones y no se versionan.
