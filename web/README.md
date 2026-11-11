# Web de Alpha Centauri

Aplicación Vite + TypeScript + Three.js que consulta la API (`api/main.py`). No contiene reglas ni física: todo lo
que muestra viene de la API, incluida la trayectoria de los replays.

- Publicada en Vercel: https://alpha-centauri-five.vercel.app (rama `main`, Root Directory `web`, `npm run build`, `dist`).
- Variable pública `VITE_API_BASE_URL`: URL de la API (`https://alpha-centauri-api.onrender.com`). Se incrusta al
  compilar, así que cambiarla exige volver a desplegar.

```bash
npm ci
npm run dev        # http://localhost:5173 contra la API de .env.development (localhost:8000)
npm run build      # compila a dist/
npm run preview    # sirve dist/ en http://localhost:4173
```

Vistas: `#/` catálogo · `#/ejecucion/<id>` detalle y evaluación en vivo · `#/comparar/<a,b>` · `#/replay/<id>`
(vuelos grabados) · `#/replay/<id>/evaluacion` (la evaluación recién ejecutada). Cada vista indica el modo:
replay o evaluación en vivo.

## PROJECT ELYNDRA: identidad visual y escena 3D

La web se presenta como **PROJECT ELYNDRA**: el aterrizaje ocurre en Elyndra, un planeta ficticio del sistema Alfa
Centauri (se ven los dos soles). El rediseño es solo visual: la trayectoria sigue llegando de la API, se interpola igual
que antes y la telemetría muestra el dato exacto de cada muestra.

- `src/escena/`: el planeta y el replay 3D. `reproductor.ts` orquesta (cámaras, reproducción, efectos de contacto);
  `cielo.ts` (cielo violeta, gigante con anillos, lunas, nubes y aurora), `atmosfera.ts` (niebla por altura que sustituye a
  la de three.js, esporas), `terreno.ts`, `flora.ts` (flora bioluminiscente instanciada), `montanas.ts` (islas flotantes,
  cascadas de partículas, agujas), `plataforma.ts` (losa, torres de luz y obstáculos de la API), `cohete.ts`, `efectos.ts`,
  `posproceso.ts` y `calidad.ts`. Todo es procedural (texturas en canvas, geometría generada): no hay modelos ni imágenes externas.
  Se descarga en un fragmento aparte, solo en las vistas con el simulador.
- `src/consola/`: la consola de misión del replay (`replay.ts`), la lógica de fases, criterios y resumen (`mision.ts`) e iconos.
  Las fases salen de la trayectoria (aproximación por debajo de 80 m, aterrizaje en los últimos 20 m) y el éxito o el fallo
  es siempre el `reason` que grabó el ambiente.
- Cámaras: cinematográfica (planos según la fase del vuelo; esquiva las torres), seguimiento, aterrizaje a ras de suelo,
  torre con teleobjetivo y a bordo. Calidad alta, media y baja; en «Auto» se elige por la GPU y baja de nivel si no llega a
  ~26 fps. La preferencia se guarda en el navegador del visitante.
- Atajos en el replay: espacio (reproducir o pausar), ← y → (paso anterior o siguiente del agente), R (reiniciar), M (sonido).
- Tipografías Space Grotesk, Inter y JetBrains Mono, alojadas con los paquetes `@fontsource-variable/*` (licencia SIL OFL 1.1).
