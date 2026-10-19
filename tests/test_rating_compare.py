"""«Рейтинг» for operators: the table of everyone, places week by week, teams and metrics vs all."""

from datetime import date

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services import months
from app.services import weekly as weekly_service
from tests.conftest import auth, login, make_group, make_user
from tests.test_rating_race import MINE, RIVALS, STRONG, _metrics

JUNE = date(2026, 6, 1)


async def _week(session: AsyncSession, day: date, values: dict[int, dict], calculate=True):
    week = await weekly_service.get_or_create_week(session, day)
    for user_id, changes in values.items():
        await _metrics(session, week.id, user_id, {**STRONG, **changes})
    await session.commit()
    if calculate:
        await weekly_service.calculate_week(session, week)
        await session.commit()
    return week


async def _field(session: AsyncSession, operator: User) -> dict[str, User]:
    """The race's field: Айгерим 100, Жанна 99, Данияр 93.75, op1 91.25, Тимур 85 points."""
    operator.group_id = (await make_group(session, code="G1")).id
    rivals = {}
    for login_name, full_name, _ in RIVALS:
        rivals[login_name] = await make_user(session, login=login_name, full_name=full_name)
    await session.commit()
    return rivals


def _june(operator: User, rivals: dict[str, User]) -> dict[int, dict]:
    return {**{rivals[name].id: changes for name, _, changes in RIVALS}, operator.id: MINE}


async def _compare(client: AsyncClient, who: str = "op1", **params):
    response = await client.get("/api/v1/rating/compare", params=params,
                                headers=auth(await login(client, who)))
    assert response.status_code == 200, response.text
    return response.json()


async def test_the_week_shows_everyone_by_short_name_with_places_week_by_week(
    client, session, operator,
):
    rivals = await _field(session, operator)
    # The week before: op1 is first, Тимур second, the rest behind.
    await _week(session, date(2026, 5, 25), {
        operator.id: {}, rivals["r-d"].id: {"quality": 99},
        **{rivals[name].id: {"quality": 70} for name in ("r-a", "r-b", "r-c")},
    })
    week = await _week(session, JUNE, _june(operator, rivals))

    body = await _compare(client, period="week", week_id=week.id)

    assert body["period"] == "week" and body["live"] is False and body["participants"] == 5
    assert [w["label"] for w in body["weeks"]] == ["2026-W22", "2026-W23"]
    rows = body["operators"]
    assert [r["name"] for r in rows] == [
        "Айгерим А.", "Жанна Б.", "Данияр А.", "Оператор Первый", "Тимур Д."]
    assert [r["rank"] for r in rows] == [1, 2, 3, 4, 5]
    assert [r["is_me"] for r in rows] == [False, False, False, True, False]
    mine = rows[3]
    assert mine["points"] == 91.25 and mine["group"] == "Группа G1"
    assert [m["rank"] for m in mine["trail"]] == [1, 4]
    assert [m["rank"] for m in rows[4]["trail"]] == [2, 5]
    # Places and points only: no coins or balances of other operators.
    assert all("coins" not in r and "balance" not in r for r in rows)


async def test_a_metric_shows_your_value_the_average_and_the_best_never_another_ones(
    client, session, operator,
):
    rivals = await _field(session, operator)
    week = await _week(session, JUNE, _june(operator, rivals))

    body = await _compare(client, period="week", week_id=week.id)

    quality = next(m for m in body["metrics"] if m["code"] == "quality")
    # Quality: 100, 96, 80, 80 of the others and 80 of op1.
    assert quality["me"] == 80 and quality["best"] == 100 and quality["average"] == 87.2
    assert quality["reported"] == 5 and quality["place"] == 3
    assert quality["points"] == 20 and quality["max_points"] == 25
    assert set(quality) == {"code", "title", "unit", "direction", "target", "me", "average",
                            "best", "reported", "place", "points", "max_points"}
    # Penalties are not compared here: only the metrics that add points.
    assert {m["code"] for m in body["metrics"]}.isdisjoint({"lateness", "forbidden_sites"})


async def test_teams_rank_by_the_average_of_their_operators(client, session, operator):
    rivals = await _field(session, operator)
    other = await make_group(session, code="G2")
    for name in ("r-a", "r-d"):
        rivals[name].group_id = other.id
    for name in ("r-b", "r-c"):
        rivals[name].group_id = operator.group_id
    await session.commit()
    week = await _week(session, JUNE, _june(operator, rivals))

    body = await _compare(client, period="week", week_id=week.id)

    teams = {t["name"]: t for t in body["teams"]}
    # G2: Айгерим 100 and Тимур 85; G1: Жанна 99, Данияр 93.75 and op1 91.25.
    assert teams["Группа G1"]["points"] == 94.67 and teams["Группа G1"]["members"] == 3
    assert teams["Группа G2"]["points"] == 92.5
    assert [t["name"] for t in body["teams"]] == ["Группа G1", "Группа G2"]
    assert teams["Группа G1"]["is_mine"] and not teams["Группа G2"]["is_mine"]
    assert teams["Группа G2"]["best"] == {"name": "Айгерим А.", "points": 100.0, "is_me": False}


async def test_a_week_nobody_has_calculated_is_scored_live(client, session, operator):
    rivals = await _field(session, operator)
    week = await _week(session, JUNE, _june(operator, rivals), calculate=False)

    body = await _compare(client, period="week", week_id=week.id)

    assert body["live"] is True and body["weeks"][-1]["live"] is True
    assert [r["rank"] for r in body["operators"]] == [1, 2, 3, 4, 5]


async def test_the_month_has_its_places_prizes_and_monthly_averages(client, session, operator):
    rivals = await _field(session, operator)
    await _week(session, JUNE, _june(operator, rivals))
    item = await months.get_or_create(session, 2026, 6)
    await months.calculate(session, item)
    await session.commit()

    body = await _compare(client, period="month", year=2026, month=6)

    assert body["period"] == "month" and body["title"] == "июнь 2026"
    assert body["month"]["weeks_planned"] == 4
    rows = body["operators"]
    assert [r["rank"] for r in rows] == [1, 2, 3, 4, 5]
    assert rows[0]["prize"] > 0 and rows[0]["weeks"] == 1
    quality = next(m for m in body["metrics"] if m["code"] == "quality")
    assert quality["me"] == 80 and quality["best"] == 100 and quality["points"] is None


async def test_nothing_yet_is_an_empty_table(client, session, operator):
    body = await _compare(client, period="week")
    assert body["operators"] == [] and body["weeks"] == [] and body["metrics"] == []
    body = await _compare(client, period="month", year=2026, month=6)
    assert body["operators"] == [] and body["status"] == "open"
