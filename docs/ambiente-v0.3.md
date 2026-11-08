# Ambiente v0.3 · nivel 3: operación exigente con viento fuerte

**Equipo Alpha Centauri · ficha 02 Rocket Landing · 5 de noviembre de 2026**

Misión de la ficha: *aterrizar en una plataforma con velocidad e inclinación seguras y combustible limitado.* El nivel 3 no añade una decisión nueva: **cambia las condiciones de operación**. El viento lateral fuerte, que en los niveles 1 y 2 solo aparecía como condición de la suite (incidente medido), pasa a ser lo normal: el agente tiene que seguir eligiendo hueco entre las torres y frenar a tiempo mientras el viento lo empuja más fuerte y de forma más irregular.

Esta ficha describe solo lo que cambia respecto al nivel 2 ([ambiente-v0.2.md](ambiente-v0.2.md)): el entorno Gymnasium `RocketLanding3D-N3-v0` ([`rocket_env/nivel3.py`](../rocket_env/nivel3.py)) hereda las torres, la colisión, el castigo de proximidad, la física, los pasos y las reglas de aterrizaje del nivel 2 sin tocar un número. Lo que no se menciona aquí es igual que en v0.2.

## Qué cambia

| Constante | Nivel 2 (v0.2) | Nivel 3 (v0.3) | Efecto |
|---|---|---|---|
| `VIENTO_MAX`: viento a 10 m, sorteado por época | 0–10 m/s | **0–15 m/s** | con la ley 1/7, a 600 m llega a ~27 m/s (antes ~18) |
| `RAFAGAS`: intensidad de las ráfagas (Ornstein-Uhlenbeck, τ = 3 s) | 1,5 m/s | **3,0 m/s** | empujes bruscos que la política no puede anticipar (no observa la ráfaga futura) |

La dirección del viento sigue siendo uniforme en 0–360°, y la condición `options={"viento": v}` de la suite sigue fijando el módulo a 10 m. La secuencia de sorteos de cada época es la misma que en los niveles 1 y 2: con la misma semilla, el cohete sale del mismo punto con las mismas condiciones de suelo, y solo cambian el módulo del viento y las ráfagas.

## Observaciones y acciones

Iguales que en el nivel 2: **25 valores** de observación (los 16 del nivel 1 y 3 por torre) y la misma acción. Por eso es **la misma familia de modelos** que el nivel 2: un modelo de N2 juega aquí tal cual, sin adaptador, y lo que pierde es la degradación por el cambio de condiciones. Los retornos no se comparan entre niveles (`compatible()` distingue 0.2 de 0.3), pero las métricas de misión sí, con la misma suite y las mismas semillas.

Un modelo del nivel 1 solo juega aquí con `AdaptadorN1`, igual que en el nivel 2.

## Recompensa, éxito y fracaso

Sin cambios respecto al nivel 2: mismos seis resultados ("colisión" incluida), mismos puntos y mismo potencial. "Sin pasos" se informa con `truncated=True`, como desde la versión 0.1.1.

## Incidente controlado: degradación medida

`python incidente.py` evalúa el modelo congelado en el nivel 3 con la suite v1 (200 épocas por condición, semillas desde 10 000 000) y guarda el antes y el después época a época en `resultados/incidentes/<run_id>@RocketLanding3D-N3-v0.json`.

| Modelo | En su nivel (suite v1) | En N3, condiciones normales | En N3, viento fijo de 15 m/s | Colisiones en N3 |
|---|---|---|---|---|
| `ppo-n2-transfer-1m5-v0.2-s1`, recomendado de N2 desde el catálogo v6 | 93,5 % | **82,5 %** (−11) | 57,5 % | 18 (13 en N2) |
| `ppo-n2-transfer-1m5-v0.2-s0`, recomendado de N2 al empezar el nivel 3 | 86,0 % | **72,0 %** (−14) | 46,5 % | 35 (27 en N2) |
| `ppo-n2-transfer-v0.2-s0`, anterior de N2 | 76,5 % | 61,5 % (−15) | 38,0 % | 49 (42 en N2) |
| `ppo-v2-v0.1-s1`, recomendado de N1 (con adaptador) | 99,0 % | 61,0 % (−38) | 40,5 % | 58 |

Los choques contra el suelo del recomendado de N2 pasan de 1 a 17: el viento le quita velocidad de margen en la frenada final. Las colisiones suben de 27 a 35, porque el viento lo desplaza hacia las torres durante la aproximación.

## Intervención

Hipótesis: reentrenar el recomendado del nivel 2 en las condiciones del nivel 3 (transferencia de pesos y normalización, 600 000 pasos) recupera al menos 2 puntos de aterrizajes frente a ese mismo modelo jugando en N3 (72,0 %), sin más colisiones y sin perder más de 5 puntos con viento de 15 m/s. Es el criterio del pipeline ([pipelines/entrenar_publicar.py](../pipelines/entrenar_publicar.py)), fijado antes de entrenar.

Dos intentos, los dos ejecutados por el pipeline y conservados (`configs/`, `manifests/`, MLflow `experimento-4-nivel3`, `pipelines/ejecuciones/`):

| En N3, suite v1 | Referencia: `ppo-n2-transfer-1m5-v0.2-s0` sin reentrenar | Intervención 1: `ppo-n3-transfer-v0.3-s0` (600 000 pasos) | Intervención 2: `ppo-n3-transfer-1m5-v0.3-s0` (1,5 M pasos) |
|---|---|---|---|
| Aterrizajes | 72,0 % | 81,5 % | **86,5 %** |
| Con viento fijo de 15 m/s | 46,5 % | **74,5 %** | 67,5 % |
| Choques contra el suelo | 17 | 0 | 3 |
| Colisiones con torres | 35 | 37 | **24** |
| Decisión del pipeline | — | **rechazada**: más colisiones que la referencia | **seleccionada**: recomendado de N3 (catálogo v7); anterior desde el v8 |

Lectura:
- Reentrenar en las condiciones nuevas recupera la frenada (los choques contra el suelo pasan de 17 a 0–3) y casi todo el terreno perdido: 86,5 % en N3, el mismo nivel que tenía el modelo en N2 (86,0 %).
- La primera intervención aprendió antes a frenar con viento que a esquivar torres con viento. Con más presupuesto las colisiones bajan de 37 a 24, como pasó en el nivel 2 (42 → 27). Se confirma la hipótesis del segundo intento.
- Hay una contrapartida: con viento fijo de 15 m/s la intervención 1 aguanta mejor (74,5 % frente a 67,5 %). El criterio fijado antes de entrenar prioriza las condiciones normales del nivel y no tener más colisiones, así que se selecciona la 2. La 1 queda como evidencia y como candidata si la operación pasara a ser siempre de viento máximo.

**Tercera intervención: partir del nuevo recomendado de N2.** Mientras se hacía el nivel 3, el pipeline promovió `ppo-n2-transfer-1m5-v0.2-s1` como recomendado de N2 (93,5 %). Jugando en N3 sin reentrenar da 82,5 % con 18 colisiones. Frente a esa referencia, el recomendado de N3 de entonces no pasaba el criterio (24 colisiones frente a 18). Se repitió la receta seleccionada (transferencia + 1,5 M de pasos en N3) cambiando solo el modelo de partida:

| En N3, suite v1 | `ppo-n2-transfer-1m5-v0.2-s1` sin reentrenar | `ppo-n3-transfer-1m5-v0.3-s0` (desde N2-s0) | `ppo-n3-transfer-1m5-desde-s1-v0.3-s0` (desde N2-s1) |
|---|---|---|---|
| Aterrizajes | 82,5 % | 86,5 % | **92,0 %** |
| Con viento fijo de 15 m/s | 57,5 % | 67,5 % | **79,0 %** |
| Choques contra el suelo | 15 | 3 | 1 |
| Colisiones con torres | 18 | 24 | **15** |
| Decisión del pipeline | — | recomendado de N3 hasta el catálogo v8; queda como anterior (rollback) | **seleccionado**: recomendado de N3 (catálogo v8) |

La mejora viene del punto de partida: un modelo de N2 que ya esquiva mejor las torres (13 colisiones frente a 27) da un modelo de N3 que también las esquiva mejor. Supera en las tres métricas tanto al recomendado anterior de N3 como al recomendado de N2 jugando en N3.

## Tres semillas del finalista

La guía pide tres semillas de entrenamiento para los finalistas. Las semillas 1 y 2 de la configuración seleccionada (transferencia desde N2-s1, 1,5 M de pasos en N3) se entrenaron con el pipeline. Hipótesis de cada una: quedar a menos de 5 puntos del 92,0 % de la semilla 0. Son entrenamientos independientes, cada uno evaluado con las mismas 200 épocas de la suite v1; no son episodios de un mismo modelo.

| Semilla | Aterrizajes | Con viento fijo de 15 m/s | Colisiones | Choques contra el suelo | Decisión del pipeline |
|---|---|---|---|---|---|
| s0 | 92,0 % | 79,0 % | 15 | 1 | seleccionada: recomendado de N3 |
| s1 | 91,5 % | 87,5 % | 16 | 0 | rechazada: no mejora en 2 puntos y tiene una colisión más |
| s2 | 84,5 % | 76,5 % | 18 | 11 | rechazada: 7,5 puntos por debajo |
| **media ± desviación típica** | **89,3 ± 4,2 %** | **81,0 ± 5,8 %** | **16,3 ± 1,5** | | |

Lectura:
- La hipótesis se cumple para s1 (−0,5 puntos) y **no para s2** (−7,5 puntos: once choques contra el suelo, la frenada final con viento es lo menos estable).
- El recomendado es la mejor de tres semillas: lo esperable de la receta es ~89 %, no 92 %. La variabilidad entre semillas es mayor que en N1 (2 puntos) y que el margen de mejora del criterio (2 puntos); por eso una sola semilla no basta para comparar recetas.
- La intervención funciona en las tres semillas: hasta la peor (84,5 %, 18 colisiones) supera al recomendado de N2 jugando en N3 sin reentrenar (82,5 %, 18 colisiones), y la media lo supera en 7 puntos de aterrizajes y 23 con viento de 15 m/s.
- Las semillas rechazadas no sustituyen al recomendado: el pipeline compara cada candidato con el recomendado vigente, y ninguna lo mejora.

## Rollback demostrado en producción

La guía define rollback como restaurar una versión anterior identificada y comprobar su funcionamiento. Se hizo el 5 de noviembre en este nivel 3 (torres, 0.3), antes de que el equipo lo sustituyera por la pasarela (0.5); el procedimiento es el mismo para cualquier nivel. Se hizo contra la API pública, con `python catalogo.py` para cambiar el catálogo y `python comprobar_api.py` para comprobar lo servido. Cada paso fue un PR revisado y fusionado en `main`:

| Paso | PR | Commit servido | Catálogo | Recomendado de N3 servido | Evaluación en vivo (20 épocas de la suite v1) | Evidencia |
|---|---|---|---|---|---|---|
| antes | #6 | `104fe05` | v8 | `ppo-n3-transfer-1m5-desde-s1-v0.3-s0` | 95 % | `pipelines/ejecuciones/rollback-n3-0-antes.json` |
| restaurar el anterior | #7 | `e872565` (164 s tras el merge) | v9 | `ppo-n3-transfer-1m5-v0.3-s0` | 75 % | `pipelines/ejecuciones/rollback-n3-1-restaurado.json` |
| volver al recomendado | #8 | `d19acd0` (90 s tras el merge) | v10 | `ppo-n3-transfer-1m5-desde-s1-v0.3-s0` | 95 % | `pipelines/ejecuciones/rollback-n3-2-vuelta.json` |

Cada paso queda en el historial del catálogo (`catalogo.json`, acciones `restaurar` y `recomendar` con su motivo y su commit base) y en la vista del catálogo de la web. La evaluación en vivo confirma que lo que cambia es el modelo servido, no solo la etiqueta: con las mismas 20 épocas, el modelo restaurado aterriza 75 % y el recomendado 95 %.

Para repetirlo en cualquier nivel:

```bash
python catalogo.py restaurar --nivel N3 --motivo "…"        # commit + PR + merge
python comprobar_api.py --nivel N3 --esperado <anterior> --commit <merge> --salida pipelines/ejecuciones/<archivo>.json
python catalogo.py recomendar <run_id> --motivo "…"         # volver
```
