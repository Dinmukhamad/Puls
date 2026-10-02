"""The administrators' test city (app/services/city_sandbox.py), kept apart from the real one."""

import pytest
from sqlalchemy import func, select

from app.models.city_estate import CityCell, CityDistrictState, CityObject, CityProject
from app.models.coin import CoinTransaction
from app.models.enums import Role
from app.models.progress import Notification
from app.services import city_land
from tests.conftest import auth, login, make_user
from tests.test_city_estate import (
    ADMIN,
    CITY,
    FIRST,
    OFFICES,
    SECOND,
    buy,
    district_view,
    estate,
    fund,
    legacy_square,
    open_world,
)

pytestmark = pytest.mark.asyncio
SANDBOX = ADMIN + "/sandbox"


@pytest.fixture
async def admin(session):
    return await make_user(session, login="admin-sandbox", role=Role.ADMIN)


@pytest.fixture
async def me(client, admin):
    return auth(await login(client, admin.login))


async def sandbox(client, h, city="support", district="support-team-1"):
    r = await client.get(f"{SANDBOX}/cities/{city}", headers=h)
    assert r.status_code == 200, r.text
    assert r.headers["cache-control"] == "private, no-store"
    return next(d for d in r.json()["districts"] if d["id"] == district)


async def build(client, h, family, block, col, row, district="support-team-1"):
    return await client.post(
        f"{SANDBOX}/plots",
        headers=h,
        json={"district_id": district, "family": family, "block": block, "col": col, "row": row},
    )


async def level(client, h, obj, value):
    return await client.post(
        f"{SANDBOX}/buildings/{obj['id']}/level", headers=h, json={"level": value}
    )


async def district(client, h, district_id="support-team-1", **body):
    return await client.put(f"{SANDBOX}/districts/{district_id}", headers=h, json=body)


async def project(client, h, family, district_id="support-team-1", **place):
    return await client.post(
        f"{SANDBOX}/projects",
        headers=h,
        json={"district_id": district_id, "family": family, **place},
    )


async def count(session, model, *where):
    return await session.scalar(select(func.count()).select_from(model).where(*where))


def first_plot(district_id):
    """The first plot for sale in the district's first band: (block, column, row)."""
    for number, b in sorted(city_land.blocks(district_id).items()):
        free = [
            (c, r) for r in range(b["rows"]) for c in range(b["cols"]) if (c, r) not in b["skip"]
        ]
        if b["band"] == 1 and free:
            return number, *free[0]
    raise AssertionError(district_id)


async def test_only_administrators_open_the_test_city(
    client, session, head, supervisor, operator, me
):
    trainer = await make_user(session, login="trainer-sandbox", role=Role.TRAINER)
    for user in (head, supervisor, operator, trainer):
        h = auth(await login(client, user.login))
        assert (await client.get(f"{SANDBOX}/cities/support", headers=h)).status_code == 403
        assert (await build(client, h, "house", FIRST, 0, 0)).status_code == 403
        assert (await district(client, h, open_band=2)).status_code == 403
        assert (await project(client, h, "square", u=0, v=0)).status_code == 403
        assert (await client.post(f"{SANDBOX}/cities/support/reset", headers=h)).status_code == 403
    r = await client.get(f"{SANDBOX}/cities/support", headers=me)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["city"] == "support" and data["sandbox"] is True
    # The same three districts on the same land, under the ids of the real ones.
    assert [d["id"] for d in data["districts"]] == [f"support-team-{n}" for n in (1, 2, 3)]
    first = data["districts"][0]
    assert first["construction"] and first["managed"] and not first["mine"]
    assert first["land"]["plots"] == city_land.plot_count("support-team-1")
    assert first["land"]["taken"] == 0 and first["land"]["open_band"] == 1
    assert first["objects"] == [] and first["projects"] == [] and first["hq"]["level"] == 1
    assert (await client.get(f"{SANDBOX}/cities/north", headers=me)).status_code == 404
    assert (await build(client, me, "house", FIRST, 0, 0, "support-team-4")).status_code == 422
    assert await count(session, CityObject) == 0


async def test_administrators_build_for_free_and_set_any_stage(client, session, admin, me):
    r = await build(client, me, "house", FIRST, 0, 0)
    assert r.status_code == 200, r.text
    house = r.json()["object"]
    assert (house["family"], house["level"], house["owner"]) == ("house", 1, "mine")
    assert (house["module"], house["u"], house["v"], r.json()["merged"]) == (FIRST, 0, 0, False)
    # Up to the mansion at once, and down again.
    for value in (5, 2, 4):
        r = await level(client, me, house, value)
        assert r.status_code == 200, r.text
        assert r.json()["object"]["level"] == value
    assert (await level(client, me, house, 6)).json()["code"] == "bad_level"
    assert (await level(client, me, house, 0)).status_code == 422
    view = await sandbox(client, me)
    assert [(o["family"], o["level"]) for o in view["objects"]] == [("house", 4)]
    assert view["land"]["taken"] == 1
    # The rules of the land stay the real ones.
    assert (await build(client, me, "house", FIRST, 0, 0)).json()["code"] == "plot_taken"
    assert (await build(client, me, "park", FIRST, 4, 0)).json()["code"] == "recipe_only"
    assert (await build(client, me, "house", 99, 0, 0)).json()["code"] == "wrong_plot"
    assert (await build(client, me, "house", SECOND, 0, 0)).json()["code"] == "band_closed"
    # Ready houses too, finished as they are: one stage.
    ready = await build(client, me, "bungalow", FIRST, 1, 0)
    assert ready.status_code == 200 and ready.json()["object"]["family"] == "bungalow"
    assert (await level(client, me, ready.json()["object"], 2)).json()["code"] == "bad_level"
    # Free: nothing in the coin journal, not even an account for the administrator.
    assert await count(session, CoinTransaction) == 0
    stored = await session.scalar(select(CityObject).where(CityObject.id == house["id"]))
    assert stored.district_id == "test-support-team-1" and stored.paid == 0
    assert stored.source == "sandbox" and stored.owner_id == admin.id


async def test_squares_gather_into_parks_and_buildings_go_back(client, session, me):
    for u, v in ((0, 0), (1, 0), (0, 1)):
        assert not (await build(client, me, "square", FIRST, u, v)).json()["merged"]
    last = (await build(client, me, "square", FIRST, 1, 1)).json()
    park = last["object"]
    assert last["merged"] and park["family"] == "park"
    assert (park["u"], park["v"], park["w"], park["h"]) == (0, 0, 2, 2)
    assert (await level(client, me, park, 2)).json()["object"]["level"] == 2
    assert (await level(client, me, park, 3)).json()["code"] == "bad_level"
    house = (await build(client, me, "house", FIRST, 2, 0)).json()["object"]
    # Taken away: the plots are free again for anything.
    r = await client.delete(f"{SANDBOX}/buildings/{park['id']}", headers=me)
    assert r.status_code == 200 and r.json() == {"removed": park["id"]}
    view = await sandbox(client, me)
    assert [o["id"] for o in view["objects"]] == [house["id"]] and view["land"]["taken"] == 1
    assert await count(session, CityCell, CityCell.object_id == park["id"]) == 0
    assert (await build(client, me, "house", FIRST, 1, 1)).status_code == 200
    again = await client.delete(f"{SANDBOX}/buildings/{park['id']}", headers=me)
    assert again.status_code == 404


async def test_office_towers_build_for_free_under_the_same_land_rules(client, session, me):
    plots = [(col, row) for row in (0, 1) for col in range(6)]
    for family, (col, row) in zip(OFFICES, plots, strict=False):
        r = await build(client, me, family, FIRST, col, row)
        assert r.status_code == 200, r.text
        tower = r.json()["object"]
        assert (tower["family"], tower["level"], tower["w"], tower["h"]) == (family, 1, 1, 1)
        assert not r.json()["merged"]
        assert (await level(client, me, tower, 2)).json()["code"] == "bad_level"
    assert (await build(client, me, "officea", FIRST, 0, 0)).json()["code"] == "plot_taken"
    assert (await build(client, me, "officea", SECOND, 0, 0)).json()["code"] == "band_closed"
    view = await sandbox(client, me)
    assert [o["family"] for o in view["objects"]] == list(OFFICES)
    assert view["land"]["taken"] == len(OFFICES)
    assert await count(session, CoinTransaction) == 0
    assert (await estate(client, me))["objects"] == []


async def test_bands_and_the_headquarters_are_set_at_will(client, session, me):
    r = await district(client, me, open_band=2)
    assert r.status_code == 200 and r.json() == {"open_band": 2, "hq_level": 1}
    assert (await build(client, me, "house", SECOND, 0, 0)).status_code == 200
    assert (await district(client, me, open_band=1)).json()["open_band"] == 1
    assert (await build(client, me, "house", SECOND, 1, 0)).json()["code"] == "band_closed"
    r = await district(client, me, hq_level=5)
    assert r.json() == {"open_band": 1, "hq_level": 5}
    hq = (await sandbox(client, me))["hq"]
    assert (hq["level"], hq["name"], hq["next"]) == (5, "Флагманский штаб", None)
    assert (await district(client, me, hq_level=6)).json()["code"] == "bad_level"
    assert (await district(client, me, open_band=6)).json()["code"] == "bad_band"
    assert (await district(client, me, "support-team-4", hq_level=2)).status_code == 422
    assert (await district(client, me, color="red")).status_code == 422
    # The real district has no state of its own yet.
    assert await session.get(CityDistrictState, "support-team-1") is None


async def test_projects_are_built_or_cancelled_at_once(client, session, me):
    await legacy_square(session, "test-support-team-1")
    r = await project(client, me, "square", u=0, v=0)
    assert r.status_code == 200, r.text
    square = r.json()["project"]
    seen = (await sandbox(client, me))["projects"]
    assert [(p["id"], p["family"], p["cost"], p["funded"]) for p in seen] == [
        (square, "square", 120, 0)
    ]
    # One small and one main project at a time, on free cells of the square, as in the city.
    assert (await project(client, me, "gazebo", u=4, v=4)).json()["code"] == "project_limit"
    assert (await project(client, me, "park", u=0, v=0)).json()["code"] == "cells_taken"
    assert (await project(client, me, "park", u=10, v=10)).json()["code"] == "wrong_zone"
    r = await client.post(f"{SANDBOX}/projects/{square}/complete", headers=me)
    assert r.status_code == 200, r.text
    assert (r.json()["object"]["family"], r.json()["object"]["owner"]) == ("square", "district")
    view = await sandbox(client, me)
    assert view["projects"] == [] and (view["hq"]["level"], view["hq"]["built"]) == (2, 1)
    assert [(o["family"], o["module"]) for o in view["objects"]] == [
        ("square", 0), ("square", 0)
    ]
    again = await client.post(f"{SANDBOX}/projects/{square}/complete", headers=me)
    assert again.status_code == 404
    # A public building's next stage, then one opened and cancelled.
    gazebo = (await project(client, me, "gazebo", u=4, v=4)).json()["project"]
    built = (await client.post(f"{SANDBOX}/projects/{gazebo}/complete", headers=me)).json()
    upgrade = await project(client, me, "gazebo", target_id=built["object"]["id"])
    assert upgrade.status_code == 200, upgrade.text
    r = await client.delete(f"{SANDBOX}/projects/{upgrade.json()['project']}", headers=me)
    assert r.status_code == 200
    fountain = (await project(client, me, "fountain", u=6, v=6)).json()["project"]
    assert await count(session, CityCell, CityCell.project_id == fountain) == 4
    assert (await client.delete(f"{SANDBOX}/projects/{fountain}", headers=me)).status_code == 200
    assert await count(session, CityCell, CityCell.project_id == fountain) == 0
    assert (await sandbox(client, me))["projects"] == []
    assert (await client.delete(f"{SANDBOX}/projects/{fountain}", headers=me)).status_code == 404
    # A public building's stage is set at will too; a project for a stage gone stale ends.
    target = built["object"]
    up = (await project(client, me, "gazebo", target_id=target["id"])).json()["project"]
    assert (await level(client, me, target, 2)).json()["object"]["level"] == 2
    assert (await session.get(CityProject, up, populate_existing=True)).status == "cancelled"
    assert (await level(client, me, target, 3)).json()["code"] == "bad_level"
    assert await count(session, CoinTransaction) == 0 and await count(session, Notification) == 0


async def test_resetting_clears_only_that_test_city(client, session, me):
    await legacy_square(session, "test-support-team-1")
    await district(client, me, open_band=3, hq_level=4)
    for block in (FIRST, SECOND):
        assert (await build(client, me, "house", block, 0, 0)).status_code == 200
    other = await build(client, me, "house", *first_plot("support-team-2"), "support-team-2")
    assert other.status_code == 200
    assert (await project(client, me, "fountain", u=0, v=0)).status_code == 200
    plot = first_plot("sales-team-1")
    sales = (await build(client, me, "house", *plot, "sales-team-1")).json()["object"]
    r = await client.post(f"{SANDBOX}/cities/support/reset", headers=me)
    assert r.status_code == 200 and r.json() == {"city": "support", "reset": True}
    for number in (1, 2):
        view = await sandbox(client, me, district=f"support-team-{number}")
        assert view["objects"] == [] and view["projects"] == []
        assert view["land"]["taken"] == 0 and view["land"]["open_band"] == 1
        assert view["hq"]["level"] == 1
    assert [o["id"] for o in (await sandbox(client, me, "sales", "sales-team-1"))["objects"]] == [
        sales["id"]
    ]
    assert await count(session, CityCell, CityCell.district_id.like("test-support-%")) == 0
    assert (await build(client, me, "house", FIRST, 0, 0)).status_code == 200
    assert (await build(client, me, "house", SECOND, 0, 0)).json()["code"] == "band_closed"
    assert (await client.post(f"{SANDBOX}/cities/north/reset", headers=me)).status_code == 404


async def test_the_real_city_never_sees_the_test_city(
    client, session, admin, head, supervisor, operator, me
):
    await open_world(client, admin, head, support=[operator.group_id])
    await fund(session, operator.id, 2000)
    op = auth(await login(client, operator.login))
    real = (await buy(client, op, "house", FIRST, 0, 0)).json()["object"]
    legacy_real = await legacy_square(session)
    await legacy_square(session, "test-support-team-1")
    # The same plot in the test city is a plot of its own.
    test = (await build(client, me, "house", FIRST, 0, 0)).json()["object"]
    for u, v in ((2, 0), (3, 0), (2, 1), (3, 1)):
        await build(client, me, "square", FIRST, u, v)
    await district(client, me, open_band=4, hq_level=5)
    await project(client, me, "fountain", u=0, v=0)
    for h in (op, me):
        view = await district_view(client, h)
        assert [o["id"] for o in view["objects"]] == [real["id"], legacy_real.id]
        assert view["land"]["taken"] == 1 and view["land"]["open_band"] == 1
        assert view["hq"]["level"] == 1 and view["projects"] == []
        cities = (await client.get(f"{CITY}/cities/support", headers=h)).json()["districts"]
        assert not any(d["id"].startswith(city_land.SANDBOX) for d in cities)
    # Nobody's own buildings: the administrator's estate (and its reconcile) skip the test city.
    assert (await estate(client, me))["objects"] == []
    assert [o["id"] for o in (await estate(client, op))["objects"]] == [real["id"]]
    placed = await count(
        session, CityObject, CityObject.state == "placed", CityObject.district_id.like("test-%")
    )
    assert placed == 3  # the house, merged park and existing public square
    report = (await client.get(f"{ADMIN}/estates", headers=me)).json()
    first = next(d for d in report["districts"] if d["id"] == "support-team-1")
    assert (first["buildings"], first["builders"], first["open_projects"]) == (1, 1, 0)
    assert (first["land"]["taken"], first["hq_level"]) == (1, 1)
    assert not any(d["id"].startswith(city_land.SANDBOX) for d in report["districts"])
    assert report["inventory"] == 0
    # The test city's tools never reach the real city's buildings and projects.
    assert (await level(client, me, real, 5)).status_code == 404
    assert (await client.delete(f"{SANDBOX}/buildings/{real['id']}", headers=me)).status_code == 404
    sv = auth(await login(client, supervisor.login))
    opened = await client.post(
        f"{CITY}/projects",
        headers=sv,
        json={
            "key": "real-project-1",
            "district_id": "support-team-1",
            "family": "square",
            "module": 0,
            "u": 5,
            "v": 5,
            "economy_revision": 0,
        },
    )
    real_project = opened.json()["project"]["id"]
    done = await client.post(f"{SANDBOX}/projects/{real_project}/complete", headers=me)
    assert done.status_code == 404
    assert (
        await client.delete(f"{SANDBOX}/projects/{real_project}", headers=me)
    ).status_code == 404
    assert (await project(client, me, "gazebo", target_id=real["id"])).status_code == 404
    await client.post(f"{SANDBOX}/cities/support/reset", headers=me)
    assert [o["id"] for o in (await district_view(client, op))["objects"]] == [
        real["id"], legacy_real.id
    ]
    assert [p["id"] for p in (await district_view(client, op))["projects"]] == [real_project]
    assert test["id"] != real["id"]
