# Experimentos y modelos de Alpha Centauri

Generado el 2026-11-06 14:52 con `python experimentos_md.py` a partir de los archivos versionados del repositorio. 16 ejecuciones en 4 experimentos.

## Dónde se guarda cada cosa

| Qué | Dónde | Cómo se identifica |
|---|---|---|
| Modelo entrenado (pesos) | `resultados/runs/<run_id>/modelo.zip` (PPO: red y optimizador) o `modelo.npz` (Q-learning: tablas); PPO lleva además `modelo_normalizador.pkl` (normalización de observaciones) | SHA-256 en el manifest de la ejecución y en `manifests/<run_id>.json`; URL al archivo en el commit exacto de GitHub (`model_uri`) |
| Registro de modelos (MLflow) | `mlflow.db` + `mlruns/` dentro del repo; en línea en https://alpha-centauri-mlflow.onrender.com | modelos registrados `rocket-landing-qlearning` y `rocket-landing-ppo`, una versión por ejecución; `mlflow.pyfunc.load_model("models:/rocket-landing-ppo/<versión>")` |
| Manifiesto de la ejecución | `resultados/runs/<run_id>/manifest.json` | commit de git, versión del ambiente, configuración completa, software, métricas y huellas SHA-256 |
| Manifiesto con el formato de la guía (sección 11) | `manifests/<run_id>.json` | `run_id`, `level_id`, `environment_version`, `git_commit`, `config_sha256`, `model_uri`, `model_sha256`, `normalization_uri`, `runtime_ref`, `evaluation_suite_id`, `seed`, `parent_run_id` |
| Hipótesis, cambio, presupuesto y decisión | `configs/<run_id>.json` (y etiquetas `diseno.*` en la run de MLflow) | estado `seleccionado` / `rechazado` / `referencia` |
| Datos de entrenamiento | `resultados/runs/<run_id>/episodios.csv` (una fila por época), `entrenamiento.json` (curvas), `vuelos.json.gz` (trayectorias grabadas) | huellas SHA-256 en el manifest; `python cli.py verificar` las comprueba |
| Evaluación | `resultados/runs/<run_id>/evaluacion.json`: suite v1 (`configs/suites/suite-v1.json`), 200 épocas normales y 200 con viento de 15 m/s | semillas desde 10 000 000, nunca usadas al entrenar |
| Qué modelo se sirve | `catalogo.json` (recomendado y anterior por nivel, con historial y commit base) | la API lo lee; `GET /version` dice el commit y el catálogo servidos |
| Ambientes | `rocket_env/` (`rocket_landing.py` N1 0.1.1, `nivel2.py` N2 0.2, `nivel3.py` N3 0.3) con fichas en `docs/ambiente-v0.*.md` | cada manifest guarda `ambiente.id` y `ambiente.version` |
| Evidencia del pipeline | `pipelines/ejecuciones/<run_id>-<fecha>.json` | resultado de las ocho etapas, decisión y commit publicado |

## Resumen

| Ejecución | Experimento | Nivel · ambiente | Agente | Semilla | Presupuesto | Aterrizajes (suite v1) | Con viento 15 m/s | Colisiones | Estado | Catálogo | MLflow |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `base-v0.1-s0` | experimento-1-qlearning | N1 · RocketLanding3D-v0 0.1 | Q-learning | 0 | 5000 épocas | **78.5 %** | 38.0 % | — | referencia | histórico | rocket-landing-qlearning v1 |
| `ppo-v0.1-s0` | experimento-2-ppo | N1 · RocketLanding3D-v0 0.1 | PPO (red neuronal) | 0 | 400 000 pasos | **0.0 %** | 0.0 % | — | rechazado | histórico | rocket-landing-ppo v1 |
| `ppo-rel-v0.1-s0` | experimento-2-ppo | N1 · RocketLanding3D-v0 0.1 | PPO (red neuronal) | 0 | 600 000 pasos | **0.0 %** | 0.0 % | — | rechazado | histórico | rocket-landing-ppo v2 |
| `ppo-v2-v0.1-s0` | experimento-2-ppo | N1 · RocketLanding3D-v0 0.1 | PPO (red neuronal) | 0 | 600 000 pasos | **97.0 %** | 62.5 % | — | referencia | anterior (destino del rollback) | rocket-landing-ppo v3 |
| `ppo-n2-v0.2-s0` | experimento-3-nivel2 | N2 · RocketLanding3D-N2-v0 0.2 | PPO (red neuronal) | 0 | 600 000 pasos | **8.0 %** | 1.5 % | 54 | rechazado | histórico | rocket-landing-ppo v4 |
| `ppo-n2-transfer-v0.2-s0` | experimento-3-nivel2 | N2 · RocketLanding3D-N2-v0 0.2 | PPO (red neuronal) | 0 | 600 000 pasos | **76.5 %** | 42.0 % | 42 | referencia | histórico | rocket-landing-ppo v5 |
| `ppo-n2-transfer-1m5-v0.2-s0` | experimento-3-nivel2 | N2 · RocketLanding3D-N2-v0 0.2 | PPO (red neuronal) | 0 | 1 500 000 pasos | **86.0 %** | 55.5 % | 27 | seleccionado | anterior (destino del rollback) | rocket-landing-ppo v6 |
| `ppo-v2-v0.1-s1` | experimento-2-ppo | N1 · RocketLanding3D-v0 0.1.1 | PPO (red neuronal) | 1 | 600 000 pasos | **99.0 %** | 72.0 % | — | seleccionado | recomendado (se sirve en la web) | rocket-landing-ppo v7 |
| `ppo-v2-v0.1-s2` | experimento-2-ppo | N1 · RocketLanding3D-v0 0.1.1 | PPO (red neuronal) | 2 | 600 000 pasos | **97.5 %** | 71.5 % | — | rechazado | histórico | rocket-landing-ppo v8 |
| `ppo-n3-transfer-v0.3-s0` | experimento-4-nivel3 | N3 · RocketLanding3D-N3-v0 0.3 | PPO (red neuronal) | 0 | 600 000 pasos | **81.5 %** | 74.5 % | 37 | rechazado | histórico | rocket-landing-ppo v10 |
| `ppo-n2-transfer-1m5-v0.2-s1` | experimento-3-nivel2 | N2 · RocketLanding3D-N2-v0 0.2 | PPO (red neuronal) | 1 | 1 500 000 pasos | **93.5 %** | 63.0 % | 13 | seleccionado | recomendado (se sirve en la web) | rocket-landing-ppo v9 |
| `ppo-n3-transfer-1m5-v0.3-s0` | experimento-4-nivel3 | N3 · RocketLanding3D-N3-v0 0.3 | PPO (red neuronal) | 0 | 1 500 000 pasos | **86.5 %** | 67.5 % | 24 | seleccionado | anterior (destino del rollback) | rocket-landing-ppo v11 |
| `ppo-n3-transfer-1m5-desde-s1-v0.3-s0` | experimento-4-nivel3 | N3 · RocketLanding3D-N3-v0 0.3 | PPO (red neuronal) | 0 | 1 500 000 pasos | **92.0 %** | 79.0 % | 15 | seleccionado | recomendado (se sirve en la web) | rocket-landing-ppo v12 |
| `ppo-n3-transfer-1m5-desde-s1-v0.3-s1` | experimento-4-nivel3 | N3 · RocketLanding3D-N3-v0 0.3 | PPO (red neuronal) | 1 | 1 500 000 pasos | **91.5 %** | 87.5 % | 16 | rechazado | histórico | rocket-landing-ppo v13 |
| `ppo-n3-transfer-1m5-desde-s1-v0.3-s2` | experimento-4-nivel3 | N3 · RocketLanding3D-N3-v0 0.3 | PPO (red neuronal) | 2 | 1 500 000 pasos | **84.5 %** | 76.5 % | 18 | rechazado | histórico | rocket-landing-ppo v14 |
| `ppo-n2-transfer-1m5-v0.2-s2` | experimento-3-nivel2 | N2 · RocketLanding3D-N2-v0 0.2 | PPO (red neuronal) | 2 | 1 500 000 pasos | **85.5 %** | 56.5 % | 24 | rechazado | histórico | rocket-landing-ppo v15 |

## Experimento 1 · Q-learning en el nivel 1

Experimento de MLflow `experimento-1-qlearning` (1 ejecuciones). Las ejecuciones van en orden cronológico; cada una dice qué cambió frente a su baseline.

**Pregunta.** ¿Se puede aprender a aterrizar en el ambiente base con un modelo tabular pequeño? Fija el baseline aprendido y las métricas.

**Variables que se mueven.** épocas, tasas de aprendizaje y exploración (α, ε), descuento γ, semilla; dos tablas Q discretas (motor y dirección).

### `base-v0.1-s0` · referencia · 78.5 %

**Hipótesis.** Con el empuje expresado respecto al peso y un estado discreto pequeño (altitud, velocidad vertical y deriva prevista en cada eje), un Q-learning tabular aprende a aterrizar en menos de 5000 épocas.

**Cambio frente a `—`.** Primer modelo aprendido. Referencias no aprendidas: agente aleatorio (0/20) y controlador heurístico hecho a mano (20/20, experimento1.py).

**Dónde está el modelo.**

- `resultados/runs/base-v0.1-s0/modelo.npz` · SHA-256 `e1498f54808d1f0d1e44e37e46fc3319ab760887c1e7f05f5340468b5d337644`
- En GitHub, en el commit de entrenamiento: https://github.com/mjcastano29-tech/Alpha-Centauri/blob/f8f749a4e7cc8959dce7d5bed071019456bce9c4/resultados/runs/base-v0.1-s0/modelo.npz
- MLflow: modelo `rocket-landing-qlearning` versión 1, run `41f7db7f2f4b4feb991ab9037a347c99` (https://alpha-centauri-mlflow.onrender.com/#/experiments/1/runs/41f7db7f2f4b4feb991ab9037a347c99)
- Commit de git: `f8f749a4e7cc` · manifiesto de la sección 11: `manifests/base-v0.1-s0.json`

**Variables.**

| Variable | Valor |
|---|---|
| ambiente | RocketLanding3D-v0 v0.1 (N1) |
| agente | Q-learning · Q-learning con dos tablas (motor y dirección) |
| epochs | 5000 |
| alpha | 0.1 |
| alpha_end | 0.01 |
| gamma | 0.99 |
| epsilon_end | 0.02 |
| epsilon_decay | 0.6 |
| seed | 0 |

**Resultado.**

| Métrica | Normal (suite v1) | Viento 15 m/s |
|---|---|---|
| aterrizajes seguros | 78.5 % | 38.0 % |
| velocidad de contacto | 1.95 m/s | 1.98 m/s |
| error de posición | 5.5 m | 33.6 m |
| cómo terminan | aterrizaje 157, fuera de plataforma 10, choque 33 | aterrizaje 76, fuera de plataforma 6, choque 118 |
| primer aterrizaje / mejor época | 1785 / 5000 | |
| presupuesto | epocas 5000, tiempo_s 116, maquina CPU de portátil (WSL2) | |

**Decisión (2026-10-28).** Aceptado como baseline aprendido del nivel 1: 157/200 aterrizajes (78 %), 38 % con viento de 15 m/s, primer aterrizaje en la época 1785. Es el modelo 'anterior' del catálogo, al que se vuelve en un rollback.

## Experimento 2 · PPO (red neuronal) en el nivel 1

Experimento de MLflow `experimento-2-ppo` (5 ejecuciones). Las ejecuciones van en orden cronológico; cada una dice qué cambió frente a su baseline.

**Pregunta.** ¿Una red neuronal entrenada con PPO supera al Q-learning en el mismo ambiente? Qué parametrización de la acción lo hace aprendible y cuánto varía entre semillas.

**Variables que se mueven.** pasos del agente, entornos en paralelo, tamaño de lote, tasa de aprendizaje, γ, λ de GAE, recorte, entropía, red, desviación inicial, acción (cruda / relativa v1 / relativa v2), semilla.

### `ppo-v0.1-s0` · rechazado · 0.0 %

**Hipótesis.** Una red neuronal entrenada con PPO (Stable-Baselines3) directamente sobre la acción cruda del entorno (acelerador, encendido y dirección del empuje) supera al Q-learning con 400 000 pasos.

**Cambio frente a `base-v0.1-s0`.** Modelo tabular → red MLP 128×128; mismo ambiente, misma recompensa y misma suite. Acción: los 5 valores crudos del entorno.

**Dónde está el modelo.**

- `resultados/runs/ppo-v0.1-s0/modelo.zip` · SHA-256 `dd5d2f87be2bbb430c59a56c385678392599c68b48d81b668567948f13c3d616`
- `resultados/runs/ppo-v0.1-s0/modelo_normalizador.pkl` · SHA-256 `92c3285a0c53237138f527868c80a57b504f420c33562e65449f8b955c32aec8`
- En GitHub, en el commit de entrenamiento: https://github.com/mjcastano29-tech/Alpha-Centauri/blob/25f0295769b5de65ebe39d7f42da6f0ce4e56ca8/resultados/runs/ppo-v0.1-s0/modelo.zip
- MLflow: modelo `rocket-landing-ppo` versión 1, run `abb49500ab0543f88af73c9323aa5fc2` (https://alpha-centauri-mlflow.onrender.com/#/experiments/2/runs/abb49500ab0543f88af73c9323aa5fc2)
- Commit de git: `25f0295769b5` · manifiesto de la sección 11: `manifests/ppo-v0.1-s0.json`

**Variables.**

| Variable | Valor |
|---|---|
| ambiente | RocketLanding3D-v0 v0.1 (N1) |
| agente | PPO (red neuronal) · cruda: los 5 valores del entorno |
| total_timesteps | 400000 |
| n_envs | 8 |
| n_steps | 256 |
| batch_size | 256 |
| n_epochs | 10 |
| learning_rate | 0.0003 |
| gamma | 0.99 |
| gae_lambda | 0.95 |
| clip_range | 0.2 |
| ent_coef | 0.0 |
| net_arch | 128 × 128 |
| eval_every | 20000 |
| seed | 0 |

**Diferencias de variables con `base-v0.1-s0`.** acción del agente: Q-learning → cruda: los 5 valores del entorno; total_timesteps: — → 400000; n_envs: — → 8; n_steps: — → 256; batch_size: — → 256; n_epochs: — → 10; learning_rate: — → 0.0003; gae_lambda: — → 0.95; clip_range: — → 0.2; ent_coef: — → 0.0; net_arch: — → 128 × 128; eval_every: — → 20000

**Resultado.**

| Métrica | Normal (suite v1) | Viento 15 m/s |
|---|---|---|
| aterrizajes seguros | 0.0 % | 0.0 % |
| velocidad de contacto | 11.93 m/s | 9.61 m/s |
| error de posición | 8.1 m | 12.7 m |
| cómo terminan | choque 200 | choque 197, sin pasos 3 |
| primer aterrizaje / mejor época | nunca / 14393 | |
| presupuesto | pasos_agente 400000, epocas 14443, tiempo_s 414, maquina CPU de portátil (WSL2), 8 entornos en paralelo | |

**Decisión (2026-10-28).** Rechazado: 0/200 aterrizajes. La recompensa media sube de −115 a −49 (aprende a acercarse) pero nunca frena. Con la acción cruda el problema no es aprendible en este presupuesto. Se conserva como evidencia.

### `ppo-rel-v0.1-s0` · rechazado · 0.0 %

**Hipótesis.** El fallo de ppo-v0.1-s0 es la parametrización de la acción: si la red decide el empuje respecto al peso (×1,0 = flotar), como hacía el Q-learning, PPO aprende a aterrizar.

**Cambio frente a `ppo-v0.1-s0`.** Acción relativa v1: empuje/peso en [0, 1,6] e inclinación de hasta ±0,3 por eje (23°). Presupuesto ampliado a 600 000 pasos; coeficiente de entropía 0,005.

**Dónde está el modelo.**

- `resultados/runs/ppo-rel-v0.1-s0/modelo.zip` · SHA-256 `d8a53b9d266cfcc6b7e9291dc749a180a7c036bf5af7b8f89f296c3886324903`
- `resultados/runs/ppo-rel-v0.1-s0/modelo_normalizador.pkl` · SHA-256 `d50264ebbd8b3aa59c2a71ca2d947f93f3e262dd02b59e1e5903cafe5ecedb2c`
- En GitHub, en el commit de entrenamiento: https://github.com/mjcastano29-tech/Alpha-Centauri/blob/5b55ff723ef5c0334ac5fa8a2e813d1e9cb3e76d/resultados/runs/ppo-rel-v0.1-s0/modelo.zip
- MLflow: modelo `rocket-landing-ppo` versión 2, run `0c465e9565574403a0957c4eb60aa1eb` (https://alpha-centauri-mlflow.onrender.com/#/experiments/2/runs/0c465e9565574403a0957c4eb60aa1eb)
- Commit de git: `5b55ff723ef5` · manifiesto de la sección 11: `manifests/ppo-rel-v0.1-s0.json`

**Variables.**

| Variable | Valor |
|---|---|
| ambiente | RocketLanding3D-v0 v0.1 (N1) |
| agente | PPO (red neuronal) · relativa v1: empuje/peso en [0, 1.6] e inclinación ±0.3 |
| total_timesteps | 600000 |
| n_envs | 8 |
| n_steps | 256 |
| batch_size | 256 |
| n_epochs | 10 |
| learning_rate | 0.0003 |
| gamma | 0.99 |
| gae_lambda | 0.95 |
| clip_range | 0.2 |
| ent_coef | 0.005 |
| net_arch | 128 × 128 |
| eval_every | 20000 |
| seed | 0 |
| accion | relativa |

**Diferencias de variables con `ppo-v0.1-s0`.** acción del agente: cruda: los 5 valores del entorno → relativa v1: empuje/peso en [0, 1.6] e inclinación ±0.3; total_timesteps: 400000 → 600000; ent_coef: 0.0 → 0.005; accion: — → relativa

**Resultado.**

| Métrica | Normal (suite v1) | Viento 15 m/s |
|---|---|---|
| aterrizajes seguros | 0.0 % | 0.0 % |
| velocidad de contacto | 2.57 m/s | 7.20 m/s |
| error de posición | 5.9 m | 6.1 m |
| cómo terminan | choque 199, sin pasos 1 | choque 200 |
| primer aterrizaje / mejor época | 15936 / 19828 | |
| presupuesto | pasos_agente 600000, epocas 19831, tiempo_s 546, maquina CPU de portátil (WSL2), 8 entornos en paralelo | |

**Decisión (2026-10-28).** Rechazado: 0/200. Frena bien (0,3 m/s al contacto) pero llega inclinado 17°, por encima del límite de 10°: el rango de la acción permitía violar la regla y la única señal correctora era el −100 final. La hipótesis se confirma a medias (el empuje relativo hace que frene) y da la siguiente.

### `ppo-v2-v0.1-s0` · referencia · 97.0 %

**Hipótesis.** Acotar la inclinación de la acción al límite del aterrizaje (≤ 9,6° combinados) y centrar el empuje en flotar (acción 0 = ×1,0 el peso) hace aprendible el problema con el mismo presupuesto que ppo-rel-v0.1-s0.

**Cambio frente a `ppo-rel-v0.1-s0`.** Acción relativa v2: 3 valores en [−1, 1]; empuje = 1 + a₀ (máximo ×1,6), inclinación = a₁, a₂ × 0,12; desviación inicial de la política 0,6 (log_std_init −0,5). Todo lo demás igual que ppo-rel-v0.1-s0.

**Dónde está el modelo.**

- `resultados/runs/ppo-v2-v0.1-s0/modelo.zip` · SHA-256 `6f190ae32d2886b7755fb9911a282235dff7856984872242cf1afc5a064da496`
- `resultados/runs/ppo-v2-v0.1-s0/modelo_normalizador.pkl` · SHA-256 `a5534a6f5af58e2ed478417323afa9178e39155ca0b326649ee6ef2415561675`
- En GitHub, en el commit de entrenamiento: https://github.com/mjcastano29-tech/Alpha-Centauri/blob/6458e2b0fbb022ac625a7bdb45f85cb1da7294a5/resultados/runs/ppo-v2-v0.1-s0/modelo.zip
- MLflow: modelo `rocket-landing-ppo` versión 3, run `08e4bde8de104dbc94869a31e622f52c` (https://alpha-centauri-mlflow.onrender.com/#/experiments/2/runs/08e4bde8de104dbc94869a31e622f52c)
- Commit de git: `6458e2b0fbb0` · manifiesto de la sección 11: `manifests/ppo-v2-v0.1-s0.json`

**Variables.**

| Variable | Valor |
|---|---|
| ambiente | RocketLanding3D-v0 v0.1 (N1) |
| agente | PPO (red neuronal) · relativa v2: 3 valores en [-1, 1]; empuje = 1 + a0 (máx. 1.6), inclinación = a1, a2 × 0.12 |
| total_timesteps | 600000 |
| n_envs | 8 |
| n_steps | 256 |
| batch_size | 256 |
| n_epochs | 10 |
| learning_rate | 0.0003 |
| gamma | 0.99 |
| gae_lambda | 0.95 |
| clip_range | 0.2 |
| ent_coef | 0.005 |
| net_arch | 128 × 128 |
| log_std_init | -0.5 |
| eval_every | 20000 |
| seed | 0 |
| accion | relativa |

**Diferencias de variables con `ppo-rel-v0.1-s0`.** acción del agente: relativa v1: empuje/peso en [0, 1.6] e inclinación ±0.3 → relativa v2: 3 valores en [-1, 1]; empuje = 1 + a0 (máx. 1.6), inclinación = a1, a2 × 0.12; log_std_init: — → -0.5

**Resultado.**

| Métrica | Normal (suite v1) | Viento 15 m/s |
|---|---|---|
| aterrizajes seguros | 97.0 % | 62.5 % |
| velocidad de contacto | 1.20 m/s | 1.83 m/s |
| error de posición | 4.9 m | 7.8 m |
| cómo terminan | aterrizaje 194, fuera de plataforma 2, choque 3, sin pasos 1 | aterrizaje 125, fuera de plataforma 23, choque 38, sin pasos 14 |
| primer aterrizaje / mejor época | 1970 / 14264 | |
| presupuesto | pasos_agente 600000, epocas 15942, tiempo_s 683, maquina CPU de portátil (WSL2), 8 entornos en paralelo | |

**Decisión (2026-11-02).** Seleccionado y promovido a modelo recomendado (catálogo v2): 194/200 aterrizajes (97 %) frente a 78 % del baseline; 63 % frente a 38 % con viento de 15 m/s; contacto a 1,20 m/s y 4,9 m del centro; primer aterrizaje en la época 1970. Actualización (2026-11-05): el pipeline promovió a ppo-v2-v0.1-s1 (misma configuración con semilla 1: 99 %, 72 % con viento) como recomendado del nivel 1 (catálogo v5); esta ejecución pasa a 'anterior' (destino del rollback). La diferencia entre semillas (97 % frente a 99 %) mide la variabilidad de la configuración.

### `ppo-v2-v0.1-s1` · seleccionado · 99.0 %

**Hipótesis.** Con otra semilla (1), la configuración v2 del nivel 1 queda a menos de 5 puntos del 97 % de la semilla 0: el resultado no depende de la semilla (primera de las tres semillas del finalista).

**Cambio frente a `ppo-v2-v0.1-s0`.** Solo la semilla: 1 en vez de 0. Mismos hiperparámetros, ambiente y presupuesto (600 000 pasos) que ppo-v2-v0.1-s0.

**Dónde está el modelo.**

- `resultados/runs/ppo-v2-v0.1-s1/modelo.zip` · SHA-256 `b180a033bcf1c8111fd3361e4a3c065e4622666196f2ef5ba08bf14151cac97d`
- `resultados/runs/ppo-v2-v0.1-s1/modelo_normalizador.pkl` · SHA-256 `cbb62d0aa06fd956d0e584af5638f0edb183efbfb07cfe168068d19363e549d2`
- En GitHub, en el commit de entrenamiento: https://github.com/mjcastano29-tech/Alpha-Centauri/blob/3f69d344e63dc1f526e718abdb1d98231f0c1611/resultados/runs/ppo-v2-v0.1-s1/modelo.zip
- MLflow: modelo `rocket-landing-ppo` versión 7, run `73ba6e508aa44c8aa47783a1a9917b7f` (https://alpha-centauri-mlflow.onrender.com/#/experiments/2/runs/73ba6e508aa44c8aa47783a1a9917b7f)
- Commit de git: `3f69d344e63dc1f526e718abdb1d98231f0c1611` (había cambios sin commit al entrenar) · manifiesto de la sección 11: `manifests/ppo-v2-v0.1-s1.json`

**Variables.**

| Variable | Valor |
|---|---|
| ambiente | RocketLanding3D-v0 v0.1.1 (N1) |
| agente | PPO (red neuronal) · relativa v2: 3 valores en [-1, 1]; empuje = 1 + a0 (máx. 1.6), inclinación = a1, a2 × 0.12 |
| total_timesteps | 600000 |
| n_envs | 8 |
| n_steps | 256 |
| batch_size | 256 |
| n_epochs | 10 |
| learning_rate | 0.0003 |
| gamma | 0.99 |
| gae_lambda | 0.95 |
| clip_range | 0.2 |
| ent_coef | 0.005 |
| net_arch | 128 × 128 |
| log_std_init | -0.5 |
| eval_every | 20000 |
| seed | 1 |
| accion | relativa |
| desde | None |

**Diferencias de variables con `ppo-v2-v0.1-s0`.** ambiente: RocketLanding3D-v0 v0.1 → RocketLanding3D-v0 v0.1.1; seed: 0 → 1; ambiente: — → RocketLanding3D-v0

**Resultado.**

| Métrica | Normal (suite v1) | Viento 15 m/s |
|---|---|---|
| aterrizajes seguros | 99.0 % | 72.0 % |
| velocidad de contacto | 1.25 m/s | 1.76 m/s |
| error de posición | 3.1 m | 6.5 m |
| cómo terminan | aterrizaje 198, sin pasos 2 | aterrizaje 144, fuera de plataforma 1, choque 6, sin pasos 49 |
| primer aterrizaje / mejor época | 1470 / 16422 | |
| presupuesto | pasos_agente 600000, epocas 16423, maquina pipeline Prefect en CPU de portátil (WSL2) | |

**Decisión (2026-11-05).** Seleccionado por el pipeline: 99.0% de aterrizajes en la suite v1 (0 colisiones), 72.0% con viento de 15 m/s; supera al recomendado ppo-v2-v0.1-s0 con el criterio de aceptación (+2% de tasa, viento −5% como mucho).

### `ppo-v2-v0.1-s2` · rechazado · 97.5 %

**Hipótesis.** Tercera semilla (2) de la configuración v2 del nivel 1: queda a menos de 5 puntos de las semillas 0 (97 %) y 1 (99 %).

**Cambio frente a `ppo-v2-v0.1-s1`.** Solo la semilla: 2. Mismos hiperparámetros, ambiente y presupuesto (600 000 pasos).

**Dónde está el modelo.**

- `resultados/runs/ppo-v2-v0.1-s2/modelo.zip` · SHA-256 `3c08bf5b48d480d8d3b5f742b9f5e20cad73f272e7d9447b3446481e2f26b48d`
- `resultados/runs/ppo-v2-v0.1-s2/modelo_normalizador.pkl` · SHA-256 `f7ddb318b938aada9f797bef1d5934f15620966a05634181248c6e73c263f8a9`
- En GitHub, en el commit de entrenamiento: https://github.com/mjcastano29-tech/Alpha-Centauri/blob/d298e217d87d1f70e977b0172a8e9e09e88152d6/resultados/runs/ppo-v2-v0.1-s2/modelo.zip
- MLflow: modelo `rocket-landing-ppo` versión 8, run `2cc6a8f2be6f4fa49649fb300d415205` (https://alpha-centauri-mlflow.onrender.com/#/experiments/2/runs/2cc6a8f2be6f4fa49649fb300d415205)
- Commit de git: `d298e217d87d1f70e977b0172a8e9e09e88152d6` · manifiesto de la sección 11: `manifests/ppo-v2-v0.1-s2.json`

**Variables.**

| Variable | Valor |
|---|---|
| ambiente | RocketLanding3D-v0 v0.1.1 (N1) |
| agente | PPO (red neuronal) · relativa v2: 3 valores en [-1, 1]; empuje = 1 + a0 (máx. 1.6), inclinación = a1, a2 × 0.12 |
| total_timesteps | 600000 |
| n_envs | 8 |
| n_steps | 256 |
| batch_size | 256 |
| n_epochs | 10 |
| learning_rate | 0.0003 |
| gamma | 0.99 |
| gae_lambda | 0.95 |
| clip_range | 0.2 |
| ent_coef | 0.005 |
| net_arch | 128 × 128 |
| log_std_init | -0.5 |
| eval_every | 20000 |
| seed | 2 |
| accion | relativa |
| desde | None |

**Diferencias de variables con `ppo-v2-v0.1-s1`.** seed: 1 → 2

**Resultado.**

| Métrica | Normal (suite v1) | Viento 15 m/s |
|---|---|---|
| aterrizajes seguros | 97.5 % | 71.5 % |
| velocidad de contacto | 1.19 m/s | 1.43 m/s |
| error de posición | 3.9 m | 8.1 m |
| cómo terminan | aterrizaje 195, fuera de plataforma 4, choque 1 | aterrizaje 143, fuera de plataforma 42, choque 11, sin pasos 4 |
| primer aterrizaje / mejor época | 1717 / 17748 | |
| presupuesto | pasos_agente 600000, epocas 17748, maquina pipeline Prefect en CPU de portátil (WSL2) | |

**Decisión (2026-11-05).** Rechazado por el pipeline: 97.5% de aterrizajes en la suite v1 (0 colisiones), 71.5% con viento de 15 m/s. no mejora al recomendado ppo-v2-v0.1-s1 en al menos 2% (97.5% frente a 99.0%).

## Experimento 3 · Nivel 2: torres alrededor de la plataforma

Experimento de MLflow `experimento-3-nivel2` (5 ejecuciones). Las ejecuciones van en orden cronológico; cada una dice qué cambió frente a su baseline.

**Pregunta.** Con una decisión nueva (por qué hueco entrar entre tres torres), ¿aprende PPO desde cero o hace falta partir del modelo del nivel 1? Cuánto presupuesto exige y cuánto varía entre semillas.

**Variables que se mueven.** las del experimento 2 más el ambiente (observación de 25 valores), el modelo de partida (transferencia) y el presupuesto (600 000 o 1 500 000 pasos).

### `ppo-n2-v0.2-s0` · rechazado · 8.0 %

**Hipótesis.** La misma receta que funcionó en el nivel 1 (PPO, acción relativa v2, 600 000 pasos) aprende desde cero a entrar entre las torres y aterrizar en el nivel 2.

**Cambio frente a `ppo-v2-v0.1-s0`.** Primer modelo del nivel 2. Mismos hiperparámetros que ppo-v2-v0.1-s0; cambia el ambiente (RocketLanding3D-N2-v0: 3 torres, observación de 25 valores, colisión −100, castigo de proximidad en el potencial).

**Dónde está el modelo.**

- `resultados/runs/ppo-n2-v0.2-s0/modelo.zip` · SHA-256 `330d3cbacbc2a8ae7baa6e38edbcf852341a6333c1af8ba6f0f59982d1e34b92`
- `resultados/runs/ppo-n2-v0.2-s0/modelo_normalizador.pkl` · SHA-256 `298ec2438371973c169d46f278e7333cf87cd7db5ab6c21511a8a0dc5b1faae7`
- En GitHub, en el commit de entrenamiento: https://github.com/mjcastano29-tech/Alpha-Centauri/blob/5b99fd685a66c4ae1c88dd64041fc212398e441e/resultados/runs/ppo-n2-v0.2-s0/modelo.zip
- MLflow: modelo `rocket-landing-ppo` versión 4, run `98520fc1b3fa415eacb968b66d0beb7a` (https://alpha-centauri-mlflow.onrender.com/#/experiments/3/runs/98520fc1b3fa415eacb968b66d0beb7a)
- Commit de git: `5b99fd685a66c4ae1c88dd64041fc212398e441e` (había cambios sin commit al entrenar) · manifiesto de la sección 11: `manifests/ppo-n2-v0.2-s0.json`

**Variables.**

| Variable | Valor |
|---|---|
| ambiente | RocketLanding3D-N2-v0 v0.2 (N2) |
| agente | PPO (red neuronal) · relativa v2: 3 valores en [-1, 1]; empuje = 1 + a0 (máx. 1.6), inclinación = a1, a2 × 0.12 |
| total_timesteps | 600000 |
| n_envs | 8 |
| n_steps | 256 |
| batch_size | 256 |
| n_epochs | 10 |
| learning_rate | 0.0003 |
| gamma | 0.99 |
| gae_lambda | 0.95 |
| clip_range | 0.2 |
| ent_coef | 0.005 |
| net_arch | 128 × 128 |
| log_std_init | -0.5 |
| eval_every | 20000 |
| seed | 0 |
| accion | relativa |

**Diferencias de variables con `ppo-v2-v0.1-s0`.** ambiente: RocketLanding3D-v0 v0.1 → RocketLanding3D-N2-v0 v0.2; ambiente: — → RocketLanding3D-N2-v0

**Resultado.**

| Métrica | Normal (suite v1) | Viento 15 m/s |
|---|---|---|
| aterrizajes seguros | 8.0 % | 1.5 % |
| velocidad de contacto | 2.48 m/s | 5.95 m/s |
| error de posición | 27.8 m | 42.3 m |
| cómo terminan | aterrizaje 16, fuera de plataforma 97, choque 33, colisión 54 | aterrizaje 3, fuera de plataforma 70, choque 73, sin pasos 4, colisión 50 |
| primer aterrizaje / mejor época | 3501 / 20663 | |
| presupuesto | pasos_agente 600000, epocas 21376, tiempo_s 759, maquina CPU de portátil (WSL2), 8 entornos en paralelo | |

**Decisión (2026-11-05).** Rechazado: 16/200 aterrizajes (8 %). Aprende a frenar (97 contactos suaves) pero fuera de la plataforma, y sigue chocando con las torres (54 colisiones): el −100 de la colisión en el 30 % de las salidas corta las épocas antes de que el agente practique el aterrizaje, y la red trata la plataforma rodeada de torres como zona peligrosa. Peor que el modelo del nivel 1 a ciegas (72 %). Siguiente hipótesis: partir de la política del nivel 1 y aprender solo a esquivar las torres.

### `ppo-n2-transfer-v0.2-s0` · referencia · 76.5 %

**Hipótesis.** Partir de la política del nivel 1 (ppo-v2-v0.1-s0: 72 % en el nivel 2 sin ver las torres) y aprender solo a esquivar las torres es más barato y mejor que aprender desde cero: con el mismo presupuesto de 600 000 pasos se superan el 72 % y las 53 colisiones del modelo a ciegas.

**Cambio frente a `ppo-n2-v0.2-s0`.** Transferencia: se copian los pesos de ppo-v2-v0.1-s0 y la normalización de las 16 observaciones comunes; las columnas de la primera capa para las 9 entradas nuevas (torres) empiezan en cero. Mismos hiperparámetros y ambiente que ppo-n2-v0.2-s0.

**Dónde está el modelo.**

- `resultados/runs/ppo-n2-transfer-v0.2-s0/modelo.zip` · SHA-256 `a7cd4150e5b70798848442664c5c112d4baa95b16f0fa54a90b963425e46f49d`
- `resultados/runs/ppo-n2-transfer-v0.2-s0/modelo_normalizador.pkl` · SHA-256 `7a0c6bcad898c4e1af9432aeb2184f840f1bf95ed52ff81f105a4fc85bf84a75`
- En GitHub, en el commit de entrenamiento: https://github.com/mjcastano29-tech/Alpha-Centauri/blob/5b99fd685a66c4ae1c88dd64041fc212398e441e/resultados/runs/ppo-n2-transfer-v0.2-s0/modelo.zip
- MLflow: modelo `rocket-landing-ppo` versión 5, run `9ded0b0f09f24ca88ac76be37749d72b` (https://alpha-centauri-mlflow.onrender.com/#/experiments/3/runs/9ded0b0f09f24ca88ac76be37749d72b)
- Commit de git: `5b99fd685a66c4ae1c88dd64041fc212398e441e` (había cambios sin commit al entrenar) · manifiesto de la sección 11: `manifests/ppo-n2-transfer-v0.2-s0.json`
- Parte de los pesos de `ppo-v2-v0.1-s0` (transferencia)

**Variables.**

| Variable | Valor |
|---|---|
| ambiente | RocketLanding3D-N2-v0 v0.2 (N2) |
| agente | PPO (red neuronal) · relativa v2: 3 valores en [-1, 1]; empuje = 1 + a0 (máx. 1.6), inclinación = a1, a2 × 0.12 |
| total_timesteps | 600000 |
| n_envs | 8 |
| n_steps | 256 |
| batch_size | 256 |
| n_epochs | 10 |
| learning_rate | 0.0003 |
| gamma | 0.99 |
| gae_lambda | 0.95 |
| clip_range | 0.2 |
| ent_coef | 0.005 |
| net_arch | 128 × 128 |
| log_std_init | -0.5 |
| eval_every | 20000 |
| seed | 0 |
| accion | relativa |
| desde | ppo-v2-v0.1-s0 |

**Diferencias de variables con `ppo-n2-v0.2-s0`.** desde: — → ppo-v2-v0.1-s0

**Resultado.**

| Métrica | Normal (suite v1) | Viento 15 m/s |
|---|---|---|
| aterrizajes seguros | 76.5 % | 42.0 % |
| velocidad de contacto | 1.44 m/s | 3.60 m/s |
| error de posición | 9.4 m | 17.3 m |
| cómo terminan | aterrizaje 153, fuera de plataforma 1, choque 4, colisión 42 | aterrizaje 84, fuera de plataforma 7, choque 51, colisión 58 |
| primer aterrizaje / mejor época | 4 / 19904 | |
| presupuesto | pasos_agente 600000, epocas 19940, tiempo_s 832, maquina CPU de portátil (WSL2), 8 entornos en paralelo | |

**Decisión (2026-11-05).** Seleccionado como recomendado del nivel 2 (catálogo v3): 153/200 aterrizajes (77 %) frente a 8 % desde cero y 72 % del modelo del nivel 1 a ciegas; aterriza en su cuarta época y la evaluación sin ruido llega a 45/50. La hipótesis se confirma solo en parte: la destreza de aterrizar se conserva, pero las colisiones bajan poco (42 frente a 53): esquivar las torres exige anticipar la ruta desde los 600 m y 600 000 pasos no bastan. Siguiente hipótesis: más presupuesto (1,5 M de pasos) con la misma transferencia. Actualización (mismo día): superado por ppo-n2-transfer-1m5-v0.2-s0 (86 %, 27 colisiones); pasa a 'anterior' del nivel 2 en el catálogo (destino del rollback).

### `ppo-n2-transfer-1m5-v0.2-s0` · seleccionado · 86.0 %

**Hipótesis.** Esquivar las torres exige anticipar la ruta desde la salida y 600 000 pasos no bastan: con 1,5 M de pasos y la misma transferencia desde el nivel 1, las colisiones bajan claramente (menos de 30 en 200) y la tasa supera el 80 %.

**Cambio frente a `ppo-n2-transfer-v0.2-s0`.** Solo el presupuesto: 1 500 000 pasos en vez de 600 000. Misma transferencia desde ppo-v2-v0.1-s0, mismos hiperparámetros y ambiente que ppo-n2-transfer-v0.2-s0.

**Dónde está el modelo.**

- `resultados/runs/ppo-n2-transfer-1m5-v0.2-s0/modelo.zip` · SHA-256 `a1d482aaa151eb8819258f8512174d846231ef1c60a9ab008e5cd136805fd1db`
- `resultados/runs/ppo-n2-transfer-1m5-v0.2-s0/modelo_normalizador.pkl` · SHA-256 `0f47cb0d9ea76b116d53e6e106c96cdafed65beefd1fd5eb543564f1848b38c3`
- En GitHub, en el commit de entrenamiento: https://github.com/mjcastano29-tech/Alpha-Centauri/blob/e106cda449db0da672de7f6a855a94380beb84d9/resultados/runs/ppo-n2-transfer-1m5-v0.2-s0/modelo.zip
- MLflow: modelo `rocket-landing-ppo` versión 6, run `069c285758c548059b92ae94b3d739f3` (https://alpha-centauri-mlflow.onrender.com/#/experiments/3/runs/069c285758c548059b92ae94b3d739f3)
- Commit de git: `e106cda449db0da672de7f6a855a94380beb84d9` · manifiesto de la sección 11: `manifests/ppo-n2-transfer-1m5-v0.2-s0.json`
- Parte de los pesos de `ppo-v2-v0.1-s0` (transferencia)

**Variables.**

| Variable | Valor |
|---|---|
| ambiente | RocketLanding3D-N2-v0 v0.2 (N2) |
| agente | PPO (red neuronal) · relativa v2: 3 valores en [-1, 1]; empuje = 1 + a0 (máx. 1.6), inclinación = a1, a2 × 0.12 |
| total_timesteps | 1500000 |
| n_envs | 8 |
| n_steps | 256 |
| batch_size | 256 |
| n_epochs | 10 |
| learning_rate | 0.0003 |
| gamma | 0.99 |
| gae_lambda | 0.95 |
| clip_range | 0.2 |
| ent_coef | 0.005 |
| net_arch | 128 × 128 |
| log_std_init | -0.5 |
| eval_every | 20000 |
| seed | 0 |
| accion | relativa |
| desde | ppo-v2-v0.1-s0 |

**Diferencias de variables con `ppo-n2-transfer-v0.2-s0`.** total_timesteps: 600000 → 1500000

**Resultado.**

| Métrica | Normal (suite v1) | Viento 15 m/s |
|---|---|---|
| aterrizajes seguros | 86.0 % | 55.5 % |
| velocidad de contacto | 1.31 m/s | 2.83 m/s |
| error de posición | 7.0 m | 14.1 m |
| cómo terminan | aterrizaje 172, choque 1, colisión 27 | aterrizaje 111, fuera de plataforma 9, choque 24, sin pasos 14, colisión 42 |
| primer aterrizaje / mejor época | 4 / 48133 | |
| presupuesto | pasos_agente 1500000, epocas 49460, tiempo_s 2564, maquina CPU de portátil (WSL2), 8 entornos en paralelo | |

**Decisión (2026-11-05).** Seleccionado y promovido a recomendado del nivel 2 (catálogo v4): 172/200 aterrizajes (86 %) frente a 77 % con 600 000 pasos y 72 % del modelo del nivel 1 a ciegas; colisiones 27 frente a 42 y 53; contacto a 1.31 m/s y 7.0 m del centro. Confirma la hipótesis: el presupuesto era el cuello de botella. Cuesta 2,5 veces más tiempo (43 min). Queda pendiente repetirlo con tres semillas.

### `ppo-n2-transfer-1m5-v0.2-s1` · seleccionado · 93.5 %

**Hipótesis.** Segunda semilla (1) del finalista del nivel 2 (transferencia desde ppo-v2-v0.1-s0, 1,5 M de pasos): queda a menos de 5 puntos del 86 % de la semilla 0.

**Cambio frente a `ppo-n2-transfer-1m5-v0.2-s0`.** Solo la semilla del entrenamiento PPO: 1. Misma transferencia, hiperparámetros, ambiente y presupuesto.

**Dónde está el modelo.**

- `resultados/runs/ppo-n2-transfer-1m5-v0.2-s1/modelo.zip` · SHA-256 `797735839f718b18198dd9a060d45bf6b23755ca8edfd0f6206d76a9129f7c06`
- `resultados/runs/ppo-n2-transfer-1m5-v0.2-s1/modelo_normalizador.pkl` · SHA-256 `c70833d925e4bbc14b980ab7c489a2c2613113cea00e440bdfc40a2fa41240b5`
- En GitHub, en el commit de entrenamiento: https://github.com/mjcastano29-tech/Alpha-Centauri/blob/7443e1d9686a257eddf1c9c617988408e8df9dd2/resultados/runs/ppo-n2-transfer-1m5-v0.2-s1/modelo.zip
- MLflow: modelo `rocket-landing-ppo` versión 9, run `fba2d044e23e4cca84bac83b29b61bb0` (https://alpha-centauri-mlflow.onrender.com/#/experiments/3/runs/fba2d044e23e4cca84bac83b29b61bb0)
- Commit de git: `7443e1d9686a257eddf1c9c617988408e8df9dd2` (había cambios sin commit al entrenar) · manifiesto de la sección 11: `manifests/ppo-n2-transfer-1m5-v0.2-s1.json`
- Parte de los pesos de `ppo-v2-v0.1-s0` (transferencia)

**Variables.**

| Variable | Valor |
|---|---|
| ambiente | RocketLanding3D-N2-v0 v0.2 (N2) |
| agente | PPO (red neuronal) · relativa v2: 3 valores en [-1, 1]; empuje = 1 + a0 (máx. 1.6), inclinación = a1, a2 × 0.12 |
| total_timesteps | 1500000 |
| n_envs | 8 |
| n_steps | 256 |
| batch_size | 256 |
| n_epochs | 10 |
| learning_rate | 0.0003 |
| gamma | 0.99 |
| gae_lambda | 0.95 |
| clip_range | 0.2 |
| ent_coef | 0.005 |
| net_arch | 128 × 128 |
| log_std_init | -0.5 |
| eval_every | 20000 |
| seed | 1 |
| accion | relativa |
| desde | ppo-v2-v0.1-s0 |

**Diferencias de variables con `ppo-n2-transfer-1m5-v0.2-s0`.** seed: 0 → 1

**Resultado.**

| Métrica | Normal (suite v1) | Viento 15 m/s |
|---|---|---|
| aterrizajes seguros | 93.5 % | 63.0 % |
| velocidad de contacto | 0.79 m/s | 2.86 m/s |
| error de posición | 5.2 m | 15.6 m |
| cómo terminan | aterrizaje 187, colisión 13 | aterrizaje 126, fuera de plataforma 1, choque 29, sin pasos 3, colisión 41 |
| primer aterrizaje / mejor época | 4 / 47840 | |
| presupuesto | pasos_agente 1500000, epocas 48450, maquina pipeline Prefect en CPU de portátil (WSL2) | |

**Decisión (2026-11-05).** Seleccionado por el pipeline: 93.5% de aterrizajes en la suite v1 (13 colisiones), 63.0% con viento de 15 m/s; supera al recomendado ppo-n2-transfer-1m5-v0.2-s0 con el criterio de aceptación (+2% de tasa, viento −5% como mucho, no más colisiones).

### `ppo-n2-transfer-1m5-v0.2-s2` · rechazado · 85.5 %

**Hipótesis.** Tercera semilla (2) del finalista del nivel 2: queda a menos de 5 puntos del 86 % de la semilla 0.

**Cambio frente a `ppo-n2-transfer-1m5-v0.2-s0`.** Solo la semilla del entrenamiento PPO: 2. Misma transferencia, hiperparámetros, ambiente y presupuesto.

**Dónde está el modelo.**

- `resultados/runs/ppo-n2-transfer-1m5-v0.2-s2/modelo.zip` · SHA-256 `fb8dd6d2969df36331930e91b2ace6526690fdcd3d94c8b0a6655dd9e866d4f3`
- `resultados/runs/ppo-n2-transfer-1m5-v0.2-s2/modelo_normalizador.pkl` · SHA-256 `00de0033f9b5073f111acd4cd5ec46bc04d4a2838e25d373c1ab2b42ff179702`
- En GitHub, en el commit de entrenamiento: https://github.com/mjcastano29-tech/Alpha-Centauri/blob/f61e2a500ea2e3e05ca9c60f37f1147ae619ecbf/resultados/runs/ppo-n2-transfer-1m5-v0.2-s2/modelo.zip
- MLflow: modelo `rocket-landing-ppo` versión 15, run `63855464a69c4fbeac683bf3b83c0bf4` (https://alpha-centauri-mlflow.onrender.com/#/experiments/3/runs/63855464a69c4fbeac683bf3b83c0bf4)
- Commit de git: `f61e2a500ea2e3e05ca9c60f37f1147ae619ecbf` (había cambios sin commit al entrenar) · manifiesto de la sección 11: `manifests/ppo-n2-transfer-1m5-v0.2-s2.json`
- Parte de los pesos de `ppo-v2-v0.1-s0` (transferencia)

**Variables.**

| Variable | Valor |
|---|---|
| ambiente | RocketLanding3D-N2-v0 v0.2 (N2) |
| agente | PPO (red neuronal) · relativa v2: 3 valores en [-1, 1]; empuje = 1 + a0 (máx. 1.6), inclinación = a1, a2 × 0.12 |
| total_timesteps | 1500000 |
| n_envs | 8 |
| n_steps | 256 |
| batch_size | 256 |
| n_epochs | 10 |
| learning_rate | 0.0003 |
| gamma | 0.99 |
| gae_lambda | 0.95 |
| clip_range | 0.2 |
| ent_coef | 0.005 |
| net_arch | 128 × 128 |
| log_std_init | -0.5 |
| eval_every | 20000 |
| seed | 2 |
| accion | relativa |
| desde | ppo-v2-v0.1-s0 |

**Diferencias de variables con `ppo-n2-transfer-1m5-v0.2-s0`.** seed: 0 → 2

**Resultado.**

| Métrica | Normal (suite v1) | Viento 15 m/s |
|---|---|---|
| aterrizajes seguros | 85.5 % | 56.5 % |
| velocidad de contacto | 1.51 m/s | 4.36 m/s |
| error de posición | 6.4 m | 18.0 m |
| cómo terminan | aterrizaje 171, choque 5, colisión 24 | aterrizaje 113, choque 30, sin pasos 1, colisión 56 |
| primer aterrizaje / mejor época | 3 / 39576 | |
| presupuesto | pasos_agente 1500000, epocas 47308, maquina pipeline Prefect en CPU de portátil (WSL2) | |

**Decisión (2026-11-06).** Rechazado por el pipeline: 85.5% de aterrizajes en la suite v1 (24 colisiones), 56.5% con viento de 15 m/s. no mejora al recomendado ppo-n2-transfer-1m5-v0.2-s1 en al menos 2% (85.5% frente a 93.5%); con viento de 15 m/s pierde más de 5% (56.5% frente a 63.0%); más colisiones que el recomendado (24 frente a 13).

## Experimento 4 · Nivel 3: viento fuerte (incidente e intervención)

Experimento de MLflow `experimento-4-nivel3` (5 ejecuciones). Las ejecuciones van en orden cronológico; cada una dice qué cambió frente a su baseline.

**Pregunta.** Cuando cambian las condiciones de operación (viento de hasta 15 m/s y ráfagas dobles), ¿cuánto se degrada el modelo del nivel 2 y lo recupera reentrenarlo en el nivel 3? Desde qué modelo conviene partir.

**Variables que se mueven.** las del experimento 3 con el ambiente N3; cambia el modelo de partida (recomendado de N2, semilla 0 o 1) y el presupuesto.

### `ppo-n3-transfer-v0.3-s0` · rechazado · 81.5 %

**Hipótesis.** Intervención ante el incidente de viento: reentrenar el recomendado del nivel 2 en las condiciones del nivel 3 (viento 0–15 m/s, ráfagas ×2) recupera al menos 2 puntos de aterrizajes frente a ese mismo modelo jugando en N3 (72,0 %) sin más colisiones

**Cambio frente a `ppo-n2-transfer-1m5-v0.2-s0`.** Ambiente N3 (viento hasta 15 m/s, ráfagas 3 m/s) y transferencia de pesos y normalización desde ppo-n2-transfer-1m5-v0.2-s0; 600 000 pasos

**Dónde está el modelo.**

- `resultados/runs/ppo-n3-transfer-v0.3-s0/modelo.zip` · SHA-256 `6646945f1952c26f60d8c9508c1f49e06c6e7ce6733ec1fbdeb35881ffbc8f95`
- `resultados/runs/ppo-n3-transfer-v0.3-s0/modelo_normalizador.pkl` · SHA-256 `b9441e583a56365b0d44bc9fa5c5a784e675260aae491366b6b992ffa14f20fa`
- En GitHub, en el commit de entrenamiento: https://github.com/mjcastano29-tech/Alpha-Centauri/blob/388cb701eff057ef6d97d650cae31463f908508b/resultados/runs/ppo-n3-transfer-v0.3-s0/modelo.zip
- MLflow: modelo `rocket-landing-ppo` versión 10, run `f08434938a7148d3b76378d53963b434` (https://alpha-centauri-mlflow.onrender.com/#/experiments/4/runs/f08434938a7148d3b76378d53963b434)
- Commit de git: `388cb701eff057ef6d97d650cae31463f908508b` (había cambios sin commit al entrenar) · manifiesto de la sección 11: `manifests/ppo-n3-transfer-v0.3-s0.json`
- Parte de los pesos de `ppo-n2-transfer-1m5-v0.2-s0` (transferencia)

**Variables.**

| Variable | Valor |
|---|---|
| ambiente | RocketLanding3D-N3-v0 v0.3 (N3) |
| agente | PPO (red neuronal) · relativa v2: 3 valores en [-1, 1]; empuje = 1 + a0 (máx. 1.6), inclinación = a1, a2 × 0.12 |
| total_timesteps | 600000 |
| n_envs | 8 |
| n_steps | 256 |
| batch_size | 256 |
| n_epochs | 10 |
| learning_rate | 0.0003 |
| gamma | 0.99 |
| gae_lambda | 0.95 |
| clip_range | 0.2 |
| ent_coef | 0.005 |
| net_arch | 128 × 128 |
| log_std_init | -0.5 |
| eval_every | 20000 |
| seed | 0 |
| accion | relativa |
| desde | ppo-n2-transfer-1m5-v0.2-s0 |

**Diferencias de variables con `ppo-n2-transfer-1m5-v0.2-s0`.** ambiente: RocketLanding3D-N2-v0 v0.2 → RocketLanding3D-N3-v0 v0.3; total_timesteps: 1500000 → 600000; ambiente: RocketLanding3D-N2-v0 → RocketLanding3D-N3-v0; desde: ppo-v2-v0.1-s0 → ppo-n2-transfer-1m5-v0.2-s0

**Resultado.**

| Métrica | Normal (suite v1) | Viento 15 m/s |
|---|---|---|
| aterrizajes seguros | 81.5 % | 74.5 % |
| velocidad de contacto | 1.52 m/s | 1.89 m/s |
| error de posición | 9.8 m | 11.1 m |
| cómo terminan | aterrizaje 163, colisión 37 | aterrizaje 149, fuera de plataforma 1, choque 19, colisión 31 |
| primer aterrizaje / mejor época | 6 / 19439 | |
| presupuesto | pasos_agente 600000, epocas 19440, maquina pipeline Prefect en CPU de portátil (WSL2) | |

**Decisión (2026-11-05).** Rechazado por el pipeline: 81.5% de aterrizajes en la suite v1 (37 colisiones), 74.5% con viento de 15 m/s. más colisiones que ppo-n2-transfer-1m5-v0.2-s0 (37 frente a 35).

### `ppo-n3-transfer-1m5-v0.3-s0` · seleccionado · 86.5 %

**Hipótesis.** Las colisiones de la primera intervención (37 frente a 35) son falta de presupuesto, como en el nivel 2: con 1,5 M de pasos el modelo reentrenado en N3 no tiene más colisiones que el recomendado de N2 jugando en N3 y mantiene al menos +2 puntos de aterrizajes (72,0 %)

**Cambio frente a `ppo-n2-transfer-1m5-v0.2-s0`.** Solo el presupuesto: 1 500 000 pasos en vez de 600 000 (misma transferencia desde ppo-n2-transfer-1m5-v0.2-s0, mismo ambiente N3)

**Dónde está el modelo.**

- `resultados/runs/ppo-n3-transfer-1m5-v0.3-s0/modelo.zip` · SHA-256 `6e865aa29afbdb2be507cc905bdc638930c0ef036a8b14e14dfc4d8b1262f168`
- `resultados/runs/ppo-n3-transfer-1m5-v0.3-s0/modelo_normalizador.pkl` · SHA-256 `456fce5ac622df510f54928c0594754872e8b93d27e9d30d1628827cbdc702b7`
- En GitHub, en el commit de entrenamiento: https://github.com/mjcastano29-tech/Alpha-Centauri/blob/eeb0babbf79c2b4266b4bf843e856530960d8573/resultados/runs/ppo-n3-transfer-1m5-v0.3-s0/modelo.zip
- MLflow: modelo `rocket-landing-ppo` versión 11, run `44b0296d7d6a4443b72aae36456157c6` (https://alpha-centauri-mlflow.onrender.com/#/experiments/4/runs/44b0296d7d6a4443b72aae36456157c6)
- Commit de git: `eeb0babbf79c2b4266b4bf843e856530960d8573` · manifiesto de la sección 11: `manifests/ppo-n3-transfer-1m5-v0.3-s0.json`
- Parte de los pesos de `ppo-n2-transfer-1m5-v0.2-s0` (transferencia)

**Variables.**

| Variable | Valor |
|---|---|
| ambiente | RocketLanding3D-N3-v0 v0.3 (N3) |
| agente | PPO (red neuronal) · relativa v2: 3 valores en [-1, 1]; empuje = 1 + a0 (máx. 1.6), inclinación = a1, a2 × 0.12 |
| total_timesteps | 1500000 |
| n_envs | 8 |
| n_steps | 256 |
| batch_size | 256 |
| n_epochs | 10 |
| learning_rate | 0.0003 |
| gamma | 0.99 |
| gae_lambda | 0.95 |
| clip_range | 0.2 |
| ent_coef | 0.005 |
| net_arch | 128 × 128 |
| log_std_init | -0.5 |
| eval_every | 20000 |
| seed | 0 |
| accion | relativa |
| desde | ppo-n2-transfer-1m5-v0.2-s0 |

**Diferencias de variables con `ppo-n2-transfer-1m5-v0.2-s0`.** ambiente: RocketLanding3D-N2-v0 v0.2 → RocketLanding3D-N3-v0 v0.3; ambiente: RocketLanding3D-N2-v0 → RocketLanding3D-N3-v0; desde: ppo-v2-v0.1-s0 → ppo-n2-transfer-1m5-v0.2-s0

**Resultado.**

| Métrica | Normal (suite v1) | Viento 15 m/s |
|---|---|---|
| aterrizajes seguros | 86.5 % | 67.5 % |
| velocidad de contacto | 1.45 m/s | 2.90 m/s |
| error de posición | 6.8 m | 14.5 m |
| cómo terminan | aterrizaje 173, choque 3, colisión 24 | aterrizaje 135, fuera de plataforma 4, choque 28, colisión 33 |
| primer aterrizaje / mejor época | 6 / 47287 | |
| presupuesto | pasos_agente 1500000, epocas 48619, maquina pipeline Prefect en CPU de portátil (WSL2) | |

**Decisión (2026-11-05).** Seleccionado por el pipeline: 86.5% de aterrizajes en la suite v1 (24 colisiones), 67.5% con viento de 15 m/s; supera a ppo-n2-transfer-1m5-v0.2-s0 en este ambiente con el criterio de aceptación (+2% de tasa, viento −5% como mucho, no más colisiones).

### `ppo-n3-transfer-1m5-desde-s1-v0.3-s0` · seleccionado · 92.0 %

**Hipótesis.** Partir del nuevo recomendado del nivel 2 (s1: 93,5 % en N2, 82,5 % y 18 colisiones jugando en N3) con la receta seleccionada en N3 (1,5 M de pasos) mejora al recomendado de N3 en al menos 2 puntos sin más colisiones

**Cambio frente a `ppo-n3-transfer-1m5-v0.3-s0`.** Solo el modelo de partida: ppo-n2-transfer-1m5-v0.2-s1 en vez de ppo-n2-transfer-1m5-v0.2-s0 (mismo ambiente N3, mismo presupuesto)

**Dónde está el modelo.**

- `resultados/runs/ppo-n3-transfer-1m5-desde-s1-v0.3-s0/modelo.zip` · SHA-256 `77f0d12b40b0711e84a3d422281b07ed5c8dbfbe801a093fadae1380f12a5de9`
- `resultados/runs/ppo-n3-transfer-1m5-desde-s1-v0.3-s0/modelo_normalizador.pkl` · SHA-256 `30eac1012c89a3cd27a6e09c9be710511ad9b40d2bb386a5263d278f71ec41c2`
- En GitHub, en el commit de entrenamiento: https://github.com/mjcastano29-tech/Alpha-Centauri/blob/4d9f5c8590153df34be2c370688849c2182f837b/resultados/runs/ppo-n3-transfer-1m5-desde-s1-v0.3-s0/modelo.zip
- MLflow: modelo `rocket-landing-ppo` versión 12, run `d945f0daa90944de83e40483f6e91d8f` (https://alpha-centauri-mlflow.onrender.com/#/experiments/4/runs/d945f0daa90944de83e40483f6e91d8f)
- Commit de git: `4d9f5c8590153df34be2c370688849c2182f837b` · manifiesto de la sección 11: `manifests/ppo-n3-transfer-1m5-desde-s1-v0.3-s0.json`
- Parte de los pesos de `ppo-n2-transfer-1m5-v0.2-s1` (transferencia)

**Variables.**

| Variable | Valor |
|---|---|
| ambiente | RocketLanding3D-N3-v0 v0.3 (N3) |
| agente | PPO (red neuronal) · relativa v2: 3 valores en [-1, 1]; empuje = 1 + a0 (máx. 1.6), inclinación = a1, a2 × 0.12 |
| total_timesteps | 1500000 |
| n_envs | 8 |
| n_steps | 256 |
| batch_size | 256 |
| n_epochs | 10 |
| learning_rate | 0.0003 |
| gamma | 0.99 |
| gae_lambda | 0.95 |
| clip_range | 0.2 |
| ent_coef | 0.005 |
| net_arch | 128 × 128 |
| log_std_init | -0.5 |
| eval_every | 20000 |
| seed | 0 |
| accion | relativa |
| desde | ppo-n2-transfer-1m5-v0.2-s1 |

**Diferencias de variables con `ppo-n3-transfer-1m5-v0.3-s0`.** desde: ppo-n2-transfer-1m5-v0.2-s0 → ppo-n2-transfer-1m5-v0.2-s1

**Resultado.**

| Métrica | Normal (suite v1) | Viento 15 m/s |
|---|---|---|
| aterrizajes seguros | 92.0 % | 79.0 % |
| velocidad de contacto | 1.36 m/s | 1.83 m/s |
| error de posición | 4.9 m | 9.5 m |
| cómo terminan | aterrizaje 184, choque 1, colisión 15 | aterrizaje 158, choque 10, colisión 32 |
| primer aterrizaje / mejor época | 3 / 46030 | |
| presupuesto | pasos_agente 1500000, epocas 46065, maquina pipeline Prefect en CPU de portátil (WSL2) | |

**Decisión (2026-11-05).** Seleccionado por el pipeline: 92.0% de aterrizajes en la suite v1 (15 colisiones), 79.0% con viento de 15 m/s; supera al recomendado ppo-n3-transfer-1m5-v0.3-s0 con el criterio de aceptación (+2% de tasa, viento −5% como mucho, no más colisiones).

### `ppo-n3-transfer-1m5-desde-s1-v0.3-s1` · rechazado · 91.5 %

**Hipótesis.** Semilla 1 de la configuración seleccionada en N3 (transferencia desde N2-s1, 1,5 M de pasos): queda a menos de 5 puntos del 92,0 % de la semilla 0

**Cambio frente a `ppo-n3-transfer-1m5-desde-s1-v0.3-s0`.** Solo la semilla de entrenamiento: 1. Mismo modelo de partida, ambiente y presupuesto

**Dónde está el modelo.**

- `resultados/runs/ppo-n3-transfer-1m5-desde-s1-v0.3-s1/modelo.zip` · SHA-256 `97df128d04c61247ce08a549257daa023171c2027141858fd35c6589217017b9`
- `resultados/runs/ppo-n3-transfer-1m5-desde-s1-v0.3-s1/modelo_normalizador.pkl` · SHA-256 `636849d3a582390c188b799bf7f8614ade5cbd887dcf802c830773460685c686`
- En GitHub, en el commit de entrenamiento: https://github.com/mjcastano29-tech/Alpha-Centauri/blob/0a994ae8f7a8a2bfad3e8797c9f1f6e605906822/resultados/runs/ppo-n3-transfer-1m5-desde-s1-v0.3-s1/modelo.zip
- MLflow: modelo `rocket-landing-ppo` versión 13, run `1cd7df609f624699bfc218b48f47ba19` (https://alpha-centauri-mlflow.onrender.com/#/experiments/4/runs/1cd7df609f624699bfc218b48f47ba19)
- Commit de git: `0a994ae8f7a8a2bfad3e8797c9f1f6e605906822` · manifiesto de la sección 11: `manifests/ppo-n3-transfer-1m5-desde-s1-v0.3-s1.json`
- Parte de los pesos de `ppo-n2-transfer-1m5-v0.2-s1` (transferencia)

**Variables.**

| Variable | Valor |
|---|---|
| ambiente | RocketLanding3D-N3-v0 v0.3 (N3) |
| agente | PPO (red neuronal) · relativa v2: 3 valores en [-1, 1]; empuje = 1 + a0 (máx. 1.6), inclinación = a1, a2 × 0.12 |
| total_timesteps | 1500000 |
| n_envs | 8 |
| n_steps | 256 |
| batch_size | 256 |
| n_epochs | 10 |
| learning_rate | 0.0003 |
| gamma | 0.99 |
| gae_lambda | 0.95 |
| clip_range | 0.2 |
| ent_coef | 0.005 |
| net_arch | 128 × 128 |
| log_std_init | -0.5 |
| eval_every | 20000 |
| seed | 1 |
| accion | relativa |
| desde | ppo-n2-transfer-1m5-v0.2-s1 |

**Diferencias de variables con `ppo-n3-transfer-1m5-desde-s1-v0.3-s0`.** seed: 0 → 1

**Resultado.**

| Métrica | Normal (suite v1) | Viento 15 m/s |
|---|---|---|
| aterrizajes seguros | 91.5 % | 87.5 % |
| velocidad de contacto | 1.36 m/s | 1.46 m/s |
| error de posición | 4.8 m | 6.3 m |
| cómo terminan | aterrizaje 183, choque 1, colisión 16 | aterrizaje 175, colisión 25 |
| primer aterrizaje / mejor época | 3 / 44684 | |
| presupuesto | pasos_agente 1500000, epocas 44720, maquina pipeline Prefect en CPU de portátil (WSL2) | |

**Decisión (2026-11-05).** Rechazado por el pipeline: 91.5% de aterrizajes en la suite v1 (16 colisiones), 87.5% con viento de 15 m/s. no mejora a ppo-n3-transfer-1m5-desde-s1-v0.3-s0 en al menos 2% (91.5% frente a 92.0%); más colisiones que ppo-n3-transfer-1m5-desde-s1-v0.3-s0 (16 frente a 15).

### `ppo-n3-transfer-1m5-desde-s1-v0.3-s2` · rechazado · 84.5 %

**Hipótesis.** Semilla 2 de la configuración seleccionada en N3 (transferencia desde N2-s1, 1,5 M de pasos): queda a menos de 5 puntos del 92,0 % de la semilla 0

**Cambio frente a `ppo-n3-transfer-1m5-desde-s1-v0.3-s0`.** Solo la semilla de entrenamiento: 2. Mismo modelo de partida, ambiente y presupuesto

**Dónde está el modelo.**

- `resultados/runs/ppo-n3-transfer-1m5-desde-s1-v0.3-s2/modelo.zip` · SHA-256 `477d089e7184ad9f621ca93b4bba4c0a6de0baeec8572bc5d49a0135c23012d7`
- `resultados/runs/ppo-n3-transfer-1m5-desde-s1-v0.3-s2/modelo_normalizador.pkl` · SHA-256 `8831248b5f241983f2bd9ed4e0c5464d07152d72991f052e208bd77886d77f95`
- En GitHub, en el commit de entrenamiento: https://github.com/mjcastano29-tech/Alpha-Centauri/blob/d8a4f75c54a3a01ecb2abced162f5ee6f43eea37/resultados/runs/ppo-n3-transfer-1m5-desde-s1-v0.3-s2/modelo.zip
- MLflow: modelo `rocket-landing-ppo` versión 14, run `b05d3d15beb643c0828c4ba26c6593b9` (https://alpha-centauri-mlflow.onrender.com/#/experiments/4/runs/b05d3d15beb643c0828c4ba26c6593b9)
- Commit de git: `d8a4f75c54a3a01ecb2abced162f5ee6f43eea37` (había cambios sin commit al entrenar) · manifiesto de la sección 11: `manifests/ppo-n3-transfer-1m5-desde-s1-v0.3-s2.json`
- Parte de los pesos de `ppo-n2-transfer-1m5-v0.2-s1` (transferencia)

**Variables.**

| Variable | Valor |
|---|---|
| ambiente | RocketLanding3D-N3-v0 v0.3 (N3) |
| agente | PPO (red neuronal) · relativa v2: 3 valores en [-1, 1]; empuje = 1 + a0 (máx. 1.6), inclinación = a1, a2 × 0.12 |
| total_timesteps | 1500000 |
| n_envs | 8 |
| n_steps | 256 |
| batch_size | 256 |
| n_epochs | 10 |
| learning_rate | 0.0003 |
| gamma | 0.99 |
| gae_lambda | 0.95 |
| clip_range | 0.2 |
| ent_coef | 0.005 |
| net_arch | 128 × 128 |
| log_std_init | -0.5 |
| eval_every | 20000 |
| seed | 2 |
| accion | relativa |
| desde | ppo-n2-transfer-1m5-v0.2-s1 |

**Diferencias de variables con `ppo-n3-transfer-1m5-desde-s1-v0.3-s0`.** seed: 0 → 2

**Resultado.**

| Métrica | Normal (suite v1) | Viento 15 m/s |
|---|---|---|
| aterrizajes seguros | 84.5 % | 76.5 % |
| velocidad de contacto | 2.09 m/s | 4.25 m/s |
| error de posición | 8.2 m | 16.4 m |
| cómo terminan | aterrizaje 169, fuera de plataforma 2, choque 11, colisión 18 | aterrizaje 153, fuera de plataforma 1, choque 28, colisión 18 |
| primer aterrizaje / mejor época | 3 / 38121 | |
| presupuesto | pasos_agente 1500000, epocas 45671, maquina pipeline Prefect en CPU de portátil (WSL2) | |

**Decisión (2026-11-05).** Rechazado por el pipeline: 84.5% de aterrizajes en la suite v1 (18 colisiones), 76.5% con viento de 15 m/s. no mejora a ppo-n3-transfer-1m5-desde-s1-v0.3-s0 en al menos 2% (84.5% frente a 92.0%); más colisiones que ppo-n3-transfer-1m5-desde-s1-v0.3-s0 (18 frente a 15).

