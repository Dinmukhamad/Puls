"""Oktell stays available while its curriculum and new rewards are deferred."""

from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models.city import CityAward, CitySettings
from app.models.coin import CoinTransaction
from app.models.enums import Role, TxType
from app.services.city import default_missions, settings
from app.services.coins import post_transaction
from tests.conftest import auth, login, login_with_work_sites, make_user

pytestmark = pytest.mark.asyncio
CITY = "/api/v1/learning/city"
ADMIN = "/api/v1/admin/learning/city"
OKTELL = "/api/v1/learning/oktell"
# Snapshots from the previous curriculum: they must neither reactivate missions
# nor cause historical balances and experience to be rewritten.
LEGACY_MISSIONS = {
    key: {
        "title": f"Oktell: {key}",
        "description": "Прежнее упражнение Oktell",
        "pulsar": "Прежняя подсказка к упражнению",
        "target": 1,
        "xp": xp,
        "coins": coins,
        "prerequisite": parent,
        "enabled": True,
    }
    for key, xp, coins, parent in [
        ("oktell_ready", 75, 20, "welcome"),
        ("oktell_call", 100, 40, "oktell_ready"),
        ("oktell_message", 75, 30, "oktell_call"),
        ("oktell_shift", 100, 40, "oktell_message"),
    ]
}


async def action(client, headers, name, **fields):
    response = await client.post(
        f"{OKTELL}/actions",
        headers=headers,
        json={"request_id": str(uuid4()), "action": name, **fields},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def claim(client, headers, key, revision=0):
    return await client.post(
        f"{CITY}/missions/{key}/claim", headers=headers, json={"revision": revision}
    )


async def dashboard(client, headers):
    response = await client.get(CITY, headers=headers)
    assert response.status_code == 200, response.text
    data = response.json()
    assert not any(row["district"] == "oktell" for row in data["missions"])
    assert not any(row["key"].startswith("oktell_") for row in data["missions"])
    return data


async def use_workspace(client, headers):
    """Real workspace actions remain usable independently of city missions."""
    await action(client, headers, "login", login="6600", password="training")
    await action(client, headers, "join")
    await action(client, headers, "phone_settings", web_phone=True, auto_answer=False)
    started = await action(client, headers, "call_start", contact_id="supervisor")
    call_id = started["active_call"]["id"]
    await action(client, headers, "call_end")
    await action(
        client, headers, "call_comment", call_id=call_id,
        comment="Проверка связи завершена", tags=[],
    )
    await action(
        client, headers, "message", contact_id="supervisor", text="Проверка связи"
    )
    await action(client, headers, "pause", reason="break")
    await action(client, headers, "resume")
    return await action(client, headers, "leave")


async def test_oktell_workspace_stays_open_without_active_missions_or_new_rewards(
    client, operator, session
):
    plain = auth(await login(client, operator.login))
    city = await dashboard(client, plain)
    district = next(row for row in city["districts"] if row["id"] == "oktell")
    assert district["soon"] is False
    assert district["completed_missions"] == 0
    assert city["xp"] == 0 and city["balance"] == 0
    blocked = await client.get(OKTELL, headers=plain)
    assert blocked.status_code == 403 and blocked.json()["code"] == "work_sites_qr_required"

    headers = auth(await login_with_work_sites(client, operator.login))
    assert (await client.get(OKTELL, headers=headers)).status_code == 200
    state = await use_workspace(client, headers)
    assert state["calls"][0]["comment"] == "Проверка связи завершена"
    assert state["messages"][0]["text"] == "Проверка связи"
    assert not state["center_joined"] and state["metrics"]["calls"] == 1
    for key in LEGACY_MISSIONS:
        assert (await claim(client, headers, key)).status_code == 404
    city = await dashboard(client, headers)
    assert city["xp"] == 0 and city["balance"] == 0

    await action(client, headers, "reset")
    await use_workspace(client, headers)
    assert (await dashboard(client, headers))["xp"] == 0
    assert await session.scalar(select(func.count()).select_from(CityAward)) == 0
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0


async def test_saved_oktell_curriculum_cannot_restore_missions_or_block_other_routes(
    client, session, operator, head
):
    saved = {**default_missions(), **deepcopy(LEGACY_MISSIONS)}
    saved["driver_first"]["coins"] = 321
    saved["crm_first"]["prerequisite"] = "oktell_ready"
    session.add(CitySettings(id=1, revision=7, missions=saved, updated_by_id=head.id))
    await session.commit()

    current = await settings(session)
    assert current["revision"] == 7
    assert not set(current["missions"]) & set(LEGACY_MISSIONS)
    assert current["missions"]["driver_first"]["coins"] == 321
    assert current["missions"]["crm_first"]["prerequisite"] is None
    assert not set(default_missions()) & set(LEGACY_MISSIONS)
    headers = auth(await login_with_work_sites(client, operator.login))
    await use_workspace(client, headers)
    city = await dashboard(client, headers)
    assert city["revision"] == 7 and city["xp"] == 0 and city["balance"] == 0
    for key in LEGACY_MISSIONS:
        assert (await claim(client, headers, key, revision=7)).status_code == 404
    staff = auth(await login(client, head.login))
    editor = await client.get(f"{ADMIN}/settings", headers=staff)
    assert editor.status_code == 200, editor.text
    assert not set(editor.json()["missions"]) & set(LEGACY_MISSIONS)
    assert await session.scalar(select(func.count()).select_from(CityAward)) == 0
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0


async def test_editor_cannot_reintroduce_deferred_oktell_missions(client, head):
    headers = auth(await login(client, head.login))
    config = {"revision": 0, "missions": {**default_missions(), **deepcopy(LEGACY_MISSIONS)}}
    response = await client.put(f"{ADMIN}/settings", headers=headers, json=config)
    assert response.status_code == 422, response.text
    current = (await client.get(f"{ADMIN}/settings", headers=headers)).json()
    assert current["revision"] == 0
    assert not set(current["missions"]) & set(LEGACY_MISSIONS)


async def test_historical_oktell_awards_keep_their_experience_and_coins(
    client, session, operator
):
    for key, snapshot in LEGACY_MISSIONS.items():
        session.add(CityAward(
            user_id=operator.id, mission_key=key, snapshot=deepcopy(snapshot),
            xp=snapshot["xp"], coins=snapshot["coins"],
        ))
        await post_transaction(
            session, user_id=operator.id, amount=snapshot["coins"],
            tx_type=TxType.LEARNING_REWARD, reason=snapshot["title"],
            idempotency_key=f"city:{operator.id}:{key}", meta={"mission": key},
        )
    await session.commit()
    headers = auth(await login_with_work_sites(client, operator.login))
    city = await dashboard(client, headers)
    assert city["xp"] == 350 and city["balance"] == 130
    assert next(row for row in city["districts"] if row["id"] == "oktell")[
        "completed_missions"
    ] == 4
    for key in LEGACY_MISSIONS:
        assert (await claim(client, headers, key)).status_code == 404

    await use_workspace(client, headers)
    await action(client, headers, "reset")
    fresh = auth(await login_with_work_sites(client, operator.login))
    await use_workspace(client, fresh)
    city = await dashboard(client, fresh)
    assert city["xp"] == 350 and city["balance"] == 130
    assert next(row for row in city["districts"] if row["id"] == "oktell")[
        "completed_missions"
    ] == 4
    assert await session.scalar(select(func.count()).select_from(CityAward)) == 4
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 4
    for key, snapshot in LEGACY_MISSIONS.items():
        award = await session.get(CityAward, (operator.id, key), populate_existing=True)
        assert award.snapshot == snapshot
        assert (award.xp, award.coins) == (snapshot["xp"], snapshot["coins"])

    admin = await make_user(session, login="oktell-history-admin", role=Role.ADMIN)
    staff = auth(await login(client, admin.login))
    preview = await dashboard(client, staff)
    assert next(row for row in preview["districts"] if row["id"] == "oktell")[
        "completed_missions"
    ] == 0
    inspected = await client.get(f"{ADMIN}/operators/{operator.id}", headers=staff)
    assert inspected.status_code == 200, inspected.text
    assert inspected.json()["inspecting"] and not inspected.json()["can_claim"]
    assert next(row for row in inspected.json()["districts"] if row["id"] == "oktell")[
        "completed_missions"
    ] == 4
    report = (await client.get(f"{ADMIN}/participants", headers=staff)).json()
    item = next(row for row in report["items"] if row["user_id"] == operator.id)
    assert item["xp"] == 350
    assert not any(row["key"].startswith("oktell_") for row in item["missions"])


@pytest.mark.parametrize("role", [Role.TRAINER, Role.SUPERVISOR, Role.HEAD, Role.ADMIN])
async def test_staff_workspace_preview_has_no_oktell_curriculum_or_rewards(
    client, session, role
):
    staff = await make_user(session, login="oktell-staff", role=role)
    headers = auth(await login(client, staff.login))
    assert (await client.get(OKTELL, headers=headers)).status_code == 200
    await action(client, headers, "login", login="6600", password="training")
    city = await dashboard(client, headers)
    assert city["preview"] and not city["can_claim"]
    assert city["xp"] == 0 and city["balance"] == 0
    assert next(row for row in city["districts"] if row["id"] == "oktell")[
        "completed_missions"
    ] == 0
    for key in LEGACY_MISSIONS:
        assert (await claim(client, headers, key)).status_code == 403
    assert await session.scalar(select(func.count()).select_from(CityAward)) == 0
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0
