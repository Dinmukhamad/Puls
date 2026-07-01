#!/bin/bash
set -e
cd /app
export PYTHONPATH=/app
echo "[start] PORT=$PORT"

# Минифицируем JS если terser доступен
if command -v terser &> /dev/null; then
  echo "[start] Minifying JS..."
  terser js/app.js -o js/app.min.js --compress --mangle --quiet
  terser js/api.js -o js/api.min.js --compress --mangle --quiet
  echo "[start] JS minified"
fi

echo "[start] Running alembic upgrade head..."
alembic upgrade head
echo "[start] Migrations complete"

exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8080}" \
  --workers 2 \
  --timeout-keep-alive 30 \
  --timeout-graceful-shutdown 20 \
  --access-log
