import asyncio
import importlib.util
import json
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from app.models.city import CityEconomy
from app.models.city_estate import (
    CityCell,
    CityContribution,
    CityDistrictState,
    CityEvent,
    CityObject,
    CityProject,
)
from app.models.coin import CoinTransaction
from app.models.enums import Role, TxType
from app.models.progress import Notification
from app.models.user import CoinAccount
from app.services import city_land
from app.services.city_economy import defaults as economy_defaults
from app.services.coins import post_transaction
from tests.conftest import auth, login, make_group, make_user

pytestmark = pytest.mark.asyncio
CITY = "/api/v1/learning/city"
ADMIN = "/api/v1/admin/learning/city"
# District 1 of the island city (app/data/city_land.json): band 1 has blocks 1 (columns 4…7 free),
# 2 (3 × 2) and 3 (6 × 2); band 2 starts with block 4, and block 5 is 8 × 4 with every plot free.
FIRST, SECOND = 3, 5
# A plot in the first band and what it costs with a house: land 60 + house 120.
HOUSE_PRICE, SQUARE_PRICE = 180, 100
#: Ready houses (world/familyHouses.ts) and their prices, cheapest first.
READY = {
    "carport": 300,
    "bungalow": 420,
    "attic": 480,
    "modern": 560,
    "bayhouse": 640,
    "terrace": 720,
}
OFFICES = {
    "officea": 900,
    "officeb": 980,
    "officec": 1060,
    "officed": 1140,
    "officee": 1220,
    "officef": 1320,
    "officeg": 1440,
    "officeh": 1560,
    "officei": 1700,
}
FAMILIES = {"square", "house", *READY, *OFFICES, "park", "bigpark"}


def key():
    return uuid4().hex


async def fund(session, user_id, amount):
    await post_transaction(
        session, user_id=user_id, amount=amount, tx_type=TxType.MANUAL_CREDIT, reason="Тест"
    )
    await session.commit()


async def open_world(
    client, admin, head, *, support=(), sales=(), construction=("support-team-1",)
):
    """Assigns city ownership and supervisors, opening construction where asked."""
    h = auth(await login(client, admin.login))
    current = (await client.get(ADMIN + "/world", headers=h)).json()
    body = {"revision": current["revision"], "cities": current["cities"]}
    directory = {g["id"]: g for g in current["groups"]}
    for city, groups in (("support", support), ("sales", sales)):
        district = next(c for c in body["cities"] if c["id"] == city)["districts"][0]
        district["group_ids"] = list(groups)
        supervisors = {directory[g]["supervisor_id"] for g in district["group_ids"]}
        assert len(supervisors) <= 1 and None not in supervisors
        district["supervisor_id"] = next(iter(supervisors), None)
    for c in body["cities"]:
        c["head_id"] = head.id
        for d in c["districts"]:
            d["construction"] = d["id"] in construction
    r = await client.put(ADMIN + "/world", headers=h, json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def estate(client, h):
    r = await client.get(CITY + "/estate", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


async def buy(client, h, family, block, col, row, *, revision=0, op=None):
    return await client.post(
        CITY + "/plots",
        headers=h,
        json={
            "key": op or key(),
            "family": family,
            "block": block,
            "col": col,
            "row": row,
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


async def open_bands(session, district_id, band):
    session.add(
        CityDistrictState(district_id=district_id, hq_level=1, built_projects=0, open_band=band)
    )
    await session.commit()


async def legacy_square(session, district_id="support-team-1", *, family="square"):
    """An already-built public square at an unused corner preserves the legacy project flow."""
    obj = CityObject(
        district_id=district_id,
        owner_id=None,
        family=family,
        level=1,
        state="placed",
        module=0,
        u=11,
        v=11,
        rotation=0,
        source="legacy",
        paid=0,
    )
    session.add(obj)
    await session.flush()
    session.add(CityCell(district_id=district_id, module=0, u=11, v=11, object_id=obj.id))
    await session.commit()
    return obj


@pytest.fixture
async def estate_admin(session):
    return await make_user(session, login="estate-admin", role=Role.ADMIN)


@pytest.fixture
async def team(client, session, estate_admin, head, supervisor, operator):
    await open_world(client, estate_admin, head, support=[operator.group_id])
    await fund(session, operator.id, 2000)
    return operator


async def test_construction_waits_for_the_pilot_and_staff_never_build(
    client, session, estate_admin, head, supervisor, operator
):
    me = auth(await login(client, operator.login))
    assert (await estate(client, me))["status"] == "no_team"
    await open_world(client, estate_admin, head, support=[operator.group_id], construction=())
    data = await estate(client, me)
    assert data["status"] == "closed" and data["district"]["id"] == "support-team-1"
    families = {c["family"]: c for c in data["catalogue"]}
    assert set(families) == FAMILIES
    assert [lv["price"] for lv in families["house"]["levels"]] == [120, 180, 260, 360, 500]
    assert [lv["name"] for lv in families["house"]["levels"]][:2] == [
        "Одноэтажный дом",
        "Двухэтажный дом",
    ]
    assert (families["park"]["squares"], families["bigpark"]["squares"]) == (4, 6)
    assert data["land_prices"] == [60, 45, 30, 20, 10]
    assert {p["family"] for p in data["projects"]} == {
        "square",
        "gazebo",
        "fountain",
        "sports",
        "park",
    }
    await fund(session, operator.id, 500)
    r = await buy(client, me, "house", FIRST, 0, 0)
    assert r.status_code == 409 and r.json()["code"] == "construction_closed"
    trainer = await make_user(session, login="trainer-estate", role=Role.TRAINER)
    t = auth(await login(client, trainer.login))
    assert (await estate(client, t))["status"] == "staff"
    await open_world(client, estate_admin, head, support=[operator.group_id])
    assert (await buy(client, t, "house", FIRST, 0, 0)).status_code == 403
    assert await spent(session) == []


async def test_an_operator_buys_a_plot_with_a_house_and_builds_it_up(client, session, team):
    me = auth(await login(client, team.login))
    r = await buy(client, me, "house", FIRST, 0, 0)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["price"] == HOUSE_PRICE and data["balance"] == 2000 - HOUSE_PRICE
    assert not data["replayed"] and not data["merged"]
    house = data["object"]
    assert (house["family"], house["level"], house["module"], house["u"], house["v"]) == (
        "house",
        1,
        FIRST,
        0,
        0,
    )
    assert (house["w"], house["h"], house["paid"]) == (1, 1, HOUSE_PRICE)
    # One storey, then two, and on to the mansion: each stage at the price of the catalogue.
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
    # Many houses: an operator may buy as many plots as there are free.
    second = await buy(client, me, "house", FIRST, 1, 0)
    assert second.status_code == 200, second.text
    assert sum(await spent(session)) == -(HOUSE_PRICE * 2 + 180 + 260 + 360 + 500)
    mine = await estate(client, me)
    assert [(o["family"], o["level"]) for o in mine["objects"]] == [("house", 5), ("house", 1)]
    assert await session.scalar(select(func.count()).select_from(CityCell)) == 2


async def test_ready_houses_are_bought_finished_at_the_price_of_their_size(
    client, session, head, team
):
    me = auth(await login(client, team.login))
    catalogue = {c["family"]: c for c in (await estate(client, me))["catalogue"]}
    ready = [f for f, c in catalogue.items() if c["ready"] and f in READY]
    assert ready == list(READY), "cheapest first"
    for family, price in READY.items():
        item = catalogue[family]
        assert item["size"] == [1, 1] and item["squares"] is None and len(item["levels"]) == 1
        assert item["levels"][0]["price"] == price and item["levels"][0]["name"] == item["name"]
    assert not catalogue["house"]["ready"] and not catalogue["square"]["ready"]
    # Land of the band plus the house, at once; it has no stages to build up.
    r = await buy(client, me, "terrace", FIRST, 0, 0)
    assert r.status_code == 200, r.text
    house = r.json()["object"]
    assert r.json()["price"] == 60 + 720 and r.json()["balance"] == 2000 - 780
    assert (house["family"], house["level"], house["paid"], house["w"]) == ("terrace", 1, 780, 1)
    up = await change(client, me, house, "upgrade", version=house["version"], economy_revision=0)
    assert up.json()["code"] == "max_level"
    # A square beside it is a square: only squares gather into parks.
    for u, v in ((1, 0), (0, 1), (1, 1)):
        assert not (await buy(client, me, "square", FIRST, u, v)).json()["merged"]
    view = await district_view(client, me)
    assert sorted(o["family"] for o in view["objects"]) == ["square", "square", "square", "terrace"]
    # The head sets a ready house's price in the economy tab; the next purchase pays it.
    boss = auth(await login(client, head.login))
    economy = (await client.get(ADMIN + "/economy", headers=boss)).json()
    economy.pop("catalogue"), economy.pop("can_edit")
    cheaper = {**economy["estate"], "modern": [500]}
    r = await client.put(ADMIN + "/economy", headers=boss, json={**economy, "estate": cheaper})
    assert r.status_code == 200, r.text
    revision = r.json()["revision"]
    stale = await buy(client, me, "modern", FIRST, 2, 0)
    assert stale.json()["code"] == "prices_changed"
    r = await buy(client, me, "modern", FIRST, 2, 0, revision=revision)
    assert r.status_code == 200 and r.json()["price"] == 60 + 500
    assert sum(await spent(session)) == -(780 + 3 * SQUARE_PRICE + 560)


async def test_all_supplied_office_towers_are_bought_finished_on_one_plot(client, session, team):
    me = auth(await login(client, team.login))
    await fund(session, team.id, 12_000)
    catalogue = {c["family"]: c for c in (await estate(client, me))["catalogue"]}
    assert [f for f, c in catalogue.items() if c["ready"]] == [*READY, *OFFICES]
    plots = [(col, row) for row in (0, 1) for col in range(6)]
    purchased = []
    for (family, price), (col, row) in zip(OFFICES.items(), plots, strict=False):
        item = catalogue[family]
        assert item["size"] == [1, 1] and item["squares"] is None
        assert len(item["levels"]) == 1 and item["levels"][0]["price"] == price
        op = key()
        r = await buy(client, me, family, FIRST, col, row, op=op)
        assert r.status_code == 200, r.text
        data = r.json()
        tower = data["object"]
        assert data["price"] == 60 + price and not data["merged"]
        assert (tower["family"], tower["level"], tower["w"], tower["h"]) == (family, 1, 1, 1)
        assert tower["paid"] == 60 + price and tower["source"] == "purchase"
        assert (tower["module"], tower["u"], tower["v"]) == (FIRST, col, row)
        purchased.append(tower)
        replay = await buy(client, me, family, FIRST, col, row, op=op)
        assert replay.status_code == 200 and replay.json()["replayed"]
        assert replay.json()["object"] == tower
        assert (await buy(client, me, family, FIRST, col, row)).json()["code"] == "plot_taken"
        upgrade = await change(
            client, me, tower, "upgrade", version=tower["version"], economy_revision=0
        )
        assert upgrade.json()["code"] == "max_level"
    assert (await buy(client, me, "officea", 4, 3, 1)).json()["code"] == "wrong_plot"
    assert (await buy(client, me, "officea", 99, 0, 0)).json()["code"] == "wrong_plot"
    assert [o["id"] for o in (await estate(client, me))["objects"]] == [o["id"] for o in purchased]
    view = await district_view(client, me)
    assert [o["family"] for o in view["objects"]] == list(OFFICES)
    assert view["land"]["taken"] == len(OFFICES)
    assert await session.scalar(select(func.count()).select_from(CityCell)) == len(OFFICES)
    assert sum(await spent(session)) == -sum(60 + price for price in OFFICES.values())


async def test_saved_economies_gain_offices_and_keep_custom_prices(client, session, head, team):
    # A row saved before office towers existed keeps its prices and gains their defaults.
    saved = economy_defaults()
    saved["estate"] = {f: prices for f, prices in saved["estate"].items() if f not in OFFICES}
    saved["estate"]["terrace"] = [800]
    saved["land"][0] = 65
    session.add(CityEconomy(id=1, revision=3, values=saved, updated_by_id=head.id))
    await session.commit()
    boss = auth(await login(client, head.login))
    me = auth(await login(client, team.login))
    current = (await client.get(ADMIN + "/economy", headers=boss)).json()
    current.pop("catalogue"), current.pop("can_edit")
    assert current["revision"] == 3 and current["estate"]["terrace"] == [800]
    assert current["land"][0] == 65
    assert {f: current["estate"][f] for f in OFFICES} == {f: [p] for f, p in OFFICES.items()}
    # An earlier open form must be refreshed, so it cannot silently overwrite new prices.
    old_form = await client.put(ADMIN + "/economy", headers=boss, json={"revision": 3, **saved})
    assert old_form.status_code == 422
    invalid = {**current["estate"], "officea": [0]}
    assert (
        await client.put(ADMIN + "/economy", headers=boss, json={**current, "estate": invalid})
    ).status_code == 422
    # A refreshed form can customise office prices; purchases check its revision as usual.
    current["estate"]["officea"] = [1000]
    changed = await client.put(ADMIN + "/economy", headers=boss, json=current)
    assert changed.status_code == 200, changed.text
    revision = changed.json()["revision"]
    assert (await buy(client, me, "officea", FIRST, 0, 0, revision=3)).json()["code"] == (
        "prices_changed"
    )
    bought = await buy(client, me, "officea", FIRST, 0, 0, revision=revision)
    assert bought.status_code == 200 and bought.json()["price"] == 1065
    # Clients omitting all estate prices preserve the complete current catalogue.
    keep = {k: v for k, v in changed.json().items() if k != "estate"}
    retained = await client.put(ADMIN + "/economy", headers=boss, json=keep)
    assert retained.status_code == 200 and retained.json()["estate"]["officea"] == [1000]
    assert set(retained.json()["estate"]) == FAMILIES
    assert await spent(session) == [-1065]


async def test_a_repeated_key_returns_the_first_result_and_never_pays_twice(client, session, team):
    me = auth(await login(client, team.login))
    op = key()
    first = await buy(client, me, "square", FIRST, 0, 0, op=op)
    assert first.status_code == 200 and not first.json()["replayed"]
    repeat = await buy(client, me, "square", FIRST, 0, 0, op=op)
    assert repeat.status_code == 200 and repeat.json()["replayed"]
    assert repeat.json()["object"] == first.json()["object"]
    other = await buy(client, me, "square", FIRST, 1, 0, op=op)
    assert other.status_code == 409 and other.json()["code"] == "operation_key_reused"
    status = (await client.get(f"{CITY}/operations/{op}", headers=me)).json()
    assert status["status"] == "done"
    assert status["result"]["object"]["id"] == first.json()["object"]["id"]
    unknown = (await client.get(f"{CITY}/operations/{key()}", headers=me)).json()
    assert unknown["status"] == "unknown"
    assert await spent(session) == [-SQUARE_PRICE]


async def test_double_click_and_two_tabs_pay_once(client, session, team):
    me = auth(await login(client, team.login))
    op = key()
    same = await asyncio.gather(*[buy(client, me, "house", FIRST, 0, 0, op=op) for _ in range(3)])
    assert [r.status_code for r in same] == [200, 200, 200]
    assert len({r.json()["object"]["id"] for r in same}) == 1
    tabs = await asyncio.gather(*[buy(client, me, "house", FIRST, 1, 0) for _ in range(3)])
    assert sorted(r.status_code for r in tabs) == [200, 409, 409]
    account = await session.scalar(
        select(CoinAccount)
        .where(CoinAccount.user_id == team.id)
        .execution_options(populate_existing=True)
    )
    assert account.balance == 2000 - 2 * HOUSE_PRICE
    assert sorted(await spent(session)) == [-HOUSE_PRICE, -HOUSE_PRICE]


async def test_only_free_plots_of_ones_district_at_the_price_seen(
    client, session, head, team
):
    me = auth(await login(client, team.login))
    for place, code in (
        ((1, 0, 0), "wrong_plot"),  # a group quarter stands there
        ((4, 3, 1), "wrong_plot"),  # the district's centre
        ((99, 0, 0), "wrong_plot"),  # no such block
        ((FIRST, 6, 0), "wrong_plot"),  # past the block's last column
    ):
        r = await buy(client, me, "house", *place)
        assert r.status_code == 409 and r.json()["code"] == code, (place, r.text)
    assert (await buy(client, me, "castle", FIRST, 0, 0)).status_code == 404
    assert (await buy(client, me, "park", FIRST, 0, 0)).json()["code"] == "recipe_only"
    forged = await client.post(
        CITY + "/plots",
        headers=me,
        json={
            "key": key(),
            "family": "square",
            "block": FIRST,
            "col": 0,
            "row": 0,
            "economy_revision": 0,
            "price": 1,
        },
    )
    assert forged.status_code == 422
    neighbour = await make_user(session, login="neighbour-estate", group_id=team.group_id)
    await fund(session, neighbour.id, 500)
    n = auth(await login(client, neighbour.login))
    assert (await buy(client, n, "square", FIRST, 0, 0)).status_code == 200
    taken = await buy(client, me, "house", FIRST, 0, 0)
    assert taken.json()["code"] == "plot_taken"
    # The head changes the prices: what the operator saw is no longer the price.
    boss = auth(await login(client, head.login))
    economy = (await client.get(ADMIN + "/economy", headers=boss)).json()
    economy.pop("catalogue"), economy.pop("can_edit")
    economy["land"] = [80, 45, 30, 20, 10]
    assert (await client.put(ADMIN + "/economy", headers=boss, json=economy)).status_code == 200
    stale = await buy(client, me, "square", FIRST, 1, 0)
    assert stale.status_code == 409 and stale.json()["code"] == "prices_changed"
    fresh = await buy(client, me, "square", FIRST, 1, 0, revision=1)
    assert fresh.status_code == 200 and fresh.json()["price"] == 80 + 40
    poor = await make_user(session, login="poor-estate", group_id=team.group_id)
    p = auth(await login(client, poor.login))
    broke = await buy(client, p, "square", FIRST, 2, 0, revision=1)
    assert broke.status_code == 409 and broke.json()["code"] == "insufficient_coins"
    assert sorted(await spent(session)) == [-120, -SQUARE_PRICE]


async def test_four_squares_become_a_park_and_six_a_big_park(client, session, team):
    me = auth(await login(client, team.login))
    results = [
        (await buy(client, me, "square", FIRST, u, v)).json() for u, v in ((0, 0), (1, 0), (0, 1))
    ]
    assert [r["object"]["family"] for r in results] == ["square"] * 3
    fourth = (await buy(client, me, "square", FIRST, 1, 1)).json()
    park = fourth["object"]
    assert fourth["merged"] and park["family"] == "park" and park["level"] == 1
    assert (park["u"], park["v"], park["w"], park["h"]) == (0, 0, 2, 2)
    assert park["paid"] == 4 * SQUARE_PRICE and park["squares"] == 4
    up = await change(client, me, park, "upgrade", version=park["version"], economy_revision=0)
    assert up.status_code == 200 and up.json()["object"]["level"] == 2 and up.json()["price"] == 120
    # Two more squares beside it fill a 3 × 2 rectangle: a big park, keeping the fountain's stage.
    assert not (await buy(client, me, "square", FIRST, 2, 0)).json()["merged"]
    last = (await buy(client, me, "square", FIRST, 2, 1)).json()
    big = last["object"]
    assert last["merged"] and big["family"] == "bigpark" and big["level"] == 2
    assert (big["u"], big["v"], big["w"], big["h"], big["rotation"]) == (0, 0, 3, 2, 0)
    assert big["paid"] == 6 * SQUARE_PRICE + 120 and big["squares"] == 6
    view = await district_view(client, me)
    assert [(o["family"], o["owner"], o["w"], o["h"]) for o in view["objects"]] == [
        ("bigpark", "mine", 3, 2)
    ]
    cells = list(await session.scalars(select(CityCell.object_id)))
    assert len(cells) == 6 and set(cells) == {big["id"]}
    consumed = await session.scalar(
        select(func.count()).select_from(CityObject).where(CityObject.state == "consumed")
    )
    assert consumed == 7  # four squares into the park, then it and two squares into the big one
    assert sum(await spent(session)) == -(6 * SQUARE_PRICE + 120)
    top = await change(client, me, big, "upgrade", version=big["version"], economy_revision=0)
    assert top.json()["object"]["level"] == 3 and top.json()["price"] == 250


async def test_six_squares_in_two_columns_make_an_upright_big_park(client, session, team):
    await open_bands(session, "support-team-1", 2)
    me = auth(await login(client, team.login))
    await fund(session, team.id, 1000)
    # In this order no four of them fill a square until the sixth fills the whole 2 × 3.
    for u, v in ((0, 0), (0, 1), (0, 2), (1, 0), (1, 2)):
        assert not (await buy(client, me, "square", SECOND, u, v)).json()["merged"]
    last = (await buy(client, me, "square", SECOND, 1, 1)).json()
    big = last["object"]
    assert last["merged"] and big["family"] == "bigpark"
    assert (big["u"], big["v"], big["w"], big["h"], big["rotation"]) == (0, 0, 2, 3, 1)
    # Land of the second band is cheaper: 45 instead of 60.
    assert big["paid"] == 6 * (45 + 40)


async def test_squares_of_a_neighbour_or_a_house_in_the_way_do_not_merge(client, session, team):
    me = auth(await login(client, team.login))
    neighbour = await make_user(session, login="neighbour-merge", group_id=team.group_id)
    await fund(session, neighbour.id, 500)
    n = auth(await login(client, neighbour.login))
    for u, v in ((0, 0), (1, 0), (0, 1)):
        await buy(client, me, "square", FIRST, u, v)
    assert not (await buy(client, n, "square", FIRST, 1, 1)).json()["merged"]
    await buy(client, me, "house", FIRST, 2, 0)
    assert not (await buy(client, me, "square", FIRST, 2, 1)).json()["merged"]
    families = await session.scalars(select(CityObject.family).where(CityObject.state == "placed"))
    assert sorted(families) == ["house", "square", "square", "square", "square", "square"]


async def test_every_band_is_open_before_building_and_filling_land_does_not_unlock_it(
    client, session, team
):
    me = auth(await login(client, team.login))
    await fund(session, team.id, 4000)
    totals = city_land.band_totals("support-team-1")
    assert totals[0] == 26 and len(totals) == 5
    first = [(1, u, v) for u in range(4, 8) for v in (0, 1)] + [
        (block, u, v) for block, cols in ((2, 3), (3, 6)) for u in range(cols) for v in (0, 1)
    ]
    # A team may start in the outermost part before building anything nearer the centre.
    empty = (await district_view(client, me))["land"]
    assert empty["open_band"] == 5 and empty["taken"] == 0
    outer = await buy(client, me, "house", 16, 0, 0)
    assert outer.status_code == 200 and outer.json()["price"] == 10 + 120
    need = 19
    for block, u, v in first[: need - 1]:
        assert (await buy(client, me, "house", block, u, v)).status_code == 200
    assert (await district_view(client, me))["land"]["open_band"] == 5
    assert (await buy(client, me, "house", *first[need - 1])).status_code == 200
    land = (await district_view(client, me))["land"]
    assert land["open_band"] == 5 and land["taken"] == need + 1 and land["plots"] == sum(totals)
    assert land["bands"][0] == {"band": 1, "plots": 26, "taken": need}
    r = await buy(client, me, "house", SECOND, 0, 0)
    assert r.status_code == 200 and r.json()["price"] == 45 + 120
    bands = await session.scalars(select(CityEvent.payload).where(CityEvent.kind == "band"))
    assert list(bands) == []


async def test_a_transfer_takes_buildings_along_to_the_inventory(
    client, session, estate_admin, head, team
):
    me = auth(await login(client, team.login))
    house = (await buy(client, me, "house", FIRST, 0, 0)).json()["object"]
    await change(client, me, house, "upgrade", version=house["version"], economy_revision=0)
    await buy(client, me, "square", FIRST, 1, 0)
    await buy(client, me, "officea", FIRST, 2, 0)
    sales_sv = await make_user(session, login="sv-sales", role=Role.SUPERVISOR)
    sales = await make_group(session, code="GS", supervisor_id=sales_sv.id)
    await open_world(
        client,
        estate_admin,
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
    assert data["district"]["id"] == "sales-team-1"
    assert {(o["family"], o["state"], o["level"]) for o in data["objects"]} == {
        ("house", "stored", 2),
        ("square", "stored", 1),
        ("officea", "stored", 1),
    }
    assert await session.scalar(select(func.count()).select_from(CityCell)) == 0
    assert not (await district_view(client, me))["objects"]
    stored = next(o for o in data["objects"] if o["family"] == "house")
    placed = await change(
        client, me, stored, "place", version=stored["version"], block=6, col=0, row=0
    )
    assert placed.status_code == 200, placed.text
    house = placed.json()["object"]
    assert (house["state"], house["district_id"], house["module"], house["level"]) == (
        "placed",
        "sales-team-1",
        6,
        2,
    )
    again = await change(
        client, me, house, "place", version=house["version"], block=6, col=1, row=0
    )
    assert again.status_code == 404
    office = next(o for o in data["objects"] if o["family"] == "officea")
    placed_office = await change(
        client, me, office, "place", version=office["version"], block=6, col=1, row=0
    )
    assert placed_office.status_code == 200, placed_office.text
    assert placed_office.json()["object"]["state"] == "placed"
    assert placed_office.json()["object"]["paid"] == 960
    view = await district_view(client, me, "sales", "sales-team-1")
    assert [(o["family"], o["owner"]) for o in view["objects"]] == [
        ("house", "mine"),
        ("officea", "mine"),
    ]
    # Moving cost nothing: the journal has only the purchases.
    assert sorted(await spent(session)) == [-960, -HOUSE_PRICE, -180, -SQUARE_PRICE]
    events = await session.scalars(select(CityEvent.kind).where(CityEvent.kind == "transfer"))
    assert len(list(events)) == 3


async def test_regrouping_districts_and_deactivation_release_land(
    client, session, head, supervisor, team
):
    me = auth(await login(client, team.login))
    await buy(client, me, "house", FIRST, 0, 0)
    boss = auth(await login(client, head.login))
    world = (await client.get(ADMIN + "/world", headers=boss)).json()
    body = {"revision": world["revision"], "cities": world["cities"]}
    support = body["cities"][0]["districts"]
    support[0]["group_ids"], support[1]["group_ids"] = [], [team.group_id]
    support[0]["supervisor_id"], support[1]["supervisor_id"] = None, supervisor.id
    support[1]["construction"] = True
    assert (await client.put(ADMIN + "/world", headers=boss, json=body)).status_code == 200
    data = await estate(client, me)
    assert data["district"]["id"] == "support-team-2" and data["objects"][0]["state"] == "stored"
    house = data["objects"][0]
    r = await change(client, me, house, "place", version=house["version"], block=1, col=0, row=0)
    assert r.status_code == 200, r.text
    off = await client.patch(
        f"/api/v1/admin/users/{team.id}", headers=boss, json={"is_active": False}
    )
    assert off.status_code == 200, off.text
    assert await session.scalar(select(func.count()).select_from(CityCell)) == 0
    house = await session.scalar(select(CityObject).execution_options(populate_existing=True))
    assert house.state == "stored" and house.owner_id == team.id


async def test_team_funds_a_project_and_the_headquarters_grows(client, session, supervisor, team):
    legacy = await legacy_square(session)
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
    assert [(o["family"], o["owner"], o["module"], o["w"]) for o in view["objects"]] == [
        ("square", "district", 0, 1),
        ("square", "district", 0, 1),
    ]
    assert view["objects"][0]["id"] == legacy.id
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
    await legacy_square(session)
    mate = await make_user(session, login="mate-cancel", group_id=team.group_id)
    await fund(session, mate.id, 400)
    boss = auth(await login(client, head.login))
    body = {
        "district_id": "support-team-1",
        "family": "fountain",
        "module": 0,
        "u": 2,
        "v": 2,
        "economy_revision": 0,
    }
    project = (
        await client.post(f"{CITY}/projects", headers=boss, json={"key": key(), **body})
    ).json()["project"]
    assert project["cost"] == 300 and (project["w"], project["h"]) == (2, 2)
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
    reopened = await client.post(f"{CITY}/projects", headers=sv, json={"key": key(), **body})
    assert reopened.status_code == 200, reopened.text
    rows = await session.scalars(select(CityContribution.refund_transaction_id))
    assert all(rows)


async def test_projects_keep_to_the_public_square_its_limits_and_roles(
    client, session, supervisor, team
):
    await legacy_square(session)
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
    # The public square is not a plot: an operator's purchase cannot reach it.
    assert (await buy(client, me, "house", 0, 0, 0)).status_code == 422


async def test_concurrent_contributions_never_overfund(client, session, supervisor, team):
    await legacy_square(session)
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
    await buy(client, me, "house", FIRST, 0, 0)
    await legacy_square(session)
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
    assert view["objects"][0]["owner"] == "resident"
    assert (view["land"]["plots"], view["land"]["taken"], view["land"]["open_band"]) == (
        city_land.plot_count("support-team-1"),
        1,
        5,
    )
    # One operator in the team: a stage change would show exactly what they gave.
    assert view["projects"][0]["progress"] is None and view["projects"][0]["mine"] == 0
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


async def test_the_city_has_three_districts_with_land_and_only_they_open(client, estate_admin):
    boss = auth(await login(client, estate_admin.login))
    world = (await client.get(ADMIN + "/world", headers=boss)).json()
    body = {"revision": world["revision"], "cities": world["cities"]}
    districts = body["cities"][0]["districts"]
    districts.append(
        {
            "id": "support-team-4", "name": "Район 4", "group_ids": [],
            "supervisor_id": None, "construction": True,
        }
    )
    r = await client.put(ADMIN + "/world", headers=boss, json=body)
    assert r.status_code == 400
    districts[-1]["construction"] = False
    districts[2]["construction"] = True
    r = await client.put(ADMIN + "/world", headers=boss, json=body)
    assert r.status_code == 200, r.text
    public = (await client.get(CITY + "/world", headers=boss)).json()
    support = [d["prepared"] for d in public["cities"][0]["districts"]]
    assert support == [city_land.plot_count(f"support-team-{n}") for n in (1, 2, 3)] + [0]
    assert all(n > 1000 for n in support[:3])
    sales = [d["prepared"] for d in public["cities"][1]["districts"]]
    assert all(n > 150 for n in sales)


async def test_staff_report_counts_land_and_old_purchases(client, session, head, team):
    me = auth(await login(client, team.login))
    await buy(client, me, "house", FIRST, 0, 0)
    await buy(client, me, "square", FIRST, 1, 0)
    await make_user(session, login="loner-estate")
    boss = auth(await login(client, head.login))
    report = (await client.get(ADMIN + "/estates", headers=boss)).json()
    first = next(d for d in report["districts"] if d["id"] == "support-team-1")
    assert first["land"] == {
        "plots": city_land.plot_count("support-team-1"),
        "taken": 2,
        "open_band": 5,
    }
    assert (first["buildings"], first["builders"], first["operators"]) == (2, 1, 1)
    assert first["construction"]
    assert report["operators_without_district"] == 1
    assert report["coins"] == {
        "buildings": HOUSE_PRICE + SQUARE_PRICE,
        "contributions": 0,
        "refunded": 0,
    }
    assert report["legacy"]["buildings"] == 0
    assert (await client.get(ADMIN + "/estates", headers=me)).status_code == 403


async def test_history_is_append_only(client, session, team):
    me = auth(await login(client, team.login))
    await buy(client, me, "house", FIRST, 0, 0)
    assert await session.scalar(select(func.count()).select_from(CityEvent)) == 1
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


async def test_the_economy_tab_sets_land_and_building_prices(client, head):
    boss = auth(await login(client, head.login))
    economy = (await client.get(ADMIN + "/economy", headers=boss)).json()
    economy.pop("catalogue"), economy.pop("can_edit")
    assert economy["land"] == [60, 45, 30, 20, 10]
    assert set(economy["estate"]) == FAMILIES
    for bad in ({"land": [60, 45]}, {"land": [60, 45, 30, 20, -1]}):
        r = await client.put(ADMIN + "/economy", headers=boss, json={**economy, **bad})
        assert r.status_code == 422, bad
    # Parks gather themselves for free unless a fee is set; buying a square costs at least a coin.
    fine = {**economy["estate"], "park": [0, 100], "bigpark": [5, 150, 250]}
    r = await client.put(ADMIN + "/economy", headers=boss, json={**economy, "estate": fine})
    assert r.status_code == 200, r.text
    economy["revision"] = r.json()["revision"]
    free_square = {**fine, "square": [0]}
    r = await client.put(ADMIN + "/economy", headers=boss, json={**economy, "estate": free_square})
    assert r.status_code == 422
    # A form of the earlier version, without land prices, keeps them.
    older = {k: v for k, v in economy.items() if k != "land"}
    r = await client.put(ADMIN + "/economy", headers=boss, json=older)
    assert r.status_code == 200 and r.json()["land"] == [60, 45, 30, 20, 10]


def reset_module():
    path = Path(__file__).resolve().parent.parent / "alembic/versions/20261001_city_land.py"
    spec = importlib.util.spec_from_file_location("city_land_reset", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_the_land_reset_refunds_what_was_built_and_given_once(session, supervisor, operator):
    """What the migration does with the estates built before the plots (20261001_city_land)."""
    await fund(session, operator.id, 1000)
    mate = await make_user(session, login="mate-reset", group_id=operator.group_id)
    await fund(session, mate.id, 300)
    # Built on the old estates: a house and its stage, as the old code paid for them.
    for amount, op in ((120, "a1"), (180, "a2")):
        await post_transaction(
            session,
            user_id=operator.id,
            amount=-amount,
            tx_type=TxType.CITY_BUILD,
            reason="Мой район: Личный дом",
            idempotency_key=f"city-op:{operator.id}:{op}",
        )
    # A legacy plot purchase near a training centre stays as it is.
    await post_transaction(
        session,
        user_id=operator.id,
        amount=-50,
        tx_type=TxType.CITY_BUILD,
        reason="Мой город",
        idempotency_key=f"city-build:{operator.id}:academy-0",
    )
    house = CityObject(
        district_id="support-team-1",
        owner_id=operator.id,
        family="house",
        level=2,
        state="placed",
        module=2,
        u=4,
        v=8,
        rotation=0,
        source="purchase",
        paid=300,
    )
    project = CityProject(
        district_id="support-team-1",
        family="fountain",
        level=1,
        module=0,
        u=2,
        v=2,
        rotation=0,
        size="main",
        cost=300,
        funded=0,
        status="open",
    )
    session.add_all([house, project])
    await session.flush()
    session.add_all(
        [
            CityCell(district_id="support-team-1", module=2, u=4, v=8, object_id=house.id),
            CityCell(district_id="support-team-1", module=0, u=2, v=2, project_id=project.id),
            CityDistrictState(
                district_id="support-team-1", hq_level=3, built_projects=4, open_band=2
            ),
        ]
    )
    given = []
    for user, amount in ((operator, 40), (mate, 70)):
        tx = await post_transaction(
            session,
            user_id=user.id,
            amount=-amount,
            tx_type=TxType.CITY_CONTRIBUTION,
            reason="Проект района",
            idempotency_key=f"city-op:{user.id}:c{amount}",
        )
        item = CityContribution(
            project_id=project.id, user_id=user.id, amount=amount, transaction_id=tx.id
        )
        session.add(item)
        given.append(item)
    project.funded = 110
    await session.commit()
    before = {
        a.user_id: (a.balance, a.total_earned, a.total_spent)
        for a in await session.scalars(select(CoinAccount))
    }
    reset = reset_module().reset_estates
    refunded = await session.run_sync(lambda s: reset(s.connection()))
    await session.commit()
    assert refunded == {operator.id: 120 + 180 + 40, mate.id: 70}
    accounts = {
        a.user_id: a
        for a in await session.scalars(
            select(CoinAccount).execution_options(populate_existing=True)
        )
    }
    for user_id, amount in refunded.items():
        balance, earned, total_spent = before[user_id]
        account = accounts[user_id]
        assert (account.balance, account.total_earned, account.total_spent) == (
            balance + amount,
            earned,
            total_spent,
        )
    refunds = list(
        await session.scalars(
            select(CoinTransaction).where(CoinTransaction.tx_type == TxType.PURCHASE_REFUND)
        )
    )
    assert sorted((t.user_id, t.amount, t.idempotency_key) for t in refunds) == sorted(
        (u, a, f"city-land-reset:{u}") for u, a in refunded.items()
    )
    assert all(t.balance_after == accounts[t.user_id].balance for t in refunds)
    contributions = await session.scalars(
        select(CityContribution).execution_options(populate_existing=True)
    )
    assert all(c.refund_transaction_id for c in contributions)
    states = await session.scalars(
        select(CityObject.state).execution_options(populate_existing=True)
    )
    assert set(states) == {"archived"}
    assert await session.scalar(select(func.count()).select_from(CityCell)) == 0
    status = await session.scalar(
        select(CityProject.status).execution_options(populate_existing=True)
    )
    assert status == "cancelled"
    state = await session.scalar(
        select(CityDistrictState).execution_options(populate_existing=True)
    )
    assert (state.hq_level, state.built_projects, state.open_band) == (1, 0, 1)
    notes = await session.scalars(
        select(Notification.user_id).where(Notification.title == "Районы начинаются заново")
    )
    assert sorted(notes) == sorted(refunded)
    resets = await session.scalars(select(CityEvent.district_id).where(CityEvent.kind == "reset"))
    assert list(resets) == ["support-team-1"]
    # Run again (a retried deploy): nothing more comes back.
    assert await session.run_sync(lambda s: reset(s.connection())) == {}
    await session.commit()
    count = await session.scalar(
        select(func.count())
        .select_from(CoinTransaction)
        .where(CoinTransaction.tx_type == TxType.PURCHASE_REFUND)
    )
    assert count == 2
