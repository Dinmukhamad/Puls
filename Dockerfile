# Puls — образ приложения (FastAPI + статика).
# Совместим с ARM (Oracle Ampere A1) и x86 — базовый образ мультиарх.
FROM python:3.13-slim

# psycopg2-binary/psycopg тянут libpq; bcrypt/cryptography — сборочные заголовки.
# Ставим минимум системных зависимостей и чистим кеш.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Сначала зависимости — слой кешируется, пока requirements.txt не менялся.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Затем код и статика (то, что реально отдаёт приложение).
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./alembic.ini
COPY start.sh ./start.sh
COPY index.html ./index.html
COPY css ./css
COPY js ./js
COPY assets ./assets
COPY img ./img

RUN chmod +x start.sh

# Контейнер слушает порт из $PORT (start.sh), по умолчанию 8080.
EXPOSE 8080

# Healthcheck для docker — дергает /health (лёгкий, без БД).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS "http://localhost:${PORT:-8080}/ready" || exit 1

CMD ["bash", "start.sh"]
