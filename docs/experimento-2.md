# Experimento 2 · red neuronal (PPO) y registro de experimentos

**Equipo Alpha Centauri · 28 de octubre de 2026 · ambiente RocketLanding3D-v0 versión 0.1 (sin cambios respecto a la ficha)**

Objetivo del experimento: sustituir el Q-learning tabular del experimento 1 por una red neuronal, versionar
experimento, datos, pipeline y modelo con herramientas de MLOps (MLflow, Hugging Face Hub) y comparar los
modelos con gráficas profesionales en un panel común.

## Qué se mantiene y qué cambia

| | Experimento 1 | Experimento 2 |
|---|---|---|
| Ambiente | RocketLanding3D-v0 · 0.1 | el mismo, sin cambios (para que los resultados sean comparables) |
| Modelo | Q-learning con dos tablas (297 valores) | PPO (Stable-Baselines3): red MLP 128×128, PyTorch |
| Acción que decide el modelo | catálogo discreto: 6 empujes relativos al peso × 5 direcciones | 3 valores continuos en [−1, 1]: empuje alrededor de flotar e inclinación en x e y (≤ 9,6°) |
| Exploración | ε de 1 a 0,02 | ruido gaussiano de la política (desviación inicial 0,6, coeficiente de entropía 0,005) |
| Épocas de entrenamiento | 5000 | ≈ 16 000 (600 000 pasos de agente en 8 entornos en paralelo) |
| Evaluación periódica | cada 250 épocas, 50 épocas sin explorar | cada 20 000 pasos, 50 épocas sin ruido |
| Registro | carpeta `resultados/runs/<id>/` | lo mismo + MLflow (parámetros, métricas, dataset, modelo registrado) |

## Resultados (200 épocas de evaluación, meteorología no vista al entrenar)

| Ejecución | Acción de la red | Aterrizajes | Velocidad de contacto | Error de posición | Primer aterrizaje |
|---|---|---|---|---|---|
| `base-v0.1-s0` (exp. 1, Q-learning) | — | 157 / 200 (78 %) | 1,95 m/s | 5,5 m | época 1785 |
| `ppo-v0.1-s0` | cruda: los 5 valores del entorno | 0 / 200 | — | — | nunca |
| `ppo-rel-v0.1-s0` | relativa v1: empuje/peso en [0, 1,6], inclinación ±0,3 | 0 / 200 | 0,3 m/s (llega inclinado 17°) | — | época 15 936 |
| **`ppo-v2-v0.1-s0`** | **relativa v2: [−1, 1]³, empuje centrado en flotar, inclinación ≤ 9,6°** | **194 / 200 (97 %)** | ver `panel.html` | ver `panel.html` | época 1970 |

Con la perturbación de viento lateral de 15 m/s, los números de cada modelo están en `panel.html` y en
`resultados/runs/<id>/evaluacion.json`.

## Lo que aprendimos (y conviene contar en clase)

1. **La parametrización de la acción decide si el problema es aprendible.** La misma red con la acción
   cruda del entorno (acelerador + bit de encendido) no aterriza ni una vez en 400 000 pasos: aprende a
   acercarse (la recompensa sube de −115 a −49) pero nunca a frenar. Con el empuje expresado *respecto al
   peso* (×1,0 = flotar), como en el Q-learning, sí.
2. **Los límites de la acción deben respetar las reglas del aterrizaje.** La versión v1 permitía inclinar
   hasta 23° y la red aprendió a volar siempre inclinada al máximo: frenaba perfectamente (0,3 m/s) y
   chocaba por inclinación (límite 10°), sin ninguna señal intermedia que la corrigiera. Acotar la
   inclinación a 9,6° resolvió el problema sin tocar el ambiente ni la recompensa.
3. **Arrancar flotando ayuda.** Centrar la acción en ×1,0 hace que la política inicial (media 0) flote en
   vez de caer, y la exploración es útil desde la primera época.
4. **Los experimentos fallidos también se versionan.** Las dos ejecuciones que no aterrizan están en el
   registro y en MLflow con su commit, su configuración y sus métricas: son la evidencia de los puntos 1 y 2.

## Cómo reproducir

```bash
python cli.py entrenar-ppo --run-id mi-ppo            # ≈ 11 min en CPU; determinista con la misma semilla
python cli.py entrenar-ppo --accion cruda             # reproduce el experimento fallido
python cli.py runs                                    # tabla de ejecuciones
python panel.py                                       # regenera panel.html con todas
mlflow ui --backend-store-uri sqlite:///mlflow.db     # parámetros, métricas, dataset y modelos registrados
```

## Decisiones pendientes para el experimento 3

- Nuevas variables del ambiente (versión 0.2): dinámica de rotación real (torque), obstáculos, sobrecalentamiento observable.
- Comparar varias semillas por configuración (hoy una) y reportar media y desviación.
- Publicar los modelos en Hugging Face Hub (`publicar_hf.py`, requiere el token del equipo).
- Servidor MLflow compartido (DagsHub) en vez de la base SQLite en el repositorio.
