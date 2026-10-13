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
from app.models.settings import AuditLog
from app.models.user import CoinAccount
from app.services import city_estate, city_land
from app.services.city_economy import defaults as economy_defaults
from app.services.coins import post_transaction
from tests.conftest import auth, login, make_group, make_user

pytestmark = pytest.mark.asyncio
CITY = "/api/v1/learning/city"
ADMIN = "/api/v1/admin/learning/city"
# The tests' land is the island city's as its cells ran in rings (tests/conftest.py RING_LAND).
# District 1 of it is made of small cells, a block a band:
# block 1 is the first band, its six rows free in all 63 columns; block 2 is the second band, free
# in columns 0…33 of its twelve rows (the district's centre comes next); block 5, the outermost
# band, has the railway across it from column 43 on. A house stands on HOUSE × HOUSE cells, a
# square or an office tower on SMALL × SMALL: "plot" (c, r) of these tests is the building-sized
# square of cells from column s·c, row s·r, s being the side of the building bought there.
FIRST, SECOND = 1, 2
HOUSE, SMALL = 3, 2
#: Coins for a cell of land in each band, from the centre outwards.
LAND = [7, 5, 4, 2, 1]
# The land under a house in the first band, nine cells, and under a square or an office, four;
# with the house (120) and the square (40) on top.
HOUSE_LAND, SMALL_LAND = HOUSE * HOUSE * LAND[0], SMALL * SMALL * LAND[0]
HOUSE_PRICE, SQUARE_PRICE = HOUSE_LAND + 120, SMALL_LAND + 40
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


def side(family):
    """Cells along a side of what is bought: a house 3, a square or an office tower 2."""
    spec = city_estate.PLOT_FAMILIES.get(family)
    return spec["size"][0] if spec else HOUSE


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


async def buy(client, h, family, block, col, row, *, revision=0, op=None, cells=False, **extra):
    """Buys `family` on plot (col, row) of a block; with `cells`, from that very cell."""
    step = 1 if cells else side(family)
    return await client.post(
        CITY + "/plots",
        headers=h,
        json={
            "key": op or key(),
            "family": family,
            "block": block,
            "col": col * step,
            "row": row * step,
            "economy_revision": revision,
            **extra,
        },
    )


async def lay(client, h, family, cells, *, revision=0, op=None, **extra):
    """Lays small things of one kind on cells [block, column, row]."""
    return await client.post(
        CITY + "/decor",
        headers=h,
        json={
            "key": op or key(),
            "family": family,
            "cells": [list(c) for c in cells],
            "economy_revision": revision,
            **extra,
        },
    )


async def take_away(client, h, cells, *, op=None, **extra):
    return await client.post(
        CITY + "/decor/remove",
        headers=h,
        json={"key": op or key(), "cells": [list(c) for c in cells], **extra},
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
    assert data["land_prices"] == LAND
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
    assert (house["w"], house["h"], house["paid"]) == (HOUSE, HOUSE, HOUSE_PRICE)
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
    assert await session.scalar(select(func.count()).select_from(CityCell)) == 2 * HOUSE * HOUSE


async def test_ready_houses_are_bought_finished_at_the_price_of_their_size(
    client, session, head, team
):
    me = auth(await login(client, team.login))
    catalogue = {c["family"]: c for c in (await estate(client, me))["catalogue"]}
    ready = [f for f, c in catalogue.items() if c["ready"] and f in READY]
    assert ready == list(READY), "cheapest first"
    for family, price in READY.items():
        item = catalogue[family]
        assert item["size"] == [HOUSE, HOUSE] and item["squares"] is None
        assert len(item["levels"]) == 1
        assert item["levels"][0]["price"] == price and item["levels"][0]["name"] == item["name"]
    assert not catalogue["house"]["ready"] and not catalogue["square"]["ready"]
    # Nine cells of land of the band plus the house, at once; it has no stages to build up.
    r = await buy(client, me, "terrace", FIRST, 0, 0)
    assert r.status_code == 200, r.text
    house = r.json()["object"]
    terrace = HOUSE_LAND + 720
    assert r.json()["price"] == terrace and r.json()["balance"] == 2000 - terrace
    assert (house["family"], house["level"], house["paid"], house["w"]) == (
        "terrace",
        1,
        terrace,
        HOUSE,
    )
    up = await change(client, me, house, "upgrade", version=house["version"], economy_revision=0)
    assert up.json()["code"] == "max_level"
    # Squares beside it stay squares: where the fourth would stand is the house, and only squares
    # gather into parks.
    for u, v in ((3, 0), (3, 2), (0, 3)):
        assert not (await buy(client, me, "square", FIRST, u, v, cells=True)).json()["merged"]
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
    assert r.status_code == 200 and r.json()["price"] == HOUSE_LAND + 500
    assert sum(await spent(session)) == -(terrace + 3 * SQUARE_PRICE + HOUSE_LAND + 500)


async def test_all_supplied_office_towers_are_bought_finished_on_four_cells(client, session, team):
    me = auth(await login(client, team.login))
    await fund(session, team.id, 12_000)
    catalogue = {c["family"]: c for c in (await estate(client, me))["catalogue"]}
    assert [f for f, c in catalogue.items() if c["ready"]] == [*READY, *OFFICES]
    plots = [(col, row) for row in (0, 1) for col in range(6)]
    purchased = []
    for (family, price), (col, row) in zip(OFFICES.items(), plots, strict=False):
        item = catalogue[family]
        assert item["size"] == [SMALL, SMALL] and item["squares"] is None
        assert len(item["levels"]) == 1 and item["levels"][0]["price"] == price
        op = key()
        r = await buy(client, me, family, FIRST, col, row, op=op)
        assert r.status_code == 200, r.text
        data = r.json()
        tower = data["object"]
        assert data["price"] == SMALL_LAND + price and not data["merged"]
        assert (tower["family"], tower["w"], tower["h"]) == (family, SMALL, SMALL)
        assert tower["level"] == 1
        assert tower["paid"] == SMALL_LAND + price and tower["source"] == "purchase"
        assert (tower["module"], tower["u"], tower["v"]) == (FIRST, col * SMALL, row * SMALL)
        purchased.append(tower)
        replay = await buy(client, me, family, FIRST, col, row, op=op)
        assert replay.status_code == 200 and replay.json()["replayed"]
        assert replay.json()["object"] == tower
        assert (await buy(client, me, family, FIRST, col, row)).json()["code"] == "plot_taken"
        upgrade = await change(
            client, me, tower, "upgrade", version=tower["version"], economy_revision=0
        )
        assert upgrade.json()["code"] == "max_level"
    centre = await buy(client, me, "officea", SECOND, 34, 0, cells=True)
    assert centre.json()["code"] == "wrong_plot"
    assert (await buy(client, me, "officea", 99, 0, 0)).json()["code"] == "wrong_plot"
    assert [o["id"] for o in (await estate(client, me))["objects"]] == [o["id"] for o in purchased]
    view = await district_view(client, me)
    assert [o["family"] for o in view["objects"]] == list(OFFICES)
    taken = len(OFFICES) * SMALL * SMALL
    assert view["land"]["taken"] == view["land"]["built"] == taken
    assert await session.scalar(select(func.count()).select_from(CityCell)) == taken
    assert sum(await spent(session)) == -sum(SMALL_LAND + price for price in OFFICES.values())


async def test_saved_economies_gain_offices_and_keep_custom_prices(client, session, head, team):
    # A row saved before office towers existed keeps its prices and gains their defaults. Its land
    # was priced a plot of nine cells: a cell costs a ninth of it, a coin at least.
    saved = economy_defaults()
    saved["estate"] = {f: prices for f, prices in saved["estate"].items() if f not in OFFICES}
    saved["estate"]["terrace"] = [800]
    saved["land"] = [65, 45, 30, 20, 10]
    session.add(CityEconomy(id=1, revision=3, values=saved, updated_by_id=head.id))
    await session.commit()
    boss = auth(await login(client, head.login))
    me = auth(await login(client, team.login))
    current = (await client.get(ADMIN + "/economy", headers=boss)).json()
    current.pop("catalogue"), current.pop("can_edit")
    assert current["revision"] == 3 and current["estate"]["terrace"] == [800]
    assert current["land"] == [7, 5, 3, 2, 1]
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
    assert bought.status_code == 200 and bought.json()["price"] == SMALL * SMALL * 7 + 1000
    # Saved again, its land is priced by the cell: read back, it stays as it was.
    again = (await client.get(ADMIN + "/economy", headers=boss)).json()
    assert again["land"] == [7, 5, 3, 2, 1] and "land_unit" not in again
    # Clients omitting all estate prices preserve the complete current catalogue.
    keep = {k: v for k, v in changed.json().items() if k != "estate"}
    retained = await client.put(ADMIN + "/economy", headers=boss, json=keep)
    assert retained.status_code == 200 and retained.json()["estate"]["officea"] == [1000]
    assert set(retained.json()["estate"]) == FAMILIES
    assert retained.json()["land"] == [7, 5, 3, 2, 1]
    assert await spent(session) == [-(SMALL * SMALL * 7 + 1000)]


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


async def test_only_free_plots_of_ones_district_at_the_price_seen(client, session, head, team):
    me = auth(await login(client, team.login))
    for place, cells, code in (
        ((5, 16, 1), False, "wrong_plot"),  # the railway runs there
        ((5, 46, 3), True, "wrong_plot"),  # one of its nine cells is the railway's
        ((SECOND, 12, 0), False, "wrong_plot"),  # the district's centre
        ((99, 0, 0), False, "wrong_plot"),  # no such block
        ((FIRST, 61, 0), True, "wrong_plot"),  # past the block's last column
        ((FIRST, 0, 4), True, "wrong_plot"),  # past its last row
    ):
        r = await buy(client, me, "house", *place, cells=cells)
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
    # A building may stand a cell away from another, never over one of its cells.
    assert (await buy(client, me, "house", FIRST, 1, 1, cells=True)).json()["code"] == "plot_taken"
    # The head changes the prices: what the operator saw is no longer the price.
    boss = auth(await login(client, head.login))
    economy = (await client.get(ADMIN + "/economy", headers=boss)).json()
    economy.pop("catalogue"), economy.pop("can_edit")
    economy["land"] = [9, 5, 4, 2, 1]
    assert (await client.put(ADMIN + "/economy", headers=boss, json=economy)).status_code == 200
    stale = await buy(client, me, "square", FIRST, 1, 0)
    assert stale.status_code == 409 and stale.json()["code"] == "prices_changed"
    fresh = await buy(client, me, "square", FIRST, 1, 0, revision=1)
    dearer = SMALL * SMALL * 9 + 40
    assert fresh.status_code == 200 and fresh.json()["price"] == dearer
    poor = await make_user(session, login="poor-estate", group_id=team.group_id)
    p = auth(await login(client, poor.login))
    broke = await buy(client, p, "square", FIRST, 2, 0, revision=1)
    assert broke.status_code == 409 and broke.json()["code"] == "insufficient_coins"
    assert sorted(await spent(session)) == [-dearer, -SQUARE_PRICE]


async def test_four_squares_become_a_park_and_six_a_big_park(client, session, team):
    me = auth(await login(client, team.login))
    results = [
        (await buy(client, me, "square", FIRST, u, v)).json() for u, v in ((0, 0), (1, 0), (0, 1))
    ]
    assert [r["object"]["family"] for r in results] == ["square"] * 3
    fourth = (await buy(client, me, "square", FIRST, 1, 1)).json()
    park = fourth["object"]
    assert fourth["merged"] and park["family"] == "park" and park["level"] == 1
    assert (park["u"], park["v"], park["w"], park["h"]) == (0, 0, 2 * SMALL, 2 * SMALL)
    assert park["paid"] == 4 * SQUARE_PRICE and park["squares"] == 4
    up = await change(client, me, park, "upgrade", version=park["version"], economy_revision=0)
    assert up.status_code == 200 and up.json()["object"]["level"] == 2 and up.json()["price"] == 120
    # Two more squares beside it fill a 3 × 2 rectangle: a big park, keeping the fountain's stage.
    assert not (await buy(client, me, "square", FIRST, 2, 0)).json()["merged"]
    last = (await buy(client, me, "square", FIRST, 2, 1)).json()
    big = last["object"]
    assert last["merged"] and big["family"] == "bigpark" and big["level"] == 2
    assert (big["u"], big["v"], big["w"], big["h"], big["rotation"]) == (
        0,
        0,
        3 * SMALL,
        2 * SMALL,
        0,
    )
    assert big["paid"] == 6 * SQUARE_PRICE + 120 and big["squares"] == 6
    view = await district_view(client, me)
    assert [(o["family"], o["owner"], o["w"], o["h"]) for o in view["objects"]] == [
        ("bigpark", "mine", 3 * SMALL, 2 * SMALL)
    ]
    cells = list(await session.scalars(select(CityCell.object_id)))
    assert len(cells) == 6 * SMALL * SMALL and set(cells) == {big["id"]}
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
    assert (big["u"], big["v"], big["w"], big["h"], big["rotation"]) == (
        0,
        0,
        2 * SMALL,
        3 * SMALL,
        1,
    )
    # Land of the second band is cheaper: a cell for 5 coins instead of 7.
    assert big["paid"] == 6 * (SMALL * SMALL * LAND[1] + 40)


async def test_squares_of_a_neighbour_or_a_house_in_the_way_do_not_merge(client, session, team):
    me = auth(await login(client, team.login))
    neighbour = await make_user(session, login="neighbour-merge", group_id=team.group_id)
    await fund(session, neighbour.id, 500)
    n = auth(await login(client, neighbour.login))
    for u, v in ((0, 0), (1, 0), (0, 1)):
        await buy(client, me, "square", FIRST, u, v)
    assert not (await buy(client, n, "square", FIRST, 1, 1)).json()["merged"]
    # A house where the fourth square of a park would be.
    assert (await buy(client, me, "house", FIRST, 8, 2, cells=True)).status_code == 200
    for u, v in ((6, 0), (8, 0), (6, 2)):
        assert not (await buy(client, me, "square", FIRST, u, v, cells=True)).json()["merged"]
    families = await session.scalars(select(CityObject.family).where(CityObject.state == "placed"))
    assert sorted(families) == ["house"] + ["square"] * 7


async def test_every_band_is_open_before_building_and_filling_land_does_not_unlock_it(
    client, session, team
):
    me = auth(await login(client, team.login))
    await fund(session, team.id, 8000)
    totals = city_land.band_totals("support-team-1")
    assert totals[0] == 63 * 6 and len(totals) == 5
    # Every plot of the first band: twenty-one side by side in each of its two rows.
    first = [(FIRST, u, v) for u in range(21) for v in (0, 1)]
    # A team may start in the outermost part before building anything nearer the centre.
    empty = (await district_view(client, me))["land"]
    assert empty["open_band"] == 5 and empty["taken"] == 0
    outer = await buy(client, me, "house", 5, 0, 0)
    assert outer.status_code == 200 and outer.json()["price"] == HOUSE * HOUSE * LAND[4] + 120
    for place in first[:-1]:
        assert (await buy(client, me, "house", *place)).status_code == 200
    assert (await district_view(client, me))["land"]["open_band"] == 5
    assert (await buy(client, me, "house", *first[-1])).status_code == 200
    land = (await district_view(client, me))["land"]
    need = len(first) * HOUSE * HOUSE
    assert land["open_band"] == 5 and land["cells"] == sum(totals)
    assert land["taken"] == land["built"] == need + HOUSE * HOUSE
    # The band is full, every one of its cells under a house.
    assert land["bands"][0] == {"band": 1, "cells": totals[0], "taken": need}
    assert need == totals[0]
    r = await buy(client, me, "house", SECOND, 0, 0)
    assert r.status_code == 200 and r.json()["price"] == HOUSE * HOUSE * LAND[1] + 120
    bands = await session.scalars(select(CityEvent.payload).where(CityEvent.kind == "band"))
    assert list(bands) == []


async def test_a_transfer_takes_buildings_along_to_the_inventory(
    client, session, estate_admin, head, team
):
    me = auth(await login(client, team.login))
    house = (await buy(client, me, "house", FIRST, 0, 0)).json()["object"]
    await change(client, me, house, "upgrade", version=house["version"], economy_revision=0)
    await buy(client, me, "square", FIRST, 3, 0, cells=True)
    await buy(client, me, "officea", FIRST, 5, 0, cells=True)
    # A road and a lamp of their own, and a teammate who stays.
    assert (await lay(client, me, "road", [(FIRST, c, 3) for c in range(3)])).status_code == 200
    assert (await lay(client, me, "lamp", [(FIRST, 3, 3)])).status_code == 200
    mate = await make_user(session, login="mate-stays", group_id=team.group_id)
    m = auth(await login(client, mate.login))
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
    # The road and the lamp stay for the team, now the district's; their coins came back.
    left = list(await session.scalars(select(CityCell).order_by(CityCell.u)))
    assert [(c.u, c.decor, c.owner_id, c.paid) for c in left] == [
        (0, "road", None, 0),
        (1, "road", None, 0),
        (2, "road", None, 0),
        (3, "lamp", None, 0),
    ]
    back = await session.scalar(
        select(CoinTransaction).where(CoinTransaction.idempotency_key.like("city-decor-left:%"))
    )
    assert (back.user_id, back.amount, back.tx_type) == (team.id, 15 + 15, TxType.PURCHASE_REFUND)
    old = await district_view(client, m)
    assert not old["objects"]
    assert old["decor"] == {
        "lamp": [[FIRST, 3, 3, 1]],
        "road": [[FIRST, c, 3, 1] for c in range(3)],
    }
    # Any operator of the district may take the district's away; it costs nothing, so nothing
    # comes back.
    gone = await take_away(client, m, [(FIRST, 3, 3)])
    assert gone.status_code == 200 and gone.json()["refunded"] == 0
    seen = (await district_view(client, me, "support", "support-team-1"))["decor"]
    assert seen == {"road": [[FIRST, c, 3, 0] for c in range(3)]}
    stored = next(o for o in data["objects"] if o["family"] == "house")
    placed = await change(
        client, me, stored, "place", version=stored["version"], block=2, col=0, row=0
    )
    assert placed.status_code == 200, placed.text
    house = placed.json()["object"]
    assert (house["state"], house["district_id"], house["module"], house["level"]) == (
        "placed",
        "sales-team-1",
        2,
        2,
    )
    again = await change(
        client, me, house, "place", version=house["version"], block=2, col=HOUSE, row=0
    )
    assert again.status_code == 404
    office = next(o for o in data["objects"] if o["family"] == "officea")
    over = await change(
        client, me, office, "place", version=office["version"], block=2, col=HOUSE - 1, row=0
    )
    assert over.json()["code"] == "plot_taken"
    placed_office = await change(
        client, me, office, "place", version=office["version"], block=2, col=HOUSE, row=0
    )
    assert placed_office.status_code == 200, placed_office.text
    assert placed_office.json()["object"]["state"] == "placed"
    assert placed_office.json()["object"]["paid"] == SMALL_LAND + 900
    view = await district_view(client, me, "sales", "sales-team-1")
    assert [(o["family"], o["owner"]) for o in view["objects"]] == [
        ("house", "mine"),
        ("officea", "mine"),
    ]
    # Moving cost nothing: the journal has only the purchases.
    assert sorted(await spent(session)) == sorted(
        [-(SMALL_LAND + 900), -HOUSE_PRICE, -180, -SQUARE_PRICE, -15, -15]
    )
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
    land = view["land"]
    assert (land["cells"], land["taken"], land["built"], land["open_band"]) == (
        city_land.plot_count("support-team-1"),
        HOUSE * HOUSE,
        HOUSE * HOUSE,
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
            "id": "support-team-4",
            "name": "Район 4",
            "group_ids": [],
            "supervisor_id": None,
            "construction": True,
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
    await buy(client, me, "square", FIRST, HOUSE, 0, cells=True)
    await make_user(session, login="loner-estate")
    boss = auth(await login(client, head.login))
    report = (await client.get(ADMIN + "/estates", headers=boss)).json()
    first = next(d for d in report["districts"] if d["id"] == "support-team-1")
    assert first["land"] == {
        "cells": city_land.plot_count("support-team-1"),
        "taken": HOUSE * HOUSE + SMALL * SMALL,
        "built": HOUSE * HOUSE + SMALL * SMALL,
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
    assert economy["land"] == LAND
    assert set(economy["estate"]) == FAMILIES
    for bad in ({"land": [7, 5]}, {"land": [7, 5, 4, 2, -1]}, {"land": [7, 5, 4, 2, 100_001]}):
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
    assert r.status_code == 200 and r.json()["land"] == LAND


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


async def test_small_things_are_laid_on_free_cells_of_the_district_and_paid_together(
    client, session, team
):
    me = auth(await login(client, team.login))
    mine = await estate(client, me)
    assert [d["family"] for d in mine["decor"]] == list(city_estate.DECOR_FAMILIES)
    assert {d["family"]: d["price"] for d in mine["decor"]} == city_estate.DECOR_PRICES
    assert mine["decor_batch"] == city_estate.DECOR_BATCH == 400
    road = [(FIRST, c, 3) for c in range(5)]
    r = await lay(client, me, "road", road, district_id="support-team-1")
    assert r.status_code == 200, r.text
    assert (r.json()["laid"], r.json()["price"], r.json()["balance"]) == (5, 25, 2000 - 25)
    rows = list(await session.scalars(select(CityCell).order_by(CityCell.u)))
    assert [(c.module, c.u, c.v, c.decor, c.owner_id, c.paid, c.object_id) for c in rows] == [
        (FIRST, c, 3, "road", team.id, 5, None) for c in range(5)
    ]
    # Everyone sees them, the viewer's own marked; they take land but build nothing.
    view = await district_view(client, me)
    assert view["decor"] == {"road": [[FIRST, c, 3, 1] for c in range(5)]}
    assert (view["land"]["taken"], view["land"]["built"]) == (5, 0)
    neighbour = await make_user(session, login="neighbour-decor", group_id=team.group_id)
    await fund(session, neighbour.id, 300)
    n = auth(await login(client, neighbour.login))
    seen = (await district_view(client, n))["decor"]
    assert seen == {"road": [[FIRST, c, 3, 0] for c in range(5)]}
    # A repeated key replays the first result and never pays twice.
    op, lamps = key(), [(FIRST, 0, 4), (FIRST, 4, 4)]
    first = await lay(client, me, "lamp", lamps, op=op)
    again = await lay(client, me, "lamp", lamps, op=op)
    assert again.json()["replayed"] and again.json()["price"] == first.json()["price"] == 30
    # Any operator of the district builds on any free cell; one cell wrong refuses the batch.
    for cells, code in (
        ([(FIRST, 5, 3), (FIRST, 4, 3)], "plot_taken"),  # a road stands there already
        ([(5, 48, 3)], "wrong_plot"),  # the railway
        ([(FIRST, 63, 0)], "wrong_plot"),  # past the block's last column
        ([(SECOND, 40, 2)], "wrong_plot"),  # the district's centre
        ([(FIRST, 6, 5), (FIRST, 6, 5)], "cells_repeated"),
    ):
        refused = await lay(client, n, "tree", cells)
        assert refused.status_code == 409 and refused.json()["code"] == code, (cells, refused.text)
    assert await session.scalar(select(func.count()).where(CityCell.u == 5)) == 0
    assert (await lay(client, n, "castle", [(FIRST, 6, 5)])).status_code == 404
    assert (await lay(client, n, "tree", [])).status_code == 422
    too_many = [(3, i % 117, i // 117) for i in range(city_estate.DECOR_BATCH + 1)]
    assert (await lay(client, n, "tree", too_many)).status_code == 422
    elsewhere = await lay(client, n, "tree", [(FIRST, 6, 5)], district_id="support-team-2")
    assert elsewhere.json()["code"] == "district_changed"
    # A building and a small thing never share a cell, either way round.
    over_road = await buy(client, n, "house", FIRST, 3, 2, cells=True)
    assert over_road.json()["code"] == "plot_taken"
    assert (await buy(client, n, "house", FIRST, 3, 0)).status_code == 200
    assert (await lay(client, me, "tree", [(FIRST, 10, 1)])).json()["code"] == "plot_taken"
    # What one saw is what one pays; with no coins left one lays nothing.
    stale = await lay(client, n, "tree", [(FIRST, 6, 5)], revision=1)
    assert stale.json()["code"] == "prices_changed"
    poor = await make_user(session, login="poor-decor", group_id=team.group_id)
    p = auth(await login(client, poor.login))
    assert (await lay(client, p, "lamp", [(FIRST, 7, 5)])).json()["code"] == "insufficient_coins"
    # An alley: a footpath with a tree on either side, at its own price a cell, its land included.
    alley = await lay(client, me, "alley", [(FIRST, c, 5) for c in range(3)])
    assert alley.status_code == 200, alley.text
    assert city_estate.DECOR_PRICES["alley"] == 18
    assert (alley.json()["laid"], alley.json()["price"]) == (3, 3 * 18)
    assert sorted(await spent(session)) == sorted([-25, -30, -HOUSE_PRICE, -54])


async def test_taking_small_things_away_returns_what_they_cost_and_only_ones_own(
    client, session, head, team
):
    me = auth(await login(client, team.login))
    assert (await lay(client, me, "lamp", [(FIRST, 0, 0), (FIRST, 1, 0)])).status_code == 200
    # The head makes lamps dearer: a new lamp costs the new price, an old one returns what it cost.
    boss = auth(await login(client, head.login))
    economy = (await client.get(ADMIN + "/economy", headers=boss)).json()
    economy.pop("catalogue"), economy.pop("can_edit")
    dearer = {**economy["decor"], "lamp": 40}
    changed = await client.put(ADMIN + "/economy", headers=boss, json={**economy, "decor": dearer})
    assert changed.status_code == 200, changed.text
    revision = changed.json()["revision"]
    dear = await lay(client, me, "lamp", [(FIRST, 2, 0)], revision=revision)
    assert dear.json()["price"] == 40
    neighbour = await make_user(session, login="neighbour-away", group_id=team.group_id)
    await fund(session, neighbour.id, 300)
    n = auth(await login(client, neighbour.login))
    assert (await lay(client, n, "road", [(FIRST, 3, 0)], revision=revision)).status_code == 200
    house = await buy(client, n, "house", FIRST, 2, 1, revision=revision)
    assert house.status_code == 200, house.text
    # A neighbour's road is theirs: refused, and nothing of the batch goes. Nothing to take away
    # on a free cell, nor a building, which is no small thing.
    assert (await take_away(client, me, [(FIRST, 0, 0), (FIRST, 3, 0)])).status_code == 403
    for cells in ([(FIRST, 4, 0)], [(FIRST, 6, 3)], [(FIRST, 0, 0), (FIRST, 0, 0)]):
        refused = await take_away(client, me, cells)
        assert refused.json()["code"] in ("decor_missing", "cells_repeated"), refused.text
    op = key()
    gone = await take_away(client, me, [(FIRST, 0, 0), (FIRST, 2, 0)], op=op)
    assert gone.status_code == 200, gone.text
    assert (gone.json()["removed"], gone.json()["refunded"]) == (2, 15 + 40)
    assert gone.json()["balance"] == 2000 - 15 * 2 - 40 + 55
    replay = await take_away(client, me, [(FIRST, 0, 0), (FIRST, 2, 0)], op=op)
    assert replay.json()["replayed"] and replay.json()["refunded"] == 55
    refunds = await session.scalars(
        select(CoinTransaction).where(CoinTransaction.tx_type == TxType.PURCHASE_REFUND)
    )
    assert [(t.user_id, t.amount, t.idempotency_key) for t in refunds] == [
        (team.id, 55, f"city-op:{team.id}:{op}")
    ]
    left = await session.scalars(
        select(CityCell.u).where(CityCell.decor.is_not(None)).order_by(CityCell.u)
    )
    assert list(left) == [1, 3]
    # The freed cells take something new at once, of anyone in the district.
    assert (await lay(client, n, "tree", [(FIRST, 0, 0)], revision=revision)).status_code == 200
    events = await session.scalars(select(CityEvent.payload).where(CityEvent.kind == "decor"))
    assert [e["do"] for e in events] == ["lay", "lay", "lay", "remove", "lay"]


async def test_an_owner_turns_a_buildings_front_where_no_road_decides_it(client, session, team):
    me = auth(await login(client, team.login))
    house = (await buy(client, me, "house", FIRST, 0, 0, rotation=3)).json()["object"]
    assert house["rotation"] == 3
    turned = await change(client, me, house, "turn", version=house["version"], rotation=1)
    assert turned.status_code == 200, turned.text
    obj = turned.json()["object"]
    assert (obj["rotation"], obj["version"], obj["u"], obj["v"]) == (1, house["version"] + 1, 0, 0)
    stale = await change(client, me, house, "turn", version=house["version"], rotation=2)
    assert stale.json()["code"] == "stale_object"
    wrong = await change(client, me, obj, "turn", version=obj["version"], rotation=4)
    assert wrong.status_code == 422
    neighbour = await make_user(session, login="neighbour-turn", group_id=team.group_id)
    n = auth(await login(client, neighbour.login))
    foreign = await change(client, n, obj, "turn", version=obj["version"], rotation=2)
    assert foreign.status_code == 404
    # A park has no front to turn.
    for u, v in ((3, 0), (5, 0), (3, 2)):
        await buy(client, me, "square", FIRST, u, v, cells=True)
    park = (await buy(client, me, "square", FIRST, 5, 2, cells=True)).json()["object"]
    assert park["family"] == "park"
    no_front = await change(client, me, park, "turn", version=park["version"], rotation=1)
    assert no_front.json()["code"] == "no_front"
    # Turning is free, and the district's history keeps it.
    assert sorted(await spent(session)) == sorted([-HOUSE_PRICE] + [-SQUARE_PRICE] * 4)
    turns = await session.scalars(select(CityEvent.payload).where(CityEvent.kind == "turn"))
    assert list(turns) == [{"to": 1}]


async def test_the_economy_tab_sets_the_price_of_a_cell_of_every_small_thing(
    client, session, head, team
):
    boss = auth(await login(client, head.login))
    economy = (await client.get(ADMIN + "/economy", headers=boss)).json()
    economy.pop("catalogue"), economy.pop("can_edit")
    assert economy["decor"] == city_estate.DECOR_PRICES
    assert economy["decor"]["road"] == 5 and economy["decor"]["lamp"] == 15
    for bad in (
        {**economy["decor"], "castle": 5},
        {k: v for k, v in economy["decor"].items() if k != "road"},
        {**economy["decor"], "road": -1},
        {**economy["decor"], "road": 100_001},
    ):
        r = await client.put(ADMIN + "/economy", headers=boss, json={**economy, "decor": bad})
        assert r.status_code == 422, bad
    free_roads = {**economy["decor"], "road": 0}
    free = await client.put(ADMIN + "/economy", headers=boss, json={**economy, "decor": free_roads})
    assert free.status_code == 200 and free.json()["decor"]["road"] == 0
    # A form of the earlier version, without these prices, keeps them.
    older = {k: v for k, v in free.json().items() if k != "decor"}
    retained = await client.put(ADMIN + "/economy", headers=boss, json=older)
    assert retained.status_code == 200 and retained.json()["decor"]["road"] == 0
    # A free road costs nothing, and its journal stays untouched; a lamp keeps its price.
    me = auth(await login(client, team.login))
    revision = retained.json()["revision"]
    assert (await lay(client, me, "road", [(FIRST, 0, 0)], revision=revision)).json()["price"] == 0
    assert (await lay(client, me, "lamp", [(FIRST, 1, 0)], revision=revision)).json()["price"] == 15
    assert await spent(session) == [-15]
    gone = await take_away(client, me, [(FIRST, 0, 0)])
    assert gone.status_code == 200 and gone.json()["refunded"] == 0
    assert await spent(session, TxType.PURCHASE_REFUND) == []


def cells_module():
    path = Path(__file__).resolve().parent.parent / "alembic/versions/20261012_city_cells.py"
    spec = importlib.util.spec_from_file_location("city_cells_reset", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_the_cells_reset_refunds_buildings_and_open_contributions_once(
    session, supervisor, operator
):
    """What the migration to small cells does with the districts built before (20261012)."""
    await fund(session, operator.id, 1000)
    mate = await make_user(session, login="mate-cells", group_id=operator.group_id)
    await fund(session, mate.id, 300)

    def building(family, state, paid, district_id="support-team-1", **place):
        where = {"module": 1, "u": 0, "v": 0} if state == "placed" else {}
        return CityObject(
            district_id=district_id,
            owner_id=operator.id,
            family=family,
            level=1,
            state=state,
            rotation=0,
            source="purchase",
            paid=paid,
            **{**where, **place},
        )

    house = building("house", "placed", 300)
    park = building("park", "placed", 400, u=3)
    stored = building("square", "stored", 100)
    # Squares merged into the park: their coins are the park's already.
    consumed = building("square", "consumed", 100)
    # The administrators' test city never cost anything.
    test_city = building("house", "placed", 999, district_id="test-support-team-1")
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
    session.add_all([house, park, stored, consumed, test_city, project])
    await session.flush()
    session.add_all(
        [
            CityCell(district_id="support-team-1", module=1, u=0, v=0, object_id=house.id),
            CityCell(district_id="support-team-1", module=0, u=2, v=2, project_id=project.id),
            CityCell(district_id="test-support-team-1", module=1, u=0, v=0, object_id=test_city.id),
            CityDistrictState(
                district_id="support-team-1",
                hq_level=3,
                built_projects=4,
                open_band=5,
                landmark_peak_plots=40,
            ),
        ]
    )
    gifts = ((operator, 40, False), (mate, 70, False), (mate, 25, True))
    for user, amount, refunded_before in gifts:
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
        if refunded_before:
            back = await post_transaction(
                session,
                user_id=user.id,
                amount=amount,
                tx_type=TxType.PURCHASE_REFUND,
                reason="Возврат",
                idempotency_key=f"city-refund:{user.id}:old",
                evaluate_achievements=False,
            )
            item.refund_transaction_id = back.id
        session.add(item)
    project.funded = 110
    await session.commit()
    before = {
        a.user_id: (a.balance, a.total_earned, a.total_spent)
        for a in await session.scalars(select(CoinAccount))
    }
    reset = cells_module().reset_cells
    refunded = await session.run_sync(lambda s: reset(s.connection()))
    await session.commit()
    assert refunded == {operator.id: 300 + 400 + 100 + 40, mate.id: 70}
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
    resets = list(
        await session.scalars(
            select(CoinTransaction).where(
                CoinTransaction.idempotency_key.like("city-cells-reset:%")
            )
        )
    )
    assert sorted((t.user_id, t.amount, t.tx_type) for t in resets) == sorted(
        (u, a, TxType.PURCHASE_REFUND) for u, a in refunded.items()
    )
    assert all(t.balance_after == accounts[t.user_id].balance for t in resets)
    by_user = {t.user_id: t for t in resets}
    assert by_user[operator.id].meta == {"buildings": 800, "contributions": 40}
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
    assert (state.hq_level, state.built_projects, state.landmark_peak_plots) == (1, 0, 0)
    notes = await session.scalars(
        select(Notification).where(Notification.title == "Районы начинаются заново")
    )
    notes = list(notes)
    assert sorted(n.user_id for n in notes) == sorted(refunded)
    assert all(n.link == "/training/city" and "клетки" in n.body for n in notes)
    resets = await session.scalars(select(CityEvent.district_id).where(CityEvent.kind == "reset"))
    assert sorted(resets) == ["support-team-1", "test-support-team-1"]
    audit = await session.scalar(select(AuditLog).where(AuditLog.action == "city.land.reset"))
    assert audit.payload == {
        "users": 2,
        "coins": 910,
        "districts": ["support-team-1", "test-support-team-1"],
    }
    # Run again (a retried deploy): nothing more comes back.
    assert await session.run_sync(lambda s: reset(s.connection())) == {}
    await session.commit()
    count = await session.scalar(
        select(func.count())
        .select_from(CoinTransaction)
        .where(CoinTransaction.idempotency_key.like("city-cells-reset:%"))
    )
    assert count == 2


def squares_module():
    path = Path(__file__).resolve().parent.parent / "alembic/versions/20261012_city_squares.py"
    spec = importlib.util.spec_from_file_location("city_squares_reset", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_the_square_grid_starts_the_support_districts_again_and_refunds_once(
    session, supervisor, operator
):
    """What the island city's square grid does with its districts (20261012_city_squares): the
    support districts and their test copies start again, the sales districts keep everything."""
    await fund(session, operator.id, 1000)
    mate = await make_user(session, login="mate-squares", group_id=operator.group_id)
    await fund(session, mate.id, 300)

    def building(family, state, paid, district_id="support-team-1", **place):
        where = {"module": 1, "u": 0, "v": 0} if state == "placed" else {}
        return CityObject(
            district_id=district_id,
            owner_id=operator.id,
            family=family,
            level=1,
            state=state,
            rotation=0,
            source="purchase",
            paid=paid,
            **{**where, **place},
        )

    def project(district_id):
        return CityProject(
            district_id=district_id,
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

    house, stored = building("house", "placed", 300), building("square", "stored", 100)
    # Squares merged into a park: their coins are the park's already.
    consumed = building("square", "consumed", 100)
    sales = building("house", "placed", 500, district_id="sales-team-1")
    # The administrators' test city never cost anything; its sales copy stays as it is too.
    test_city = building("house", "placed", 999, district_id="test-support-team-1")
    test_sales = building("house", "placed", 999, district_id="test-sales-team-1")
    support_project, sales_project = project("support-team-1"), project("sales-team-1")
    objects = [house, stored, consumed, sales, test_city, test_sales]
    session.add_all([*objects, support_project, sales_project])
    await session.flush()

    def cell(district_id, u, **what):
        return CityCell(district_id=district_id, module=1, u=u, v=0, **what)

    session.add_all(
        [
            cell("support-team-1", 0, object_id=house.id),
            cell("support-team-1", 5, decor="road", owner_id=operator.id, paid=6),
            cell("support-team-1", 6, decor="tree", owner_id=mate.id, paid=4),
            cell("sales-team-1", 0, object_id=sales.id),
            cell("sales-team-1", 5, decor="road", owner_id=operator.id, paid=6),
            cell("test-support-team-1", 0, object_id=test_city.id),
            cell("test-support-team-1", 3, decor="lamp", owner_id=operator.id, paid=0),
            CityDistrictState(
                district_id="support-team-1", hq_level=3, built_projects=4, landmark_peak_plots=40
            ),
            CityDistrictState(
                district_id="sales-team-1", hq_level=2, built_projects=1, landmark_peak_plots=12
            ),
        ]
    )
    gifts = (
        (operator, 40, support_project),
        (mate, 70, support_project),
        (mate, 25, sales_project),
    )
    for user, amount, target in gifts:
        tx = await post_transaction(
            session,
            user_id=user.id,
            amount=-amount,
            tx_type=TxType.CITY_CONTRIBUTION,
            reason="Проект района",
            idempotency_key=f"city-op:{user.id}:c{amount}",
        )
        session.add(
            CityContribution(
                project_id=target.id, user_id=user.id, amount=amount, transaction_id=tx.id
            )
        )
    await session.commit()
    before = {
        a.user_id: (a.balance, a.total_earned, a.total_spent)
        for a in await session.scalars(select(CoinAccount))
    }
    reset = squares_module().reset_support
    refunded = await session.run_sync(lambda s: reset(s.connection()))
    await session.commit()
    # The support district's buildings standing or stored, its small things, the gifts to it.
    assert refunded == {operator.id: 300 + 100 + 6 + 40, mate.id: 4 + 70}
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
    resets = list(
        await session.scalars(
            select(CoinTransaction).where(
                CoinTransaction.idempotency_key.like("city-squares-reset:%")
            )
        )
    )
    assert sorted((t.user_id, t.amount, t.tx_type) for t in resets) == sorted(
        (u, a, TxType.PURCHASE_REFUND) for u, a in refunded.items()
    )
    assert all(t.balance_after == accounts[t.user_id].balance for t in resets)
    by_user = {t.user_id: t for t in resets}
    assert by_user[operator.id].meta == {"buildings": 400, "decor": 6, "contributions": 40}
    assert by_user[mate.id].meta == {"buildings": 0, "decor": 4, "contributions": 70}
    contributions = await session.scalars(
        select(CityContribution).execution_options(populate_existing=True)
    )
    returned = {(c.project_id, c.amount): bool(c.refund_transaction_id) for c in contributions}
    assert returned == {
        (support_project.id, 40): True,
        (support_project.id, 70): True,
        (sales_project.id, 25): False,
    }
    states = {
        o.district_id + ":" + o.family + ":" + str(o.paid): o.state
        for o in await session.scalars(select(CityObject).execution_options(populate_existing=True))
    }
    assert states == {
        "support-team-1:house:300": "archived",
        "support-team-1:square:100": "archived",
        "sales-team-1:house:500": "placed",
        "test-support-team-1:house:999": "archived",
        "test-sales-team-1:house:999": "placed",
    }
    left = await session.execute(select(CityCell.district_id, CityCell.u))
    assert sorted(left.all()) == [("sales-team-1", 0), ("sales-team-1", 5)]
    projects = await session.execute(
        select(CityProject.district_id, CityProject.status).execution_options(
            populate_existing=True
        )
    )
    assert sorted(projects.all()) == [("sales-team-1", "open"), ("support-team-1", "cancelled")]
    districts = await session.scalars(
        select(CityDistrictState).execution_options(populate_existing=True)
    )
    assert {
        d.district_id: (d.hq_level, d.built_projects, d.landmark_peak_plots) for d in districts
    } == {"support-team-1": (1, 0, 0), "sales-team-1": (2, 1, 12)}
    notes = list(
        await session.scalars(
            select(Notification).where(
                Notification.title == "Районы Техподдержки начинаются заново"
            )
        )
    )
    assert sorted(n.user_id for n in notes) == sorted(refunded)
    bodies = {n.user_id: n.body for n in notes}
    assert all("квадратные" in body for body in bodies.values())
    assert bodies[operator.id].endswith("446 коинов.") and bodies[mate.id].endswith("74 коина.")
    events = await session.scalars(select(CityEvent).where(CityEvent.kind == "reset"))
    assert sorted((e.district_id, e.payload["land"]) for e in events) == [
        ("support-team-1", "squares"),
        ("test-support-team-1", "squares"),
    ]
    audit = await session.scalar(
        select(AuditLog).where(
            AuditLog.action == "city.land.reset", AuditLog.entity_id == "squares"
        )
    )
    assert audit.payload == {
        "users": 2,
        "coins": 446 + 74,
        "districts": ["support-team-1", "test-support-team-1"],
    }
    # Run again (a retried deploy): nothing more comes back.
    assert await session.run_sync(lambda s: reset(s.connection())) == {}
    await session.commit()
    count = await session.scalar(
        select(func.count())
        .select_from(CoinTransaction)
        .where(CoinTransaction.idempotency_key.like("city-squares-reset:%"))
    )
    assert count == 2


def sizes_module():
    path = Path(__file__).resolve().parent.parent / "alembic/versions/20261012_city_sizes.py"
    spec = importlib.util.spec_from_file_location("city_sizes", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_the_sizes_migration_frees_the_cells_beyond_a_buildings_new_size(session, operator):
    """Squares, office towers and parks bought on 3 × 3 plots keep their first cells (20261012)."""

    def building(family, block, u, rotation=0, state="placed"):
        return CityObject(
            district_id="support-team-1",
            owner_id=operator.id,
            family=family,
            level=1,
            state=state,
            module=block if state == "placed" else None,
            u=u if state == "placed" else None,
            v=0 if state == "placed" else None,
            rotation=rotation,
            source="purchase",
            paid=100,
        )

    # What each stood on before: a plot of 3 × 3 cells, a park on 2 × 2 plots, a big park on 3 × 2
    # (upright: 2 × 3).
    old = {
        "square": (building("square", FIRST, 0), 3, 3),
        "officea": (building("officea", FIRST, 3, rotation=1), 3, 3),
        "house": (building("house", FIRST, 6), 3, 3),
        "park": (building("park", FIRST, 9), 6, 6),
        "bigpark": (building("bigpark", SECOND, 0, rotation=1), 6, 9),
    }
    stored = building("square", FIRST, 0, state="stored")
    legacy = await legacy_square(session)
    session.add_all([obj for obj, _w, _h in old.values()] + [stored])
    await session.flush()
    for obj, w, h in old.values():
        session.add_all(
            CityCell(district_id=obj.district_id, module=obj.module, u=u, v=v, object_id=obj.id)
            for u in range(obj.u, obj.u + w)
            for v in range(obj.v, obj.v + h)
        )
    await session.commit()
    shrink = sizes_module().shrink
    freed = await session.run_sync(lambda s: shrink(s.connection()))
    await session.commit()
    assert freed == (9 - 4) * 2 + (36 - 16) + (54 - 24)
    left = {}
    for cell in await session.scalars(select(CityCell)):
        left.setdefault(cell.object_id, set()).add((cell.u, cell.v))

    def first_cells(obj, w, h):
        return {(u, v) for u in range(obj.u, obj.u + w) for v in range(obj.v, obj.v + h)}

    kept = {"square": (2, 2), "officea": (2, 2), "house": (3, 3), "park": (4, 4), "bigpark": (4, 6)}
    for family, (obj, _w, _h) in old.items():
        assert left[obj.id] == first_cells(obj, *kept[family]), family
    assert left[legacy.id] == {(11, 11)} and stored.id not in left
    # Run again (a retried deploy): nothing more goes.
    assert await session.run_sync(lambda s: shrink(s.connection())) == 0
