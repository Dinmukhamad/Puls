import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.db.base import utcnow
from app.models.access import AccessRule
from app.models.city import CityAward
from app.models.coin import CoinTransaction
from app.models.crm import CrmAppeal
from app.models.driver import DriverOrder, DriverProfile
from app.models.driver_shift import DriverShift
from app.models.enums import Role
from app.models.user import CoinAccount
from app.services.city import default_missions
from app.services.crm_catalog import default_categories
from tests.conftest import auth, login, make_user

pytestmark = pytest.mark.asyncio
BASE = "/api/v1/learning/city"
ADMIN = "/api/v1/admin/learning/city"


async def claim(client, headers, key, revision=0):
    return await client.post(
        f"{BASE}/missions/{key}/claim", headers=headers, json={"revision": revision}
    )


async def order(session, user_id, *, stage="complete", preview=False):
    shift_id = None
    if preview:
        shift_id = str(uuid4())
        session.add(
            DriverShift(
                id=shift_id,
                user_id=user_id,
                mode="free",
                config={},
                data={},
                events=[],
                is_preview=True,
            )
        )
        await session.flush()
    session.add(
        DriverOrder(
            id=str(uuid4()),
            user_id=user_id,
            shift_id=shift_id,
            stage=stage,
            origin="A",
            destination="B",
            payment="card",
            fare=1000,
            commission=10,
            park={},
            events=[],
            finished_at=utcnow() if stage == "complete" else None,
        )
    )
    await session.commit()


async def appeal(session, user_id, *, phone=False, ticket=False, status="recorded"):
    categories = (
        [n["id"] for n in default_categories() if "phone_change" in n["rules"]][:1] if phone else []
    )
    row = CrmAppeal(
        request_id=str(uuid4()),
        author_id=user_id,
        author_name="Operator",
        channel="Звонок",
        phone="+77001234567",
        license_number="123",
        contacted_at=utcnow(),
        park="Park",
        city="City",
        category_ids=categories,
        category_labels=[],
        details={},
        comment="Validated at creation",
        is_ticket=ticket,
        status=status,
    )
    session.add(row)
    await session.commit()
    return row


async def test_city_reads_never_award_and_server_rejects_forged_progress(client, operator, session):
    headers = auth(await login(client, operator.login))
    result = (await client.get(BASE, headers=headers)).json()
    assert result["xp"] == 0 and result["balance"] == 0
    assert result["missions"][0]["state"] == "ready"
    assert (await claim(client, headers, "driver_five")).status_code == 409
    assert (await claim(client, headers, "missing")).status_code == 404
    forged = await client.post(
        BASE + "/missions/welcome/claim",
        headers=headers,
        json={"revision": 0, "coins": 999, "user_id": operator.id},
    )
    assert forged.status_code == 422
    assert await session.scalar(select(func.count()).select_from(CityAward)) == 0
    assert (await client.get(BASE)).status_code == 401
    assert (await client.get(ADMIN + "/participants", headers=headers)).status_code == 403


async def test_real_driver_chain_ignores_foreign_cancelled_and_preview_orders(
    client, operator, session
):
    headers = auth(await login(client, operator.login))
    other = await make_user(session, login="other")
    await order(session, other.id)
    await order(session, operator.id, stage="cancelled")
    await order(session, operator.id, preview=True)
    await claim(client, headers, "welcome")
    assert (await claim(client, headers, "driver_profile")).status_code == 409
    session.add(DriverProfile(user_id=operator.id, stage="offline"))
    await session.commit()
    assert (await claim(client, headers, "driver_profile")).status_code == 200
    assert (await claim(client, headers, "driver_first")).status_code == 409
    await order(session, operator.id)
    assert (await claim(client, headers, "driver_first")).status_code == 200
    for _ in range(3):
        await order(session, operator.id)
    assert (await claim(client, headers, "driver_five")).status_code == 409
    await order(session, operator.id)
    assert (await claim(client, headers, "driver_five")).status_code == 200
    assert (await claim(client, headers, "driver_five")).json()["already_claimed"] is True
    result = (await client.get(BASE, headers=headers)).json()
    assert result["xp"] == 470 and result["balance"] == 180 and result["level"] == 2
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 3


async def test_crm_chain_requires_own_category_and_staff_closed_ticket(client, operator, session):
    headers = auth(await login(client, operator.login))
    other = await make_user(session, login="other")
    await appeal(session, other.id, phone=True, ticket=True, status="closed")
    await claim(client, headers, "welcome")
    assert (await claim(client, headers, "crm_first")).status_code == 409
    await appeal(session, operator.id)
    assert (await claim(client, headers, "crm_first")).status_code == 200
    assert (await claim(client, headers, "crm_phone")).status_code == 409
    ticket = await appeal(session, operator.id, phone=True, ticket=True, status="new")
    assert (await claim(client, headers, "crm_phone")).status_code == 200
    assert (await claim(client, headers, "crm_closed")).status_code == 409
    staff = await make_user(session, login="trainer", role=Role.TRAINER)
    staff_headers = auth(await login(client, staff.login))
    response = await client.patch(
        f"/api/v1/admin/learning/crm/appeals/{ticket.id}/status",
        headers=staff_headers,
        json={"status": "closed"},
    )
    assert response.status_code == 200, response.text
    assert (await claim(client, headers, "crm_closed")).status_code == 200
    result = (await client.get(BASE, headers=headers)).json()
    assert result["xp"] == 505 and result["balance"] == 210


async def test_concurrent_claims_and_session_changes_do_not_duplicate_rewards(
    client, operator, session
):
    headers = auth(await login(client, operator.login))
    await claim(client, headers, "welcome")
    await order(session, operator.id)
    responses = await asyncio.gather(*[claim(client, headers, "driver_profile") for _ in range(2)])
    assert [r.status_code for r in responses] == [200, 200]
    assert sorted(r.json()["already_claimed"] for r in responses) == [False, True]
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 1
    assert (await session.get(CoinAccount, operator.id)).balance == 20
    second_session = auth(await login(client, operator.login))
    assert (await claim(client, second_session, "driver_profile")).json()["already_claimed"] is True


@pytest.mark.parametrize("role", [Role.TRAINER, Role.SUPERVISOR, Role.HEAD, Role.ADMIN])
async def test_staff_preview_reporting_and_editing_roles(client, session, operator, role):
    staff = await make_user(session, login="staff", role=role)
    headers = auth(await login(client, staff.login))
    data = (await client.get(BASE, headers=headers)).json()
    assert data["preview"] and not data["can_claim"] and data["xp"] == 0
    assert (await claim(client, headers, "welcome")).status_code == 403
    assert (await client.get(ADMIN + "/participants", headers=headers)).json()["total"] == 1
    detail = (await client.get(f"{ADMIN}/operators/{operator.id}", headers=headers)).json()
    assert detail["inspecting"] and not detail["can_claim"]
    config = {"revision": 0, "missions": default_missions()}
    result = await client.put(ADMIN + "/settings", headers=headers, json=config)
    assert result.status_code == (403 if role == Role.SUPERVISOR else 200), result.text


async def test_settings_revision_cycles_disabled_missions_and_award_snapshot(
    client, session, operator, head
):
    h = auth(await login(client, head.login))
    op = auth(await login(client, operator.login))
    await claim(client, op, "welcome")
    config = {"revision": 0, "missions": default_missions()}
    config["missions"]["driver_profile"]["prerequisite"] = "driver_first"
    assert (await client.put(ADMIN + "/settings", headers=h, json=config)).status_code == 422
    config["missions"] = default_missions()
    config["missions"]["welcome"]["xp"] = 500
    config["missions"]["driver_profile"]["enabled"] = False
    assert (await client.put(ADMIN + "/settings", headers=h, json=config)).status_code == 200
    assert (await client.put(ADMIN + "/settings", headers=h, json=config)).status_code == 409
    await order(session, operator.id)
    assert (await claim(client, op, "driver_first", 0)).status_code == 409
    assert (await claim(client, op, "driver_profile", 1)).status_code == 409
    assert (await claim(client, op, "driver_first", 1)).status_code == 200
    assert (await client.get(BASE, headers=op)).json()["xp"] == 145
    saved = await session.get(CityAward, (operator.id, "welcome"))
    assert saved.snapshot["xp"] == 25


async def test_city_respects_section_restrictions_and_does_not_open_crm(client, session, operator):
    headers = auth(await login(client, operator.login))
    assert (await claim(client, headers, "welcome")).status_code == 200
    blocked = await client.get("/api/v1/learning/crm/catalog", headers=headers)
    assert blocked.status_code == 403 and blocked.json()["code"] == "work_sites_qr_required"
    session.add(
        AccessRule(
            target_type="user", target_id=str(operator.id), section="training", effect="deny"
        )
    )
    await session.commit()
    assert (await client.get(BASE, headers=headers)).status_code == 403
    assert (await claim(client, headers, "driver_first")).status_code == 403


async def test_active_order_is_in_progress_but_cannot_earn_a_completion_reward(
    client, session, operator
):
    headers = auth(await login(client, operator.login))
    await claim(client, headers, "welcome")
    await order(session, operator.id, stage="pickup")
    assert (await claim(client, headers, "driver_profile")).status_code == 200
    data = (await client.get(BASE, headers=headers)).json()
    first = next(m for m in data["missions"] if m["key"] == "driver_first")
    assert first["state"] == "in_progress" and first["current"] == 0
    assert (await claim(client, headers, "driver_first")).status_code == 409
