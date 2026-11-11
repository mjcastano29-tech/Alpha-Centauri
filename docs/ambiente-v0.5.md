# Ambiente v0.5 · nivel 3 (v1): pasarela con viento fuerte

**Equipo Alpha Centauri · ficha 02 Rocket Landing · 6 de noviembre de 2026**

El nivel 3 no añade una decisión nueva: **cambia las condiciones de operación** del nivel 2 con pasarela ([ambiente-v0.4.md](ambiente-v0.4.md)), igual que el ambiente 0.3 lo hacía con las torres ([ambiente-v0.3.md](ambiente-v0.3.md), retirado). Entorno Gymnasium `RocketLanding3D-N3-v1` ([`rocket_env/pasarela.py`](../rocket_env/pasarela.py)), que hereda la pasarela, los pilares, la colisión, el potencial y todas las reglas de v0.4.

## Qué cambia

| Constante | Nivel 2 v1 (0.4) | Nivel 3 v1 (0.5) | Efecto |
|---|---|---|---|
| viento a 10 m (sorteo por época) | 0–10 m/s | **0–15 m/s** | la condición "viento-15" de la suite deja de ser una perturbación y entra en la operación normal |
| ráfagas (desviación del proceso de Ornstein-Uhlenbeck) | 1,5 m/s | **3 m/s** | la deriva cambia más deprisa; el traslado de 30 m bajo la pasarela es la fase sensible |

## Observaciones y acciones

Las de v0.4 (20 valores y la misma acción): **misma familia de modelos**. Un modelo del nivel 2 v1 juega aquí tal cual, sin adaptador, y eso mide la degradación al cambiar las condiciones (incidente). Un modelo del nivel 1 sigue necesitando `AdaptadorN1`.

## Recompensa, éxito y fracaso

Los de v0.4 sin cambios.

## Incidente controlado e intervención

Como en el ambiente 0.3: `python incidente.py --run <recomendado de N2 v1> --ambiente RocketLanding3D-N3-v1` mide el antes (su nivel) y el después (este), normal y con viento de 15 m/s; la intervención es reentrenar en este ambiente partiendo de sus pesos (`--desde`) por el pipeline, que decide frente a ese incidente (`--baseline`). Resultados en `configs/`, `resultados/incidentes/` y la vista `#/incidente` de la web; se resumen aquí al cerrar el experimento 6 (`experimento-6-pasarela-viento`).

### Degradación medida (8 de noviembre)

Los tres modelos de N2 v1 jugando en N3 v1 sin reentrenar, con la suite v1 (200 épocas por condición):

| Modelo de N2 v1 | En N2 v1 | En N3 v1, normal | En N3 v1, viento fijo de 15 m/s | Colisiones en N3 v1 | Fallo principal |
|---|---|---|---|---|---|
| `ppo-pasarela-transfer-1m5-v0.4-s0` | 91,5 % | **64,5 %** (−27) | 27,0 % | 39 | colisión con la pasarela; 23 sin pasos |
| `ppo-pasarela-transfer-1m5-v0.4-s1` | 97,5 % | 85,0 % (−12,5) | 45,0 % | 19 | colisión |
| `ppo-pasarela-transfer-1m5-v0.4-s2`, recomendado de N2 | 100 % | 93,5 % (−6,5) | 61,0 % | 7 | colisión y choque |

El viento empuja al cohete fuera de la abertura en la fase de entrada y lo desvía en el traslado de 30 m por debajo. La degradación depende mucho de la semilla: s2 llega a N3 casi intacta.

### Intervención: reentrenar en N3 v1

Transferencia de pesos y normalización desde un modelo de N2 v1 y 1,5 M de pasos en N3 v1, entrenado y decidido por el pipeline. Mismo criterio que en todo el proyecto: +2 puntos, no perder más de 5 con viento y no tener más colisiones.

| Ejecución | Parte de | Aterrizajes | Colisiones | Con viento de 15 m/s | Decisión del pipeline |
|---|---|---|---|---|---|
| `ppo-pasarela-viento-transfer-1m5-v0.5-s0` | N2-s0 | 94,5 % | 6 | 65,5 % | seleccionada frente a N2-s0 en N3 (64,5 %): catálogo v12 |
| `ppo-pasarela-viento-transfer-1m5-v0.5-s1` | N2-s0, semilla 1 | 94,0 % | 8 | 66,0 % | rechazada: no mejora a s0 |
| `ppo-pasarela-viento-transfer-1m5-v0.5-s2` | N2-s0, semilla 2 | 92,5 % | 10 | 74,5 % | rechazada: no mejora a s0 |
| **`ppo-pasarela-viento-transfer-1m5-desde-s2-v0.5-s0`** | N2-s2 | **97,5 %** | **3** | **85,5 %** | **seleccionada: recomendado de N3** (catálogo v15) |

Lectura:
- **Tres semillas de la receta** (desde N2-s0): 93,7 ± 1,0 % de aterrizajes, 68,7 ± 5,1 % con viento y 8 ± 2 colisiones. Es mucho más estable entre semillas que el entrenamiento en N2 (96,3 ± 4,4 %): reentrenar desde un modelo que ya sabe usar la abertura reduce la variabilidad.
- **Por qué hubo una cuarta ejecución.** Mientras corrían las semillas, el pipeline promovió N2-s2 (100 %) como recomendado de N2. Jugando en N3 sin reentrenar, N2-s2 da 93,5 %, a solo 1 punto del recomendado de N3 de entonces (94,5 %): con ese punto de partida, la intervención ya no se justificaba con el criterio de 2 puntos. Se repitió la receta cambiando solo el modelo de partida (N2-s2), igual que se hizo con las torres (ambiente 0.3).
- **Resultado:** 97,5 % de aterrizajes, 3 colisiones y 85,5 % con viento fijo de 15 m/s, frente a 93,5 %, 7 y 61 % del mismo modelo sin reentrenar. La intervención recupera la degradación y mejora la robustez al viento máximo en 24 puntos.
- **Trazabilidad:** esta ejecución está marcada con cambios sin commit (`*`). El único archivo modificado al entrenar era `docs/ambiente-v0.4.md` (documentación); el código y las configuraciones eran los del commit `8ab04da`, así que el modelo se reproduce desde ese commit.
- Pendiente: las semillas 1 y 2 de esta última configuración (desde N2-s2), si el equipo decide que es la finalista del contraste principal de N3.

## Cómo reproducir

```bash
python -m pytest tests/test_ambiente_pasarela.py
python incidente.py --run <run_id de N2 v1> --ambiente RocketLanding3D-N3-v1
.venv-prefect/bin/python pipelines/entrenar_publicar.py --ambiente RocketLanding3D-N3-v1 --seed 0 --run-id <id> --desde <run_id de N2 v1> \
    --total-timesteps 1500000 --baseline <run_id de N2 v1> --push
```
