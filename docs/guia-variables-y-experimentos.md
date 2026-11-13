# Guía de estudio para la defensa · variables, modelo y experimentos

**Equipo Alpha Centauri · Rocket Landing · noviembre de 2026.** Documento interno para tener claro, antes de exponer, cómo se modela cada variable, qué ve y qué decide el agente, cómo se premia y cuándo termina una época, qué cambia entre niveles y entre experimentos, y qué números conviene recordar. Todo sale del código y de las fichas versionadas: [ambiente-v0.1.md](ambiente-v0.1.md), [ambiente-v0.4.md](ambiente-v0.4.md), [ambiente-v0.5.md](ambiente-v0.5.md), [experimento-2.md](experimento-2.md), `configs/*.json` y [EXPERIMENTOS.md](../EXPERIMENTOS.md).

## 1. El mapa en una frase

Un **ambiente** Gymnasium simula un cohete que cae desde 600 m con viento, atmósfera y combustible limitado; un **agente** (Q-learning al principio, PPO después) decide cada paso el empuje y la inclinación; una **recompensa** con forma de potencial lo guía hacia la plataforma y un premio final decide si la misión se cumplió; cada **nivel** sube la complejidad (pasarela, viento fuerte) con una versión nueva del ambiente; cada **experimento** agrupa ejecuciones que responden una pregunta cambiando una variable a la vez; el **pipeline** entrena, evalúa con una suite fija, decide con un criterio escrito de antemano y publica el modelo recomendado.

| Pieza | Nivel 1 | Nivel 2 (v1) | Nivel 3 (v1) |
|---|---|---|---|
| Ambiente | `RocketLanding3D-v0` 0.1.1 | `RocketLanding3D-N2-v1` 0.4 | `RocketLanding3D-N3-v1` 0.5 |
| Qué añade | misión base | pasarela a 180 m con una sola abertura desplazada | viento 0–15 m/s y ráfagas de 3 m/s sobre el mismo mundo |
| Observación | 16 valores | 20 valores | 20 valores (misma familia que N2) |
| Acción | 5 valores (la red decide 3) | igual | igual |
| Resultados posibles | aterrizaje, fuera de plataforma, choque, sin pasos, fuera de zona | + colisión | igual que N2 |
| Experimentos | 1 (Q-learning), 2 (PPO) | 3 (torres, retirado), 5 (pasarela) | 4 (torres, retirado), 6 (pasarela) |
| Recomendado | `ppo-v2-v0.1-s1` 99 % | `ppo-pasarela-transfer-1m5-v0.4-s2` 100 % | `ppo-pasarela-viento-transfer-1m5-desde-s2-v0.5-s0` 97,5 % |

## 2. El mundo: cómo se modela cada variable

Unidades SI en todo el ambiente. El eje z apunta hacia arriba; la plataforma está en el origen.

| Variable | Cómo se modela | Valores |
|---|---|---|
| Posición (x, y, z) | masa puntual integrada con Euler explícito cada 0,1 s | salida en z = 600 m sobre x, y ∈ [−50, 50] m; zona de vuelo: cilindro de 300 m de radio y 1200 m de techo |
| Velocidad (vx, vy, vz) | a = (empuje + arrastre)/m + gravedad; v ← v + a·Δt | salida: vz ∈ [−20, −15] m/s, vx, vy ∈ [−3, 3] m/s |
| Masa m | 1000 kg en seco + combustible | combustible inicial 500 kg; consumo ṁ = T/(Isp·g₀), Isp = 250 s |
| Empuje T | T = (27 000 N − p(z)·0,02 m²) · acelerador, en la dirección del eje; solo con motor encendido, combustible y sin sobrecalentar | ≈ 25 kN al nivel del mar; relación empuje/peso 1,7 lleno y 2,5 vacío |
| Arrastre D | D = −½ ρ(z) C_d A \|v − w\| (v − w), C_d = 0,8, A = 3 m² | es la **única vía por la que el viento mueve el cohete**: 10 m/s de viento ≈ 130 N ≈ 0,09 m/s² |
| Gravedad | −m·g₀ en z, g₀ = 9,80665 m/s² | |
| Atmósfera | ISA desde el suelo: T(z) = T₀ − 0,0065·z; p(z) = p₀·(T/T₀)^(g₀/(R·0,0065)); ρ = p/(R·T) | T₀ ∈ [263, 313] K (−10 a 40 °C) y p₀ ∈ [98, 104] kPa, sorteados por época; la densidad varía un 25 % entre épocas |
| Viento medio w(z) | perfil de potencia: w(z) = w₁₀ · (max(z, 1)/10)^(1/7), dirección φ fija por época | w₁₀ ∈ [0, 10] m/s en N1 y N2; [0, 15] en N3; a 600 m el viento es 1,8 veces el de 10 m |
| Ráfagas g_r | proceso de Ornstein-Uhlenbeck: dg = −g/τ·dt + σ·√(2dt/τ)·ξ, τ = 3 s; vertical ×0,3 | σ = 1,5 m/s en N1 y N2; 3 m/s en N3 |
| Temperatura del motor T_m | dT_m/dt = 30·acelerador − 0,05·(T_m − T_aire) | se bloquea a 900 K hasta bajar de 800 K; en la práctica llega a unos 600 K |
| Inclinación θ | el eje del cohete sigue instantáneamente a la dirección del empuje (sin dinámica de rotación); θ = arccos(dz) | límite de aterrizaje 10° |
| Pasos k | cada paso del agente dura hasta que el cohete se desplaza 20 m en vertical o pasan 2 s, lo que ocurra antes (7 a 20 subpasos de física) | 50 pasos como máximo, es decir, 100 s de vuelo |

**Perturbación / incidente.** `reset(options={"viento": 15})` fija w₁₀ = 15 m/s con dirección aleatoria: fuera del rango de entrenamiento de N1 y N2, dentro del de N3. Es la segunda condición de la suite de evaluación y el "incidente" de la rúbrica.

## 3. Observación: lo que ve el agente

Vector en unidades físicas; PPO lo normaliza con `VecNormalize` (media y varianza móviles, recorte a ±10). El agente **no** ve las ráfagas futuras, el bloqueo térmico, la dirección media del viento ni el tiempo absoluto.

| Índice | Nivel 1 (16 valores) | Unidad |
|---|---|---|
| 0–2 | x, y, z (posición respecto al centro de la plataforma) | m |
| 3–5 | vx, vy, vz | m/s |
| 6–8 | viento en la posición del cohete (medio + ráfaga) | m/s |
| 9, 10 | temperatura y presión del aire | K, kPa |
| 11 | temperatura del motor | K |
| 12 | combustible restante | fracción 0–1 |
| 13 | motor encendido | 0/1 |
| 14 | pasos restantes | fracción 0–1 |
| 15 | inclinación del eje | grados |

| Índice | Niveles 2 y 3 con pasarela (0.4 y 0.5): 16 + 4 | Unidad |
|---|---|---|
| 16, 17 | o_x − x, o_y − y: posición relativa del **objetivo de la fase** (el centro de la abertura mientras el cohete está por encima de la pasarela; la plataforma una vez debajo) | m |
| 18 | H − z: altura que queda hasta la pasarela (negativa una vez cruzada) | m |
| 19 | r_a − d_a: margen hasta el borde de la abertura (positivo dentro de ella) | m |

Con las torres retiradas (0.2 y 0.3) eran 25 valores: los 16 de N1 más, por torre, x_k − x, y_k − y, h_k − z. Un modelo de N1 tiene una red de 16 entradas: para jugar en N2 o N3 se le recorta la observación con `AdaptadorN1` y vuela **a ciegas** respecto al obstáculo. Eso mide la dificultad del nivel (5 % bajo la pasarela).

**Por qué "objetivo de la fase" y no "posición de la abertura".** El primer intento del nivel 2 v1 ponía la abertura fija en las entradas 16 y 17 y la red heredada seguía volando hacia la plataforma: 2 % a los 320 000 pasos, abortado. Darle a la red el siguiente punto de paso, como un sistema de navegación, y heredar en esas entradas los pesos de la posición hizo que la política de partida ya aterrizara el 35 % sin entrenar.

## 4. Acción: lo que decide el agente

**Acción del entorno** (contrato, 5 valores continuos): motor encendido (> 0) o apagado; acelerador en [0, 1] como fracción del empuje máximo; dirección del empuje (x, y, z), que el entorno normaliza. No hay torque: el eje sigue al empuje.

Los agentes no emiten esos 5 valores directamente (salvo el experimento fallido `ppo-v0.1-s0`). Cada uno tiene su **parametrización**, y esa elección fue la decisión más importante del proyecto:

| Agente | Qué decide | Traducción a la acción del entorno |
|---|---|---|
| Q-learning (exp. 1) | motor: apagado o empuje ×0,6, ×0,9, ×1,0, ×1,1, ×1,4 **el peso actual**; dirección: recto o inclinado 5,7° hacia ±x o ±y | el acelerador se calcula con la masa y la presión observadas, así "×1,0" siempre significa flotar |
| PPO acción cruda (`ppo-v0.1-s0`) | los 5 valores del entorno | ninguna; **0 % de aterrizajes**: aprende a acercarse pero nunca a frenar |
| PPO relativa v1 (`ppo-rel-v0.1-s0`) | empuje/peso en [0, 1,6]; inclinación ±0,3 por eje (hasta 23°) | **0 %**: frena perfecto (0,3 m/s) pero llega inclinado 17° y choca por inclinación |
| **PPO relativa v2** (todo lo demás) | 3 valores en [−1, 1]: a₀ empuje, a₁ y a₂ inclinación | empuje/peso = 1 + a₀ (máximo 1,6; por debajo de 0,05 el motor se apaga); inclinación = a₁·0,12 y a₂·0,12 (≤ 9,6° combinados, por debajo del límite de 10°). La acción 0 es "flotar recto": la política inicial no cae |

Lecciones que conviene decir en voz alta: la parametrización decide si el problema es aprendible; los límites de la acción deben respetar las reglas del aterrizaje; arrancar flotando hace útil la exploración desde la primera época; los dos fracasos están versionados como evidencia.

## 5. Recompensa

Dos partes: **por paso**, una diferencia de potencial menos el combustible gastado; **al terminar**, un premio o castigo según el resultado.

**Por paso:** r = Φ(s′) − Φ(s) − 0,1 · kg de combustible gastados en el paso.

    Φ(s) = −d_obj/5 − v_h − |vz − v_seg(z)| − z/10 [− 8·c en N2 y N3]
    v_seg(z) = −clip(0,08·z, 1,5, 30)  m/s: bajar rápido arriba, despacio cerca del suelo

- d_obj: distancia horizontal al objetivo. En N1 es la plataforma. Con pasarela es la abertura mientras el cohete está encima y la plataforma una vez debajo.
- v_h: velocidad horizontal. |vz − v_seg|: cuánto se aparta de la velocidad de descenso segura. z/10: siempre empuja a bajar.
- c (solo con pasarela): castigo de proximidad, c = 1 − (z − H)/20 en los 20 m por encima de la pasarela y fuera de la abertura; vale hasta 8 puntos.

Por ser un potencial, la suma de la época vale Φ(final) − Φ(inicio), unos +80 puntos como máximo, **sea cual sea el camino**: flotar o dar vueltas no suma. El combustible resta hasta 50 puntos si se vacía el depósito.

**Al terminar:**

| Resultado | Cuándo | Puntos | Gymnasium |
|---|---|---|---|
| aterrizaje | contacto con \|vz\| ≤ 3 m/s, v_h ≤ 2 m/s, inclinación ≤ 10° y a ≤ 10 m del centro | **+100** | `terminated` |
| fuera de plataforma | contacto suave (las tres condiciones) pero a más de 10 m del centro | −50 | `terminated` |
| choque | contacto que incumple alguna condición de suavidad | −100 | `terminated` |
| fuera de zona | d_h > 300 m o z > 1200 m | −100 | `terminated` |
| colisión (N2, N3) | cruzar el plano de la pasarela fuera de la abertura, o tocar un pilar (radio del fuselaje 3 m) | −100 | `terminated` |
| sin pasos | agotar los 50 pasos sin tocar el suelo | −100 | **`truncated`** |

Por qué estos valores: aterrizar y chocar son simétricos (±100) y dominan sobre la aproximación (+80) y el combustible (−50), así que la única manera de acabar con recompensa alta es aterrizar. Un aterrizaje típico vale unos +150; un choque, unos −73; agotar pasos, unos −95. Las bandas no se solapan.

**Trampas comprobadas con políticas fijas.** Flotar da −205 (el viento saca al cohete de la zona y gasta 413 kg); caída libre, −113 (choca siempre); subir siempre, −261. Posarse suave fuera de la plataforma puede acabar cerca de cero (media +0,8): es la única trampa que queda abierta y la métrica "fuera de plataforma" la vigila (5 % con el Q-learning, 0–1 % con PPO).

## 6. Truncamiento frente a terminación

Gymnasium distingue dos formas de acabar una época y el contrato del ambiente las respeta desde la versión 0.1.1:

- **`terminated=True`**: el cohete llegó a un **estado final**: tocó el suelo (aterrizaje, fuera de plataforma, choque), salió de la zona o chocó con la pasarela. No existe un estado siguiente desde el que seguir.
- **`truncated=True`**: la época la corta un **límite externo**: los 50 pasos. El cohete sigue en el aire; el estado no es final, pero no se le deja continuar. La penalización (−100) es la misma que la de un fracaso, para que esperar nunca compense.

Por qué importa: los algoritmos que calculan el retorno con *bootstrap* (PPO estima el valor del estado siguiente) deben tratar distinto un corte externo de un estado final; mezclarlos sesga la función de valor. El ambiente no usa `max_episode_steps` de Gymnasium: cuenta sus propios pasos y devuelve `truncated` él mismo. Hay pruebas de contrato en `tests/test_ambiente.py` para los dos casos. La versión del ambiente pasó de 0.1 a 0.1.1 (tercer número) porque la señal cambió pero las reglas y la recompensa no: `compatible()` compara solo mayor.menor, así que los modelos de 0.1 siguen siendo válidos.

Dato útil: en el recomendado de N1 con viento de 15 m/s, 49 de los 56 fracasos son "sin pasos": el modelo se queda luchando contra el viento sin llegar a posarse. Eso es truncamiento, no choque.

## 7. Qué cambia de una versión del ambiente a otra

| Versión | Nivel | Qué cambia respecto a la anterior | Estado |
|---|---|---|---|
| 0.1 → 0.1.1 | N1 | solo la señal: "sin pasos" pasa a `truncated` | vigente |
| 0.2 | N2 v0 | tres torres (radios 7 m, alturas 420, 360 y 300 m) alrededor de la plataforma; observación 25; resultado "colisión"; castigo de proximidad | retirado el 6 de noviembre |
| 0.3 | N3 v0 | las torres con viento 0–15 m/s y ráfagas 3 m/s; misma observación que 0.2 | retirado |
| 0.4 | N2 v1 | **pasarela**: disco de 90 m de radio a 180 m de altura, 3 m de grosor, abertura de 16 m de radio centrada en (28, 12) m, cuatro pilares de 2,5 m en el borde; observación 16 + 4 con el objetivo de la fase; potencial con d_obj por fases y castigo c; herencia de pesos en la transferencia | vigente |
| 0.5 | N3 v1 | 0.4 con viento 0–15 m/s y ráfagas 3 m/s; nada más cambia | vigente |

Por qué se cambiaron las torres por la pasarela: con las torres la ruta recta solo cruzaba una torre en el 30 % de las salidas (el modelo de N1 a ciegas conservaba el 72 %); con la pasarela la ruta recta choca siempre salvo que la salida caiga sobre la abertura (el modelo de N1 a ciegas baja a 5 %). La decisión es inevitable y se ve en el replay: entrar por la abertura y trasladarse 30 m por debajo mientras se frena desde 180 m (v_seg(180) = 14,4 m/s).

## 8. Los agentes y sus hiperparámetros

**Q-learning (experimento 1).** Dos tablas pequeñas, 297 valores en total: la del motor indexada por altitud (6 intervalos: 20, 60, 150, 350, 600 m) y velocidad vertical (7 intervalos); la de dirección indexada por la deriva prevista en 4 s en cada eje horizontal (3 intervalos: a un lado, centrado, al otro lado). α de 0,1 a 0,01, γ = 0,99, ε de 1 a 0,02 en el 60 % de las 5000 épocas; evaluación cada 250 épocas en 50 sin explorar y se guarda la mejor. Resultado: 78,5 % (38 % con viento). Primer aterrizaje en la época 1785.

**PPO (Stable-Baselines3, experimentos 2 a 6).** Misma receta en todas las ejecuciones; lo que cambia entre experimentos es el ambiente, el modelo de partida, el presupuesto y la semilla.

| Hiperparámetro | Valor | Qué controla |
|---|---|---|
| red (`net_arch`) | MLP 128 × 128, política y valor separadas | capacidad de la función |
| `n_envs` | 8 entornos en paralelo | muestras por actualización |
| `n_steps` | 256 por entorno (2048 por actualización) | tamaño del lote de experiencia |
| `batch_size` · `n_epochs` | 256 · 10 | cuántas veces se reutiliza cada lote |
| `learning_rate` | 3·10⁻⁴ | tamaño del paso de optimización |
| `gamma` γ | 0,99 | descuento: con 50 pasos por época, casi sin descuento |
| `gae_lambda` λ | 0,95 | sesgo frente a varianza en la ventaja (GAE) |
| `clip_range` | 0,2 | cuánto puede cambiar la política por actualización |
| `ent_coef` | 0,005 | bonificación de entropía: mantiene exploración |
| `log_std_init` | −0,5 (desviación inicial ≈ 0,6) | ruido inicial de la política en acciones de [−1, 1] |
| normalización | `VecNormalize` de observaciones y recompensas, recorte ±10 | la red ve entradas comparables (metros, kelvin, fracciones) |
| evaluación periódica | cada 20 000 pasos, 50 épocas sin ruido con semillas desde 20 000 000; se guarda la mejor | elección del punto de control |
| presupuesto | 600 000 pasos (N1: ≈ 16 000 épocas, 11 min) o 1 500 000 (N2, N3: ≈ 42 000 épocas) | |
| semillas | 0, 1, 2; cada entorno paralelo usa semilla·10⁶ + k | réplicas |

**Transferencia (`--desde`).** Se copian los pesos de la misma forma; en la primera capa, las columnas de las entradas que ya existían se copian y las nuevas empiezan en cero, así la red arranca comportándose como la original. La normalización de observaciones se copia para las entradas comunes. Con la pasarela, además, las entradas 16 y 17 (objetivo − posición) **heredan los pesos de x e y con signo cambiado** y las de x e y se anulan: la política de partida vuela hacia el objetivo de la fase desde el primer paso y solo tiene que aprender a cruzar frenando.

## 9. Los seis experimentos: pregunta, variable que cambia, resultado

Cada ejecución tiene en `configs/<run_id>.json` su hipótesis, el cambio frente a su baseline, el presupuesto y la decisión con fecha. Regla de diseño: **una variable a la vez**.

### Experimento 1 · Q-learning en el nivel 1 (ambiente 0.1)

Pregunta: ¿se puede aprender a aterrizar con un modelo tabular pequeño? Fija el baseline y las métricas. Referencias no aprendidas: agente aleatorio 0/20, controlador heurístico a mano 20/20.

| Ejecución | Cambio | Aterrizajes · con viento 15 |
|---|---|---|
| `base-v0.1-s0` | primer modelo aprendido | 78,5 % · 38 % |

### Experimento 2 · PPO en el nivel 1 (0.1, 0.1.1)

Pregunta: ¿una red neuronal supera al Q-learning? ¿Qué parametrización de la acción lo hace aprendible y cuánto varía entre semillas?

| Ejecución | Cambio frente a la anterior | Aterrizajes · con viento | Decisión |
|---|---|---|---|
| `ppo-v0.1-s0` | tabla → red MLP 128×128; acción cruda; 400 000 pasos | 0 % · 0 % | rechazada |
| `ppo-rel-v0.1-s0` | acción relativa v1 (empuje/peso directo, inclinación ±23°); 600 000 pasos; entropía 0,005 | 0 % · 0 % | rechazada (llega inclinada 17°) |
| `ppo-v2-v0.1-s0` | acción relativa v2 (centrada en flotar, inclinación ≤ 9,6°); desviación inicial 0,6 | 97 % · 62,5 % | referencia |
| `ppo-v2-v0.1-s1` | solo la semilla (1) | **99 % · 72 %** | **recomendado de N1** (pipeline, 5 de noviembre) |
| `ppo-v2-v0.1-s2` | solo la semilla (2) | 97,5 % · 71,5 % | rechazada (no mejora en 2 puntos) |

Tres semillas: 97,8 ± 1,0 %. La cifra honesta de la configuración es la media; el recomendado es la mejor de tres por el criterio del pipeline.

### Experimento 3 · Nivel 2 con torres (0.2, retirado)

Pregunta: con una decisión nueva (por qué hueco entrar), ¿aprende PPO desde cero o hay que partir del modelo de N1? ¿Cuánto presupuesto exige?

| Ejecución | Cambio | Aterrizajes · con viento · colisiones |
|---|---|---|
| `ppo-n2-v0.2-s0` | misma receta de N1, desde cero | 8 % · 1,5 % · 54 |
| `ppo-n2-transfer-v0.2-s0` | transferencia desde `ppo-v2-v0.1-s0` | 76,5 % · 42 % · 42 |
| `ppo-n2-transfer-1m5-v0.2-s0` | solo el presupuesto: 1,5 M de pasos | 86 % · 55,5 % · 27 |
| `-s1`, `-s2` | solo la semilla | 93,5 % y 85,5 %; tres semillas 88,3 ± 4,5 % |

Lección: desde cero no aprende; la transferencia lo hace abordable; esquivar exige anticipar la ruta y 600 000 pasos no bastan.

### Experimento 4 · Nivel 3 con torres (0.3, retirado): incidente e intervención

Pregunta: cuando cambian las condiciones de operación, ¿cuánto se degrada el modelo de N2 y lo recupera reentrenarlo? ¿Desde qué modelo conviene partir?

| Ejecución | Cambio | Aterrizajes · con viento · colisiones |
|---|---|---|
| (incidente) recomendado de N2 jugando en N3 | ninguno: medición | 72 % (−11 puntos frente a su nivel) |
| `ppo-n3-transfer-v0.3-s0` | reentrenar en N3 desde el recomendado de N2, 600 000 pasos | 81,5 % · 74,5 % · 37 (rechazada: más colisiones) |
| `ppo-n3-transfer-1m5-v0.3-s0` | solo el presupuesto: 1,5 M | 86,5 % · 67,5 % · 24 |
| `ppo-n3-transfer-1m5-desde-s1-v0.3-s0` | solo el modelo de partida: N2-s1 (nuevo recomendado de N2) | 92 % · 79 % · 15 |
| `-s1`, `-s2` | solo la semilla | 91,5 % y 84,5 %; tres semillas 89,3 ± 4,2 % |

Aquí se demostró el **rollback en producción**: catálogo v8 → v9 (restaurar el anterior) → v10 (volver al recomendado), con `comprobar_api.py` como evidencia.

### Experimento 5 · Nivel 2 v1: pasarela (0.4)

Pregunta: con el obstáculo acordado por el equipo, ¿aprende PPO a entrar por la abertura y volver al centro partiendo del modelo de N1?

| Ejecución | Cambio | Aterrizajes · con viento · colisiones | Decisión |
|---|---|---|---|
| intento abortado (sin run_id) | abertura fija en la observación, transferencia simple | 2 % a los 320 000 pasos | abortado; MLflow limpiado; documentado en la ficha |
| `ppo-pasarela-transfer-1m5-v0.4-s0` | observación "objetivo de la fase" + herencia de pesos; desde `ppo-v2-v0.1-s1`; 1,5 M | 91,5 % · 30 % · 14 | seleccionada frente al 5 % a ciegas (catálogo v11) |
| `-s1` | solo la semilla | 97,5 % · 52 % · 4 | seleccionada: mejora 6 puntos |
| `-s2` | solo la semilla | **100 % · 68 % · 0** | **recomendado de N2** |

Tres semillas: 96,3 ± 4,4 %. La variabilidad con viento (30 a 68 %) es el incidente que el nivel 3 convierte en operación normal.

### Experimento 6 · Nivel 3 v1: pasarela con viento fuerte (0.5)

Pregunta: con viento de hasta 15 m/s y ráfagas dobles, ¿cuánto se degrada el modelo de la pasarela y lo recupera reentrenarlo?

| Ejecución | Cambio | Aterrizajes · con viento · colisiones | Decisión |
|---|---|---|---|
| (incidente) N2-s0, N2-s1, N2-s2 jugando en N3 v1 | medición | 64,5 % (−27), 85 % (−12,5), 93,5 % (−6,5) | fallo principal: colisión con la pasarela |
| `ppo-pasarela-viento-transfer-1m5-v0.5-s0` | reentrenar en N3 v1 desde N2-s0; 1,5 M | 94,5 % · 65,5 % · 6 | seleccionada frente al 64,5 % (catálogo v12) |
| `-s1`, `-s2` | solo la semilla | 94 % y 92,5 %; tres semillas 93,7 ± 1,0 % | rechazadas: no mejoran a s0 |
| `ppo-pasarela-viento-transfer-1m5-desde-s2-v0.5-s0` | solo el modelo de partida: N2-s2 (nuevo recomendado de N2) | **97,5 % · 85,5 % · 3** | **recomendado de N3** (catálogo v15) |

La intervención recupera la degradación y mejora la robustez al viento máximo en 24 puntos (61 % → 85,5 %). Reentrenar desde un modelo que ya sabe usar la abertura reduce la variabilidad entre semillas (±1,0 frente a ±4,4).

### Lo que aprendimos, en orden

1. La parametrización de la acción decide si PPO aprende (0 % → 97 % sin tocar el ambiente).
2. La transferencia desde el nivel anterior es lo que hace abordables los niveles 2 y 3 con 1,5 M de pasos (8 % desde cero frente a 86 % con transferencia).
3. Cuando el obstáculo cambia qué significa "objetivo", hay que dárselo al agente en la observación (2 % → 96 %).
4. La variabilidad entre semillas llega a 4 puntos: por eso se reportan medias y el pipeline conserva recomendado y anterior.
5. Partir del mejor modelo del nivel anterior importa más que el presupuesto (92 frente a 86,5 %; 97,5 frente a 94,5 %).

## 10. Cómo se evalúa y cómo se decide

- **Suite v1** (`configs/suites`): 200 épocas con semillas desde 10 000 000 (meteorología y salida que no aparecen en el entrenamiento, que usa otras semillas; la evaluación periódica usa 20 000 000), modelo congelado y sin ruido, en dos condiciones: normal (viento sorteado en el rango del ambiente) y **viento fijo de 15 m/s**. Las mismas 200 épocas para todos los modelos del mismo ambiente.
- **Métricas**: tasa de aterrizajes seguros (la de la misión), velocidad de contacto, error de posición final; complementarias: combustible, colisiones, cómo terminan las épocas, primer aterrizaje y mejor época durante el entrenamiento.
- **Criterio de aceptación del pipeline**, fijado antes de entrenar: un candidato sustituye al recomendado de su nivel si gana al menos **2 puntos** de tasa, no pierde más de **5 puntos** con viento de 15 m/s y **no tiene más colisiones**. En un nivel nuevo, la referencia es el modelo del nivel anterior jugando en él (`incidente.py`). El anterior se conserva para el rollback.
- **Test reservado** (`suite_reservada.py`): misma estructura, semilla guardada fuera del repositorio, aplicado **una sola vez** el 10 de noviembre a los tres recomendados: 97,5, 99,0 y 97,0 % (−1,5, −1 y −0,5 puntos respecto a la suite v1): no hay sobreajuste a la suite.
- **Viento en vivo** (web): no es un experimento ni un entrenamiento. La API simula paso a paso con el modelo congelado y el usuario mueve el viento; es la perturbación del nivel 3 aplicada a mano para verla.

## 11. Chuleta de números

| Dato | Valor |
|---|---|
| Salida · plataforma · zona | 600 m · radio 10 m · cilindro 300 × 1200 m |
| Aterrizaje seguro | \|vz\| ≤ 3 m/s, v_h ≤ 2 m/s, inclinación ≤ 10°, ≤ 10 m del centro |
| Paso del agente · física · límite | 20 m o 2 s · Euler 0,1 s · 50 pasos (100 s) |
| Cohete | 1000 kg + 500 kg de combustible, 27 kN, Isp 250 s, C_d 0,8, A 3 m², fuselaje 3 m |
| Viento | N1/N2: 0–10 m/s, ráfagas 1,5; N3: 0–15, ráfagas 3; perturbación: 15 fijo; perfil (z/10)^(1/7) |
| Recompensa | potencial −d/5 − v_h − \|vz − v_seg\| − z/10 (−8c); combustible −0,1/kg; +100 / −50 / −100 |
| Pasarela | radio 90 m a 180 m, grosor 3 m, abertura r 16 m en (28, 12), 4 pilares r 2,5 m |
| Observación · acción | 16 (N1) y 20 (pasarela) · 5 en el entorno, 3 en la red (relativa v2, inclinación ≤ 9,6°) |
| PPO | MLP 128×128, 8 envs, 2048 pasos/actualización, lr 3e-4, γ 0,99, λ 0,95, clip 0,2, ent 0,005 |
| Presupuestos | 600 000 pasos (N1) · 1 500 000 (N2, N3) |
| Ejecuciones · experimentos · pipeline | 23 · 6 · 21 evidencias; catálogo v15 |
| Recomendados (suite v1 / viento 15 / reservada) | N1 99 / 72 / 97,5 · N2 100 / 68 / 99 · N3 97,5 / 85,5 / 97 |
| Medias de tres semillas | N1 97,8 ± 1,0 · N2 96,3 ± 4,4 · N3 93,7 ± 1,0 |
| Degradación sin reentrenar | N1 bajo pasarela 99 → 5 % · N2 en N3 v1 100 → 93,5 % (s0: 91,5 → 64,5 %) |
| Criterio del pipeline | +2 puntos, viento −5 como mucho, no más colisiones |

## 12. Preguntas que pueden hacer y la respuesta corta

- **¿Por qué el viento no es una fuerza?** Entra por el arrastre como velocidad del aire: su efecto depende de la densidad (temperatura y presión) y de la velocidad relativa. Así las tres variables meteorológicas están acopladas.
- **¿Por qué un potencial?** Para que la recompensa guíe sin cambiar la política óptima: sumada en la época solo depende de dónde empieza y dónde acaba; flotar no suma. El castigo de proximidad de la pasarela también va dentro del potencial.
- **¿Qué pasa si el agente no observa las ráfagas?** Es intencional: ve el viento en su posición (medio + ráfaga actual) y tiene que reaccionar; la dirección media la infiere.
- **¿Por qué 50 pasos?** Desde 600 m hacen falta 30 pasos de 20 m en línea recta; los 20 restantes son el margen para frenar y corregir. Con 800 m de salida no alcanzaba.
- **¿`terminated` o `truncated`?** Estados finales terminan; agotar pasos trunca con la misma penalización. Cambió en 0.1.1 sin invalidar modelos.
- **¿Por qué no torque?** Decisión documentada: el eje sigue al empuje. El torque real está en la lista de lo que haríamos después, como la abertura aleatoria por época.
- **¿Por qué el recomendado no es la media?** El pipeline promueve con un criterio fijo y conserva el anterior; la media de las tres semillas está en el informe y en las fichas; el test reservado confirma que no hay sobreajuste.
- **¿Cuál fue el experimento que más enseñó?** El 2: la misma red pasa de 0 % a 97 % cambiando solo cómo se expresa la acción.
