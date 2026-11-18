# Guion de la defensa (10 minutos) · Alpha Centauri

**Reparto.** **MJ** = María Jimena Castaño Albarracín · **Isaías** = Isaías Céspedes Novoa · **Rojas** = Jorge Horacio Rojas Criollo. El orden sigue el que pide el documento de entrega: problema y negocio, ambiente, modelo e hipótesis, baseline y resultados, versionado, demostración, límites y aprendizajes. Cada bloque dice **qué se muestra** (clics exactos) y **qué se dice** (texto literal; se puede decir con otras palabras, pero sin saltarse los datos en negrita).

**Preparación, 10 minutos antes.**

1. Abrir https://alpha-centauri-five.vercel.app/#/monitoreo y pulsar **Medir latencia ahora** (despierta la API y carga los tres modelos).
2. Abrir https://alpha-centauri-mlflow.onrender.com en otra pestaña y esperar a que cargue.
3. Dejar abiertas estas pestañas, en este orden: `/landing/`, `#/` (simulador), `#/experimentos`, `#/incidente`, `#/monitoreo`, el repositorio en GitHub en `pipelines/README.md`, y la carpeta `pipelines/ejecuciones/`.
4. Pantalla del portátil duplicada en el proyector; zoom del navegador al 110 % si el salón es grande.
5. Quien habla controla el ratón. El siguiente se prepara mientras el anterior termina.

Ritmo: 10 minutos son unas 1300 palabras. Los textos de abajo están ajustados a eso. Si vamos tarde, lo primero que se recorta es la visita a MLflow del minuto 5; lo segundo, la vista de Monitoreo del minuto 8.

---

## Minuto 0–1 · Problema y negocio · MJ

**Se muestra.** Pestaña `/landing/`. Dejar la portada visible mientras se habla; bajar despacio hasta la sección de los tres niveles.

**Se dice.**

> Buenos días. Somos el equipo Alpha Centauri: María Jimena Castaño, Isaías Céspedes y Jorge Rojas. Nuestro escenario es Rocket Landing: un agente que aterriza un cohete en una plataforma con velocidad e inclinación seguras y combustible limitado, en un mundo donde el viento, la temperatura y la presión cambian en cada vuelo.
>
> El cohete es el pretexto. Lo que entregamos es el sistema que una empresa necesita cuando pone un modelo a tomar decisiones y las condiciones le cambian debajo de los pies: **ambientes versionados con contrato, modelos recuperables por huella, un pipeline que entrena, evalúa y decide con un criterio escrito antes de entrenar, una API y una web para operarlo, y un rollback probado en producción**. Es exactamente lo que necesita un controlador de climatización, una flota de drones de reparto o un modelo de demanda cuando llega una temporada que no estaba en los datos.
>
> En diez minutos contamos cómo lo construimos, qué falló por el camino y qué aprendimos.

---

## Minuto 1–3 · El ambiente · Isaías

**Se muestra.** Pestaña `#/` (Simulador). En el desplegable **Experimento** elegir "6 · Nivel 3 (v1): pasarela con viento fuerte"; ficha de modelo "recomendado"; modo **Replay grabado**. Dejar correr el replay. Al hablar de la observación, señalar el panel de altitud y velocidades y el panel lateral de Navegación y Entorno. Al hablar de la acción, señalar la barra inferior "Paso n/50 · empuje ×… · inclinación". Al hablar del truncamiento, señalar "Paso n/50". Al final, cambiar el desplegable a "2 · PPO en el nivel 1" y luego a "5 · Nivel 2 (v1): pasarela" para que se vea el cambio de mundo. Opcional: tecla **F** para ampliar la escena un momento.

**Se dice.**

> Este es el ambiente: un entorno Gymnasium hecho por nosotros. El cohete sale a **600 metros**, con hasta 50 metros de desvío y cayendo a 15 o 20 metros por segundo. El agente observa **16 variables**: posición, velocidad, el viento en su posición, temperatura y presión del aire, temperatura del motor, combustible, pasos restantes e inclinación. En los niveles con pasarela ve **cuatro más**: hacia dónde queda el objetivo de la fase, cuánto le falta para la pasarela y el margen hasta el borde de la abertura.
>
> Decide dos cosas en cada paso: **cuánto empuje respecto a su peso**, desde motor apagado hasta 1,6 veces el peso, y **cuánto se inclina**, hasta 9,6 grados. Un **paso** dura hasta que baja 20 metros o pasan 2 segundos; dentro, la física avanza cada décima de segundo. Un **episodio** tiene **50 pasos** como máximo, 100 segundos.
>
> El viento no es una fuerza inventada: es la velocidad del aire y entra por el arrastre, así que su efecto depende de la densidad, y la densidad de la temperatura y la presión que se sortean en cada episodio. Por eso las tres variables meteorológicas están acopladas.
>
> **Éxito**: tocar la plataforma a menos de 3 metros por segundo en vertical, 2 en horizontal, 10 grados de inclinación y 10 metros del centro. **Fallos**: chocar, posarse fuera de la plataforma, salir de la zona de vuelo o colisionar con la pasarela. Y el **truncamiento**: si agota los 50 pasos en el aire, el episodio se corta. Gymnasium lo informa como `truncated`, no `terminated`, porque el cohete no llegó a un estado final; lo distinguimos porque PPO estima el valor del estado siguiente y mezclarlos sesga ese valor.
>
> La **recompensa** tiene dos partes. Por paso, una guía con forma de potencial: acercarse al objetivo, frenar hacia una velocidad segura que depende de la altura, y bajar; menos el combustible gastado. Al final, **+100 por aterrizar, −50 por posarse fuera y −100 por todo lo demás**. Por ser un potencial, flotar no suma nada: lo comprobamos con políticas fijas antes de entrenar. Flotar da −205; aterrizar, unos +150.
>
> *(cambia el desplegable)* Nivel 1, la misión base. Nivel 2: una **pasarela a 180 metros** cubre la plataforma y la única abertura está desplazada 30 metros; hay que entrar por ella y trasladarse por debajo mientras se frena. Nivel 3: el mismo mundo con **viento de hasta 15 metros por segundo y ráfagas del doble**.

---

## Minuto 3–5 · Modelo, hipótesis, baseline y resultados · MJ

**Se muestra.** Pestaña `#/experimentos`. Arriba, la tabla de complejidad entre niveles (señalar las columnas de degradación: 99 → 5 % y 100 → 93,5 %). Después, en el selector, el **experimento 2**: señalar las dos ejecuciones rechazadas con 0 % y la v2 con 97 %. Luego el **experimento 3** (8 % desde cero frente a 76,5 y 86 % con transferencia) y el **experimento 5** (tres semillas de la pasarela). No abrir fichas: solo señalar filas.

**Se dice.**

> Empezamos con un baseline tabular: **Q-learning con dos tablas, 297 valores en total, 78 % de aterrizajes**. Después pasamos a **PPO**, una red de 128 por 128, con la misma receta en todos los experimentos. Entre una ejecución y la siguiente cambia **una sola variable**, y cada ejecución tiene escritos su hipótesis, su cambio, su presupuesto y la decisión con fecha.
>
> Los intentos que no mejoraron están aquí, no los borramos. La red decidiendo directamente la acción cruda del entorno: **0 %**; aprendía a acercarse pero nunca a frenar. Con el empuje expresado respecto al peso pero inclinación libre hasta 23 grados: **0 %**; frenaba perfecto, a 0,3 metros por segundo, y chocaba inclinada 17 grados porque el límite es 10. Acotando la inclinación a 9,6 grados y centrando la acción en flotar: **97 %**. Sin tocar el ambiente ni la recompensa. Fue la lección más importante del proyecto: **la parametrización de la acción decide si el problema es aprendible**.
>
> En el nivel 2, entrenar desde cero dio **8 %**. Partiendo de los pesos del modelo del nivel 1, **76 %** con el mismo presupuesto; con un millón y medio de pasos, **86 %**. En la pasarela el primer intento no aprendía, 2 %: la red heredada seguía volando hacia la plataforma. Le dimos en la observación el objetivo de la fase, la abertura mientras está encima y la plataforma debajo, y heredó los pesos de posición: **96 % de media en tres semillas**.
>
> Y la tabla de complejidad: el recomendado del nivel 1 bajo la pasarela, a ciegas, pasa de **99 a 5 %**; el del nivel 2 con viento fuerte, sin reentrenar, de **100 a 93,5**. Cada nivel es más difícil y lo medimos antes de entrenar. Reportamos siempre la media de tres semillas: **97,8, 96,3 y 93,7 %** en los tres niveles; el recomendado es la mejor de las tres según el criterio del pipeline.

---

## Minuto 5–6 · Versionado · Rojas

**Se muestra.** Desde `#/experimentos`, experimento 5, clic en `ppo-pasarela-transfer-1m5-v0.4-s2` para abrir su **ficha**. Señalar, en orden: versión del ambiente, commit completo, SHA-256 del modelo y del normalizador, enlace al manifiesto, versión en MLflow. Clic en el enlace de MLflow (pestaña ya despierta): mostrar la run con sus parámetros y métricas; volver. Después pestaña `#/catalogo`: señalar `ppo-v2-v0.1-s0` como "anterior" del nivel 1 y los modelos de torres como "histórico".

**Se dice.**

> Todo lo que vieron se puede reconstruir. El ambiente tiene **versión semántica y ficha**: 0.1.1 el nivel 1, 0.4 la pasarela, 0.5 la pasarela con viento. Un cambio de reglas sube la versión, y los modelos de versiones distintas no se comparan entre sí.
>
> Cada modelo es una ejecución con nombre, **commit completo, huella SHA-256 del modelo y del normalizador, el manifiesto con el formato de la sección 11 de la guía, su versión en MLflow y las dependencias fijadas**. `python cli.py verificar` recalcula las huellas de las 23 ejecuciones y avisa si algo cambió. Esta es su run en MLflow, con los mismos parámetros y métricas.
>
> Un modelo histórico, como el anterior del nivel 1 entrenado con el ambiente 0.1, se carga y se evalúa igual que el recomendado, y la API lo hace en producción con `POST /evaluar`. El catálogo guarda para cada nivel el recomendado y el anterior, y cada cambio deja una línea con fecha y motivo: va por la versión 15.

---

## Minuto 6–8 · Demostración: incidente, intervención, viento en vivo y rollback · Rojas

**Se muestra.** Pestaña `#/incidente`, bajar al bloque de N3 v1: señalar la tabla 1 (degradación de los tres modelos de N2) y la tabla 2 (intervenciones, con las dos rechazadas y la seleccionada). Después pestaña `#/` (Simulador): desplegable en el experimento 6, ficha "recomendado", modo **Viento en vivo**, botón **Lanzar misión**. Dejar que avance unos 8 pasos; subir el deslizador **Intensidad** a **20 m/s** y mover la dirección; comentar mientras corrige. Si hay tiempo, tecla **F** para pantalla completa durante diez segundos. Al terminar la misión, pestaña `#/monitoreo`: señalar el commit servido, el modelo de cada nivel y la lista de últimas decisiones con los dos rollbacks.

**Se dice.**

> El incidente de la rúbrica es nuestro nivel 3: **cambian las condiciones de operación**, no el obstáculo. Medimos los tres modelos del nivel 2 jugando con viento fuerte sin reentrenar: caen **27, 12,5 y 6,5 puntos**, y el fallo principal es la colisión con la pasarela.
>
> La intervención fue reentrenar en esas condiciones partiendo de sus pesos. El pipeline decide con un criterio fijado antes de entrenar: **ganar al menos 2 puntos, no perder más de 5 con viento y no tener más colisiones**. Dos semillas fueron rechazadas y están aquí. El recomendado final aterriza el **97,5 %** y el **85,5 % con viento de 15 metros por segundo**: 24 puntos más que el mismo modelo sin reentrenar.
>
> Ahora lo vemos en vivo. *(lanza la misión)* La API está simulando paso a paso con ese modelo congelado; nada está grabado. Subo el viento a **20 metros por segundo**, más de lo que vio en el entrenamiento… y el modelo corrige la deriva, entra por la abertura y se traslada por debajo hasta la plataforma. Esta es la perturbación del nivel 3 aplicada a mano.
>
> Y cuando un modelo falla en producción, hay vuelta atrás. La hicimos de verdad: catálogo versión 8 con el recomendado; **`catalogo.py restaurar`**, commit, push, y comprobamos que la API servía el catálogo 9 con el anterior; después volvimos al recomendado, catálogo 10. Tres minutos por ciclo, con evidencia. En **Monitoreo** se ve qué commit y qué catálogo se sirven, qué modelo atiende cada nivel, las últimas decisiones del pipeline, los rollbacks y las alertas.

---

## Minuto 8–9 · Cómo se decide: pipeline y test reservado · Isaías

**Se muestra.** Pestaña de GitHub en `pipelines/README.md`: señalar la lista de las ocho etapas y el criterio. Abrir un JSON de `pipelines/ejecuciones/` (por ejemplo el de `ppo-pasarela-viento-transfer-1m5-desde-s2-v0.5-s0`): señalar las etapas, la decisión y el commit publicado. Mostrar la captura `docs/evidencia-prefect-flow-run.png`.

**Se dice.**

> El pipeline tiene **ocho etapas** en Prefect y ejecuta los mismos comandos que usábamos a mano: validar el ambiente, probar el contrato, entrenar, evaluar en la **suite fija de 200 episodios en dos condiciones**, normal y con viento de 15, registrar con manifiesto y MLflow, decidir, publicar el catálogo con commit y push, y comprobar que la API pública sirve lo esperado. Dejó **21 evidencias** como esta, con las etapas, la decisión y el commit.
>
> Antes de la entrega aplicamos **una sola vez un test reservado**: la misma estructura que la suite, pero con una semilla que no está en el repositorio. Los tres recomendados dieron **97,5, 99 y 97 %**, entre medio punto y punto y medio por debajo de la suite. No sobreajustamos a la suite.

---

## Minuto 9–10 · Límites, aprendizajes y cierre · MJ

**Se muestra.** Volver a la pestaña `/landing/` o dejar `#/monitoreo`. Sin clics.

**Se dice.**

> Los límites, con honestidad. El recomendado es la mejor de tres semillas por el criterio; la cifra esperable de cada receta es la media. **Ocho ejecuciones se entrenaron con cambios sin confirmar en git**: están marcadas con un asterisco y la ficha dice qué archivo era. El plan gratuito duerme la API y la primera petición tarda un minuto. Y la base de MLflow vive en git, así que el pipeline corre desde una máquina a la vez.
>
> Lo que aprendimos: **la parametrización de la acción decide si aprende; la transferencia desde el nivel anterior hace abordables los niveles; cuando el obstáculo cambia qué significa "objetivo", hay que dárselo al agente en la observación; y medir antes de diseñar**, como con las torres que cambiamos por la pasarela porque solo obligaban a desviarse el 30 % de las veces.
>
> Contribuciones: Isaías, la escena 3D, las pruebas, las huellas y la landing; Jorge, el nivel 3, el incidente, la intervención y el rollback en producción; yo, el ambiente, los agentes, el versionado, la API, la web y el pipeline. Todo está en el repositorio con la etiqueta **v1.2.3**. Gracias; quedamos atentos a sus preguntas.

---

## Si el docente pide el rollback en vivo

Terminal en la raíz del repositorio, con la rama `main` al día:

```bash
python catalogo.py restaurar --nivel N3 --motivo "demostración en la defensa"
git add catalogo.json && git commit -m "rollback N3 (demostración)" && git push
```

Render redespliega en unos tres minutos; mientras, enseñar `pipelines/ejecuciones/rollback-n3-*.json`. Al volver la API, `GET /version` muestra el catálogo nuevo. Después, `python catalogo.py recomendar ppo-pasarela-viento-transfer-1m5-desde-s2-v0.5-s0 --nivel N3 --motivo "fin de la demostración"`, commit y push.

## Preguntas probables y respuesta corta

- **¿Por qué el recomendado no es la media?** El pipeline promueve con un criterio fijo (+2 puntos, viento, colisiones) y conserva el anterior; la media de las tres semillas está en el informe y en las fichas. El test reservado da −1,5, −1 y −0,5 puntos respecto a la suite v1: no hay sobreajuste a la suite. *(Responde MJ.)*
- **¿Qué pasa si el modelo nuevo falla en producción?** `catalogo.py restaurar`, commit y push: la API sirve el anterior en unos tres minutos; `comprobar_api.py` deja evidencia. Hecho dos veces con el nivel 3. *(Rojas.)*
- **¿Por qué cambiaron las torres por la pasarela?** Decisión del equipo tras medir: las torres solo obligaban a desviarse en el 30 % de las salidas; la pasarela, siempre. Los modelos de torres siguen reproducibles. *(MJ.)*
- **¿`terminated` o `truncated`?** Éxito y fallos de misión terminan (`terminated`); agotar los 50 pasos trunca (`truncated`) con la misma penalización. Pruebas en `tests/test_ambiente.py`. *(Isaías.)*
- **¿Por qué el viento no es una fuerza?** Entra por el arrastre como velocidad del aire: su efecto depende de la densidad, que depende de la temperatura y la presión. Así las tres variables meteorológicas están acopladas. *(Isaías.)*
- **¿Qué es Python y qué es TypeScript?** Python es la autoridad: ambiente, modelos y evaluación. La web solo muestra lo que devuelve la API y reproduce trayectorias grabadas; en el viento en vivo, la API simula paso a paso. *(Isaías.)*
- **¿Por qué Prefect en otro entorno?** Prefect 3.8 no convive con la versión de FastAPI de la API; el orquestador tiene su `requirements-pipeline.txt` y ejecuta las etapas con el intérprete del proyecto. *(Rojas.)*
- **¿El viento en vivo es un experimento?** No: es un modo de servicio del modelo congelado. Los experimentos tienen hipótesis, entrenamiento y decisión del pipeline. *(Rojas.)*
- **¿Qué harían después?** Abertura aleatoria por episodio, rotación real con torque, bloqueo térmico observable, un servidor de MLflow compartido y una penalización de "fuera de plataforma" proporcional a la distancia. *(MJ.)*
