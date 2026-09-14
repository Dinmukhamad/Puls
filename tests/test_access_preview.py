import pytest
from sqlalchemy import func, select

from app.models.access import AccessRule
from app.models.enums import Role
from app.models.settings import AuditLog
from app.services.access import effective_access
from tests.conftest import auth, login, make_group, make_user
from tests.test_access import administrator, change


async def preview(client, headers, kind, ids, changes=None, revision=None):
    if revision is None:
        revision = (await client.get("/api/v1/admin/access", headers=headers)).json()["revision"]
    return await client.post("/api/v1/admin/access/preview", headers=headers, json={
        "revision": revision, "target_type": kind, "target_ids": ids,
        "changes": changes or [],
    })


async def test_role_preview_preserves_personal_exceptions_and_has_no_writes(client, session):
    _, headers = await administrator(client, session)
    one = await make_user(session, login="preview-one")
    two = await make_user(session, login="preview-two")
    await change(client, headers, kind="user", ids=[str(two.id)],
                 changes=[{"section": "training", "effect": "allow"}])
    rules = await session.scalar(select(func.count(AccessRule.id)))
    audits = await session.scalar(select(func.count(AuditLog.id)))
    changes = [{"section": "training", "effect": "deny"}]
    result = await preview(client, headers, "role", ["operator"], changes)
    assert result.status_code == 200, result.text
    data = result.json()
    assert data["total"] == 2
    section = data["sections"]["training"]
    assert section["state"] == "off"
    assert section["sources"] == {"role": 1}
    assert section["before_allowed"] == 2
    assert section["after_allowed"] == 1
    assert section["exceptions"] == 1
    assert section["changed"] == 1
    assert (await effective_access(session, one))["allowed"]["training"] is True
    assert await session.scalar(select(func.count(AccessRule.id))) == rules
    assert await session.scalar(select(func.count(AuditLog.id))) == audits
    saved = await change(client, headers, kind="role", ids=["operator"], changes=changes)
    assert saved.status_code == 200
    actual = [(await effective_access(session, user))["allowed"]["training"] for user in [one, two]]
    assert sum(actual) == section["after_allowed"]


async def test_removing_personal_override_previews_inherited_group_access(client, session):
    _, headers = await administrator(client, session)
    group = await make_group(session, code="inherit-group")
    user = await make_user(session, login="inherited", group_id=group.id)
    await change(client, headers, kind="role", ids=["operator"])
    await change(client, headers, kind="group", ids=[str(group.id)],
                 changes=[{"section": "training", "effect": "allow"}])
    await change(client, headers, kind="user", ids=[str(user.id)])
    result = await preview(client, headers, "user", [str(user.id)],
                           [{"section": "training", "effect": "inherit"}])
    section = result.json()["sections"]["training"]
    assert section["state"] == "on"
    assert section["effect"] == "inherit"
    assert section["has_override"] is False
    assert section["sources"] == {"group": 1}
    assert (section["before_allowed"], section["after_allowed"]) == (0, 1)
    assert (await effective_access(session, user))["allowed"]["training"] is False


async def test_bulk_mixed_group_and_empty_audience_defaults(client, session):
    _, headers = await administrator(client, session)
    group = await make_group(session, code="mixed-group")
    first = await make_user(session, login="mixed-operator", group_id=group.id)
    second = await make_user(session, login="mixed-head", role=Role.HEAD, group_id=group.id)
    result = (await preview(client, headers, "group", [str(group.id)])).json()
    assert result["sections"]["training"]["state"] == "mixed"
    result = (await preview(client, headers, "user", [str(first.id), str(second.id)],
                            [{"section": "training", "effect": "allow"}])).json()
    assert result["sections"]["training"]["state"] == "on"
    assert result["sections"]["training"]["after_allowed"] == 2
    assert result["sections"]["system"]["locked"] is True
    empty = await make_group(session, code="empty")
    result = (await preview(client, headers, "group", [str(empty.id)])).json()
    assert result["total"] == 0
    assert result["sections"]["training"]["state"] == "mixed"
    result = (await preview(client, headers, "role", ["supervisor"])).json()
    assert result["total"] == 0
    assert result["sections"]["overview"]["state"] == "on"


async def test_preview_does_not_grant_admin_or_developer_capabilities(client, session):
    _, headers = await administrator(client, session)
    user = await make_user(session, login="restricted")
    result = (await preview(client, headers, "user", [str(user.id)],
                            [{"section": "system", "effect": "allow"}])).json()
    assert result["sections"]["system"]["state"] == "off"
    assert result["sections"]["system"]["locked"] is True
    assert result["sections"]["system"]["sources"] == {"admin_only": 1}
    assert (await preview(client, headers, "user", [str(user.id)],
                          [{"section": "sessions", "effect": "allow"}])).status_code == 400
    user_headers = auth(await login(client, user.login))
    assert (await preview(client, user_headers, "all", ["*"], revision=0)).status_code == 403


@pytest.mark.parametrize("kind,ids", [("role", ["bogus"]), ("user", ["01"]), ("group", ["-1"])])
async def test_preview_validates_targets(client, session, kind, ids):
    _, headers = await administrator(client, session)
    assert (await preview(client, headers, kind, ids)).status_code == 400


async def test_preview_refuses_stale_revision_and_unchanged_empty_save(client, session):
    _, headers = await administrator(client, session)
    await change(client, headers)
    assert (await preview(client, headers, "all", ["*"], revision=0)).status_code == 409
    assert (await preview(client, headers, "all", ["*"])).status_code == 200
    assert (await client.put("/api/v1/admin/access", headers=headers, json={
        "revision": 1, "target_type": "all", "target_ids": ["*"], "changes": [],
    })).status_code == 422
