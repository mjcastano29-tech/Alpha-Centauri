# Correo de entrega · borrador

Los tres campos entre corchetes los completa el equipo antes de enviar. El SHA completo de la etiqueta se obtiene con `git rev-parse v1.2.1`.

---

**Asunto:** MLOps · Entrega final · Grupo [A o B] · Alpha Centauri (Rocket Landing)

Profesor Julián Zuluaga:

Le enviamos la entrega final del equipo **Alpha Centauri**, escenario **[escenario asignado: Rocket Landing]**, grupo **[A o B]**.

**1. Integrantes.** María Jimena Castaño Albarracín (mjcastano29-tech), Isaías Céspedes Novoa (isaiasexternado-a11y) y Jorge Horacio Rojas Criollo (jhrojas02).

**2. Repositorio.** https://github.com/mjcastano29-tech/Alpha-Centauri (público; no requiere acceso adicional).

**3. Aplicación y registro de experimentos.**
- Web: https://alpha-centauri-five.vercel.app (simulador con replay y viento en vivo, experimentos, catálogo, incidente, monitoreo; presentación en https://alpha-centauri-five.vercel.app/landing/).
- API: https://alpha-centauri-api.onrender.com (`/version`, `/docs`).
- Registro de experimentos y artefactos (MLflow): https://alpha-centauri-mlflow.onrender.com. Los artefactos (modelos, normalizadores, datos, manifiestos) están además versionados en el repositorio.
- Los servicios están en el plan gratuito de Render: la primera petición tras 15 minutos sin uso tarda cerca de un minuto. Ningún acceso requiere contraseña.

**4. Versión entregada.** Etiqueta y release `v1.2.1`, commit `[SHA completo: git rev-parse v1.2.1]`.
- Modelos recomendados (se sirven en la web): N1 `ppo-v2-v0.1-s1` (ambiente `RocketLanding3D-v0` 0.1.1, MLflow `rocket-landing-ppo` v7), N2 `ppo-pasarela-transfer-1m5-v0.4-s2` (`RocketLanding3D-N2-v1` 0.4, v19), N3 `ppo-pasarela-viento-transfer-1m5-desde-s2-v0.5-s0` (`RocketLanding3D-N3-v1` 0.5, v22).
- Modelos históricos recuperables, por ejemplo: `ppo-v2-v0.1-s0` (anterior de N1; ambiente 0.1, compatible con 0.1.1; MLflow v3) y `ppo-n2-transfer-1m5-v0.2-s1` (nivel 2 con torres, ambiente 0.2 retirado pero reproducible; MLflow v9). Las 23 ejecuciones están en `resultados/runs/<run_id>/` con su manifiesto.

**5. Dónde está cada cosa.**
- README: `README.md` (misión, arquitectura, instalación, ejecución, reproducción, evaluación y recuperación de modelos).
- Comparación de experimentos: `EXPERIMENTOS.md` y la vista https://alpha-centauri-five.vercel.app/#/experimentos; comparación entre ejecuciones en `#/comparar`.
- Manifiestos de modelos: `manifests/<run_id>.json` (formato de la sección 11) y `resultados/runs/<run_id>/manifest.json`; servidos en `GET /ejecuciones/<run_id>/manifiesto`.
- Evaluación y recuperación: sección "Evaluar y recuperar un modelo" del README (`python cli.py verificar`, `python cli.py evaluar --run <run_id>`, `load_agent`).
- Ficha del ambiente y niveles: `docs/ambiente-v0.1.md`, `docs/ambiente-v0.4.md`, `docs/ambiente-v0.5.md` (retirados: 0.2 y 0.3).
- Pipeline, incidente, intervención y rollback: `pipelines/README.md`, `pipelines/ejecuciones/`, `resultados/incidentes/`, vista `#/incidente`; informe final en `docs/informe-final.md`; índice de todo en `docs/entregables.md` y PDF en `entregables/`.

**6. Presentación y limitaciones.** Presentación: https://alpha-centauri-five.vercel.app/landing/ y el guion en `docs/guion-defensa.md`; material de apoyo en `entregables/10-guia-variables-y-experimentos.pdf` y `entregables/11-historia-del-proyecto.pdf` [adjuntar si se desea]. Limitaciones conocidas: la API y MLflow duermen en el plan gratuito (primera petición lenta); 8 de las 23 ejecuciones se entrenaron con cambios sin commit, marcadas con `*` y documentadas en su ficha; `mlflow.db` vive en git, por lo que el pipeline se ejecuta desde una máquina a la vez; el replay de la web interpola trayectorias grabadas, salvo el modo "viento en vivo", en el que la API simula paso a paso. Todos los componentes funcionan.

Quedamos atentos.

Equipo Alpha Centauri
