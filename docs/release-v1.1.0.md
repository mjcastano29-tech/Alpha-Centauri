# Notas de la release v1.1.0

Entrega final del proyecto Alpha Centauri · Rocket Landing (curso de MLOps).

**Novedades respecto a v1.0.0**

- **Viento en vivo** (`#/vivo`): misión paso a paso en la que la API simula con el modelo congelado y el usuario cambia la intensidad y la dirección del viento con una barra mientras el cohete vuela (`POST /sesiones`, `POST /sesiones/{id}/paso`).
- **Pantalla completa** de la escena 3D en el simulador y en la misión en vivo (botón o tecla F, barra flotante con reproducir, pasos y viento).
- **Paquete de entregables**: `docs/entregables.md` (rúbrica → evidencia) y los PDF de `entregables/`, generados con `python entregables.py --ref v1.1.0`. Se adjuntan a la release.

**Qué contiene el proyecto**: tres niveles (N1 0.1.1, N2 v1 0.4 pasarela, N3 v1 0.5 pasarela con viento), 23 ejecuciones en 6 experimentos, pipeline Prefect de 8 etapas con 21 evidencias, API y web públicas, catálogo v15, monitoreo, incidente, intervención y rollback demostrado, informe final, guion de la defensa y test reservado. 113 pruebas.

Web: https://alpha-centauri-five.vercel.app · API: https://alpha-centauri-api.onrender.com · MLflow: https://alpha-centauri-mlflow.onrender.com

Para publicarla en GitHub desde la raíz del repositorio:

```bash
gh release create v1.1.0 --title "Alpha Centauri v1.1.0 · entrega final" --notes-file docs/release-v1.1.0.md entregables/*.pdf entregables/09-evidencia-prefect-flow-run.png
```
