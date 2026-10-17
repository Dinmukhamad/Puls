"""Fixed proof goals coexist with historical awards and trainer-authored instructions."""

from copy import deepcopy

import pytest
from sqlalchemy import func, select

from app.models.city import CityAward, CitySettings
from app.models.coin import CoinTransaction
from app.models.enums import Role
from app.services.city import default_missions, settings
from tests.conftest import auth, login, make_user

pytestmark = pytest.mark.asyncio


async def test_old_crm_count_targets_normalize_without_overwriting_custom_rules(session, head):
    missions = default_missions()
    for key in ("crm_first", "crm_phone", "crm_closed"):
        missions[key].update(
            target=8,
            coins=321,
            xp=654,
            description="Своя инструкция тренера",
            pulsar="Своя подробная подсказка",
        )
    missions["driver_first"]["target"] = 3
    row = CitySettings(id=1, revision=7, missions=deepcopy(missions), updated_by_id=head.id)
    session.add(row)
    await session.commit()
    current = await settings(session)
    assert current["revision"] == 7
    for key in ("crm_first", "crm_phone", "crm_closed"):
        assert current["missions"][key] == {**missions[key], "target": 1}
    assert current["missions"]["driver_first"]["target"] == 3
    await session.refresh(row)
    assert row.missions["crm_first"]["target"] == 8  # A projection is not an administrative edit.


async def test_config_rejects_new_crm_count_targets_but_keeps_other_missions_editable(
    client, session
):
    trainer = await make_user(session, login="crm-goal-editor", role=Role.TRAINER)
    headers = auth(await login(client, trainer.login))
    missions = default_missions()
    missions["crm_phone"]["target"] = 2
    rejected = await client.put(
        "/api/v1/admin/learning/city/settings",
        headers=headers,
        json={"revision": 0, "missions": missions},
    )
    assert rejected.status_code == 422, rejected.text
    assert "CRM" in rejected.text
    missions["crm_phone"]["target"] = 1
    missions["driver_first"]["target"] = 2
    accepted = await client.put(
        "/api/v1/admin/learning/city/settings",
        headers=headers,
        json={"revision": 0, "missions": missions},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["missions"]["driver_first"]["target"] == 2


async def test_legacy_award_snapshot_survives_fixed_training_goal(client, session, operator):
    legacy = {**default_missions()["crm_first"], "target": 8, "coins": 91, "xp": 123}
    session.add(
        CityAward(user_id=operator.id, mission_key="crm_first", snapshot=legacy, coins=91, xp=123)
    )
    await session.commit()
    headers = auth(await login(client, operator.login))
    city = await client.get("/api/v1/learning/city", headers=headers)
    assert city.status_code == 200, city.text
    mission = next(item for item in city.json()["missions"] if item["key"] == "crm_first")
    assert mission["state"] == "completed"
    assert mission["target"] == mission["current"] == 8
    assert mission["coins"] == 91 and mission["xp"] == 123
    claim = await client.post(
        "/api/v1/learning/city/missions/crm_first/claim", headers=headers, json={"revision": 0}
    )
    assert claim.status_code == 200, claim.text
    assert claim.json()["already_claimed"] is True
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0
