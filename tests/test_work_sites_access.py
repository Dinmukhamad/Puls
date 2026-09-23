"""The QR unlock is session-bound, one-use, and enforced on all Work Sites APIs."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core.security import decode_token
from app.models.access import AccessRule
from app.models.enums import Role
from app.models.session import LoginSession
from app.models.settings import AuditLog
from app.models.work_sites_access import WorkSitesAccess
from app.services.sessions import secret_hash
from tests.conftest import auth, login, make_user

pytestmark = pytest.mark.asyncio
BASE = "/api/v1/work-sites-access"
CRM = "/api/v1/learning/crm"


async def issue(client, headers):
    result = await client.post(BASE + "/request", headers=headers)
    assert result.status_code == 200, result.text
    return {"payload": result.json()["payload"]}


async def test_only_work_sites_are_locked_and_all_crm_endpoints_require_qr(client, operator):
    headers = auth(await login(client, operator.login))
    state = await client.get(BASE + "/status", headers=headers)
    assert state.json() == {"required": True, "granted": False, "pending_until": None}
    assert state.headers["cache-control"] == "private, no-store"
    for method, path in [
        ("GET", CRM + "/catalog"),
        ("GET", CRM + "/appeals"),
        ("GET", CRM + "/appeals/1"),
        ("GET", CRM + "/attachments/1"),
        ("POST", CRM + "/appeals"),
    ]:
        response = await client.request(method, path, headers=headers)
        assert response.status_code == 403, response.text
        assert response.json()["code"] == "work_sites_qr_required"
    for path in ["/api/v1/auth/me", "/api/v1/me/access", "/api/v1/learning"]:
        assert (await client.get(path, headers=headers)).status_code == 200
    assert (await client.post(BASE + "/request")).status_code == 401


@pytest.mark.parametrize("role", [Role.TRAINER, Role.SUPERVISOR, Role.HEAD, Role.ADMIN])
async def test_every_non_operator_can_approve_but_preview_does_not_grant(
    client, session, operator, role
):
    # No group relationship is required: every non-operator can approve, as requested.
    staff = await make_user(session, login="approver", role=role)
    staff_headers = auth(await login(client, staff.login))
    state = (await client.get(BASE + "/status", headers=staff_headers)).json()
    assert state["granted"] is True and state["required"] is False
    assert (await client.get(CRM + "/catalog", headers=staff_headers)).status_code == 200
    # The scanner remains available even when the staff member's own training
    # permissions are restricted; it is a separate role capability.
    for section in ("training", "learning_admin"):
        session.add(
            AccessRule(target_type="user", target_id=str(staff.id), section=section, effect="deny")
        )
    await session.commit()
    operator_headers = auth(await login(client, operator.login))
    qr = await issue(client, operator_headers)
    row = await session.scalar(select(WorkSitesAccess))
    assert row.token_hash == secret_hash(qr["payload"].removeprefix("puls:work-sites:"))
    assert qr["payload"] not in row.token_hash
    preview = await client.post(BASE + "/preview", headers=staff_headers, json=qr)
    assert preview.status_code == 200, preview.text
    assert preview.json()["full_name"] == operator.full_name
    assert preview.json()["section"] == "Рабочие сайты"
    assert (await client.get(CRM + "/catalog", headers=operator_headers)).status_code == 403
    approved = await client.post(BASE + "/approve", headers=staff_headers, json=qr)
    assert approved.status_code == 200, approved.text
    assert (await client.get(CRM + "/catalog", headers=operator_headers)).status_code == 200
    assert (await client.post(BASE + "/approve", headers=staff_headers, json=qr)).status_code == 410
    assert (await client.post(BASE + "/preview", headers=staff_headers, json=qr)).status_code == 410
    audit = await session.scalar(select(AuditLog).where(AuditLog.action == "work_sites.approve"))
    assert audit.actor_id == staff.id and audit.entity_id == str(operator.id)
    assert qr["payload"] not in str(audit.payload)


async def test_operator_cannot_scan_or_approve_even_their_own_qr(client, operator):
    headers = auth(await login(client, operator.login))
    qr = await issue(client, headers)
    for action in ("preview", "approve"):
        assert (await client.post(BASE + "/" + action, headers=headers, json=qr)).status_code == 403
    assert (await client.get(BASE + "/status", headers=headers)).json()["granted"] is False


async def test_approval_survives_refresh_but_never_another_login_or_device(
    client, session, operator, head
):
    logged_in = (
        await client.post(
            "/api/v1/auth/login", data={"username": operator.login, "password": "password123"}
        )
    ).json()
    first = auth(logged_in["access_token"])
    second = auth(await login(client, operator.login))
    other = await make_user(session, login="other-operator")
    other_headers = auth(await login(client, other.login))
    staff = auth(await login(client, head.login))
    qr = await issue(client, first)
    forged = {**qr, "session_id": decode_token(second["Authorization"].split()[1], "access")["sid"]}
    assert (await client.post(BASE + "/approve", headers=staff, json=forged)).status_code == 422
    assert (await client.post(BASE + "/approve", headers=staff, json=qr)).status_code == 200
    for headers in (second, other_headers):
        assert (await client.get(CRM + "/catalog", headers=headers)).status_code == 403
    refreshed = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": logged_in["refresh_token"]}
    )
    assert refreshed.status_code == 200
    renewed = auth(refreshed.json()["access_token"])
    assert (await client.get(CRM + "/catalog", headers=renewed)).status_code == 200
    assert (await client.post("/api/v1/auth/logout", headers=renewed)).status_code in (200, 204)
    assert (await client.get(CRM + "/catalog", headers=renewed)).status_code == 401
    new_login = auth(await login(client, operator.login))
    assert (await client.get(CRM + "/catalog", headers=new_login)).status_code == 403


async def test_expired_replaced_and_logged_out_codes_cannot_be_approved(
    client, session, operator, head
):
    headers = auth(await login(client, operator.login))
    staff = auth(await login(client, head.login))
    qr = await issue(client, headers)
    assert (await client.post(BASE + "/request", headers=headers)).status_code == 429
    row = await session.scalar(select(WorkSitesAccess))
    row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    row.requested_at = datetime.now(UTC) - timedelta(minutes=6)
    await session.commit()
    assert (await client.post(BASE + "/preview", headers=staff, json=qr)).status_code == 410
    current = await issue(client, headers)
    assert current != qr
    assert (await client.post(BASE + "/approve", headers=staff, json=qr)).status_code == 410
    assert (await client.post(BASE + "/preview", headers=staff, json=current)).status_code == 200
    await client.post("/api/v1/auth/logout", headers=headers)
    assert (await client.post(BASE + "/approve", headers=staff, json=current)).status_code == 410
    assert (
        await client.post(
            BASE + "/preview", headers=staff, json={"payload": "https://elsewhere.test/"}
        )
    ).status_code == 422


async def test_qr_never_overrides_account_or_section_restrictions(client, session, operator, head):
    token = await login(client, operator.login)
    headers, staff = auth(token), auth(await login(client, head.login))
    qr = await issue(client, headers)
    restriction = AccessRule(
        target_type="user", target_id=str(operator.id), section="training", effect="deny"
    )
    session.add(restriction)
    await session.commit()
    for path in (CRM + "/catalog", BASE + "/status"):
        response = await client.get(path, headers=headers)
        assert response.status_code == 403 and response.json()["code"] == "section_denied"
    assert (await client.post(BASE + "/approve", headers=staff, json=qr)).status_code == 403
    await session.delete(restriction)
    operator.is_active = False
    await session.commit()
    assert (await client.post(BASE + "/approve", headers=staff, json=qr)).status_code == 410
    operator.is_active = True
    record = await session.get(LoginSession, decode_token(token, "access")["sid"])
    record.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await session.commit()
    assert (await client.post(BASE + "/preview", headers=staff, json=qr)).status_code == 410
