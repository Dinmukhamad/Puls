"""Bulk revocation must never exceed the confirmed devices or current role scope."""

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, update

from app.models.enums import Role
from app.models.session import LoginSession
from app.models.settings import AuditLog
from app.models.user import User
from app.services.sessions import secret_hash, session_tokens
from tests.conftest import auth, make_user

ROOT = "/api/v1/admin/sessions"


async def issue(session, user, label):
    now = datetime.now(UTC)
    secret = f"test-refresh-{uuid.uuid4()}"
    record = LoginSession(
        id=str(uuid.uuid4()),
        user_id=user.id,
        refresh_hash=secret_hash(secret),
        device=label,
        ip_address="127.0.0.1",
        last_active_at=now,
        expires_at=now + timedelta(days=1),
    )
    session.add(record)
    await session.flush()
    return {"id": record.id, **session_tokens(record, secret).model_dump()}


@pytest.fixture
async def devices(session, developer, operator):
    second = await make_user(session, login="second-operator")
    trainer = await make_user(session, login="trainer-device", role=Role.TRAINER)
    users = {"actor": developer, "operator": operator, "second": second, "trainer": trainer}
    owners = {
        "current": developer,
        "actor_other": developer,
        "op_a": operator,
        "op_b": operator,
        "second": second,
        "trainer": trainer,
    }
    tokens = {name: await issue(session, user, name) for name, user in owners.items()}
    await session.commit()
    return {"users": users, "tokens": tokens, "headers": auth(tokens["current"]["access_token"])}


async def revoked(session):
    return set(
        await session.scalars(select(LoginSession.id).where(LoginSession.revoked_at.is_not(None)))
    )


async def test_listing_has_login_and_actual_role_without_secrets(client, devices):
    response = await client.get(ROOT, headers=devices["headers"])
    assert response.status_code == 200
    rows = {row["id"]: row for row in response.json()}
    current = rows[devices["tokens"]["current"]["id"]]
    assert current["current"] is True
    operator = rows[devices["tokens"]["op_a"]["id"]]
    assert operator["role"] == "operator"
    assert operator["login"] == devices["users"]["operator"].login
    assert "refresh_hash" not in response.text
    assert "refresh_token" not in response.text


@pytest.mark.parametrize(
    ("scope", "target_names"),
    [
        ("selected", {"op_a", "trainer"}),
        ("user", {"op_a", "op_b"}),
        ("role", {"op_a", "op_b", "second"}),
        ("all", {"actor_other", "op_a", "op_b", "second", "trainer"}),
    ],
)
async def test_bulk_scopes_intersect_confirmed_ids_and_preserve_new_devices(
    client, session, devices, scope, target_names
):
    tokens, users = devices["tokens"], devices["users"]
    # "selected" is intentionally a subset. Other scopes include foreign roles/users
    # to prove that the server, rather than the browser, enforces the boundary.
    confirmed_names = {"op_a", "trainer"} if scope == "selected" else set(tokens)
    body = {"scope": scope, "session_ids": [tokens[name]["id"] for name in confirmed_names]}
    if scope == "user":
        body["user_id"] = users["operator"].id
    elif scope == "role":
        body["role"] = "operator"

    # This device appeared after the confirmation snapshot and must survive all scopes.
    new_device = await issue(session, users["operator"], "logged in after confirmation")
    await session.commit()
    response = await client.post(f"{ROOT}/revoke-bulk", headers=devices["headers"], json=body)
    assert response.status_code == 200, response.text
    expected = {tokens[name]["id"] for name in target_names}
    assert await revoked(session) == expected
    assert response.json()["revoked_count"] == len(expected)
    affected_users = {
        users["actor"].id
        if name == "actor_other"
        else users["operator"].id
        if name in {"op_a", "op_b"}
        else users[name].id
        for name in target_names
    }
    assert response.json()["user_count"] == len(affected_users)
    assert response.json()["current_revoked"] is False
    assert new_device["id"] not in await revoked(session)
    assert (await client.get("/api/v1/auth/me", headers=devices["headers"])).status_code == 200

    audit = await session.scalar(select(AuditLog).where(AuditLog.action == "session.revoke_bulk"))
    assert audit.actor_id == users["actor"].id
    assert audit.payload["scope"] == scope
    assert audit.payload["keep_current"] is True
    assert audit.payload["revoked_count"] == len(expected)
    assert audit.payload["user_count"] == len(affected_users)
    assert set(audit.payload["session_ids"]) == expected
    assert set(audit.payload["user_ids"]) == affected_users
    assert audit.payload["user_id"] == body.get("user_id")
    assert audit.payload["role"] == body.get("role")
    audit_json = json.dumps(audit.payload)
    assert "refresh" not in audit_json
    for token in tokens.values():
        assert token["access_token"] not in audit_json
        assert token["refresh_token"] not in audit_json


async def test_current_is_preserved_by_default_then_explicitly_revoked(client, session, devices):
    current = devices["tokens"]["current"]
    body = {"scope": "selected", "session_ids": [current["id"]]}
    kept = await client.post(f"{ROOT}/revoke-bulk", headers=devices["headers"], json=body)
    assert kept.status_code == 200
    assert kept.json()["revoked_count"] == 0
    assert kept.json()["current_revoked"] is False
    assert await revoked(session) == set()
    assert (await client.get("/api/v1/auth/me", headers=devices["headers"])).status_code == 200

    response = await client.post(
        f"{ROOT}/revoke-bulk", headers=devices["headers"], json={**body, "keep_current": False}
    )
    assert response.status_code == 200
    assert response.json()["revoked_count"] == 1
    assert response.json()["user_count"] == 1
    assert response.json()["current_revoked"] is True
    assert (await client.get("/api/v1/auth/me", headers=devices["headers"])).status_code == 401
    refreshed = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": current["refresh_token"]}
    )
    assert refreshed.status_code == 401


async def test_revoked_other_device_rejects_both_tokens(client, devices):
    target = devices["tokens"]["op_a"]
    response = await client.post(
        f"{ROOT}/revoke-bulk",
        headers=devices["headers"],
        json={"scope": "selected", "session_ids": [target["id"]]},
    )
    assert response.status_code == 200
    assert (
        await client.get("/api/v1/auth/me", headers=auth(target["access_token"]))
    ).status_code == 401
    assert (
        await client.post("/api/v1/auth/refresh", json={"refresh_token": target["refresh_token"]})
    ).status_code == 401
    unaffected = devices["tokens"]["op_b"]
    assert (
        await client.get("/api/v1/auth/me", headers=auth(unaffected["access_token"]))
    ).status_code == 200
    assert (
        await client.post(
            "/api/v1/auth/refresh", json={"refresh_token": unaffected["refresh_token"]}
        )
    ).status_code == 200


@pytest.mark.parametrize("role", list(Role))
async def test_non_developer_cannot_bulk_revoke(client, session, devices, role):
    user = await make_user(session, login=f"not-developer-{role}", role=role)
    token = await issue(session, user, "unauthorized")
    await session.commit()
    response = await client.post(
        f"{ROOT}/revoke-bulk",
        headers=auth(token["access_token"]),
        json={"scope": "all", "session_ids": [row["id"] for row in devices["tokens"].values()]},
    )
    assert response.status_code == 403
    assert await revoked(session) == set()
    assert (
        await session.scalar(
            select(func.count(AuditLog.id)).where(AuditLog.action == "session.revoke_bulk")
        )
        == 0
    )


async def test_invalid_payloads_are_atomic_and_not_audited(client, session, devices):
    sid = devices["tokens"]["op_a"]["id"]
    base = {"scope": "selected", "session_ids": [sid]}
    invalid = [
        {},
        {"scope": "selected"},
        {"session_ids": [sid]},
        {**base, "scope": "everybody"},
        {**base, "session_ids": []},
        {**base, "session_ids": [sid, sid]},
        {**base, "session_ids": [str(uuid.uuid4()) for _ in range(5001)]},
        {**base, "session_ids": "not-an-array"},
        {**base, "session_ids": [1]},
        {**base, "session_ids": [None]},
        {**base, "session_ids": [""]},
        {**base, "session_ids": [" "]},
        {**base, "session_ids": ["a" * 37]},
        {**base, "keep_current": "false"},
        {**base, "keep_current": 0},
        {**base, "keep_current": None},
        {**base, "unexpected": True},
        {**base, "user_id": 1},
        {**base, "user_id": None},
        {**base, "role": "operator"},
        {**base, "role": None},
        {**base, "scope": "user"},
        {**base, "scope": "user", "user_id": 0},
        {**base, "scope": "user", "user_id": -1},
        {**base, "scope": "user", "user_id": "1"},
        {**base, "scope": "user", "user_id": True},
        {**base, "scope": "user", "user_id": 1, "role": "operator"},
        {**base, "scope": "user", "user_id": 1, "role": None},
        {**base, "scope": "role"},
        {**base, "scope": "role", "role": "unknown"},
        {**base, "scope": "role", "role": "operator", "user_id": 1},
        {**base, "scope": "role", "role": "operator", "user_id": None},
        {**base, "scope": "all", "user_id": 1},
        {**base, "scope": "all", "role": "operator"},
    ]
    for payload in invalid:
        response = await client.post(
            f"{ROOT}/revoke-bulk", headers=devices["headers"], json=payload
        )
        assert response.status_code == 422, (payload, response.text)
    assert await revoked(session) == set()
    assert (
        await session.scalar(
            select(func.count(AuditLog.id)).where(AuditLog.action == "session.revoke_bulk")
        )
        == 0
    )


async def test_expired_revoked_unknown_and_repeat_are_safe(client, session, devices):
    tokens = devices["tokens"]
    expired_at = datetime.now(UTC) - timedelta(days=1)
    prior_revocation = datetime.now(UTC) - timedelta(hours=1)
    await session.execute(
        update(LoginSession)
        .where(LoginSession.id == tokens["op_b"]["id"])
        .values(expires_at=expired_at)
    )
    await session.execute(
        update(LoginSession)
        .where(LoginSession.id == tokens["second"]["id"])
        .values(revoked_at=prior_revocation)
    )
    await session.commit()
    body = {
        "scope": "selected",
        "session_ids": [tokens[name]["id"] for name in ("op_a", "op_b", "second")]
        + [str(uuid.uuid4())],
    }
    first = await client.post(f"{ROOT}/revoke-bulk", headers=devices["headers"], json=body)
    assert first.status_code == 200
    assert first.json()["revoked_count"] == first.json()["user_count"] == 1
    state = dict((await session.execute(select(LoginSession.id, LoginSession.revoked_at))).all())
    assert state[tokens["op_b"]["id"]] is None
    assert state[tokens["second"]["id"]].replace(tzinfo=UTC) == prior_revocation
    second = await client.post(f"{ROOT}/revoke-bulk", headers=devices["headers"], json=body)
    assert second.status_code == 200
    assert second.json()["revoked_count"] == second.json()["user_count"] == 0
    after = dict((await session.execute(select(LoginSession.id, LoginSession.revoked_at))).all())
    assert after == state


async def test_role_is_revalidated_after_confirmation(client, session, devices):
    before = await client.get(ROOT, headers=devices["headers"])
    confirmed = [row["id"] for row in before.json() if row["role"] == "operator"]
    # A user was promoted after the developer opened the confirmation dialog.
    await session.execute(
        update(User).where(User.id == devices["users"]["operator"].id).values(role=Role.TRAINER)
    )
    await session.commit()
    response = await client.post(
        f"{ROOT}/revoke-bulk",
        headers=devices["headers"],
        json={"scope": "role", "role": "operator", "session_ids": confirmed},
    )
    assert response.status_code == 200
    assert response.json()["revoked_count"] == 1
    assert await revoked(session) == {devices["tokens"]["second"]["id"]}
