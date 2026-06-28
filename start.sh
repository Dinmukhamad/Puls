#!/bin/bash
set -e
cd /app
echo "[start] PORT=$PORT"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8080}"
