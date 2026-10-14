"""Seasons: the city starts again on schedule or by hand, and the past city stays in the history."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.models.city import CityAward
from app.models.city_estate import CityDistrictState, CityObject
from app.models.city_season import CitySeason
from app.models.enums import Role
from app.models.progress import Notification
from app.models.settings import AuditLog
from app.models.user import CoinAccount
from app.services import city_seasons
from tests.conftest import auth, login, make_user
from tests.test_city_estate import (
    FIRST,
    HOUSE_PRICE,
    district_view,
    estate,
    fund,
    key,
    legacy_square,
    open_world,
)
from tests.test_city_estate import buy as buy_plot
from tests.test_city_estate import lay as lay_decor

pytestmark = pytest.mark.asyncio
CITY = "/api/v1/learning/city"
ADMIN = "/api/v1/admin/learning/city"
ROAD = [(FIRST, c, 5) for c in range(6)]


@pytest.fixture
async def team(client, session, head, supervisor, operator):
    admin = await make_user(session, login="season-admin", role=Role.ADMIN)
    await open_world(client, admin, head, support=[operator.group_id])
    await fund(session, operator.id, 2000)
    return operator


async def overview(client, h):
    r = await client.get(CITY + "/seasons", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


async def schedule(client, h, revision, period=None, ends_at=None):
    return await client.put(
        ADMIN + "/seasons/schedule",
        headers=h,
        json={
            "revision": revision,
            "period": period,
            "ends_at": ends_at.isoformat() if ends_at else None,
        },
    )


async def balance(session, user_id):
    return await session.scalar(
        select(CoinAccount.balance)
        .where(CoinAccount.user_id == user_id)
        .execution_options(populate_existing=True)
    )


async def test_heads_set_one_schedule_for_both_cities(client, session, head, operator):
    me, boss = auth(await login(client, operator.login)), auth(await login(client, head.login))
    first = await overview(client, me)
    assert first["current"]["number"] == 1 and first["current"]["ends_at"] is None
    assert first["history"] == [] and not first["can_manage"] and first["resets"] == 0
    assert [p["id"] for p in first["periods"]] == ["week", "2weeks", "month", "2months", "3months"]
    revision = (await overview(client, boss))["current"]["revision"]
    soon = datetime.now(UTC) + timedelta(days=10)
    assert (await schedule(client, me, revision, "month", soon)).status_code == 403
    stale = await schedule(client, boss, revision + 1, "month", soon)
    assert stale.status_code == 409 and stale.json()["code"] == "revision_conflict"
    assert (await schedule(client, boss, revision, "month")).status_code == 422
    past = await schedule(client, boss, revision, "week", datetime.now(UTC) - timedelta(hours=1))
    assert past.status_code == 400
    saved = await schedule(client, boss, revision, "month", soon)
    assert saved.status_code == 200, saved.text
    current = saved.json()["current"]
    assert current["period"] == "month" and current["period_name"] == "Месяц"
    assert not current["warning"] and current["revision"] == revision + 1
    near = await schedule(
        client, boss, revision + 1, "2weeks", datetime.now(UTC) + timedelta(days=2)
    )
    assert near.json()["current"]["warning"] and (await overview(client, me))["current"]["warning"]
    off = await schedule(client, boss, revision + 2)
    assert off.json()["current"]["ends_at"] is None and off.json()["current"]["period"] is None
    audit = await session.scalars(
        select(AuditLog.action).where(AuditLog.action.like("city.season%"))
    )
    assert list(audit) == ["city.season.schedule"] * 3


async def test_a_reset_keeps_the_past_city_and_starts_the_land_again(
    client, session, head, supervisor, team
):
    me, boss = auth(await login(client, team.login)), auth(await login(client, head.login))
    mate = await make_user(
        session, login="season-mate", full_name="Мадина Ким", group_id=team.group_id
    )
    await fund(session, mate.id, 500)
    m = auth(await login(client, mate.login))
    assert (await buy_plot(client, me, "house", FIRST, 0, 0)).status_code == 200
    assert (await lay_decor(client, m, "road", ROAD)).status_code == 200
    assert (await lay_decor(client, me, "tree", [(FIRST, 7, 0)])).status_code == 200
    # A shared project still collecting: its contribution comes back, the house does not.
    await legacy_square(session)
    sv = auth(await login(client, supervisor.login))
    project = (
        await client.post(
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
    ).json()["project"]
    given = await client.post(
        f"{CITY}/projects/{project['id']}/contributions",
        headers=me,
        json={"key": key(), "amount": 60},
    )
    assert given.status_code == 200, given.text
    session.add(CityAward(user_id=team.id, mission_key="welcome", snapshot={}, xp=75, coins=20))
    await session.commit()
    before = await balance(session, team.id)
    assert before == 2000 - HOUSE_PRICE - 10 - 60
    test_copy = CityObject(
        district_id="test-support-team-1",
        owner_id=None,
        family="square",
        level=1,
        state="placed",
        module=1,
        u=0,
        v=0,
        source="legacy",
    )
    session.add(test_copy)
    await session.commit()

    reset = await client.post(ADMIN + "/seasons/reset", headers=boss, json={"number": 1})
    assert reset.status_code == 200, reset.text
    data = reset.json()
    assert data["current"]["number"] == 2 and data["resets"] == 1
    past = data["history"][0]
    assert past["number"] == 1 and not past["scheduled"] and past["ended_by"] == head.full_name
    assert past["visible_until"] is None and past["totals"]["mine"] is None
    totals = past["totals"]
    district = next(d for d in totals["districts"] if d["id"] == "support-team-1")
    assert district["families"] == {"house": 1, "square": 1}
    assert district["decor"] == {"road": 6, "tree": 1} and district["small"] == 7
    assert [p["name"] for p in district["top"]] == ["Оператор Первый", "Мадина Ким"]
    assert district["top"][0] == {
        "name": "Оператор Первый",
        "buildings": 1,
        "small": 1,
        "cells": 10,
    }
    assert totals["builders"] == 2 and totals["cities"]["support"]["small"] == 7

    # The land is empty, the main building back at its first level; training and coins stay.
    view = await district_view(client, me)
    assert view["objects"] == [] and view["decor"] == {} and view["projects"] == []
    assert view["hq"]["level"] == 1 and view["landmark"]["level"] == 1
    assert (await estate(client, me))["objects"] == []
    assert await balance(session, team.id) == before + 60
    assert await session.scalar(select(CityAward.xp).where(CityAward.user_id == team.id)) == 75
    states = await session.scalars(
        select(CityObject.state)
        .where(CityObject.district_id == "support-team-1")
        .execution_options(populate_existing=True)
    )
    assert set(states) == {"archived"}
    await session.refresh(test_copy)
    assert test_copy.state == "placed"
    district_state = await session.get(CityDistrictState, "support-team-1", populate_existing=True)
    assert (district_state.hq_level, district_state.landmark_peak_plots) == (1, 0)
    notes = await session.scalars(
        select(Notification.user_id).where(Notification.title == "Город начал новый сезон")
    )
    assert sorted(notes) == sorted([team.id, mate.id])
    assert await session.scalar(select(AuditLog.id).where(AuditLog.action == "city.season.close"))

    # The operator sees the past city for five days, with their own part of it.
    mine = (await overview(client, me))["history"][0]
    assert mine["totals"]["mine"] == {"buildings": 1, "small": 1, "cells": 10}
    assert mine["visible_until"] is not None and "people" not in mine["totals"]
    shot = await client.get(f"{CITY}/seasons/{past['id']}/cities/support", headers=me)
    assert shot.status_code == 200, shot.text
    old = next(d for d in shot.json()["districts"] if d["id"] == "support-team-1")
    assert {o["family"] for o in old["objects"]} == {"house", "square"}
    assert {o["owner"] for o in old["objects"]} <= {"resident", "district"}
    assert len(old["decor"]["road"]) == 6 and old["projects"] == [] and not old["mine"]
    assert shot.json()["history"]["number"] == 1
    assert (
        await client.get(f"{CITY}/seasons/{past['id']}/cities/moon", headers=me)
    ).status_code == 404

    again = await client.post(ADMIN + "/seasons/reset", headers=boss, json={"number": 1})
    assert again.status_code == 409 and again.json()["code"] == "season_changed"
    assert (
        await client.post(ADMIN + "/seasons/reset", headers=me, json={"number": 2})
    ).status_code == 403
    # Season 2 is built on the same land from scratch.
    assert (await buy_plot(client, me, "house", FIRST, 0, 0)).status_code == 200


async def test_operators_see_the_past_city_for_five_days_heads_always(
    client, session, head, operator
):
    me, boss = auth(await login(client, operator.login)), auth(await login(client, head.login))
    assert (
        await client.post(ADMIN + "/seasons/reset", headers=boss, json={"number": 1})
    ).status_code == 200
    past = (await overview(client, me))["history"]
    assert [s["number"] for s in past] == [1]
    await session.execute(
        update(CitySeason)
        .where(CitySeason.number == 1)
        .values(ended_at=datetime.now(UTC) - timedelta(days=5, minutes=1))
    )
    await session.commit()
    assert (await overview(client, me))["history"] == []
    hidden = await client.get(f"{CITY}/seasons/{past[0]['id']}/cities/support", headers=me)
    assert hidden.status_code == 404
    staff = await overview(client, boss)
    assert [s["number"] for s in staff["history"]] == [1] and staff["resets"] == 1
    shown = await client.get(f"{CITY}/seasons/{past[0]['id']}/cities/sales", headers=boss)
    assert shown.status_code == 200 and shown.json()["city"] == "sales"


async def test_the_schedule_resets_the_city_when_its_date_comes(client, session, head, team):
    me, boss = auth(await login(client, team.login)), auth(await login(client, head.login))
    assert (await buy_plot(client, me, "house", FIRST, 0, 0)).status_code == 200
    revision = (await overview(client, boss))["current"]["revision"]
    soon = datetime.now(UTC) + timedelta(days=7)
    assert (await schedule(client, boss, revision, "week", soon)).status_code == 200
    # Not yet: the scheduler's check finds nothing to do.
    assert await city_seasons.close_due(session) is None
    due = datetime.now(UTC) - timedelta(minutes=3)
    await session.execute(update(CitySeason).where(CitySeason.number == 1).values(ends_at=due))
    await session.commit()
    # The first request after the date resets the city before it shows it.
    view = await district_view(client, me)
    assert view["objects"] == []
    current = (await overview(client, me))["current"]
    assert current["number"] == 2 and current["period"] == "week"
    ends = datetime.fromisoformat(current["ends_at"])
    assert abs(ends - (due + timedelta(days=7))) < timedelta(seconds=1)
    past = (await overview(client, boss))["history"][0]
    assert past["scheduled"] and past["ended_by"] is None and past["totals"]["buildings"] == 1


async def test_a_purchase_after_the_date_lands_in_the_new_season(client, session, head, team):
    me, boss = auth(await login(client, team.login)), auth(await login(client, head.login))
    revision = (await overview(client, boss))["current"]["revision"]
    soon = datetime.now(UTC) + timedelta(days=1)
    assert (await schedule(client, boss, revision, "2weeks", soon)).status_code == 200
    # Long overdue: missed periods are skipped, the next reset is still ahead.
    await session.execute(update(CitySeason).values(ends_at=datetime.now(UTC) - timedelta(days=40)))
    await session.commit()
    bought = await buy_plot(client, me, "house", FIRST, 0, 0)
    assert bought.status_code == 200, bought.text
    seasons = list(
        await session.scalars(
            select(CitySeason).order_by(CitySeason.number).execution_options(populate_existing=True)
        )
    )
    assert [s.number for s in seasons] == [1, 2] and seasons[0].totals["buildings"] == 0
    assert city_seasons.aware(seasons[1].ends_at) > datetime.now(UTC)
    assert (await district_view(client, me))["objects"][0]["family"] == "house"


async def test_periods_follow_the_office_calendar():
    almaty = city_seasons.ZoneInfo("Asia/Almaty")
    start = datetime(2026, 1, 31, 9, tzinfo=almaty)
    month = city_seasons.after(start, "month").astimezone(almaty)
    assert (month.month, month.day, month.hour) == (2, 28, 9)
    quarter = city_seasons.after(datetime(2026, 11, 30, 9, tzinfo=almaty), "3months").astimezone(
        almaty
    )
    assert (quarter.year, quarter.month, quarter.day) == (2027, 2, 28)
    assert city_seasons.after(start, "2weeks") - start == timedelta(days=14)
