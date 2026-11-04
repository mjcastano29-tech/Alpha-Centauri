# Imagen de la API (api/main.py). La usan Hugging Face Spaces (Docker) y cualquier host de contenedores.
FROM python:3.10-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# Dependencias primero, para que la capa se reutilice entre despliegues
COPY requirements-api.txt ./
RUN pip install --upgrade pip && pip install -r requirements-api.txt

# Código, ambiente, ejecuciones (modelos + manifests), catálogo y registro de MLflow (versiones de modelo)
COPY . .

# Spaces expone el 7860; otros hosts pasan PORT
ENV PORT=7860 CORS_ORIGENES=* MAX_EPISODIOS=50
EXPOSE 7860
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
