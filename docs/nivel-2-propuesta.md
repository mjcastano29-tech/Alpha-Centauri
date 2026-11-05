# Propuesta de nivel 2 (ambiente 0.2) · para acordar en equipo

> **Decisión (5 de noviembre de 2026): candidato C, obstáculos junto a la plataforma.** Implementado como
> `RocketLanding3D-N2-v0` (ambiente 0.2): tres torres de 300–420 m alrededor de la plataforma. Ficha:
> [ambiente-v0.2.md](ambiente-v0.2.md). El resto de este documento se conserva como registro de las opciones.

**3 de noviembre de 2026.** La guía pide tres niveles: N1 misión base (lo que tenemos), N2 "más decisiones" (rutas,
obstáculos, recursos o una variable relevante) y N3 operación exigente (perturbación). Cada modelo conserva el
ambiente donde se entrenó; si cambian las dimensiones o el significado de observaciones o acciones, nace una
familia nueva de modelos. Aquí van tres candidatos para N2, con lo que cambia en el contrato y cuánto cuesta.

## Candidato A (recomendado): rotación real con torque

**Qué decisión nueva toma el agente.** Hoy el eje del cohete salta instantáneamente a la dirección del empuje.
En N2 el cohete tiene inercia de giro: el agente aplica un **torque** limitado y la inclinación evoluciona con
velocidad angular. Tiene que anticipar: inclinarse antes para frenar la deriva y enderezarse a tiempo para llegar
a la plataforma con menos de 10°. Es exactamente lo que dice la ficha del profesor para Rocket Landing:
"acciones: empuje y torque limitados; observar ángulo y giro".

| | N1 (0.1) | N2 (0.2) |
|---|---|---|
| Acción | empuje + dirección del empuje | empuje + torque (x, y), torque máximo acotado |
| Estado nuevo | — | orientación del eje y velocidad angular (2 ejes) |
| Observación | 16 valores | 18 valores (añade velocidad angular x, y); la inclinación ya estaba |
| Dinámica nueva | — | I·α = τ − amortiguación; el empuje actúa en la dirección del eje actual |
| Éxito | igual (≤ 3 m/s, ≤ 2 m/s, ≤ 10°, ≤ 10 m) | igual + velocidad angular pequeña al contacto (p. ej. ≤ 10°/s) |
| Cómo se mide la dificultad | — | la política de N1 no puede jugar en N2 (acción distinta); el heurístico de N1 adaptado debería caer de 20/20 a menos de la mitad sin control de giro |

Coste: medio. Nueva familia de modelos (Q-learning necesita una tabla más; PPO cambia la capa de salida).
Presupuesto estimado: PPO 1 M de pasos (~20 min por semilla).

## Candidato B: plataforma desplazada y combustible justo

El punto de salida se aleja (hasta 150 m) y el combustible baja a 250 kg: el agente debe decidir cuánto
corregir la deriva y cuándo frenar sin quedarse sin propulsión. Misma observación y acción que N1 (los modelos
de N1 pueden evaluarse en N2 y veremos cuánto degradan). Coste bajo. Riesgo: puede resultar solo "más difícil"
sin una decisión cualitativamente nueva, que es lo que la guía pide documentar.

## Candidato C: obstáculos cerca de la plataforma

Dos torres (cilindros) junto a la plataforma; chocar con ellas es fallo. Obliga a elegir una ruta de aproximación.
Exige sensores nuevos en la observación (distancias a obstáculos) y detección de colisión con cuerpos. Coste alto;
es el que más cambia la visualización.

## Nivel 3 propuesto (con cualquiera de los anteriores)

Viento de 0 a 15 m/s con ráfagas el doble de fuertes (hoy 0–10 y 1,5 m/s). Ya tenemos medida la degradación del
modelo recomendado con viento de 15 m/s (97 % → 63 %); la intervención será entrenar un candidato con ese viento
en el entrenamiento y decidir con la suite si se acepta.

## Decisión que necesitamos tomar

1. Elegir el candidato de N2 (propongo A).
2. Fijar los umbrales nuevos (torque máximo, velocidad angular al contacto).
3. Acordar el presupuesto por semilla y cuántas semillas (la guía pide tres para los dos finalistas).

Cuando se decida: ambiente 0.2 en `rocket_env/` con su ficha (`docs/ambiente-v0.2.md`), entrada en el
CHANGELOG, `configs/` con las hipótesis de los candidatos y entrenamiento de la nueva familia.
