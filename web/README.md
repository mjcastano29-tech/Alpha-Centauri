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
