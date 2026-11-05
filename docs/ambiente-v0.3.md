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
| `ppo-n2-transfer-1m5-v0.2-s0`, recomendado de N2 | 86,0 % | **72,0 %** (−14) | 46,5 % | 35 (27 en N2) |
| `ppo-n2-transfer-v0.2-s0`, anterior de N2 | 76,5 % | 61,5 % (−15) | 38,0 % | 49 (42 en N2) |
| `ppo-v2-v0.1-s1`, recomendado de N1 (con adaptador) | 99,0 % | 61,0 % (−38) | 40,5 % | 58 |

Los choques contra el suelo del recomendado de N2 pasan de 1 a 17: el viento le quita velocidad de margen en la frenada final. Las colisiones suben de 27 a 35, porque el viento lo desplaza hacia las torres durante la aproximación.

## Intervención

Hipótesis: reentrenar el recomendado del nivel 2 en las condiciones del nivel 3 (transferencia de pesos y normalización, 600 000 pasos) recupera al menos 2 puntos de aterrizajes frente a ese mismo modelo jugando en N3 (72,0 %), sin más colisiones y sin perder más de 5 puntos con viento de 15 m/s. Es el criterio del pipeline ([pipelines/entrenar_publicar.py](../pipelines/entrenar_publicar.py)), fijado antes de entrenar.

Resultado: ver `configs/ppo-n3-transfer-v0.3-s0.json` y la evidencia del pipeline en `pipelines/ejecuciones/`.
