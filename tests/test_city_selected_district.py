"""Do not apply plot coordinates to a different district after an operator changes teams."""

import pytest
from sqlalchemy import func, select

from app.models.city_estate import CityCell, CityObject, CityOperation
from app.models.coin import CoinTransaction
from app.models.enums import Role
from app.models.user import CoinAccount
from app.services.city_estate import fingerprint
from tests.conftest import auth, login, make_group, make_user
from tests.test_city_estate import (
    CITY,
    FIRST,
    buy,
    estate,
    fund,
    key,
    open_world,
)

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def selected_team(client, session, head, supervisor, operator):
    admin = await make_user(session, login="selected-district-admin", role=Role.ADMIN)
    await open_world(client, admin, head, support=[operator.group_id])
    await fund(session, operator.id, 2000)
    return admin, operator


@pytest.mark.parametrize("action", ["purchase", "place"])
async def test_transfer_rejects_old_selected_district_before_charging_or_placing(
    client, session, selected_team, head, action
):
    estate_admin, team = selected_team
    me = auth(await login(client, team.login))
    bought = await buy(client, me, "house", FIRST, 0, 0)
    assert bought.status_code == 200, bought.text
    old_object = bought.json()["object"]
    sales_sv = await make_user(session, login="selected-district-sv", role=Role.SUPERVISOR)
    sales_group = await make_group(
        session, code="selected-district-sales", supervisor_id=sales_sv.id
    )
    await open_world(
        client,
        estate_admin,
        head,
        support=[team.group_id],
        sales=[sales_group.id],
        construction=("support-team-1", "sales-team-1"),
    )
    staff = auth(await login(client, estate_admin.login))
    moved = await client.patch(
        f"/api/v1/admin/users/{team.id}", headers=staff, json={"group_id": sales_group.id}
    )
    assert moved.status_code == 200, moved.text
    current = await estate(client, me)
    assert current["district"]["id"] == "sales-team-1"
    stored = next(o for o in current["objects"] if o["id"] == old_object["id"])
    assert stored["state"] == "stored"
    account = await session.get(CoinAccount, team.id, populate_existing=True)
    money_before = (account.balance, account.reserved, account.total_earned, account.total_spent)
    transactions_before = await session.scalar(select(func.count()).select_from(CoinTransaction))
    objects_before = await session.scalar(select(func.count()).select_from(CityObject))
    assert await session.scalar(select(func.count()).select_from(CityCell)) == 0
    operation_key = key()
    body = {
        "key": operation_key,
        "district_id": "support-team-1",  # The plot preview still belongs to the old team.
        "block": 6,
        "col": 0,
        "row": 0,
    }
    if action == "purchase":
        url = CITY + "/plots"
        body.update(family="house", economy_revision=0)
    else:
        url = f"{CITY}/buildings/{stored['id']}/place"
        body.update(version=stored["version"], rotation=0)
    refused = await client.post(url, headers=me, json=body)
    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "district_changed"
    account = await session.get(CoinAccount, team.id, populate_existing=True)
    assert (account.balance, account.reserved, account.total_earned, account.total_spent) == (
        money_before
    )
    assert (
        await session.scalar(select(func.count()).select_from(CoinTransaction))
        == transactions_before
    )
    assert await session.scalar(select(func.count()).select_from(CityObject)) == objects_before
    assert await session.scalar(select(func.count()).select_from(CityCell)) == 0
    assert (
        await session.scalar(select(CityOperation).where(CityOperation.key == operation_key))
        is None
    )
    retained = await session.get(CityObject, stored["id"], populate_existing=True)
    assert retained.state == "stored" and retained.version == stored["version"]
    # Re-selecting the current district makes the same valid coordinates usable.
    body["district_id"] = "sales-team-1"
    accepted = await client.post(url, headers=me, json=body)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["object"]["district_id"] == "sales-team-1"
    assert accepted.json()["object"]["module"] == 6
    if action == "place":
        assert accepted.json()["balance"] == money_before[0]


@pytest.mark.parametrize("action", ["purchase", "place"])
async def test_older_requests_replay_their_pre_guard_operation_fingerprint(
    client, session, operator, action
):
    me = auth(await login(client, operator.login))
    operation_key = key()
    payload = {"block": FIRST, "col": 0, "row": 0}
    if action == "purchase":
        url = CITY + "/plots"
        payload.update(family="house", economy_revision=0)
        original_request = payload
    else:
        url = f"{CITY}/buildings/123/place"
        payload.update(version=2, rotation=0)
        original_request = {"id": 123, **payload}
    # The historical request has no district_id field, as in operations saved before this release.
    result = {"object": {"id": 123, "district_id": "support-team-1"}, "balance": 0}
    session.add(
        CityOperation(
            user_id=operator.id,
            key=operation_key,
            kind=action,
            fingerprint=fingerprint(action, original_request),
            result=result,
        )
    )
    await session.commit()
    replay = await client.post(url, headers=me, json={"key": operation_key, **payload})
    assert replay.status_code == 200, replay.text
    assert replay.json() == {**result, "replayed": True}
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0
    assert await session.scalar(select(func.count()).select_from(CityCell)) == 0
