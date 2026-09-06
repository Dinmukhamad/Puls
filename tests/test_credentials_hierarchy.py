"""
Кто кому меняет логин и пароль.

Иерархия: администратор - любому, руководитель - супервайзерам и операторам,
супервайзер - операторам своих групп. Свои данные меняются только в профиле,
с подтверждением паролем.
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import Role
from app.models.user import Group, User
from tests.conftest import auth, login, make_group, make_user


def password_url(user: User) -> str:
    return f"/api/v1/admin/users/{user.id}/password"


def login_url(user: User) -> str:
    return f"/api/v1/admin/users/{user.id}/login"


@pytest.fixture
async def team(session: AsyncSession) -> dict[str, User | Group]:
    """Полная лестница ролей и две группы с разными супервайзерами."""
    admin = await make_user(session, login="root", role=Role.ADMIN)
    head = await make_user(session, login="boss", role=Role.HEAD)
    sv_a = await make_user(session, login="sv.a", role=Role.SUPERVISOR)
    sv_b = await make_user(session, login="sv.b", role=Role.SUPERVISOR)
    group_a = await make_group(session, code="GA", supervisor_id=sv_a.id)
    group_b = await make_group(session, code="GB", supervisor_id=sv_b.id)
    op_a = await make_user(session, login="op.a", group_id=group_a.id)
    op_b = await make_user(session, login="op.b", group_id=group_b.id)
    sv_a.group_id = group_a.id
    sv_b.group_id = group_b.id
    session.add_all([sv_a, sv_b])
    await session.commit()
    return {
        "admin": admin, "head": head, "sv_a": sv_a, "sv_b": sv_b,
        "op_a": op_a, "op_b": op_b,
    }


# --------------------------------------------------------------------------- #
# Разрешено
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("actor_key", "target"),
    [
        ("admin", "op_a"), ("admin", "sv_a"), ("admin", "head"),
        ("head", "sv_a"), ("head", "op_a"), ("head", "op_b"),
        ("sv_a", "op_a"),
    ],
)
async def test_allowed_password_reset(
    client: AsyncClient, team: dict, actor_key: str, target: str
) -> None:
    token = await login(client, team[actor_key].login)
    response = await client.post(
        password_url(team[target]), headers=auth(token), json={"password": "новыйПароль1"}
    )
    assert response.status_code == 200, response.text

    # Сотрудник входит с новым паролем.
    fresh = await client.post(
        "/api/v1/auth/login",
        data={"username": team[target].login, "password": "новыйПароль1"},
    )
    assert fresh.status_code == 200


@pytest.mark.parametrize(
    ("actor_key", "target", "new_login"),
    [("admin", "op_a", "op.a2"), ("head", "sv_a", "sv.a2"), ("sv_a", "op_a", "op.a3")],
)
async def test_allowed_login_reset(
    client: AsyncClient, team: dict, actor_key: str, target: str, new_login: str
) -> None:
    token = await login(client, team[actor_key].login)
    response = await client.post(
        login_url(team[target]), headers=auth(token), json={"login": new_login}
    )
    assert response.status_code == 200, response.text
    assert response.json()["login"] == new_login

    fresh = await client.post(
        "/api/v1/auth/login", data={"username": new_login, "password": "password123"}
    )
    assert fresh.status_code == 200


# --------------------------------------------------------------------------- #
# Запрещено
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("actor_key", "target", "why"),
    [
        ("sv_a", "op_b", "оператор чужой группы"),
        ("sv_a", "sv_b", "равная должность"),
        ("sv_a", "head", "должность выше"),
        ("sv_a", "admin", "должность выше"),
        ("head", "admin", "должность выше"),
        ("head", "head2", "равная должность"),
    ],
)
async def test_forbidden_targets(
    client: AsyncClient, session: AsyncSession, team: dict, actor_key: str, target: str, why: str
) -> None:
    if target == "head2":
        team["head2"] = await make_user(session, login="boss2", role=Role.HEAD)
    token = await login(client, team[actor_key].login)

    for url in (password_url(team[target]), login_url(team[target])):
        payload = {"password": "новыйПароль1"} if url.endswith("password") else {"login": "any.new"}
        response = await client.post(url, headers=auth(token), json=payload)
        assert response.status_code == 403, f"{why}: {url} -> {response.status_code}"


async def test_operator_cannot_touch_anyone(client: AsyncClient, team: dict) -> None:
    token = await login(client, team["op_a"].login)
    for url, payload in (
        (password_url(team["op_b"]), {"password": "новыйПароль1"}),
        (login_url(team["op_b"]), {"login": "op.b2"}),
    ):
        response = await client.post(url, headers=auth(token), json=payload)
        assert response.status_code == 403


@pytest.mark.parametrize("actor_key", ["admin", "head", "sv_a"])
async def test_own_credentials_go_through_the_profile(
    client: AsyncClient, team: dict, actor_key: str
) -> None:
    """
    Свой пароль через административный путь не меняется.

    Иначе оставленная открытой сессия позволила бы сменить пароль, не зная
    старого: самостоятельная смена требует подтверждения текущим паролем.
    """
    actor = team[actor_key]
    token = await login(client, actor.login)
    response = await client.post(
        password_url(actor), headers=auth(token), json={"password": "новыйПароль1"}
    )
    assert response.status_code == 403
    assert response.json()["code"] == "self_service_required"

    # Прежний пароль продолжает работать.
    still = await client.post(
        "/api/v1/auth/login", data={"username": actor.login, "password": "password123"}
    )
    assert still.status_code == 200


# --------------------------------------------------------------------------- #
# Побочные эффекты
# --------------------------------------------------------------------------- #


async def test_password_reset_ends_the_employee_sessions(
    client: AsyncClient, team: dict
) -> None:
    """Прежний пароль больше не действует, поэтому открытые входы закрываются."""
    employee = await login(client, team["op_a"].login)
    assert (await client.get("/api/v1/auth/me", headers=auth(employee))).status_code == 200

    boss = await login(client, team["head"].login)
    await client.post(
        password_url(team["op_a"]), headers=auth(boss), json={"password": "новыйПароль1"}
    )

    closed = await client.get("/api/v1/auth/me", headers=auth(employee))
    assert closed.status_code == 401


async def test_login_reset_keeps_the_employee_signed_in(
    client: AsyncClient, team: dict
) -> None:
    """Пароль и идентификатор не менялись, поэтому сеанс остаётся рабочим."""
    employee = await login(client, team["op_a"].login)
    boss = await login(client, team["head"].login)

    await client.post(login_url(team["op_a"]), headers=auth(boss), json={"login": "op.renamed"})

    alive = await client.get("/api/v1/auth/me", headers=auth(employee))
    assert alive.status_code == 200
    assert alive.json()["login"] == "op.renamed"


async def test_taken_login_is_rejected(client: AsyncClient, team: dict) -> None:
    token = await login(client, team["head"].login)
    response = await client.post(
        login_url(team["op_a"]), headers=auth(token), json={"login": team["op_b"].login}
    )
    assert response.status_code == 409


async def test_login_rules_apply_to_employees_too(client: AsyncClient, team: dict) -> None:
    token = await login(client, team["head"].login)
    response = await client.post(
        login_url(team["op_a"]), headers=auth(token), json={"login": "кириллица"}
    )
    assert response.status_code == 422
