import asyncio

import pytest
from fastapi.routing import APIRoute
from sqlalchemy import func, select

from app.main import app
from app.models.access import AccessPolicy, AccessRule
from app.models.coin import CoinTransaction
from app.models.enums import Role, TxType
from app.models.settings import AuditLog
from app.services.access import SECTIONS, effective_access, request_sections
from tests.conftest import auth, login, make_group, make_user


async def administrator(client, session):
    admin = await make_user(session, login="acl-admin", role=Role.ADMIN)
    return admin, auth(await login(client, admin.login))


async def change(client, headers, *, kind="all", ids=None, changes=None, revision=None):
    if revision is None:
        revision = (await client.get("/api/v1/admin/access", headers=headers)).json()["revision"]
    return await client.put(
        "/api/v1/admin/access",
        headers=headers,
        json={
            "revision": revision,
            "target_type": kind,
            "target_ids": ids or ["*"],
            "changes": changes or [{"section": "training", "effect": "deny"}],
        },
    )


@pytest.mark.parametrize("role", list(Role))
async def test_role_defaults(client, session, role):
    user = await make_user(session, login="defaults", role=role)
    headers = auth(await login(client, user.login))
    response = await client.get("/api/v1/me/access", headers=headers)
    assert response.status_code == 200
    allowed = response.json()["allowed"]
    assert set(allowed) == {section.code for section in SECTIONS}
    for section in ("personal", "training", "rewards"):
        assert allowed[section] is (
            role == Role.OPERATOR or (role == Role.TRAINER and section == "training")
        )
    assert allowed["team"] is (role != Role.OPERATOR)
    assert allowed["system"] is (role == Role.ADMIN)
    for path in ("/me/dashboard", "/me/wallet", "/me/progress", "/learning", "/shop/items"):
        result = await client.get(f"/api/v1{path}", headers=headers)
        assert result.status_code == (
            200 if role == Role.OPERATOR or (role == Role.TRAINER and path == "/learning") else 403
        ), result.text
    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 200
    assert (await client.get("/api/v1/me/sessions", headers=headers)).status_code == 403


@pytest.mark.parametrize(
    "personal,results", [(True, True), (True, False), (False, True), (False, False)]
)
async def test_operator_progress_is_available_from_results_and_cabinet(
    client, session, operator, personal, results
):
    _, admin_headers = await administrator(client, session)
    response = await change(
        client,
        admin_headers,
        kind="user",
        ids=[str(operator.id)],
        changes=[
            {"section": "personal", "effect": "allow" if personal else "deny"},
            {"section": "results", "effect": "allow" if results else "deny"},
        ],
    )
    assert response.status_code == 200
    headers = auth(await login(client, operator.login))
    summary = await client.get("/api/v1/me/progress", headers=headers)
    assert summary.status_code == (200 if personal or results else 403)


async def test_precedence_bulk_inherit_and_group_change(client, session, operator, supervisor):
    _, headers = await administrator(client, session)
    other = await make_user(session, login="second", group_id=operator.group_id)
    outsider = await make_user(session, login="outsider")

    async def training(user):
        return (await effective_access(session, user))["decisions"]["training"]

    assert (await change(client, headers)).status_code == 200
    assert await training(operator) == {"allowed": False, "source": "all"}
    assert (
        await change(
            client,
            headers,
            kind="role",
            ids=["operator", "supervisor"],
            changes=[{"section": "training", "effect": "allow"}],
        )
    ).status_code == 200
    assert await training(operator) == {"allowed": True, "source": "role"}
    assert (
        await change(client, headers, kind="group", ids=[str(operator.group_id)])
    ).status_code == 200
    assert await training(operator) == {"allowed": False, "source": "group"}
    assert (
        await change(
            client,
            headers,
            kind="user",
            ids=[str(operator.id), str(other.id)],
            changes=[{"section": "training", "effect": "allow"}],
        )
    ).status_code == 200
    assert await training(operator) == {"allowed": True, "source": "user"}
    assert await training(other) == {"allowed": True, "source": "user"}
    assert await training(outsider) == {"allowed": True, "source": "role"}
    assert (
        await change(
            client,
            headers,
            kind="user",
            ids=[str(operator.id), str(other.id)],
            changes=[{"section": "training", "effect": "inherit"}],
        )
    ).status_code == 200
    assert await training(other) == {"allowed": False, "source": "group"}
    other.group_id = None
    await session.commit()
    assert await training(other) == {"allowed": True, "source": "role"}
    newcomer = await make_user(session, login="new", role=Role.HEAD)
    assert await training(newcomer) == {"allowed": False, "source": "all"}
    await session.rollback()
    assert (
        await session.scalar(
            select(func.count(AuditLog.id)).where(AuditLog.action == "access.update")
        )
        == 5
    )


async def test_granted_reads_keep_scope_and_writes_keep_role(client, session, operator, supervisor):
    _, admin_headers = await administrator(client, session)
    outsider = await make_user(session, login="private-outsider")
    group = await make_group(session, code="private-group")
    outsider.group_id = group.id
    for user in (operator, outsider):
        session.add(
            CoinTransaction(
                user_id=user.id,
                tx_type=TxType.MANUAL_CREDIT,
                amount=99,
                balance_after=99,
                reason="Scoped entry",
            )
        )
    await session.commit()
    grants = [
        {"section": code, "effect": "allow"}
        for code in (
            "team",
            "analytics",
            "performance",
            "learning_admin",
            "motivation",
            "reports",
            "system",
        )
    ]
    assert (
        await change(client, admin_headers, kind="user", ids=[str(operator.id)], changes=grants)
    ).status_code == 200
    headers = auth(await login(client, operator.login))
    users = await client.get("/api/v1/admin/users", headers=headers)
    assert users.status_code == 403
    groups = await client.get("/api/v1/admin/groups", headers=headers)
    assert [row["id"] for row in groups.json()] == [operator.group_id]
    assert (
        await client.get(f"/api/v1/admin/users/{outsider.id}", headers=headers)
    ).status_code in (403, 404)
    ledger = await client.get("/api/v1/admin/coins/transactions", headers=headers)
    assert ledger.status_code == 200, ledger.text
    own_ids = list(
        await session.scalars(
            select(CoinTransaction.id).where(CoinTransaction.user_id == operator.id)
        )
    )
    assert [row["id"] for row in ledger.json()["items"]] == own_ids
    for path in (
        "/admin/wallet",
        "/analytics/summary",
        "/admin/weeks",
        "/admin/learning",
        "/admin/config/rules",
        "/admin/operators/export",
    ):
        result = await client.get(f"/api/v1{path}", headers=headers)
        assert result.status_code == (403 if path == "/admin/learning" else 200), (
            path,
            result.text,
        )
    for path in ("/admin/access", "/admin/audit", "/admin/sessions"):
        assert (await client.get(f"/api/v1{path}", headers=headers)).status_code == 403
    assert (
        await client.post("/api/v1/admin/weeks", headers=headers, json={"any_day": "2026-09-06"})
    ).status_code == 403
    assert (
        await client.post(
            "/api/v1/admin/coins/manual",
            headers=headers,
            json={"user_id": operator.id, "amount": 10, "reason": "Attempt to write"},
        )
    ).status_code == 403


async def test_revocation_blocks_direct_urls_but_preserves_scoped_lookups(client, session, head):
    _, admin_headers = await administrator(client, session)
    headers = auth(await login(client, head.login))
    assert (await client.get("/api/v1/admin/users", headers=headers)).status_code == 200
    result = await change(
        client,
        admin_headers,
        kind="user",
        ids=[str(head.id)],
        changes=[
            {"section": code, "effect": "deny"}
            for code in ("team", "learning_admin", "motivation", "reports")
        ],
    )
    assert result.status_code == 200
    for path in (
        "/admin/users",
        "/admin/groups",
        "/admin/operators",
        "/admin/learning",
        "/admin/wallet",
        "/admin/progress/levels",
        "/admin/operators/export",
    ):
        response = await client.get(f"/api/v1{path}", headers=headers)
        assert response.status_code == 403, path
        assert response.json()["code"] == "section_denied"
    # Analytics can still populate filters without exposing full user profiles.
    options = await client.get("/api/v1/lookups/users", headers=headers)
    assert options.status_code == 200
    assert all(
        set(row) == {"id", "user_id", "full_name", "role", "group_name"}
        for row in options.json()["items"]
    )


async def test_admin_cannot_lose_access_management_and_other_roles_cannot_edit(
    client, session, head
):
    admin, headers = await administrator(client, session)
    assert (
        await change(
            client, headers, changes=[{"section": item.code, "effect": "deny"} for item in SECTIONS]
        )
    ).status_code == 200
    assert (await client.get("/api/v1/admin/audit", headers=headers)).status_code == 403
    for path in (
        "/admin/access",
        "/admin/access/subjects",
        f"/admin/access/users/{admin.id}",
        "/me/access",
        "/me/notifications",
    ):
        assert (await client.get(f"/api/v1{path}", headers=headers)).status_code == 200
    own = auth(await login(client, head.login))
    assert (await change(client, own, revision=1)).status_code == 403
    assert (await client.get("/api/v1/admin/access/subjects", headers=own)).status_code == 403
    assert (
        await change(client, headers, changes=[{"section": "system", "effect": "inherit"}])
    ).status_code == 200


async def test_invalid_bulk_is_atomic_and_stale_revision_conflicts(client, session, operator):
    _, headers = await administrator(client, session)
    for kwargs in (
        {"kind": "user", "ids": [str(operator.id), "2147483647"]},
        {"kind": "user", "ids": ["9" * 21]},
        {"kind": "role", "ids": ["owner"]},
        {"kind": "user", "ids": [str(operator.id), str(operator.id)]},
        {"changes": [{"section": "unknown", "effect": "allow"}]},
    ):
        result = await change(client, headers, revision=0, **kwargs)
        assert result.status_code in (400, 404, 422), result.text
    assert await session.scalar(select(func.count(AccessRule.id))) == 0
    await session.rollback()
    results = await asyncio.gather(*[change(client, headers, revision=0) for _ in range(2)])
    assert sorted(result.status_code for result in results) == [200, 409]
    assert await session.scalar(select(AccessPolicy.revision)) == 1
    assert await session.scalar(select(func.count(AccessRule.id))) == 1


async def test_every_business_endpoint_has_section_mapping():
    exempt = (
        "/auth/",
        "/me/access",
        "/admin/access",
        "/me/sessions",
        "/admin/sessions",
        "/me/notifications",
    )
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api/v1/"):
            continue
        path = route.path.removeprefix("/api/v1")
        if path.startswith(exempt):
            continue
        for method in route.methods:
            assert request_sections(path, method), (method, path)
