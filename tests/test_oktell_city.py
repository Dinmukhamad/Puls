"""Oktell city missions require the operator's own server-validated practice."""

from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models.city import CityAward, CitySettings
from app.models.coin import CoinTransaction
from app.models.enums import Role
from app.services.city import default_missions, settings
from tests.conftest import auth, login, login_with_work_sites, make_user

pytestmark = pytest.mark.asyncio
CITY = "/api/v1/learning/city"
OKTELL = "/api/v1/learning/oktell"
REWARDS = {
    "oktell_ready": (75, 20, "welcome"),
    "oktell_call": (100, 40, "oktell_ready"),
    "oktell_message": (75, 30, "oktell_call"),
    "oktell_shift": (100, 40, "oktell_message"),
}


async def action(client, headers, name, **fields):
    response = await client.post(
        f"{OKTELL}/actions",
        headers=headers,
        json={"request_id": str(uuid4()), "action": name, **fields},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def claim(client, headers, key):
    return await client.post(
        f"{CITY}/missions/{key}/claim", headers=headers, json={"revision": 0}
    )


async def missions(client, headers):
    response = await client.get(CITY, headers=headers)
    assert response.status_code == 200, response.text
    return {
        row["key"]: row for row in response.json()["missions"] if row["district"] == "oktell"
    }


async def ready(client, headers):
    await action(client, headers, "login", login="6600", password="training")
    await action(client, headers, "join")
    return await action(client, headers, "phone_settings", web_phone=True, auto_answer=False)


async def complete_call(client, headers):
    started = await action(client, headers, "call_start", contact_id="supervisor")
    call_id = started["active_call"]["id"]
    await action(client, headers, "call_end")
    return await action(
        client, headers, "call_comment", call_id=call_id,
        comment="Учебный звонок завершён", tags=[],
    )


async def complete_message(client, headers):
    return await action(
        client, headers, "message", contact_id="supervisor", text="Учебная проверка связи"
    )


async def complete_shift(client, headers):
    await action(client, headers, "pause", reason="break")
    await action(client, headers, "resume")
    return await action(client, headers, "leave")


async def complete_training(client, headers):
    await ready(client, headers)
    await complete_call(client, headers)
    await complete_message(client, headers)
    return await complete_shift(client, headers)


async def test_oktell_district_is_open_but_reading_and_forged_progress_do_not_award(
    client, operator, session
):
    plain = auth(await login(client, operator.login))
    city = (await client.get(CITY, headers=plain)).json()
    district = next(row for row in city["districts"] if row["id"] == "oktell")
    assert district["soon"] is False
    assert city["xp"] == 0 and city["balance"] == 0
    assert (await client.get(OKTELL, headers=plain)).status_code == 403

    headers = auth(await login_with_work_sites(client, operator.login))
    state = (await client.get(OKTELL, headers=headers)).json()
    assert state["completed"] == []
    assert (await claim(client, headers, "welcome")).status_code == 200
    rows = await missions(client, headers)
    assert set(rows) == set(REWARDS)
    assert rows["oktell_ready"]["state"] == "available"
    assert all(row["current"] == 0 for row in rows.values())
    for key in REWARDS:
        assert (await claim(client, headers, key)).status_code == 409

    forged = await client.post(
        f"{OKTELL}/actions", headers=headers,
        json={"request_id": str(uuid4()), "action": "join", "completed": list(REWARDS)},
    )
    assert forged.status_code == 422, forged.text
    forged_claim = await client.post(
        f"{CITY}/missions/oktell_ready/claim", headers=headers,
        json={"revision": 0, "completed": True, "coins": 999},
    )
    assert forged_claim.status_code == 422, forged_claim.text
    assert (await client.get(OKTELL, headers=headers)).json()["completed"] == []
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0
    assert await session.scalar(
        select(func.count()).select_from(CityAward).where(CityAward.mission_key.in_(REWARDS))
    ) == 0


async def test_oktell_actions_unlock_the_mission_chain_and_pay_each_reward_once(
    client, operator, session
):
    headers = auth(await login_with_work_sites(client, operator.login))
    assert (await claim(client, headers, "welcome")).status_code == 200
    await action(client, headers, "login", login="6600", password="training")
    await action(client, headers, "join")
    assert (await claim(client, headers, "oktell_ready")).status_code == 409
    state = await action(client, headers, "phone_settings", web_phone=True, auto_answer=False)
    assert "oktell_ready" in state["completed"]

    # Completed work cannot bypass an unclaimed predecessor.
    started = await action(client, headers, "call_start", contact_id="supervisor")
    call_id = started["active_call"]["id"]
    assert (await claim(client, headers, "oktell_call")).status_code == 409
    await action(client, headers, "call_end")
    assert (await missions(client, headers))["oktell_call"]["current"] == 0
    await action(
        client, headers, "call_comment", call_id=call_id,
        comment="Учебный звонок завершён", tags=[],
    )
    assert (await missions(client, headers))["oktell_call"]["state"] == "locked"

    for key in ("oktell_ready", "oktell_call"):
        assert (await missions(client, headers))[key]["state"] == "ready"
        result = await claim(client, headers, key)
        assert result.status_code == 200, result.text
        assert result.json()["already_claimed"] is False
        assert (result.json()["xp"], result.json()["coins"]) == REWARDS[key][:2]

    assert (await claim(client, headers, "oktell_message")).status_code == 409
    await complete_message(client, headers)
    assert (await missions(client, headers))["oktell_message"]["state"] == "ready"
    message = await claim(client, headers, "oktell_message")
    assert message.status_code == 200, message.text
    assert (message.json()["xp"], message.json()["coins"]) == REWARDS["oktell_message"][:2]

    assert (await claim(client, headers, "oktell_shift")).status_code == 409
    await action(client, headers, "pause", reason="break")
    await action(client, headers, "resume")
    assert (await claim(client, headers, "oktell_shift")).status_code == 409
    state = await action(client, headers, "leave")
    assert set(state["completed"]) == set(REWARDS)
    assert (await missions(client, headers))["oktell_shift"]["state"] == "ready"
    shift = await claim(client, headers, "oktell_shift")
    assert shift.status_code == 200, shift.text
    assert (shift.json()["xp"], shift.json()["coins"]) == REWARDS["oktell_shift"][:2]

    for key in REWARDS:
        repeated = await claim(client, headers, key)
        assert repeated.status_code == 200 and repeated.json()["already_claimed"] is True
    city = (await client.get(CITY, headers=headers)).json()
    assert city["xp"] == 375 and city["balance"] == 130
    assert all(row["state"] == "completed" for row in (await missions(client, headers)).values())
    assert await session.scalar(select(func.count()).select_from(CityAward)) == 5
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 4


async def test_another_operators_oktell_evidence_cannot_unlock_own_missions(
    client, operator, session
):
    other = await make_user(session, login="oktell-other")
    other_headers = auth(await login_with_work_sites(client, other.login))
    state = await complete_training(client, other_headers)
    assert set(state["completed"]) == set(REWARDS)

    own = auth(await login_with_work_sites(client, operator.login))
    assert (await client.get(OKTELL, headers=own)).json()["completed"] == []
    assert (await claim(client, own, "welcome")).status_code == 200
    rows = await missions(client, own)
    assert all(row["current"] == 0 for row in rows.values())
    for key in REWARDS:
        assert (await claim(client, own, key)).status_code == 409
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0


@pytest.mark.parametrize("role", [Role.TRAINER, Role.SUPERVISOR, Role.HEAD, Role.ADMIN])
async def test_staff_can_practice_oktell_but_cannot_claim_city_rewards(
    client, session, role
):
    staff = await make_user(session, login="oktell-staff", role=role)
    headers = auth(await login(client, staff.login))
    state = await complete_training(client, headers)
    assert set(state["completed"]) == set(REWARDS)
    city = (await client.get(CITY, headers=headers)).json()
    assert city["preview"] and not city["can_claim"]
    assert city["xp"] == 0 and city["balance"] == 0
    assert all(row["current"] == 0 for row in (await missions(client, headers)).values())
    for key in REWARDS:
        assert (await claim(client, headers, key)).status_code == 403
    assert await session.scalar(select(func.count()).select_from(CityAward)) == 0
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0


async def test_oktell_defaults_merge_with_an_existing_saved_curriculum(session, head):
    saved = {key: value for key, value in default_missions().items() if key not in REWARDS}
    saved["driver_first"]["coins"] = 321
    saved["crm_first"]["enabled"] = False
    session.add(CitySettings(id=1, revision=7, missions=saved, updated_by_id=head.id))
    await session.commit()
    current = await settings(session)
    assert current["revision"] == 7
    assert current["missions"]["driver_first"]["coins"] == 321
    assert current["missions"]["crm_first"]["enabled"] is False
    for key, (xp, coins, parent) in REWARDS.items():
        mission = current["missions"][key]
        assert mission["enabled"] and mission["target"] == 1
        assert (mission["xp"], mission["coins"], mission["prerequisite"]) == (xp, coins, parent)


async def test_oktell_reset_keeps_earned_evidence_and_never_pays_a_second_time(
    client, operator, session
):
    headers = auth(await login_with_work_sites(client, operator.login))
    await complete_training(client, headers)
    reset = await action(client, headers, "reset")
    assert set(reset["completed"]) == set(REWARDS)
    assert (await claim(client, headers, "welcome")).status_code == 200
    for key in REWARDS:
        assert (await missions(client, headers))[key]["state"] == "ready"
        result = await claim(client, headers, key)
        assert result.status_code == 200 and not result.json()["already_claimed"]

    # Replaying a fresh cabinet and changing the browser session preserve the same awards.
    fresh = auth(await login_with_work_sites(client, operator.login))
    await complete_training(client, fresh)
    reset = await action(client, fresh, "reset")
    assert set(reset["completed"]) == set(REWARDS)
    for key in REWARDS:
        repeated = await claim(client, fresh, key)
        assert repeated.status_code == 200 and repeated.json()["already_claimed"] is True
    city = (await client.get(CITY, headers=fresh)).json()
    assert city["xp"] == 375 and city["balance"] == 130
    assert await session.scalar(select(func.count()).select_from(CityAward)) == 5
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 4
