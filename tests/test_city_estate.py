import asyncio
import json
from uuid import uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from app.models.city_estate import CityCell, CityContribution, CityEvent, CityLot, CityObject
from app.models.coin import CoinTransaction
from app.models.enums import Role, TxType
from app.models.progress import Notification
from app.models.user import CoinAccount
from app.services.coins import post_transaction
from tests.conftest import auth, login, make_group, make_user

pytestmark = pytest.mark.asyncio
CITY = "/api/v1/learning/city"
ADMIN = "/api/v1/admin/learning/city"
# The first estate given away: module 2, index 7, house rows from v = 8, garden rows from v = 10.
HOUSE = (2, 4, 8)


def key():
    return uuid4().hex


async def fund(session, user_id, amount):
    await post_transaction(
        session, user_id=user_id, amount=amount, tx_type=TxType.MANUAL_CREDIT, reason="Тест"
    )
    await session.commit()


async def open_world(client, head, *, support=(), sales=(), construction=("support-team-1",)):
    """Assigns groups to the first district of each city and opens construction where asked."""
    h = auth(await login(client, head.login))
    current = (await client.get(ADMIN + "/world", headers=h)).json()
    body = {"revision": current["revision"], "cities": current["cities"]}
    for city, groups in (("support", support), ("sales", sales)):
        next(c for c in body["cities"] if c["id"] == city)["districts"][0]["group_ids"] = list(
            groups
        )
    for c in body["cities"]:
        for d in c["districts"]:
            d["construction"] = d["id"] in construction
    r = await client.put(ADMIN + "/world", headers=h, json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def estate(client, h):
    r = await client.get(CITY + "/estate", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


async def claim(client, h):
    r = await client.post(CITY + "/estate", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


async def buy(client, h, family, module, u, v, rotation=0, *, revision=0, op=None):
    return await client.post(
        CITY + "/buildings",
        headers=h,
        json={
            "key": op or key(),
            "family": family,
            "module": module,
            "u": u,
            "v": v,
            "rotation": rotation,
            "economy_revision": revision,
        },
    )


async def change(client, h, obj, action, **body):
    return await client.post(
        f"{CITY}/buildings/{obj['id']}/{action}", headers=h, json={"key": key(), **body}
    )


async def spent(session, tx_type=TxType.CITY_BUILD):
    rows = await session.scalars(
        select(CoinTransaction.amount).where(CoinTransaction.tx_type == tx_type)
    )
    return list(rows)


async def district_view(client, h, city="support", district="support-team-1"):
    r = await client.get(f"{CITY}/cities/{city}", headers=h)
    assert r.status_code == 200, r.text
    return next(d for d in r.json()["districts"] if d["id"] == district)


@pytest.fixture
async def team(client, session, head, supervisor, operator):
    await open_world(client, head, support=[operator.group_id])
    await fund(session, operator.id, 2000)
    return operator


async def test_construction_waits_for_the_pilot_and_staff_never_build(
    client, session, head, supervisor, operator
):
    me = auth(await login(client, operator.login))
    assert (await estate(client, me))["status"] == "no_team"
    await open_world(client, head, support=[operator.group_id], construction=())
    data = await estate(client, me)
    assert data["status"] == "closed" and data["district"]["id"] == "support-team-1"
    families = {c["family"]: c for c in data["catalogue"]}
    assert set(families) == {"square", "gazebo", "fountain", "sports", "park", "house", "tower"}
    assert [lv["price"] for lv in families["house"]["levels"]] == [120, 180, 260, 360, 500]
    assert [lv["name"] for lv in families["tower"]["levels"]][-1] == "200 этажей"
    r = await client.post(CITY + "/estate", headers=me)
    assert r.status_code == 409 and r.json()["code"] == "construction_closed"
    await fund(session, operator.id, 500)
    assert (await buy(client, me, "house", *HOUSE)).status_code == 409
    trainer = await make_user(session, login="trainer-estate", role=Role.TRAINER)
    t = auth(await login(client, trainer.login))
    assert (await estate(client, t))["status"] == "staff"
    await open_world(client, head, support=[operator.group_id])
    assert (await client.post(CITY + "/estate", headers=t)).status_code == 403
    assert (await buy(client, t, "house", *HOUSE)).status_code == 403
    assert await spent(session) == []


async def test_operator_gets_one_estate_and_buys_a_house_once(client, session, team):
    me = auth(await login(client, team.login))
    first = await claim(client, me)
    assert first == {"district_id": "support-team-1", "module": 2, "index": 7, "u": 4, "v": 8}
    assert await claim(client, me) == first
    r = await buy(client, me, "house", *HOUSE)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["price"] == 120 and data["balance"] == 1880 and not data["replayed"]
    assert data["object"]["family"] == "house" and data["object"]["level"] == 1
    assert (data["object"]["w"], data["object"]["h"]) == (4, 2)
    again = await buy(client, me, "house", *HOUSE)
    assert again.status_code == 409 and again.json()["code"] == "house_exists"
    assert await spent(session) == [-120]
    assert await session.scalar(select(func.count()).select_from(CityCell)) == 8
    mine = await estate(client, me)
    assert mine["status"] == "ready" and mine["estate"] == first and mine["available"] == 1880


async def test_a_repeated_key_returns_the_first_result_and_never_pays_twice(client, session, team):
    me = auth(await login(client, team.login))
    await claim(client, me)
    op = key()
    first = await buy(client, me, "square", 2, 4, 10, op=op)
    assert first.status_code == 200 and not first.json()["replayed"]
    repeat = await buy(client, me, "square", 2, 4, 10, op=op)
    assert repeat.status_code == 200 and repeat.json()["replayed"]
    assert repeat.json()["object"] == first.json()["object"]
    other = await buy(client, me, "square", 2, 5, 10, op=op)
    assert other.status_code == 409 and other.json()["code"] == "operation_key_reused"
    status = (await client.get(f"{CITY}/operations/{op}", headers=me)).json()
    assert status["status"] == "done"
    assert status["result"]["object"]["id"] == first.json()["object"]["id"]
    unknown = (await client.get(f"{CITY}/operations/{key()}", headers=me)).json()
    assert unknown["status"] == "unknown"
    assert await spent(session) == [-40]


async def test_double_click_and_two_tabs_pay_once(client, session, team):
    me = auth(await login(client, team.login))
    await claim(client, me)
    op = key()
    same = await asyncio.gather(*[buy(client, me, "fountain", 2, 4, 10, op=op) for _ in range(3)])
    assert [r.status_code for r in same] == [200, 200, 200]
    assert len({r.json()["object"]["id"] for r in same}) == 1
    tabs = await asyncio.gather(*[buy(client, me, "sports", 2, 6, 10) for _ in range(3)])
    assert sorted(r.status_code for r in tabs) == [200, 409, 409]
    account = await session.scalar(
        select(CoinAccount)
        .where(CoinAccount.user_id == team.id)
        .execution_options(populate_existing=True)
    )
    assert account.balance == 2000 - 90 - 70
    assert sorted(await spent(session)) == [-90, -70]


async def test_buildings_keep_to_their_zone_and_the_price_the_operator_saw(
    client, session, head, team
):
    me = auth(await login(client, team.login))
    await claim(client, me)
    for family, place in (
        ("square", (2, 4, 8)),  # the house rows
        ("square", (0, 0, 0)),  # public land
        ("square", (2, 0, 10)),  # a neighbour's estate
        ("fountain", (2, 7, 10)),  # half outside the garden
        ("tower", (2, 4, 8)),  # towers stand in the business quarter
        ("tower", (1, 2, 0)),  # and take a whole lot
    ):
        r = await buy(client, me, family, *place)
        assert r.status_code == 409 and r.json()["code"] == "wrong_zone", (family, place, r.text)
    assert (await buy(client, me, "castle", 2, 4, 10)).status_code == 404
    assert (await buy(client, me, "park", 2, 4, 10)).json()["code"] == "recipe_only"
    forged = await client.post(
        CITY + "/buildings",
        headers=me,
        json={
            "key": key(),
            "family": "square",
            "module": 2,
            "u": 4,
            "v": 10,
            "economy_revision": 0,
            "price": 1,
        },
    )
    assert forged.status_code == 422
    # The head changes the prices: what the operator saw is no longer the price.
    boss = auth(await login(client, head.login))
    economy = (await client.get(ADMIN + "/economy", headers=boss)).json()
    economy.pop("catalogue"), economy.pop("can_edit")
    economy["estate"]["square"] = [55]
    assert (await client.put(ADMIN + "/economy", headers=boss, json=economy)).status_code == 200
    stale = await buy(client, me, "square", 2, 4, 10)
    assert stale.status_code == 409 and stale.json()["code"] == "prices_changed"
    fresh = await buy(client, me, "square", 2, 4, 10, revision=1)
    assert fresh.status_code == 200 and fresh.json()["price"] == 55
    poor = await make_user(session, login="poor-estate", group_id=team.group_id)
    p = auth(await login(client, poor.login))
    await claim(client, p)
    broke = await buy(client, p, "square", 2, 0, 10, revision=1)
    assert broke.status_code == 409 and broke.json()["code"] == "insufficient_coins"
    assert await spent(session) == [-55]


async def test_upgrade_move_store_and_place_back(client, session, team):
    me = auth(await login(client, team.login))
    await claim(client, me)
    house = (await buy(client, me, "house", *HOUSE)).json()["object"]
    version = house["version"]
    for level, price in ((2, 180), (3, 260), (4, 360), (5, 500)):
        r = await change(client, me, house, "upgrade", version=version, economy_revision=0)
        assert r.status_code == 200, r.text
        assert r.json()["object"]["level"] == level and r.json()["price"] == price
        version = r.json()["object"]["version"]
    top = await change(client, me, house, "upgrade", version=version, economy_revision=0)
    assert top.json()["code"] == "max_level"
    stale = await change(client, me, house, "upgrade", version=1, economy_revision=0)
    assert stale.json()["code"] == "stale_object"
    assert (await change(client, me, house, "store", version=version)).json()[
        "code"
    ] == "house_fixed"
    gazebo = (await buy(client, me, "gazebo", 2, 4, 10)).json()["object"]
    moved = await change(client, me, gazebo, "move", version=gazebo["version"], module=2, u=7, v=11)
    assert moved.status_code == 200, moved.text
    assert (moved.json()["object"]["u"], moved.json()["object"]["v"]) == (7, 11)
    stored = await change(client, me, gazebo, "store", version=moved.json()["object"]["version"])
    assert stored.json()["object"]["state"] == "stored"
    # The freed cell takes something else; the gazebo comes back elsewhere with its level.
    assert (await buy(client, me, "square", 2, 7, 11)).status_code == 200
    gazebo = stored.json()["object"]
    taken = await change(client, me, gazebo, "move", version=gazebo["version"], module=2, u=7, v=11)
    assert taken.json()["code"] == "cells_taken"
    back = await change(client, me, gazebo, "move", version=gazebo["version"], module=2, u=4, v=11)
    assert back.status_code == 200 and back.json()["object"]["state"] == "placed"
    objects = {(o["family"], o["state"], o["level"]) for o in (await estate(client, me))["objects"]}
    assert objects == {("house", "placed", 5), ("gazebo", "placed", 1), ("square", "placed", 1)}
    assert sum(await spent(session)) == -(120 + 180 + 260 + 360 + 500 + 50 + 40)


async def test_six_squares_become_one_park_with_their_history(client, session, team):
    me = auth(await login(client, team.login))
    await claim(client, me)
    ids = []
    for u in range(4, 7):
        for v in (10, 11):
            r = await buy(client, me, "square", 2, u, v)
            ids.append(r.json()["object"]["id"])
    body = {"ids": ids, "economy_revision": 0}
    merged = await client.post(f"{CITY}/buildings/merge", headers=me, json={"key": key(), **body})
    assert merged.status_code == 200, merged.text
    park = merged.json()["object"]
    assert park["family"] == "park" and park["level"] == 1 and park["paid"] == 240
    assert park["components"] == 6 and (park["u"], park["v"], park["w"], park["h"]) == (4, 10, 3, 2)
    assert merged.json()["balance"] == 2000 - 240
    again = await client.post(f"{CITY}/buildings/merge", headers=me, json={"key": key(), **body})
    assert again.json()["code"] == "bad_recipe"
    squares = await session.scalars(
        select(CityObject).where(CityObject.id.in_(ids)).execution_options(populate_existing=True)
    )
    assert all(o.state == "consumed" and o.consumed_by == park["id"] for o in squares)
    cells = await session.scalars(select(CityCell.object_id))
    assert set(cells) == {park["id"]}
    view = await district_view(client, me)
    assert [(o["family"], o["owner"]) for o in view["objects"]] == [("park", "mine")]
    up = await change(client, me, park, "upgrade", version=park["version"], economy_revision=0)
    assert up.json()["object"]["level"] == 2 and up.json()["price"] == 150


async def test_only_a_full_rectangle_of_ones_own_squares_merges(client, session, team):
    me = auth(await login(client, team.login))
    await claim(client, me)
    ids = []
    for u, v in ((4, 10), (5, 10), (6, 10), (7, 10), (4, 11), (5, 11)):
        ids.append((await buy(client, me, "square", 2, u, v)).json()["object"]["id"])
    l_shape = await client.post(
        f"{CITY}/buildings/merge",
        headers=me,
        json={"key": key(), "ids": ids, "economy_revision": 0},
    )
    assert l_shape.json()["code"] == "bad_recipe"
    neighbour = await make_user(session, login="neighbour-estate", group_id=team.group_id)
    await fund(session, neighbour.id, 100)
    n = auth(await login(client, neighbour.login))
    await claim(client, n)
    foreign = (await buy(client, n, "square", 2, 0, 10)).json()["object"]["id"]
    mixed = await client.post(
        f"{CITY}/buildings/merge",
        headers=me,
        json={"key": key(), "ids": [*ids[:5], foreign], "economy_revision": 0},
    )
    assert mixed.json()["code"] == "bad_recipe"
    assert (
        await session.scalar(
            select(func.count()).select_from(CityObject).where(CityObject.state == "consumed")
        )
        == 0
    )


async def test_one_tower_per_operator_on_its_own_business_lot(client, session, team):
    me = auth(await login(client, team.login))
    tower = await buy(client, me, "tower", 1, 4, 4, rotation=1)
    assert tower.status_code == 200, tower.text
    assert (tower.json()["object"]["w"], tower.json()["object"]["h"]) == (4, 4)
    assert (await buy(client, me, "tower", 1, 0, 0)).json()["code"] == "tower_exists"
    rival = await make_user(session, login="rival-estate", group_id=team.group_id)
    await fund(session, rival.id, 1000)
    r = auth(await login(client, rival.login))
    assert (await buy(client, r, "tower", 1, 4, 4)).json()["code"] == "cells_taken"
    assert (await buy(client, r, "tower", 1, 8, 8)).status_code == 200
    obj = tower.json()["object"]
    moved = await change(client, me, obj, "move", version=obj["version"], module=1, u=0, v=0)
    assert moved.status_code == 200 and (
        moved.json()["object"]["u"],
        moved.json()["object"]["v"],
    ) == (0, 0)
    # The old lot is free again.
    lots = await session.scalars(select(CityLot.index).where(CityLot.kind == "tower"))
    assert sorted(lots) == [0, 8]


async def test_a_transfer_takes_personal_buildings_along(client, session, head, team):
    me = auth(await login(client, team.login))
    await claim(client, me)
    house = (await buy(client, me, "house", *HOUSE)).json()["object"]
    await change(client, me, house, "upgrade", version=house["version"], economy_revision=0)
    await buy(client, me, "square", 2, 4, 10)
    sales_sv = await make_user(session, login="sv-sales", role=Role.SUPERVISOR)
    sales = await make_group(session, code="GS", supervisor_id=sales_sv.id)
    await open_world(
        client,
        head,
        support=[team.group_id],
        sales=[sales.id],
        construction=("support-team-1", "sales-team-1"),
    )
    boss = auth(await login(client, head.login))
    moved = await client.patch(
        f"/api/v1/admin/users/{team.id}", headers=boss, json={"group_id": sales.id}
    )
    assert moved.status_code == 200, moved.text
    data = await estate(client, me)
    assert data["district"]["id"] == "sales-team-1" and data["estate"] is None
    assert {(o["family"], o["state"]) for o in data["objects"]} == {
        ("house", "stored"),
        ("square", "stored"),
    }
    assert await session.scalar(select(func.count()).select_from(CityCell)) == 0
    assert not (await district_view(client, me))["objects"]
    new = await claim(client, me)
    assert new["district_id"] == "sales-team-1"
    house = next(o for o in (await estate(client, me))["objects"] if o["family"] == "house")
    assert house["state"] == "placed" and house["level"] == 2
    assert (house["u"], house["v"]) == (new["u"], new["v"])
    # Moving cost nothing: the journal has only the purchases.
    assert sorted(await spent(session)) == [-180, -120, -40]
    events = await session.scalars(select(CityEvent.kind).where(CityEvent.kind == "transfer"))
    assert len(list(events)) == 2


async def test_regrouping_districts_and_deactivation_release_land(
    client, session, head, supervisor, team
):
    me = auth(await login(client, team.login))
    await claim(client, me)
    await buy(client, me, "house", *HOUSE)
    boss = auth(await login(client, head.login))
    world = (await client.get(ADMIN + "/world", headers=boss)).json()
    body = {"revision": world["revision"], "cities": world["cities"]}
    support = body["cities"][0]["districts"]
    support[0]["group_ids"], support[1]["group_ids"] = [], [team.group_id]
    support[1]["construction"] = True
    assert (await client.put(ADMIN + "/world", headers=boss, json=body)).status_code == 200
    data = await estate(client, me)
    assert data["district"]["id"] == "support-team-2" and data["objects"][0]["state"] == "stored"
    await claim(client, me)
    assert (await estate(client, me))["objects"][0]["state"] == "placed"
    off = await client.patch(
        f"/api/v1/admin/users/{team.id}", headers=boss, json={"is_active": False}
    )
    assert off.status_code == 200, off.text
    assert await session.scalar(select(func.count()).select_from(CityLot)) == 0
    house = await session.scalar(select(CityObject).execution_options(populate_existing=True))
    assert house.state == "stored" and house.owner_id == team.id


async def test_team_funds_a_project_and_the_headquarters_grows(client, session, supervisor, team):
    mate = await make_user(session, login="mate-one", group_id=team.group_id)
    await make_user(session, login="mate-two", group_id=team.group_id)
    await fund(session, mate.id, 500)
    sv = auth(await login(client, supervisor.login))
    opened = await client.post(
        f"{CITY}/projects",
        headers=sv,
        json={
            "key": key(),
            "district_id": "support-team-1",
            "family": "square",
            "module": 0,
            "u": 0,
            "v": 0,
            "economy_revision": 0,
        },
    )
    assert opened.status_code == 200, opened.text
    project = opened.json()["project"]
    assert project["cost"] == 120 and project["funded"] == 0
    me, m = auth(await login(client, team.login)), auth(await login(client, mate.login))

    def give(h, amount, up_to=False):
        return client.post(
            f"{CITY}/projects/{project['id']}/contributions",
            headers=h,
            json={"key": key(), "amount": amount, "up_to": up_to},
        )

    first = await give(me, 50)
    assert first.status_code == 200 and first.json()["accepted"] == 50
    assert not first.json()["completed"]
    seen = (await district_view(client, m))["projects"][0]
    assert seen["progress"] == 25 and seen["mine"] == 0 and "funded" not in seen
    assert (await district_view(client, me))["projects"][0]["mine"] == 50
    over = await give(m, 100)
    assert over.status_code == 409 and over.json()["code"] == "over_remaining"
    done = await give(m, 100, True)
    assert done.status_code == 200 and done.json()["accepted"] == 70 and done.json()["completed"]
    view = await district_view(client, m)
    assert view["projects"] == [] and view["hq"]["level"] == 2 and view["hq"]["built"] == 1
    assert [(o["family"], o["owner"]) for o in view["objects"]] == [("square", "district")]
    notes = await session.scalars(
        select(Notification.user_id).where(Notification.title == "Проект района построен")
    )
    assert sorted(notes) == sorted([team.id, mate.id])
    assert sorted(await spent(session, TxType.CITY_CONTRIBUTION)) == [-70, -50]
    closed = await give(me, 10)
    assert closed.json()["code"] == "project_closed"


async def test_cancelled_project_returns_every_contribution(
    client, session, head, supervisor, team
):
    mate = await make_user(session, login="mate-cancel", group_id=team.group_id)
    await fund(session, mate.id, 400)
    boss = auth(await login(client, head.login))
    project = (
        await client.post(
            f"{CITY}/projects",
            headers=boss,
            json={
                "key": key(),
                "district_id": "support-team-1",
                "family": "fountain",
                "module": 0,
                "u": 2,
                "v": 2,
                "economy_revision": 0,
            },
        )
    ).json()["project"]
    assert project["cost"] == 300
    for user, amount in ((team, 100), (mate, 150)):
        h = auth(await login(client, user.login))
        r = await client.post(
            f"{CITY}/projects/{project['id']}/contributions",
            headers=h,
            json={"key": key(), "amount": amount},
        )
        assert r.status_code == 200, r.text
    # A member of staff from elsewhere cannot cancel it.
    stranger = await make_user(session, login="sv-stranger", role=Role.SUPERVISOR)
    s = auth(await login(client, stranger.login))
    denied = await client.post(
        f"{CITY}/projects/{project['id']}/cancel", headers=s, json={"key": key()}
    )
    assert denied.status_code == 403
    sv = auth(await login(client, supervisor.login))
    cancelled = await client.post(
        f"{CITY}/projects/{project['id']}/cancel", headers=sv, json={"key": key()}
    )
    assert cancelled.status_code == 200 and cancelled.json()["refunded"] == 250
    balances = dict(
        (
            await session.execute(
                select(CoinAccount.user_id, CoinAccount.balance).execution_options(
                    populate_existing=True
                )
            )
        ).all()
    )
    assert balances[team.id] == 2000 and balances[mate.id] == 400
    refunds = await session.scalars(
        select(CoinTransaction).where(CoinTransaction.tx_type == TxType.PURCHASE_REFUND)
    )
    assert sorted(t.amount for t in refunds) == [100, 150]
    again = await client.post(
        f"{CITY}/projects/{project['id']}/cancel", headers=sv, json={"key": key()}
    )
    assert again.json()["code"] == "project_closed"
    # Its cells are free for the next project.
    reopened = await client.post(
        f"{CITY}/projects",
        headers=sv,
        json={
            "key": key(),
            "district_id": "support-team-1",
            "family": "fountain",
            "module": 0,
            "u": 2,
            "v": 2,
            "economy_revision": 0,
        },
    )
    assert reopened.status_code == 200, reopened.text
    rows = await session.scalars(select(CityContribution.refund_transaction_id))
    assert all(rows)


async def test_projects_keep_to_public_land_limits_and_roles(client, session, supervisor, team):
    sv = auth(await login(client, supervisor.login))
    me = auth(await login(client, team.login))

    def open_(h, family="sports", module=0, u=0, v=0, **extra):
        return client.post(
            f"{CITY}/projects",
            headers=h,
            json={
                "key": key(),
                "district_id": "support-team-1",
                "family": family,
                "module": module,
                "u": u,
                "v": v,
                "economy_revision": 0,
                **extra,
            },
        )

    assert (await open_(me)).status_code == 403
    other = await make_user(session, login="sv-other-district", role=Role.SUPERVISOR)
    assert (await open_(auth(await login(client, other.login)))).status_code == 403
    assert (await open_(sv, module=2)).json()["code"] == "wrong_zone"
    assert (await open_(sv, u=11)).json()["code"] == "wrong_zone"
    assert (await open_(sv, family="house")).status_code == 404
    assert (await open_(sv)).status_code == 200
    assert (await open_(sv, family="park", u=4, v=4)).json()["code"] == "project_limit"
    assert (await open_(sv, family="gazebo", u=1, v=0)).json()["code"] == "cells_taken"
    small = await open_(sv, family="gazebo", u=8, v=8)
    assert small.status_code == 200
    project = small.json()["project"]["id"]
    trainer = await make_user(session, login="trainer-contribute", role=Role.TRAINER)
    t = auth(await login(client, trainer.login))
    staff = await client.post(
        f"{CITY}/projects/{project}/contributions", headers=t, json={"key": key(), "amount": 10}
    )
    assert staff.status_code == 403


async def test_concurrent_contributions_never_overfund(client, session, supervisor, team):
    mates = [await make_user(session, login=f"rush-{i}", group_id=team.group_id) for i in range(3)]
    for mate in mates:
        await fund(session, mate.id, 500)
    sv = auth(await login(client, supervisor.login))
    project = (
        await client.post(
            f"{CITY}/projects",
            headers=sv,
            json={
                "key": key(),
                "district_id": "support-team-1",
                "family": "square",
                "module": 0,
                "u": 0,
                "v": 0,
                "economy_revision": 0,
            },
        )
    ).json()["project"]
    heads = [auth(await login(client, m.login)) for m in mates]
    results = await asyncio.gather(
        *[
            client.post(
                f"{CITY}/projects/{project['id']}/contributions",
                headers=h,
                json={"key": key(), "amount": 70},
            )
            for h in heads
        ]
    )
    assert sorted(r.status_code for r in results) == [200, 409, 409]
    assert sum(await spent(session, TxType.CITY_CONTRIBUTION)) == -70


async def test_public_view_hides_money_names_and_small_teams_progress(
    client, session, supervisor, team
):
    me = auth(await login(client, team.login))
    await claim(client, me)
    await buy(client, me, "house", *HOUSE)
    sv = auth(await login(client, supervisor.login))
    project = (
        await client.post(
            f"{CITY}/projects",
            headers=sv,
            json={
                "key": key(),
                "district_id": "support-team-1",
                "family": "square",
                "module": 0,
                "u": 0,
                "v": 0,
                "economy_revision": 0,
            },
        )
    ).json()["project"]
    await client.post(
        f"{CITY}/projects/{project['id']}/contributions",
        headers=me,
        json={"key": key(), "amount": 60},
    )
    guest = await make_user(session, login="guest-estate")
    g = auth(await login(client, guest.login))
    response = await client.get(f"{CITY}/cities/support", headers=g)
    assert response.headers["cache-control"] == "private, no-store"
    raw = json.dumps(response.json(), ensure_ascii=False)
    for secret in ("paid", "balance", "funded", team.full_name, team.login, "created_at"):
        assert secret not in raw, secret
    view = next(d for d in response.json()["districts"] if d["id"] == "support-team-1")
    assert view["objects"][0]["owner"] == "resident" and view["estates"] == {
        "total": 72,
        "taken": 1,
    }
    # One operator in the team: a stage change would show exactly what they gave.
    assert view["projects"][0]["progress"] is None and view["projects"][0]["mine"] == 0
    assert [m["kind"] for m in view["modules"]][:3] == ["public", "business", "residential"]
    staff = await district_view(client, sv)
    assert staff["projects"][0]["funded"] == 60 and staff["managed"]


async def test_old_plots_close_once_the_team_district_opens(client, session, team):
    me = auth(await login(client, team.login))
    city = (await client.get(CITY, headers=me)).json()
    assert not city["can_build"] and city["plots_moved"]
    welcome = await client.post(f"{CITY}/missions/welcome/claim", headers=me, json={"revision": 0})
    assert welcome.status_code == 200
    blocked = await client.post(
        f"{CITY}/plots/academy-0/build", headers=me, json={"item": "garden"}
    )
    assert blocked.status_code == 409


async def test_world_opens_construction_only_where_land_is_prepared(client, head):
    boss = auth(await login(client, head.login))
    world = (await client.get(ADMIN + "/world", headers=boss)).json()
    body = {"revision": world["revision"], "cities": world["cities"]}
    districts = body["cities"][0]["districts"]
    for n in range(4, 8):
        districts.append(
            {
                "id": f"support-team-{n}",
                "name": f"Район {n}",
                "group_ids": [],
                "construction": n == 7,
            }
        )
    r = await client.put(ADMIN + "/world", headers=boss, json=body)
    assert r.status_code == 400
    districts[-1]["construction"] = False
    districts[-2]["construction"] = True
    r = await client.put(ADMIN + "/world", headers=boss, json=body)
    assert r.status_code == 200, r.text
    public = (await client.get(CITY + "/world", headers=boss)).json()
    prepared = [d["prepared"] for d in public["cities"][0]["districts"]]
    assert prepared == [10, 10, 10, 6, 6, 6, 0]


async def test_staff_report_counts_land_and_old_purchases(client, session, head, team):
    me = auth(await login(client, team.login))
    await claim(client, me)
    await buy(client, me, "house", *HOUSE)
    await make_user(session, login="loner-estate")
    boss = auth(await login(client, head.login))
    report = (await client.get(ADMIN + "/estates", headers=boss)).json()
    first = next(d for d in report["districts"] if d["id"] == "support-team-1")
    assert first["estates"] == {"total": 72, "taken": 1} and first["buildings"] == 1
    assert first["operators"] == 1 and first["construction"] and not first["needs_expansion"]
    assert report["operators_without_district"] == 1
    assert report["coins"]["buildings"] == 120 and report["legacy"]["buildings"] == 0
    assert (await client.get(ADMIN + "/estates", headers=me)).status_code == 403


async def test_history_is_append_only(client, session, team):
    me = auth(await login(client, team.login))
    await claim(client, me)
    await buy(client, me, "house", *HOUSE)
    assert await session.scalar(select(func.count()).select_from(CityEvent)) == 2
    with pytest.raises(DBAPIError):
        await session.execute(text("UPDATE city_events SET amount = 0"))
    await session.rollback()
    with pytest.raises(DBAPIError):
        await session.execute(text("DELETE FROM city_events"))
    await session.rollback()


async def test_an_older_form_without_the_pilot_switch_keeps_it(client, head, team):
    boss = auth(await login(client, head.login))
    world = (await client.get(ADMIN + "/world", headers=boss)).json()
    for city in world["cities"]:
        for district in city["districts"]:
            district.pop("construction")
    body = {"revision": world["revision"], "cities": world["cities"]}
    assert (await client.put(ADMIN + "/world", headers=boss, json=body)).status_code == 200
    public = (await client.get(CITY + "/world", headers=boss)).json()
    assert public["cities"][0]["districts"][0]["construction"]
    assert not public["cities"][0]["districts"][1]["construction"]
