"""Los experimentos del proyecto: qué pregunta responde cada uno y en qué nivel vive.

Un experimento agrupa ejecuciones (configuraciones) que comparten ambiente y pregunta; coincide con el experimento
de MLflow en el que se registran. Lo usan la API (`/catalogo` → `experimentos`), la web (vista "Experimentos") y
`experimentos_md.py`. El orden es el cronológico, que es también el de complejidad creciente del ambiente.
"""
EXPERIMENTOS = [
    {
        "id": "experimento-1-qlearning", "numero": 1, "titulo": "Q-learning en el nivel 1", "nivel": "N1", "ambiente": "RocketLanding3D-v0",
        "pregunta": "¿Se puede aprender a aterrizar en el ambiente base con un modelo tabular pequeño? Fija el baseline aprendido y las métricas.",
        "variables": "épocas, tasas de aprendizaje y exploración (α, ε), descuento γ, semilla; dos tablas Q discretas (motor y dirección).",
    },
    {
        "id": "experimento-2-ppo", "numero": 2, "titulo": "PPO (red neuronal) en el nivel 1", "nivel": "N1", "ambiente": "RocketLanding3D-v0",
        "pregunta": "¿Una red neuronal entrenada con PPO supera al Q-learning en el mismo ambiente? Qué parametrización de la acción lo hace aprendible y cuánto varía entre semillas.",
        "variables": "pasos del agente, entornos en paralelo, tamaño de lote, tasa de aprendizaje, γ, λ de GAE, recorte, entropía, red, desviación inicial, acción (cruda / relativa v1 / relativa v2), semilla.",
    },
    {
        "id": "experimento-3-nivel2", "numero": 3, "titulo": "Nivel 2: torres alrededor de la plataforma", "nivel": "N2", "ambiente": "RocketLanding3D-N2-v0",
        "pregunta": "Con una decisión nueva (por qué hueco entrar entre tres torres), ¿aprende PPO desde cero o hace falta partir del modelo del nivel 1? Cuánto presupuesto exige y cuánto varía entre semillas.",
        "variables": "las del experimento 2 más el ambiente (observación de 25 valores), el modelo de partida (transferencia) y el presupuesto (600 000 o 1 500 000 pasos).",
    },
    {
        "id": "experimento-4-nivel3", "numero": 4, "titulo": "Nivel 3: viento fuerte (incidente e intervención)", "nivel": "N3", "ambiente": "RocketLanding3D-N3-v0",
        "pregunta": "Cuando cambian las condiciones de operación (viento de hasta 15 m/s y ráfagas dobles), ¿cuánto se degrada el modelo del nivel 2 y lo recupera reentrenarlo en el nivel 3? Desde qué modelo conviene partir.",
        "variables": "las del experimento 3 con el ambiente N3; cambia el modelo de partida (recomendado de N2, semilla 0 o 1) y el presupuesto.",
    },
]
POR_ID = {e["id"]: e for e in EXPERIMENTOS}
