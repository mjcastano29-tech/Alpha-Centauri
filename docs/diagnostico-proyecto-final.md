# Diagnóstico frente al enunciado del proyecto final

**Equipo Alpha Centauri · Rocket Landing · 2 de noviembre de 2026 · rama `fase-3d` (commit `c0058c4`) + rama `isaias/arreglos-rapidos` sin fusionar**

Contraste entre lo que pide el enunciado del proyecto final de MLOps (30 de octubre de 2026) y lo que hay en el repositorio hoy. Cada afirmación remite a un archivo o a un comando; lo que no se ha podido comprobar se dice.

## Actualización · 5 de noviembre de 2026: nivel 2 en marcha y web 3D completa

- **Web 3D**: el replay y la evaluación en vivo de la web usan ahora la escena cinematográfica completa de la fase 3D (cielo, terreno, cohete de acero, penacho, polvo, choques, tres cámaras, fantasmas, posproceso) portada a `web/src/escena.ts`; el 4 de noviembre se detectó que la web servía una escena simplificada.
- **MLflow en línea**: https://alpha-centauri-mlflow.onrender.com (segundo servicio del blueprint de Render; arranca uvicorn directamente porque `mlflow server` no cabe en 512 MB y necesita `MLFLOW_SERVER_ALLOWED_HOSTS`). La web enlaza a la run de cada ejecución.
- **Nivel 2 decidido e implementado** (candidato C, obstáculos): `RocketLanding3D-N2-v0`, ambiente 0.2, tres torres de 300–420 m alrededor de la plataforma, resultado nuevo "colisión", observación de 25 valores (familia nueva). Ficha [ambiente-v0.2.md](ambiente-v0.2.md) con mapa. Dificultad medida con los controladores del nivel 1 a ciegas (`AdaptadorN1`): el recomendado del nivel 1 baja de 97 % a 72 % (53 colisiones).
- **Experimentos del nivel 2** (configs/ + MLflow `experimento-3-nivel2`): desde cero, rechazado (8 %); con transferencia de pesos desde el modelo del nivel 1 (`--desde`), 77 % y recomendado provisional del nivel 2 (catálogo v3, con recomendado y anterior por nivel). Un tercer intento con 1,5 M de pasos está en curso.
- **API y web por nivel**: cada ejecución se evalúa en el ambiente de su manifest; `POST /evaluar` acepta `ambiente` para hacer jugar a un modelo del nivel 1 en el nivel 2; la escena 3D dibuja las torres y la colisión.
- Pendiente del hito 2: tres semillas para los dos finalistas, pipeline con etapas (Prefect), incidente e intervención, rollback desde la web, monitoreo, release e informe.

## Actualización · 3 de noviembre de 2026: hito 2, primera entrega

- **Hipótesis y estado por configuración**: `configs/<run_id>.json` para las cuatro configuraciones del nivel 1 (hipótesis, cambio frente al baseline, presupuesto en épocas/pasos/tiempo/máquina, suite, estado `seleccionado`/`rechazado`/`referencia`, decisión y fecha). Las mismas etiquetas (`diseno.*`, `presupuesto.*`) están en las runs de MLflow (`python seguimiento.py etiquetar`). La API las expone como `diseno` en `/catalogo` y la web las muestra en el catálogo (tabla "Hipótesis y decisiones"), en la ficha de cada ejecución y en la comparación.
- **Manifiestos con el formato de la sección 11**: `python manifiestos.py` genera `manifests/<run_id>.json` con `run_id`, `level_id`, `environment_version`, `git_commit` completo (40 caracteres), `config_sha256`, `model_uri` (URL al archivo en el commit exacto) y `model_sha256`, `normalization_uri`, `runtime_ref`, `evaluation_suite_id`, `seed`, `parent_run_id`, más hipótesis, presupuesto, estado y métricas. Servidos en `GET /ejecuciones/<id>/manifiesto` y enlazados desde la web. Los manifests de las ejecuciones nuevas guardan el SHA completo.
- **Suite de evaluación con nombre**: `configs/suites/suite-v1.json` (200 épocas, semillas desde 10 000 000, condiciones `normal` y `viento-15`) y `suite-reservada` (misma estructura, semilla fuera del repo para el test final de los finalistas). `POST /evaluar` acepta `suite` y `condicion`; `GET /suites` las lista.
- **`truncated`**: ambiente 0.1.1: agotar los pasos se informa como `truncated=True`; las reglas y la recompensa no cambian, `RocketLanding3DEnv.compatible()` compara mayor.menor y los modelos de 0.1 siguen siendo válidos (la API lo muestra como `entrenado_con` y `compatible`). La prueba que estaba marcada como fallo esperado pasa; 31 pruebas en total.
- **Nivel 2**: propuesta en `docs/nivel-2-propuesta.md` con tres candidatos (A: rotación con torque, recomendado y alineado con la ficha del profesor; B: plataforma desplazada y combustible justo; C: obstáculos) y N3 = viento fuerte. Falta la decisión del equipo antes de entrenar.
- **MLflow visible**: `render.yaml` declara un segundo servicio `alpha-centauri-mlflow` (interfaz de MLflow de solo lectura sobre el `mlflow.db` del repo) y la API publica su URL en `mlflow_ui`; la web enlaza a él desde cada ejecución. Queda pendiente comprobar que Render lo cree al sincronizar el blueprint.
- Pendiente del hito 2 y siguientes: entrenar la familia N2 (tres semillas para los finalistas), pipeline con etapas (Prefect), incidente controlado e intervención, rollback desde la web, vista de monitoreo, release e informe.

## Actualización · 3 de noviembre de 2026: hito 1 cerrado

- **Web**: https://alpha-centauri-five.vercel.app (Vercel, rama `main`, Root Directory `web`, variable pública `VITE_API_BASE_URL`).
- **API**: https://alpha-centauri-api.onrender.com (Render, plan gratuito, `render.yaml`; `GET /version` identifica el commit servido). Hugging Face Spaces quedó descartado: exige PRO para contenedores Docker.
- **Release**: tag `v0.2.0` en `main` tras fusionar los PR #2 (reproducibilidad: dependencias fijadas, huellas SHA-256 y pruebas) y #3 (`fase-3d` → `main`); 28 pruebas pasan.
- **Comprobaciones de la sección 16 del enunciado, hechas desde fuera** (navegador headless contra la URL pública): la URL abre y muestra el catálogo con el estado de cada modelo; la API usa HTTPS y responde al preflight CORS con el dominio exacto de Vercel; ninguna ruta apunta a localhost; se carga un modelo histórico (`base-v0.1-s0`) con commit, huellas y versión en MLflow y se evalúa en vivo (6 épocas, 1,8 s, 8,2 ms por paso en la CPU de Render); el recomendado (`ppo-v2-v0.1-s0`) se evalúa igual (5/5 aterrizajes); un id inexistente se muestra como error 404; el replay se identifica como *replay* y la evaluación como *evaluación en vivo*; el commit servido coincide con `main`.
- **Límites del plan gratuito**: la API se duerme tras 15 min sin uso y tarda ~1 min en despertar; 750 h/mes.
- Lo que sigue es el hito 2 (hipótesis y estado por configuración, manifiestos con el formato de la sección 11, suite de evaluación con nombre y `truncated`, niveles N2/N3).

## 1. Resumen

| Hito del enunciado | Resultado verificable que pide | Estado |
|---|---|---|
| 1 · Reproducir | contrato, baseline, primer run y despliegue inicial | **Completo (3 nov)**: contrato, baselines, 4 runs, release `v0.2.0`, web en Vercel y API en Render verificadas desde fuera. |
| 2 · Experimentar | niveles, hipótesis, catálogo y modelos históricos | **A medias**: 4 configuraciones recuperables y registradas en MLflow, pero sin hipótesis escritas, sin niveles N1/N2/N3 declarados y sin catálogo web. |
| 3 · Operar | pipeline, comparaciones y detección de degradación | **Empezado**: comparación y degradación con viento medidas (`panel.html`); no hay pipeline orquestado, API ni web en Vercel. |
| 4 · Recuperar y defender | intervención, rollback, release e informe | **No empezado**. |

Cobertura estimada por criterio de la rúbrica (peso entre paréntesis): versionamiento y recuperación (30 %) ≈ 60 %; diseño experimental y análisis (25 %) ≈ 55 %; pipeline, despliegue, monitoreo y rollback (20 %) ≈ 10 %; contrato y funcionamiento del ambiente/agente (10 %) ≈ 85 %; defensa (15 %) por preparar. **El bloque que más pesa y menos tenemos es el de operación: web en Vercel + API + pipeline + rollback.**

## 2. Lo que ya cumple, con su evidencia

| Exigencia del enunciado | Evidencia en el repositorio |
|---|---|
| Ambiente Gymnasium con `reset`/`step`, espacios y contrato documentado | `rocket_env/rocket_landing.py` (`RocketLanding3DEnv`, `VERSION = "0.1"`), `check_env` pasa; ficha en `docs/ambiente-v0.1.md` con unidades, rangos, paso físico (0,1 s), frecuencia de decisión (cada 20 m o 2 s), éxito, fallos y simplificaciones. |
| Referencias aleatoria, de regla y baseline aprendido | `cli.py ver --agente aleatorio`, `experimento1.py` (controlador heurístico, 20/20), Q-learning `base-v0.1-s0` (78 %). |
| PPO con Stable-Baselines3 + PyTorch como política de referencia | `agente_ppo.py`, `entrenar_ppo.py`; `ppo-v2-v0.1-s0`: 194/200 aterrizajes. Red MLP 128×128 sobre observaciones numéricas, como pide la guía. |
| Q-learning tabular con la pérdida de resolución documentada | intervalos de discretización en `agente_qlearning.py` y en la ficha (sección *Observaciones y acciones*). |
| Curvas de entrenamiento (con exploración) y de evaluación (sin ella) por separado | `aprendizaje.html` y `panel.html` (curva de tramos vs. evaluación periódica sin ruido). |
| Experimentos y modelos en MLflow; modelos identificados | `seguimiento.py`: `mlflow.db` + `mlruns/`; experimentos `experimento-1-qlearning` y `experimento-2-ppo`; modelos registrados `rocket-landing-qlearning` v1 y `rocket-landing-ppo` v1–v3 (pyfunc cargable). |
| Conservar los intentos que no mejoraron | `ppo-v0.1-s0` y `ppo-rel-v0.1-s0` (0/200) están en el registro, en MLflow y en `docs/experimento-2.md` con su diagnóstico. |
| Snapshot por run: commit, configuración, ambiente, semillas, software, métricas | `resultados/runs/<id>/manifest.json`; `episodios.csv` (una fila por época), `evaluacion.json` (200 épocas normales + 200 con viento). |
| Huellas SHA-256 de artefactos y configuración; comprobación | rama `isaias/arreglos-rapidos`: `sha256` en el manifest, `python cli.py verificar` (las 4 ejecuciones OK). |
| Pruebas del contrato y de recuperación de modelos | misma rama: `tests/test_ambiente.py`, `tests/test_modelos.py`; `python -m pytest`: 19 pasan, 1 xfail esperado. |
| Dependencias fijadas | misma rama: `requirements.txt` con versiones exactas e índice CPU de PyTorch. |
| Perturbación pertinente medida antes/después | viento lateral de 15 m/s: Q-learning 78 % → 38 %; PPO v2 97 % → 63 % (`panel.html`, `evaluacion.json`). |
| Vista Three.js conectada al estado real, identificada como replay | `visualizacion/aprendizaje3d.html` (reproduce vuelos grabados; el README de Isaías lo declara *replay*). |
| Determinismo: misma configuración, misma ejecución | comprobado dos veces para `base-v0.1-s0` (157/200, primer aterrizaje 1785). |

## 3. Brechas, ordenadas por peso en la rúbrica

| # | Brecha | Qué exige el enunciado | Estado hoy | Qué hacer | Esfuerzo |
|---|---|---|---|---|---|
| 1 | **Web en Vercel** | URL funcional con catálogo, carga de modelos históricos, comparación y evaluación ejecutable por el docente; frontend Vite + TypeScript + Three.js con lockfile | Páginas HTML estáticas generadas en Python; no hay `web/`, ni Vite, ni Vercel | Crear `web/` (Vite vanilla-ts), mover la escena 3D y el panel a componentes que lean el catálogo de la API; desplegar en Vercel con `VITE_API_BASE_URL` | Alto |
| 2 | **API HTTPS (FastAPI)** | Si Python es la autoridad: endpoints de catálogo, carga de modelo, evaluación y telemetría; versión del modelo y errores; CORS | No existe. El ambiente es Python, así que la ruta de API es la natural (exportar la red al navegador obligaría a portar el ambiente a TypeScript y validar la equivalencia) | `api/` con FastAPI + Uvicorn: `GET /catalogo`, `GET /ejecuciones/{id}`, `POST /evaluar` (N épocas, semillas, viento), `GET /replay/{id}`; servirla fuera de Vercel (Render, Railway, Hugging Face Spaces o un equipo del grupo); acordar con el docente | Alto |
| 3 | **Pipeline orquestado** | Prefect o Airflow con 8 etapas: validar, probar, entrenar, evaluar, registrar, decidir, publicar catálogo, comprobar versión servida; evidencia de ejecución | Scripts CLI sueltos (`entrenar`, `entrenar-ppo`, `panel.py`, `verificar`) sin orquestación ni criterio de selección explícito | `pipelines/flujo.py` con Prefect encadenando lo que ya existe; criterio de aceptación fijado (p. ej. ≥ 90 % de aterrizajes en la suite y ≤ 2,5 m/s de contacto); registro de cada ejecución del flujo | Medio |
| 4 | **Rollback y versión servida** | Catálogo con modelo recomendado; restaurar una versión anterior identificada y comprobar que funciona | No hay noción de "recomendado" ni de versión servida | `catalogo.json` versionado con `recomendado` y `anterior`; endpoint `GET /version` que diga qué modelo sirve; procedimiento y prueba de rollback documentados | Medio |
| 5 | **Tres niveles de dificultad** | N1 misión base, N2 más decisiones, N3 operación exigente; cada modelo conserva su ambiente; nueva familia si cambian observaciones/acciones | Todo es N1 (ambiente 0.1). El viento de 15 m/s es un N3 medido pero no declarado como nivel ni entrenado | Declarar `nivel` en la configuración y el manifest (N1 = 0.1 actual). Definir N2 = ambiente 0.2 con una decisión nueva (candidatas: rotación con torque real, plataforma desplazada, combustible más justo) → nueva familia de modelos. N3 = viento 0–15 m/s + ráfagas fuertes | Alto |
| 6 | **Hipótesis por configuración y estado** | ≥ 4 configuraciones con hipótesis, cambio frente al baseline, presupuesto y estado (seleccionado / rechazado / recuperado) en MLflow | Tenemos 4 ejecuciones, pero la hipótesis solo está en prosa en `docs/experimento-2.md`; MLflow no tiene etiquetas `hipotesis`, `cambio`, `estado` | Añadir esas etiquetas a `seguimiento.registrar_ejecucion` y a los 4 runs existentes; `configs/` con un YAML por configuración | Bajo |
| 7 | **Manifiesto con el formato del enunciado** | `run_id`, `level_id`, `environment_version`, `git_commit` (SHA completo), `config_sha256`, `model_uri`, `model_sha256`, `normalization_uri`, `runtime_ref`, `evaluation_suite_id`, `seed`, `parent_run_id` | Nuestro manifest cubre commit (corto), ambiente, configuración, semilla, software, métricas y (en la rama de Isaías) SHA-256; faltan `level_id`, `model_uri`, `normalization_uri`, `runtime_ref`, `evaluation_suite_id`, `parent_run_id` y el SHA completo | Generar `manifests/<run_id>.json` con exactamente esas claves a partir del manifest actual (`model_uri` = `models:/rocket-landing-ppo/3`, `runtime_ref` = `requirements.txt@commit`) | Bajo |
| 8 | **Tres semillas para los finalistas** | Dos finalistas × 3 semillas de entrenamiento; distinguir de los episodios de evaluación | Una semilla por configuración | Entrenar `base-v0.1-s1/s2` (2 min cada uno) y `ppo-v2-v0.1-s1/s2` (11 min cada uno); reportar media ± desviación | Medio (tiempo de CPU) |
| 9 | **Suite de evaluación versionada y test final reservado** | Casos, métricas, número de episodios y versión de suite; el test reservado fuera del ajuste y del repo público | La suite es implícita: semillas `10 000 000 + k`, 200 épocas, viento 0–10 y 15 m/s. No hay suite con nombre ni test reservado | `configs/suites/v1.yaml` (semillas, episodios, condiciones) y `evaluation_suite_id` en el manifest; un conjunto de semillas reservado que no se publica | Bajo |
| 10 | **`terminated` vs `truncated`** | Éxito o fallo de misión → `terminated`; agotar el presupuesto externo → `truncated`; registrar ambas | Nuestro "sin pasos" (50 pasos) devuelve `terminated` | Devolver `truncated=True` para "sin pasos" (misma recompensa −100) y registrarlo; conviene hacerlo junto con el cambio a 0.2 para no abrir dos familias de modelos | Bajo |
| 11 | **Incidente controlado con intervención** | Medir antes/después, proponer una intervención y aceptarla o rechazarla con evidencia | Degradación medida (viento 15 m/s); no hay intervención | Candidato: PPO v2 entrenado con viento 0–15 m/s; comparar en la suite; decidir y registrar el estado | Medio |
| 12 | **README, release y arquitectura** | README con instalación, ejecución, variables, arquitectura y reproducción; release/tag identificable; `.env.example` | README actualizado para lo que existe; sin tag, sin sección de arquitectura ni variables de entorno | `git tag -a v0.2.0` tras fusionar la rama de Isaías; secciones de arquitectura y variables cuando exista la API | Bajo |
| 13 | **Estructura sugerida del repositorio** | `envs/ configs/ pipelines/ tests/ web/ manifests/ docs/` | Hoy: `rocket_env/`, scripts en la raíz, `visualizacion/`, `resultados/`, `docs/`; `tests/` llega con la rama de Isaías | No es obligatoria: documentar la correspondencia en el README y crear solo las que faltan (`configs/`, `pipelines/`, `web/`, `manifests/`) | Bajo |
| 14 | **Python 3.12 de referencia; DVC para artefactos grandes** | 3.12 "probado en el piloto"; artefactos grandes recuperables (DVC o mecanismo acordado) | Python 3.10.12; artefactos de ~1,3 MB por ejecución en git (manejable); `mlruns/` también en git | Documentar 3.10 como versión verificada (o migrar a 3.12 y re-verificar las huellas); DVC solo si los artefactos crecen o el docente lo exige | Bajo |
| 15 | **Modo visible en la interfaz** | La animación debe decir si es manual, aleatorio, referencia, evaluación o entrenamiento | La escena 3D muestra replays de épocas grabadas (entrenamiento con exploración y modelo final sin ruido) sin una etiqueta de modo explícita en pantalla | Etiqueta de modo en el HUD; en la web, modo "evaluación en vivo" cuando la API ejecute el modelo | Bajo |
| 16 | **Informe breve y presentación** | Decisiones, resultados, límites y contribuciones; guion de defensa | `docs/experimento-2.md` cubre parte; no hay informe ni presentación | Hito 4 | Medio |

## 4. Plan propuesto

**Esta semana (cerrar hito 1 y preparar el 2)**
1. Fusionar `isaias/arreglos-rapidos` en `fase-3d` mediante PR (tests, huellas, `verificar`, dependencias) y fusionar `fase-3d` en `main`; `git tag -a v0.2.0`.
2. Etiquetas `hipotesis`, `cambio`, `presupuesto`, `estado` en MLflow para los 4 runs; `configs/*.yaml`; `manifests/*.json` con el formato del enunciado.
3. Suite `v1` con nombre y semillas; conjunto reservado fuera del repo.
4. API FastAPI local con catálogo, carga y evaluación (reutiliza `load_agent`, `evaluate`, `run_epoch`).

**Semana siguiente (hito 2 y 3)**
5. `web/` con Vite + TypeScript: catálogo, comparación (datos del panel), replay 3D (escena actual) y botón "evaluar" contra la API; despliegue en Vercel; backend en el hosting acordado.
6. Nivel N2 = ambiente 0.2 con la decisión nueva acordada; `nivel` en configuración y manifest; nueva familia de modelos (Q-learning y PPO).
7. Pipeline Prefect de 8 etapas con criterio de aceptación; `catalogo.json` con recomendado/anterior.

**Después (hito 4)**
8. Incidente N3: viento fuerte → intervención (PPO entrenado con viento 0–15) → decisión registrada.
9. Tres semillas por finalista; rollback demostrado desde la web; release final; informe y ensayo de la defensa.

## 5. Dudas y dificultades para el profesor

1. **Backend**: el ambiente y los modelos son Python. ¿Podemos servir la API desde un hosting gratuito (Render, Railway o Hugging Face Spaces) o desde un equipo del grupo durante la revisión? Vercel Functions no puede cargar PyTorch con holgura.
2. **Q-learning como baseline**: está documentada la discretización. ¿Vale como "baseline aprendido" del nivel 1, siendo PPO el candidato?
3. **Decisiones cada 20 m**: nuestra frecuencia de decisión es por desplazamiento vertical (20 m o 2 s), no por tiempo fijo. ¿Es aceptable como "frecuencia de decisiones" del contrato?
4. **Truncamiento**: agotar los 50 pasos lo tratamos como fallo de misión (`terminated`, −100). ¿Debe ser `truncated` aunque tenga penalización?
5. **Test final reservado**: ¿lo define el equipo (semillas no publicadas) o lo aporta el docente por escenario?
6. **DVC**: nuestros artefactos pesan 1–2 MB por ejecución y están en git con huella SHA-256. ¿Es necesario DVC igualmente?
7. **Python**: los modelos se entrenaron con 3.10.12 y las dependencias están fijadas. ¿Es obligatorio 3.12?
8. **Prefect o Airflow**: ¿cuál se acordó en clase? Proponemos Prefect por ser más ligero en local.
9. **Vista 3D**: ¿la escena actual (replay de vuelos grabados) sirve como vista "conectada al estado real" si la web además permite una evaluación en vivo contra la API?

## 6. Riesgos

- **Tiempo de CPU**: cada PPO son 11 min y cada Q-learning 2 min; tres semillas × dos finalistas × dos niveles son unas 2,5 h de cómputo. Hay que repartirlo entre máquinas.
- **`mlflow.db` en git**: conflictos si dos personas entrenan a la vez. Mientras no haya servidor compartido, una sola persona entrena por rama y se fusiona con cuidado.
- **Dependencia de internet en las páginas**: three.js y los módulos de posproceso se cargan de CDN; en la web de Vercel irán empaquetados por Vite.
- **Escena 3D de la rama fusionada**: revisada en código (válida), no renderizada en esta sesión; conviene abrirla en un navegador antes de la demo.

## Cómo se hizo este diagnóstico

Lectura del enunciado (20 páginas) frente a `git log`, `git diff` de las ramas remotas, ejecución de `python -m pytest` y `python cli.py verificar` en un worktree de la rama de Isaías, y los resultados ya versionados en `resultados/runs/`.
