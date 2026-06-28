#!/bin/bash
set -e
cd /app
echo "[start] PORT=$PORT"

# Apply database migrations before starting the app
echo "[start] Running alembic upgrade head..."
alembic upgrade head
echo "[start] Migrations complete"

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8080}"
