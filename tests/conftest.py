"""
Общие фикстуры автотестов Puls (ТЗ 11.2).

КРИТИЧНО: переменные окружения выставляются ДО первого импорта app.* —
get_settings() закеширован через lru_cache, и engine создаётся при импорте
app.database.db. Поэтому блок os.environ стоит на уровне модуля conftest,
который pytest импортирует раньше любых тестов.
"""
from __future__ import annotations

import os
import pathlib
import uuid

_TEST_DB = pathlib.Path(__file__).resolve().parent / "puls_test.db"

os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB}"
os.environ["APP_ENV"] = "development"
os.environ["JWT_SECRET_KEY"] = "test-only-secret-key-with-at-least-32-characters"
os.environ["SEED_ADMIN_PASSWORD"] = "TestAdmin123!"
os.environ["ENABLE_DEMO_DATA"] = "false"
os.environ["AUTO_CREATE_TABLES"] = "true"
os.environ["AUTO_SEED"] = "true"
os.environ["ENABLE_WEEKLY_ACCRUAL_CRON"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

ADMIN_CREDENTIALS = {"username": "admin", "password": "TestAdmin123!"}


@pytest.fixture(scope="session")
def fastapi_app():
    """Приложение с чистой sqlite-БД на сессию тестов."""
    if _TEST_DB.exists():
        _TEST_DB.unlink()
    from app.main import app
    return app


@pytest.fixture(scope="session")
def client(fastapi_app):
    """Админ-клиент. Контекст-менеджер запускает lifespan (create_all + seed)."""
    with TestClient(fastapi_app, raise_server_exceptions=False) as c:
        r = c.post("/api/auth/login", json=ADMIN_CREDENTIALS)
        assert r.status_code == 200, r.text
        yield c


@pytest.fixture()
def make_client(client, fastapi_app):
    """Фабрика чистых клиентов (без cookie админа). Зависит от client,
    чтобы lifespan гарантированно уже отработал."""
    def _make() -> TestClient:
        return TestClient(fastapi_app, raise_server_exceptions=False)
    return _make


@pytest.fixture()
def db_session(client):
    from app.database.db import SessionLocal
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def _clean_rating_caches():
    """Кеши рейтинга/номинаций — модульные; изолируем тесты друг от друга."""
    from app.services.rating import rating_cache_invalidate
    rating_cache_invalidate()
    yield
    rating_cache_invalidate()


def make_operator(db, *, full_name: str = "Тестовый Оператор", balance: int = 0):
    """Оператор напрямую в БД — без API-обвязки, для быстрых фикстур."""
    from app.models import entities as m
    op = m.Operator(
        full_name=f"{full_name} {uuid.uuid4().hex[:6]}",
        group_name="Тест-группа",
        participation_status="participating",
        employment_status="active",
        is_active=True,
        current_balance=balance,
    )
    db.add(op)
    db.commit()
    db.refresh(op)
    return op


def make_operator_user(db, *, password: str = "OpPass123!"):
    """Оператор + привязанный user-аккаунт. Возвращает (operator, user, password)."""
    from app.core.security import hash_password
    from app.models import entities as m
    op = make_operator(db)
    user = m.User(
        full_name=op.full_name,
        username=f"op_{uuid.uuid4().hex[:10]}",
        password_hash=hash_password(password),
        role="operator",
        operator_id=op.id,
        is_active=True,
        must_change_password=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return op, user, password
