"""Смена собственного логина. Доступна любой роли."""
from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import Role
from app.models.user import User
from tests.conftest import auth, login, make_user

CHANGE = "/api/v1/auth/username"


async def test_operator_changes_own_login(client: AsyncClient, operator: User) -> None:
    token = await login(client, "op1")
    response = await client.post(
        CHANGE, headers=auth(token), json={"login": "op1.new", "current_password": "password123"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["login"] == "op1.new"

    # Прежний логин перестаёт работать, новый входит с тем же паролем.
    old = await client.post(
        "/api/v1/auth/login", data={"username": "op1", "password": "password123"}
    )
    assert old.status_code == 401
    fresh = await client.post(
        "/api/v1/auth/login", data={"username": "op1.new", "password": "password123"}
    )
    assert fresh.status_code == 200


@pytest.mark.parametrize("role", [Role.SUPERVISOR, Role.HEAD, Role.ADMIN])
async def test_every_role_can_change_login(
    client: AsyncClient, session: AsyncSession, role: Role
) -> None:
    await make_user(session, login="staff", role=role)
    token = await login(client, "staff")
    response = await client.post(
        CHANGE, headers=auth(token), json={"login": "staff.new", "current_password": "password123"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["login"] == "staff.new"


async def test_wrong_password_is_rejected(client: AsyncClient, operator: User) -> None:
    """Логин - это учётные данные для входа, поэтому смена требует пароль."""
    token = await login(client, "op1")
    response = await client.post(
        CHANGE, headers=auth(token), json={"login": "op1.new", "current_password": "неверный"}
    )
    assert response.status_code == 400

    unchanged = await client.get("/api/v1/auth/me", headers=auth(token))
    assert unchanged.json()["login"] == "op1"


async def test_taken_login_is_rejected(
    client: AsyncClient, session: AsyncSession, operator: User
) -> None:
    await make_user(session, login="taken.one")
    token = await login(client, "op1")
    response = await client.post(
        CHANGE, headers=auth(token), json={"login": "taken.one", "current_password": "password123"}
    )
    assert response.status_code == 409
    assert response.json()["code"] == "conflict"


async def test_login_differing_only_by_case_is_rejected(
    client: AsyncClient, session: AsyncSession, operator: User
) -> None:
    """
    Вход по логину чувствителен к регистру.

    Пара «Ivanov» и «ivanov» приводила бы к постоянным ошибкам входа,
    поэтому такие совпадения отклоняются заранее.
    """
    await make_user(session, login="Ivanov")
    token = await login(client, "op1")
    response = await client.post(
        CHANGE, headers=auth(token), json={"login": "ivanov", "current_password": "password123"}
    )
    assert response.status_code == 409


async def test_keeping_the_same_login_is_accepted(client: AsyncClient, operator: User) -> None:
    token = await login(client, "op1")
    response = await client.post(
        CHANGE, headers=auth(token), json={"login": "op1", "current_password": "password123"}
    )
    assert response.status_code == 200
    assert response.json()["login"] == "op1"


@pytest.mark.parametrize(
    "value", ["ab", "с пробелом", "кириллица", "danияr", "слэш/тут", "x" * 151, ""]
)
async def test_invalid_logins_are_rejected(
    client: AsyncClient, operator: User, value: str
) -> None:
    token = await login(client, "op1")
    response = await client.post(
        CHANGE, headers=auth(token), json={"login": value, "current_password": "password123"}
    )
    assert response.status_code == 422


async def test_change_requires_authentication(client: AsyncClient) -> None:
    response = await client.post(
        CHANGE, json={"login": "anyone", "current_password": "password123"}
    )
    assert response.status_code == 401


async def test_other_sessions_survive_the_change(client: AsyncClient, operator: User) -> None:
    """
    Пароль и идентификатор пользователя не менялись, поэтому вход на других
    устройствах остаётся рабочим.
    """
    first = await login(client, "op1")
    second = await login(client, "op1")

    response = await client.post(
        CHANGE, headers=auth(first), json={"login": "op1.new", "current_password": "password123"}
    )
    assert response.status_code == 200

    still_valid = await client.get("/api/v1/auth/me", headers=auth(second))
    assert still_valid.status_code == 200
    assert still_valid.json()["login"] == "op1.new"
