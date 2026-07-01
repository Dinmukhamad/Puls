#!/bin/bash
set -e
cd /app
export PYTHONPATH=/app
echo "[start] PORT=$PORT"

echo "[start] Running alembic upgrade head..."
alembic upgrade head
echo "[start] Migrations complete"

# --workers 2        — два процесса: один обслуживает трафик пока второй стартует при рестарте
# --timeout-keep-alive 30 — держать соединения живыми
# --timeout-graceful-shutdown 20 — дать 20с завершить текущие запросы перед остановкой
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8080}" \
  --workers 2 \
  --timeout-keep-alive 30 \
  --timeout-graceful-shutdown 20 \
  --access-log
