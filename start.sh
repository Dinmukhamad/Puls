#!/bin/bash
set -e
cd /app
export PYTHONPATH=/app
echo "[start] PORT=$PORT"

echo "[start] Running alembic upgrade head..."
alembic upgrade head
echo "[start] Migrations complete"

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8080}"
#!/bin/bash
set -e
cd /app
export PYTHONPATH=/app
echo "[start] PORT=$PORT"

echo "[start] Running alembic upgrade head..."
alembic upgrade head
echo "[start] Migrations complete"

# ВАЖНО: --workers 1.
# Кеши рейтинга (rating._RATING_CACHE) и аналитики (analytics_cache) — process-local
# (в памяти процесса, без Redis). При >1 воркере сброс кеша после загрузки Excel или
# сохранения расчёта периода очищает только тот процесс, что обработал запись, — второй
# воркер продолжает отдавать устаревшие данные до истечения TTL. Чтобы поднять несколько
# воркеров, вынесите кеш в общий стор (Redis) и инвалидацию через него.
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8080}" \
  --workers 1 \
  --timeout-keep-alive 30 \
  --timeout-graceful-shutdown 20 \
  --access-log
