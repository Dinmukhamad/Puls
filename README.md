# Puls — Operator Performance Platform

## Актуальная архитектура проекта

- **Backend:** FastAPI (Python)
- **База данных:** PostgreSQL
- **Frontend:** Vanilla JS / HTML / CSS (раздаётся FastAPI)
- Файл `server.js` полностью удалён
- Node.js backend не используется
- JSON-файлы не используются как источник данных

---

## Переменные окружения

Создайте `.env` на основе `.env.example`:

```env
DATABASE_URL=postgresql+psycopg2://user:password@host:5432/dbname
JWT_SECRET_KEY=ваш-случайный-ключ-минимум-32-символа
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=720

SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=ваш-пароль-администратора
SEED_ADMIN_FULLNAME=Администратор
```

---

## Запуск проекта

### Требования
- Python 3.11+
- PostgreSQL 14+

### Установка

```bash
pip install -r requirements.txt
```

### Запуск (разработка)

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Запуск (production / Railway)

```bash
python app/main.py
```

---

## Структура проекта

```
project/
  app/
    main.py           # FastAPI приложение, раздаёт статику
    core/
      config.py       # Настройки из env
      security.py     # JWT, хэширование паролей
    database/
      db.py           # SQLAlchemy engine, session
    models/
      entities.py     # ORM модели (User, Operator, ...)
    routers/
      auth.py         # /api/auth/*
      operators.py    # /api/operators/*
      wallet.py       # /api/wallet/*
      shop.py         # /api/shop/*
      rating.py       # /api/rating
      dashboard.py    # /api/dashboard/*
      weekly_results.py
    schemas/          # Pydantic схемы
    services/
      seed.py         # Начальные данные
      coins.py        # Логика коинов
      rating.py       # Логика рейтинга
  migrations/         # Alembic миграции
  css/                # Стили фронтенда
  js/                 # JS фронтенда
  assets/             # Статика
  index.html          # SPA точка входа
  requirements.txt
  .env.example
  start.sh            # Скрипт запуска для Railway
```

---

## Основные API эндпоинты

```
POST /api/auth/login                    Вход
GET  /api/auth/me                       Текущий пользователь

GET  /api/operators                     Список операторов
POST /api/operators                     Создать оператора (+ авто-аккаунт)
GET  /api/operators/{id}                Карточка оператора
PATCH /api/operators/{id}               Редактировать оператора
POST /api/operators/{id}/reset-password Сбросить пароль
POST /api/operators/account/change-password Сменить пароль (сам оператор)
POST /api/operators/account/change-username Сменить логин (сам оператор)

GET  /api/rating                        Рейтинг операторов
POST /api/weekly-results                Загрузить результаты недели

GET  /api/wallet/me                     Мой кошелёк
POST /api/wallet/transactions           Ручное начисление/списание

GET  /api/shop/items                    Товары магазина
POST /api/shop/purchases                Купить бонус
POST /api/shop/purchases/{id}/approve   Одобрить заявку
POST /api/shop/purchases/{id}/reject    Отклонить заявку

GET  /api/dashboard                     Сводка (admin)
GET  /api/dashboard/operators           Таблица операторов (admin)
GET  /api/dashboard/history             История транзакций (admin)
```

---

## Деплой на Railway

1. Подключите PostgreSQL в Railway
2. Задайте переменные окружения (см. выше)
3. Custom Start Command: `bash start.sh`
4. FastAPI автоматически создаст таблицы и seed-данные при первом запуске
