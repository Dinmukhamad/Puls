from copy import deepcopy

import pytest
from sqlalchemy import func, select

from app.models.city import CityWorld
from app.models.coin import CoinTransaction
from app.models.enums import Role
from app.services.city_world import defaults
from tests.conftest import auth, login, make_group, make_user

pytestmark = pytest.mark.asyncio
BASE = "/api/v1/learning/city/world"
ADMIN = "/api/v1/admin/learning/city/world"


async def test_world_read_is_private_and_has_two_cities_without_awards(client, operator, session):
    h = auth(await login(client, operator.login))
    r = await client.get(BASE, headers=h)
    assert r.status_code == 200 and r.headers["cache-control"] == "private, no-store"
    data = r.json()
    assert [c["id"] for c in data["cities"]] == ["support", "sales"]
    assert all(len(c["districts"]) == 3 for c in data["cities"])
    assert data["home_city"] is None and data["currency"] == "coins"
    assert "group_ids" not in str(data) and "balance" not in data
    assert not data["can_edit"]
    assert await session.scalar(select(func.count()).select_from(CityWorld)) == 0
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0


async def test_head_can_rename_without_changing_ids_and_stale_save_conflicts(client, head):
    h = auth(await login(client, head.login))
    body = {"revision": 0, "cities": defaults()}
    body["cities"][0]["name"] = "  Забота о клиентах  "
    r = await client.put(ADMIN, headers=h, json=body)
    assert r.status_code == 200, r.text
    assert r.json()["cities"][0]["name"] == "Забота о клиентах"
    assert r.json()["cities"][0]["id"] == "support"
    assert (await client.put(ADMIN, headers=h, json=body)).status_code == 409
    assert (await client.get(BASE, headers=h)).json()["cities"][0]["name"] == "Забота о клиентах"


async def test_only_head_and_admin_can_change_world(client, operator, session):
    for role in [Role.OPERATOR, Role.TRAINER, Role.SUPERVISOR]:
        user = operator if role == Role.OPERATOR else await make_user(session, login=f"world-{role}", role=role)
        h = auth(await login(client, user.login))
        assert (await client.put(ADMIN, headers=h, json={"revision": 0, "cities": defaults()})).status_code == 403


async def test_group_assignment_sets_home_and_preserves_user_group(client, head, supervisor, operator, session):
    h = auth(await login(client, head.login))
    body = {"revision": 0, "cities": defaults()}
    body["cities"][1]["districts"][0]["group_ids"] = [operator.group_id]
    r = await client.put(ADMIN, headers=h, json=body)
    assert r.status_code == 200, r.text
    data = (await client.get(BASE, headers=auth(await login(client, operator.login)))).json()
    assert data["home_city"] == "sales" and data["home_district"] == "sales-team-1"
    assert data["cities"][1]["districts"][0]["supervisor"] == supervisor.full_name
    assert data["cities"][1]["districts"][0]["mine"]


async def test_duplicate_group_and_wrong_district_ids_rejected(client, head, supervisor, operator):
    h = auth(await login(client, head.login))
    for mode in ["duplicate-group", "wrong-city", "markup", "blank"]:
        body = {"revision": 0, "cities": defaults()}
        if mode == "duplicate-group":
            for c in body["cities"]:
                c["districts"][0]["group_ids"] = [operator.group_id]
        elif mode == "wrong-city":
            body["cities"][0]["districts"][0]["id"] = "sales-team-4"
        else:
            body["cities"][0]["name"] = "<script>" if mode == "markup" else "  "
        assert (await client.put(ADMIN, headers=h, json=body)).status_code == 422


async def test_mixed_supervisors_and_removing_existing_district_rejected(client, head, supervisor, operator, session):
    other = await make_user(session, login="world-supervisor", role=Role.SUPERVISOR)
    group = await make_group(session, code="other", supervisor_id=other.id)
    h = auth(await login(client, head.login))
    body = {"revision": 0, "cities": defaults()}
    body["cities"][0]["districts"][0]["group_ids"] = [operator.group_id, group.id]
    assert (await client.put(ADMIN, headers=h, json=body)).status_code == 400
    body = {"revision": 0, "cities": defaults()}
    body["cities"][0]["districts"][0]["id"] = "support-team-4"
    assert (await client.put(ADMIN, headers=h, json=body)).status_code == 400


async def test_district_expansion_keeps_existing_keys_and_does_not_write_coins(client, head, session):
    h = auth(await login(client, head.login))
    body = {"revision": 0, "cities": defaults()}
    before = deepcopy(body["cities"][0]["districts"])
    body["cities"][0]["districts"].append({"id": "support-team-4", "name": "Новая команда", "group_ids": []})
    r = await client.put(ADMIN, headers=h, json=body)
    assert r.status_code == 200, r.text
    assert r.json()["cities"][0]["districts"][:3] == before
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0
