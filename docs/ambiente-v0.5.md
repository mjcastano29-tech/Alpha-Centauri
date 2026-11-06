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

## Cómo reproducir

```bash
python -m pytest tests/test_ambiente_pasarela.py
python incidente.py --run <run_id de N2 v1> --ambiente RocketLanding3D-N3-v1
.venv-prefect/bin/python pipelines/entrenar_publicar.py --ambiente RocketLanding3D-N3-v1 --seed 0 --run-id <id> --desde <run_id de N2 v1> \
    --total-timesteps 1500000 --baseline <run_id de N2 v1> --push
```
