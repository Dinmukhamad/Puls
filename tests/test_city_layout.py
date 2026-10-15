"""A city's number of districts: planned for the next season, cut anew at the reset."""

import json

import pytest
from sqlalchemy import select

from app.models.enums import Role
from app.models.progress import Notification
from app.models.settings import AuditLog
from app.services import city_land
from tests.conftest import RING_LAND, auth, login, make_group, make_user
from tests.test_city_estate import fund, open_world

pytestmark = pytest.mark.asyncio
ADMIN = "/api/v1/admin/learning/city"
CITY = "/api/v1/learning/city"


@pytest.fixture(autouse=True)
def every_layout(monkeypatch, tmp_path):
    """The ring land with every other layout too: each district of it gets the first one's land."""
    data = json.loads(RING_LAND.read_text(encoding="utf-8"))
    for land in data["cities"].values():
        first = land["districts"]["1"]
        land["layouts"] = {
            str(n): {str(i): first for i in range(1, n + 1)} for n in (2, 4, 5)
        }
    path = tmp_path / "land.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(city_land, "LAND_FILE", path)
    city_land._land.cache_clear()
    yield
    city_land._land.cache_clear()


@pytest.fixture
async def admin(session):
    return await make_user(session, login="layout-admin", role=Role.ADMIN)


@pytest.fixture
async def team(client, session, admin, head, supervisor, operator):
    await open_world(client, admin, head, support=[operator.group_id])
    await fund(session, operator.id, 500)
    return operator


async def world(client, h):
    r = await client.get(ADMIN + "/world", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


async def plan(client, h, city, count, supervisors=(), revision=None):
    if revision is None:
        revision = (await world(client, h))["revision"]
    districts = None if count is None else [
        {"name": f"Район {n + 1}", "supervisor_id": (list(supervisors) + [None] * 5)[n]}
        for n in range(count)
    ]
    return await client.put(ADMIN + "/layout", headers=h, json={
        "revision": revision, "city": city, "count": count, "districts": districts or [],
    })


def city_of(data, city):
    return next(c for c in data["cities"] if c["id"] == city)


async def test_a_head_plans_their_own_city_and_may_cancel(client, session, team, head, supervisor):
    boss = auth(await login(client, head.login))
    other = await make_user(session, login="head2", role=Role.HEAD)
    stranger = auth(await login(client, other.login))
    assert (await plan(client, stranger, "support", 5)).status_code == 403
    me = auth(await login(client, team.login))
    assert (await plan(client, me, "support", 5, revision=0)).status_code == 403
    wrong = await client.put(ADMIN + "/layout", headers=boss, json={
        "revision": (await world(client, boss))["revision"], "city": "support", "count": 4,
        "districts": [{"name": "Один", "supervisor_id": None}],
    })
    assert wrong.status_code == 422

    r = await plan(client, boss, "support", 5, [supervisor.id])
    assert r.status_code == 200, r.text
    support = city_of(r.json(), "support")
    assert support["plan"]["count"] == 5
    assert support["plan"]["districts"][0] == {"name": "Район 1", "supervisor_id": supervisor.id}
    # Today's districts stay until the reset.
    assert [d["id"] for d in support["districts"]] == [f"support-team-{n}" for n in (1, 2, 3)]
    stale = await plan(client, boss, "support", 4, revision=r.json()["revision"] - 1)
    assert stale.status_code == 409
    # The last plan wins, and saving the world keeps it.
    assert (await plan(client, boss, "support", 2, [supervisor.id])).status_code == 200
    current = await world(client, boss)
    body = {"revision": current["revision"], "cities": [
        {k: c[k] for k in ("id", "name", "head_id", "districts")} for c in current["cities"]
    ]}
    for c in body["cities"]:
        c["districts"] = [{k: d[k] for k in ("id", "name", "supervisor_id", "construction")}
                          for d in c["districts"]]
    saved = await client.put(ADMIN + "/world", headers=boss, json=body)
    assert saved.status_code == 200, saved.text
    assert city_of(saved.json(), "support")["plan"]["count"] == 2

    cancelled = await plan(client, boss, "support", None)
    assert cancelled.status_code == 200, cancelled.text
    assert "plan" not in city_of(cancelled.json(), "support")
    actions = list(await session.scalars(
        select(AuditLog.action).where(AuditLog.action == "city.layout")
    ))
    assert len(actions) == 3


async def test_a_supervisor_leads_one_district_after_the_reset(
    client, session, team, head, supervisor
):
    boss = auth(await login(client, head.login))
    # The supervisor already leads support's first district: planning them in sales clashes.
    clash = await plan(client, boss, "sales", 4, [supervisor.id])
    assert clash.status_code == 400 and "два района" in clash.json()["detail"]
    twice = await plan(client, boss, "support", 4, [supervisor.id, supervisor.id])
    assert twice.status_code == 422
    # Moved to sales in support's own plan, they are free there.
    assert (await plan(client, boss, "support", 4)).status_code == 200
    assert (await plan(client, boss, "sales", 4, [supervisor.id])).status_code == 200


async def test_the_reset_cuts_the_city_anew(client, session, team, head, supervisor, operator):
    boss = auth(await login(client, head.login))
    second = await make_user(session, login="sv2", role=Role.SUPERVISOR)
    await make_group(session, code="G2", supervisor_id=second.id)
    r = await plan(client, boss, "support", 5, [second.id, supervisor.id])
    assert r.status_code == 200, r.text

    reset = await client.post(ADMIN + "/seasons/reset", headers=boss, json={"number": 1})
    assert reset.status_code == 200, reset.text
    support = city_of(await world(client, boss), "support")
    assert "plan" not in support
    ids = [d["id"] for d in support["districts"]]
    assert ids == [f"support-5-team-{n}" for n in range(1, 6)]
    assert [d["supervisor_id"] for d in support["districts"]] == [
        second.id, supervisor.id, None, None, None
    ]
    assert support["districts"][1]["group_ids"] == [operator.group_id]
    # The old first district was open for building; the free new ones are closed.
    assert [d["construction"] for d in support["districts"]] == [True, False, False, False, False]
    assert all(city_land.has_land(i) for i in ids)
    # The past city keeps its old layout in the history.
    past = reset.json()["history"][0]["totals"]["districts"]
    assert {d["id"] for d in past if d["id"].startswith("support")} == {
        f"support-team-{n}" for n in (1, 2, 3)
    }
    # The operator now lives in district 2 of five.
    me = auth(await login(client, operator.login))
    mine = await client.get(CITY + "/cities/support", headers=me)
    assert mine.status_code == 200, mine.text
    districts = {d["id"]: d for d in mine.json()["districts"]}
    assert list(districts) == ids
    assert districts["support-5-team-2"]["hq"]["level"] == 1
    body = await session.scalar(
        select(Notification.body).where(Notification.user_id == operator.id,
                                        Notification.title == "Город начал новый сезон")
    )
    assert "теперь 5 районов" in body
    audit = await session.scalar(
        select(AuditLog.payload).where(AuditLog.action == "city.season.close")
    )
    assert audit["layouts"] == {"support": {"before": 3, "after": 5, "without_district": []}}


async def test_a_smaller_city_names_the_teams_left_without_a_district(
    client, session, admin, head, supervisor, operator
):
    second = await make_user(session, login="sv2", role=Role.SUPERVISOR)
    g2 = await make_group(session, code="G2", supervisor_id=second.id)
    h = auth(await login(client, admin.login))
    current = await world(client, h)
    body = {"revision": current["revision"], "cities": current["cities"]}
    support = city_of(body, "support")
    support["districts"][0]["supervisor_id"] = supervisor.id
    support["districts"][1]["supervisor_id"] = second.id
    for c in body["cities"]:
        c["head_id"] = head.id
    assert (await client.put(ADMIN + "/world", headers=h, json=body)).status_code == 200
    assert g2.id
    r = await plan(client, h, "support", 2, [second.id])
    assert r.status_code == 200, r.text

    boss = auth(await login(client, head.login))
    reset = await client.post(ADMIN + "/seasons/reset", headers=boss, json={"number": 1})
    assert reset.status_code == 200, reset.text
    after = city_of(await world(client, h), "support")
    assert [d["id"] for d in after["districts"]] == ["support-2-team-1", "support-2-team-2"]
    assert [d["supervisor_id"] for d in after["districts"]] == [second.id, None]
    audit = await session.scalar(
        select(AuditLog.payload).where(AuditLog.action == "city.season.close")
    )
    assert audit["layouts"]["support"] == {
        "before": 3, "after": 2, "without_district": [supervisor.id]
    }
    body = await session.scalar(
        select(Notification.body).where(Notification.user_id == operator.id,
                                        Notification.title == "Город начал новый сезон")
    )
    assert "теперь 2 района" in body


async def test_the_test_city_shows_the_planned_layout(client, session, team, admin, head):
    h = auth(await login(client, admin.login))
    assert (await plan(client, h, "support", 4)).status_code == 200
    r = await client.get(ADMIN + "/sandbox/cities/support", headers=h)
    assert r.status_code == 200, r.text
    assert [d["id"] for d in r.json()["districts"]] == [f"support-4-team-{n}" for n in range(1, 5)]
    assert (await plan(client, h, "support", None)).status_code == 200
    r = await client.get(ADMIN + "/sandbox/cities/support", headers=h)
    assert [d["id"] for d in r.json()["districts"]] == [f"support-team-{n}" for n in (1, 2, 3)]
