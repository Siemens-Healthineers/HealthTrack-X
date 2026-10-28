# ── Backend Dockerfile ─────────────────────────────────────────
# Build:  docker compose build backend
# Run:    docker compose up backend
# ───────────────────────────────────────────────────────────────

FROM python:3.12-slim AS base

# Prevent Python from writing .pyc files and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# ── Dependencies (cached layer) ──────────────────────────────
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Application code ─────────────────────────────────────────
COPY backend/ .

# Create directories that the app may need at runtime
RUN mkdir -p cache logs config/env

# ── Runtime ───────────────────────────────────────────────────
# Default env vars (can be overridden in docker-compose / podman run)
ENV NATS_URL=nats://htx-nats:4222 \
    CORS_ORIGINS="http://localhost:3000,http://localhost:5173,http://localhost:5174,http://127.0.0.1:3000,http://127.0.0.1:5173,http://127.0.0.1:5174" \
    AUTH_ENABLED="false"

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
