# Pulse — платформа геймификации операторов

Внутренняя система мотивации и геймификации для операторов колл-центра.

**Роли:** оператор, супервайзер, руководитель, администратор  
**Модули:** операторы, рейтинг, коины, магазин бонусов, заявки, история операций  
**Backend:** FastAPI + PostgreSQL  
**Frontend:** HTML / CSS / Vanilla JS (раздаётся FastAPI)

---

## Быстрый старт (локально)

```bash
python -m venv .venv
source .venv/bin/activate          # Linux / macOS
# .venv\Scripts\Activate.ps1     # Windows PowerShell

pip install -r requirements.txt
cp .env.example .env               # заполните переменные

alembic upgrade head               # применить миграции
uvicorn app.main:app --reload      # запустить сервер
```

Откройте http://localhost:8000

---

## Переменные окружения

### Обязательные для production

| Переменная | Описание |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET_KEY` | Секрет JWT — минимум 32 байта, уникальный |
| `CORS_ORIGINS` | Домен фронтенда (не `*` в production) |
| `SEED_ADMIN_USERNAME` | Логин admin при первом запуске |
| `SEED_ADMIN_PASSWORD` | Пароль admin (только при первом запуске) |

### Опциональные

| Переменная | По умолчанию | Описание |
|---|---|---|
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 720 | Время жизни токена (12 часов) |
| `AUTO_SEED` | true | Создавать admin и demo-данные при старте |
| `AUTO_CREATE_TABLES` | true | Создавать таблицы через create_all (dev only) |
| `ENABLE_DEMO_DATA` | true | Создавать демо-операторов |
| `AUTH_COOKIE_SECURE` | false | true в production (HTTPS) |
| `AUTH_COOKIE_SAMESITE` | lax | lax или strict |
| `APP_ENV` / `ENVIRONMENT` | development | production включает safety-check |

Генерация JWT_SECRET_KEY:
```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

---

## Миграции (Alembic)

```bash
alembic current          # текущая версия
alembic heads            # последняя версия
alembic upgrade head     # применить все миграции
alembic downgrade -1     # откатить одну миграцию

# Создать новую миграцию после изменения модели:
alembic revision --autogenerate -m "описание изменения"
```

**Правило:** изменения схемы только через Alembic. Не менять применённые миграции.

---

## Railway deploy

1. Создайте сервис PostgreSQL в Railway
2. Задайте Variables (см. выше)
3. Custom Start Command: `bash start.sh`

`start.sh` автоматически запускает `alembic upgrade head` перед стартом uvicorn.

Проверка деплоя:
```bash
curl https://<railway-domain>/health
curl https://<railway-domain>/ready
```

---

## Создание администратора

При первом запуске если задан `SEED_ADMIN_PASSWORD`:
- создаётся пользователь с ролью `admin`
- логин = `SEED_ADMIN_USERNAME` (по умолчанию `admin`)

После создания admin — уберите `SEED_ADMIN_PASSWORD` из переменных или смените пароль.

---

## Backup и restore

```bash
# Backup
pg_dump "$DATABASE_URL" > backup_$(date +%Y-%m-%d).sql

# Restore
psql "$DATABASE_URL" < backup_YYYY-MM-DD.sql
```

Railway также предоставляет Backups в UI сервиса PostgreSQL.

**Делайте backup перед каждой деструктивной миграцией.**

---

## Rollback

```bash
# Откат кода:
git revert HEAD
git push

# Откат миграции:
alembic downgrade -1

# Если код уже откатили, а миграция применена —
# нужен отдельный план. Деструктивные миграции (DROP COLUMN)
# требуют предварительного backup.
```

В Railway: Deployments → предыдущий деплой → Redeploy.

---

## Troubleshooting

### `/api/auth/me` отдаёт 500
- Проверьте Railway Deploy Logs на ошибку AttributeError
- Убедитесь что `alembic upgrade head` прошёл успешно
- Проверьте `DATABASE_URL` в Variables

### `/health` отдаёт 502
- Приложение не стартовало — смотрите Deploy Logs
- Возможно не прошла Alembic миграция
- Проверьте порт: `PORT` в Variables должен совпадать с командой запуска

### `alembic upgrade head` падает
- Проверьте `DATABASE_URL`
- Запустите `alembic current` — посмотрите текущую версию
- Смотрите текст ошибки — чаще всего конфликт типов или дублирование колонки

### Пользователь не может войти после смены JWT secret
- Все текущие сессии инвалидируются — пользователи должны перелогиниться
- Это нормальное поведение

### CORS ошибка
- Установите `CORS_ORIGINS=https://ваш-домен.railway.app`
- Не используйте `*` в production при cookie-auth

### База не подключается
- Проверьте `DATABASE_URL` в Variables
- Убедитесь что PostgreSQL сервис в Railway запущен
- Проверьте `pg_isready -d "$DATABASE_URL"`

### Не создаётся admin
- Убедитесь что задан `SEED_ADMIN_PASSWORD`
- Проверьте `AUTO_SEED=true`
- Смотрите логи `[startup] Seed`

---

## Security checklist

- [ ] `.env` не коммитится (есть в `.gitignore`)
- [ ] `JWT_SECRET_KEY` уникальный, не дефолтный
- [ ] `CORS_ORIGINS` не `*` в production
- [ ] `AUTH_COOKIE_SECURE=true` в production
- [ ] Токены не отправляются в чат или issue
- [ ] Backup перед деструктивными миграциями
- [ ] `gitleaks detect` перед релизом
- [ ] `SEED_ADMIN_PASSWORD` убран после создания admin

---

## Актуальная архитектура

- **Backend:** FastAPI (Python 3.13)
- **База данных:** PostgreSQL (Railway)
- **Frontend:** Vanilla JS / HTML / CSS (раздаётся FastAPI)
- **Auth:** HttpOnly cookie (`pulse_access_token`)
- **Миграции:** Alembic
- Файл `server.js` удалён
- Node.js backend не используется
- JSON-файлы не используются как источник данных

---

## API эндпоинты

```
POST /api/auth/login                     Вход
POST /api/auth/logout                    Выход (очищает cookie)
GET  /api/auth/me                        Текущий пользователь

GET  /api/operators                      Список операторов
POST /api/operators                      Создать (+ авто-аккаунт)
GET  /api/operators/{id}                 Карточка
PATCH /api/operators/{id}                Редактировать
POST /api/operators/{id}/reset-password  Сбросить пароль
POST /api/operators/account/change-password  Сменить пароль
POST /api/operators/account/change-username  Сменить логин

GET  /api/rating                         Рейтинг
POST /api/weekly-results                 Загрузить результаты недели

GET  /api/wallet/me                      Мой кошелёк
POST /api/wallet/transactions            Ручное начисление

GET  /api/shop/items                     Магазин
POST /api/shop/purchases                 Купить
POST /api/shop/purchases/{id}/approve    Одобрить
POST /api/shop/purchases/{id}/reject     Отклонить

GET  /api/dashboard                      Сводка (admin)
GET  /api/dashboard/operators            Таблица операторов (admin)
GET  /api/dashboard/history              История транзакций (admin)

GET  /health                             Liveness check
GET  /ready                              Readiness check (DB + migrations)
```
