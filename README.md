# Puls — платформа геймификации операторов

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
pip install -r requirements-dev.txt   # ruff + pytest (для разработки/CI)
cp .env.example .env               # заполните переменные

alembic upgrade head               # применить миграции
uvicorn app.main:app --reload      # запустить сервер
```

Откройте http://localhost:8000

Проверки перед коммитом:

```bash
ruff check app          # линт (конфиг в pyproject.toml)
pytest -q               # автотесты (tests/, sqlite поднимается сам)
npm run check:minified  # min-файлы не устарели (см. «Сборка фронтенда»)
```

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

## Ручной импорт операторов из Excel

> **Административная утилита.** Не вызывается приложением в рантайме, не запускается
> при деплое (отсутствует в `start.sh`, `Procfile`, `railpack.json`). Запускается
> вручную администратором при необходимости массово добавить/обновить операторов
> произвольной группы.

Для массового создания операторов нужной группы используйте скрипт `scripts/import_operators.py`,
указав название группы через `--group` (группа может быть любой, не привязана к конкретному номеру):

```bash
python scripts/import_operators.py --file /path/to/операторы.xlsx --group "Группа 7"
```

По умолчанию это dry-run: скрипт проверяет файл, дубли и будущие изменения, но не пишет в БД.

Для реальной записи:

```bash
python scripts/import_operators.py --file /path/to/операторы.xlsx --group "Группа 7" --apply
```

Скрипт требует `DATABASE_URL`, создаёт группу при отсутствии, создаёт/обновляет операторов, ставит `must_change_password=true` для временных паролей и сохраняет одноразовый CSV с доступами в `secure_outputs/`. Этот каталог не коммитится.

Нельзя коммитить одноразовые скрипты или таблицы с реальными ФИО, email, логинами и временными паролями. Если такие данные попали в Git, временные пароли нужно считать скомпрометированными и сразу сбросить.

---

## Сборка фронтенда (минификация)

`index.html` подключает только `*.min.*`-бандлы. Min-файлы **коммитятся в
репозиторий** — Railway (railpack, python-provider) не запускает npm при
деплое, поэтому сборка выполняется локально перед пушем:

```bash
npm install        # однократно: terser + clean-css-cli (devDependencies)
npm run build      # js/app.min.js, js/api.min.js, css/styles.min.css, css/tokens.min.css
```

После изменения `js/*.js` или `css/*.css` обязательно пересоберите бандлы и
поднимите версию `?v=...` в `index.html` (иммутабельный кеш статики привязан
к этому параметру, см. `CachedStaticFiles` в `app/main.py`).

Страховка от «min-файл = копия исходника» (такое уже случалось):

```bash
npm run check:minified   # падает, если min идентичен исходнику или не меньше его
```

Эта же проверка выполняется в CI на каждый push/PR.

---

## Линт и тесты

- **ruff** — единственный линтер (`pyproject.toml`: E/F/I/UP/B, line-length 100,
  E501 в legacy-коде осознанно игнорируется). Запуск: `ruff check app`.
- **pytest** — автотесты в `tests/`: кеш номинаций, безопасный 500 без
  traceback, SPA-fallback для `/api/*`, границы локального дня, `/coins/overview`.
  БД для тестов — временный sqlite, поднимается conftest'ом автоматически.
- **CI** — `.github/workflows/checks.yml`: ruff, compileall, pytest,
  `alembic upgrade head` на PostgreSQL 16 (service-container), проверка
  минификации и отсутствия секретов в репозитории.

---

## Работа со временем

Единый стандарт (модуль `app/core/datetime_utils.py`):

- **В БД** время хранится как **naive UTC** (`now_utc()`); `datetime.utcnow()`
  в коде запрещён.
- **Бизнес-день** («операции за сегодня», отчёты) считается по таймзоне
  колл-центра **Asia/Almaty** — используйте `local_day_bounds_utc()`, а не
  `date.today()`.
- На frontend отдаётся ISO; для локального отображения на бэке есть
  `to_local_iso()`.

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
- [ ] В репозитории нет одноразовых файлов импорта с реальными ФИО/email/паролями
- [ ] `npm run check:minified` зелёный (min-бандлы собраны из актуальных исходников)

---

## Актуальная архитектура

- **Backend:** FastAPI (Python 3.13)
- **База данных:** PostgreSQL (Railway)
- **Frontend:** Vanilla JS / HTML / CSS (раздаётся FastAPI)
- **Auth:** HttpOnly cookie (`pulse_access_token`)
- **Миграции:** Alembic
- **Рейтинг:** строится по сохранённым `PeriodReport`
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
POST /api/weekly-results                 Legacy: ручная загрузка результатов недели

POST /api/reports/period-report/upload   Загрузить Monthly Report и Report
GET  /api/reports/period-report/status   Статус загруженных файлов
GET  /api/reports/operators-period-summary Предпросмотр расчёта периода
POST /api/reports/period-report/save     Сохранить расчёт периода

GET  /api/analytics/summary              KPI аналитики
GET  /api/analytics/operators            Таблица операторов аналитики
GET  /api/analytics/groups-comparison    Сравнение групп
GET  /api/analytics/points               Анализ итоговых баллов

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

---

## Project structure after refactor

### Backend

`app/main.py` is now only the FastAPI entry point: it creates the app, attaches middleware, includes the API router, registers `/health` and `/ready`, and mounts static files.

Main backend layout:

```text
app/
  api/router.py          # one API router, mounted once with settings.api_prefix
  core/lifespan.py       # startup checks, schema maintenance, seed
  core/middleware.py     # CORS, gzip, CSRF origin guard
  core/static.py         # static files and SPA fallback
  modules/
    analytics/
    auth/
    dashboard/
    groups/
    operator_levels/
    operators/
    rating/
    reports/
    shop/
    tests/
    users/
    wallet/
    weekly_results/
    wheel/
    work_norms/
  routers/               # compatibility shims for old imports
  services/              # compatibility shims for old imports
```

New code should be added under `app/modules/<domain>/`. The old `app/routers/*` and selected `app/services/*` files are kept as thin compatibility layers so existing imports do not break.

### Frontend

Frontend sources are split into editable modules:

```text
js/src/api/*.js          # API client sections
js/src/app/*.js          # app shell and views
css/src/*.css            # CSS layers by feature area
```

Generated entry files are still committed because Railway serves static files directly:

```text
js/api.js
js/app.js
css/styles.css
js/api.min.js
js/app.min.js
css/styles.min.css
css/tokens.min.css
```

After editing frontend source files, rebuild bundles:

```powershell
npm run build
```

If Node/npm is not installed, the safe fallback bundle command is:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-frontend.ps1
```

The fallback keeps JS semantics intact and minifies CSS conservatively. Full JS minification still requires `npm run build` with `terser`.

### Required checks before publish

```bash
ruff check app
pytest -q
npm install
npm run build
npm run check:minified
```

Manual browser smoke-test before release:

- login/logout
- period report upload/save
- coins and wallet
- operator levels
- Wheel of WOW: rules, tickets, spin, history, stats
- shop purchases
- tests
- dashboard and analytics
