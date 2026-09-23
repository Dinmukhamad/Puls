"""Общие фикстуры тестов: изолированная БД, клиент API и типовые пользователи."""

from __future__ import annotations

import os
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

# Переменные окружения должны быть выставлены до импорта настроек приложения.
_TMP_DB = Path(tempfile.gettempdir()) / "gamification_tests.sqlite3"
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{_TMP_DB.as_posix()}")
os.environ.setdefault("SCHEDULER_ENABLED", "false")
os.environ.setdefault("AUTO_CREATE_SCHEMA", "false")
os.environ.setdefault("SECRET_KEY", "test-secret-key")

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.db.base import Base  # noqa: F401
from app.db.init_db import create_schema, seed_reference_data
from app.db.session import SessionLocal, engine
from app.main import app
from app.models.enums import Role
from app.models.user import Group, User
from app.services import coins as coins_service

pytestmark = pytest.mark.asyncio


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(autouse=True)
async def clean_database() -> AsyncIterator[None]:
    """
    Каждый тест начинается с пустой схемы и наполненных справочников.

    Файл БД удаляется целиком: это надёжнее ``drop_all`` для SQLite, где
    порядок удаления таблиц упирается в неизменяемые внешние ключи.
    """
    await engine.dispose()
    for suffix in ("", "-wal", "-shm"):
        candidate = Path(f"{_TMP_DB}{suffix}")
        candidate.unlink(missing_ok=True)

    await create_schema()
    async with SessionLocal() as session:
        await seed_reference_data(session)
    yield


@pytest.fixture
async def session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as db:
        yield db


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


async def make_user(
    session: AsyncSession,
    *,
    login: str,
    role: Role = Role.OPERATOR,
    full_name: str | None = None,
    group_id: int | None = None,
    password: str = "password123",
) -> User:
    user = User(
        login=login,
        full_name=full_name or f"Пользователь {login}",
        role=role,
        group_id=group_id,
        hashed_password=hash_password(password),
    )
    session.add(user)
    await session.flush()
    if role == Role.OPERATOR:
        await coins_service.get_account(session, user.id)
    await session.commit()
    return user


async def make_group(
    session: AsyncSession, *, code: str, supervisor_id: int | None = None
) -> Group:
    group = Group(code=code, name=f"Группа {code}", supervisor_id=supervisor_id)
    session.add(group)
    await session.commit()
    return group


async def login(client: AsyncClient, login_name: str, password: str = "password123") -> str:
    response = await client.post(
        "/api/v1/auth/login", data={"username": login_name, "password": password}
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def login_with_work_sites(client: AsyncClient, login_name: str) -> str:
    """CRM behavior tests use a real QR approval; access-boundary tests use plain login."""
    token = await login(client, login_name)
    headers = auth(token)
    state = (await client.get("/api/v1/work-sites-access/status", headers=headers)).json()
    if state.get("required"):
        async with SessionLocal() as db:
            from sqlalchemy import select

            approver = await db.scalar(select(User).where(User.login == "crm-test-approver"))
            if approver is None:
                await make_user(db, login="crm-test-approver", role=Role.ADMIN)
        staff = auth(await login(client, "crm-test-approver"))
        issued = await client.post("/api/v1/work-sites-access/request", headers=headers)
        assert issued.status_code == 200, issued.text
        approved = await client.post(
            "/api/v1/work-sites-access/approve",
            headers=staff,
            json={"payload": issued.json()["payload"]},
        )
        assert approved.status_code == 200, approved.text
    return token


@pytest.fixture
async def operator(session: AsyncSession) -> User:
    return await make_user(session, login="op1", full_name="Оператор Первый")


@pytest.fixture
async def supervisor(session: AsyncSession, operator: User) -> User:
    sv = await make_user(session, login="sv1", role=Role.SUPERVISOR)
    group = await make_group(session, code="G1", supervisor_id=sv.id)
    operator.group_id = group.id
    sv.group_id = group.id
    session.add_all([operator, sv])
    await session.commit()
    return sv


@pytest.fixture
async def head(session: AsyncSession) -> User:
    return await make_user(session, login="head1", role=Role.HEAD)


@pytest.fixture
async def developer(session: AsyncSession, monkeypatch) -> User:
    from app.core.config import settings

    monkeypatch.setattr(settings, "DEVELOPER_LOGIN", "developer-test")
    return await make_user(session, login="developer-test", role=Role.ADMIN)
