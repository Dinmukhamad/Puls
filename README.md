# Divergent Operator Contest

## FastAPI MVP backend

Добавлен backend-каркас для MVP iCORE gamification:

- роли `operator`, `supervisor`, `manager`, `admin`;
- JWT-авторизация;
- операторы и недельные результаты конкурса;
- правило начисления: `5 конкурсных баллов = 1 coin`;
- кошелек, история транзакций, ручные начисления и списания;
- рейтинг операторов;
- магазин бонусов с резервированием коинов, одобрением и возвратом;
- dashboard для руководителя;
- seed-данные для быстрого старта.

Локальный запуск backend:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

По умолчанию для разработки используется SQLite-файл `icore_mvp.db`, таблицы и демо-данные создаются автоматически. Для PostgreSQL укажите в `.env`:

```env
DATABASE_URL=postgresql+psycopg://icore:icore@localhost:5432/icore_mvp
```

Миграции:

```bash
alembic upgrade head
```

Демо-логины после seed:

```text
admin / admin12345
supervisor / supervisor123
manager / manager123
operator1 / operator123
```

## Persistent data on Railway

The app stores live contest data in JSON through `/api/state`.

Do not store production data in the release file `./data.json`: Railway redeploys can replace files from the GitHub repository and reset operators.

Use a Railway Volume instead:

1. Create or attach a Volume to this service.
2. Mount it at `/data`.
3. Set the service variable:

```env
DATA_FILE=/data/data.json
```

Alternative:

```env
PERSISTENT_DATA_DIR=/data
```

After deploy, open:

```text
/api/health
```

The response must show:

```json
{
  "storage": {
    "persistent": true
  }
}
```

The server writes automatic backups into `/data/backups`.

If `storage.persistent` is `false`, operator data can still disappear after deploy or restart.
