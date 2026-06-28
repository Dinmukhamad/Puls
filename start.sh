#!/bin/bash
set -e
cd /app
echo "Starting on port: $PORT"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8080}"
