"""«Гонка недели»: an operator's place among all operators, the gaps and what closes them."""

from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.visibility import short_name
from app.models.contest import OperatorWeekMetric
from app.models.user import User
from app.services import months
from app.services import race as race_service
from app.services import weekly as weekly_service
from app.services.rules import get_rules
from tests.conftest import auth, login, make_user

STRONG = {
    "hours_worked": 40, "overtime": 8, "quality": 100, "efficiency": 100,
    "calls_per_hour": 12, "driver_gratitudes": 5, "lateness": 0, "forbidden_sites": 0,
}
#: The field of the week: points 100, 99, 93.75, 91.25 (op1), 85.
RIVALS = [
    ("r-a", "Айгерим Сериковна Абдиева", {}),
    ("r-c", "Жанна Ерлановна Бекова", {"quality": 96}),
    ("r-b", "Данияр Маратович Ахметов", {"quality": 80, "calls_per_hour": 11}),
    ("r-d", "Тимур Асхатович Дюсенов", {"quality": 80, "efficiency": 50}),
]
MINE = {"quality": 80, "calls_per_hour": 9}


async def _metrics(session: AsyncSession, week_id: int, user_id: int, values: dict) -> None:
    for code, value in values.items():
        session.add(OperatorWeekMetric(week_id=week_id, user_id=user_id, metric_code=code,
                                       value=float(value)))
    await session.flush()


async def _field(session: AsyncSession, operator: User, *, mine=None, calculate=True,
                 day=date(2026, 6, 1)):
    week = await weekly_service.get_or_create_week(session, day)
    for login_name, full_name, changes in RIVALS:
        rival = await make_user(session, login=login_name, full_name=full_name)
        await _metrics(session, week.id, rival.id, {**STRONG, **changes})
    if mine is not False:
        await _metrics(session, week.id, operator.id, {**STRONG, **(mine or MINE)})
    await session.commit()
    if calculate:
        await weekly_service.calculate_week(session, week)
        await session.commit()
    return week


async def _race(client: AsyncClient, week_id: int | None = None, who: str = "op1"):
    response = await client.get(
        "/api/v1/rating/race", params={"week_id": week_id} if week_id else None,
        headers=auth(await login(client, who)),
    )
    return response


@pytest.mark.parametrize(
    ("full", "short"),
    [
        ("Айгерим Сериковна Абдиева", "Айгерим А."),
        ("Абдиева Айгерим Сериковна", "Айгерим А."),
        ("Ерлан Мухтаров", "Ерлан М."),
        ("Сериков Асхат Нурлан улы", "Асхат С."),
        ("Мадина", "Мадина"),
    ],
)
def test_short_name_keeps_the_first_name_and_the_surname_initial(full, short):
    assert short_name(full) == short


@pytest.mark.parametrize("calculate", [True, False])
async def test_place_gaps_and_names(client, session, operator, calculate):
    week = await _field(session, operator, calculate=calculate)
    response = await _race(client, week.id)
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["live"] is (not calculate)
    assert body["participants"] == 5
    assert body["me"]["rank"] == 4 and body["me"]["points"] == 91.25
    names = [row["name"] for row in body["standings"]]
    assert names == ["Айгерим А.", "Жанна Б.", "Данияр А.", "Оператор Первый", "Тимур Д."]
    assert [row["rank"] for row in body["standings"]] == [1, 2, 3, 4, 5]
    assert [row["is_me"] for row in body["standings"]] == [False, False, False, True, False]
    assert [row["gap"] for row in body["standings"]] == [8.75, 7.75, 2.5, 0, -6.25]

    nxt = body["next"]
    assert (nxt["name"], nxt["rank"], nxt["gap"]) == ("Данияр А.", 3, 2.5)
    assert (body["behind"]["name"], body["behind"]["lead"]) == ("Тимур Д.", 6.25)
    assert [(p["place"], p["name"], p["gap"], p["reached"]) for p in body["podium"]] == [
        (1, "Айгерим А.", 8.75, False), (2, "Жанна Б.", 7.75, False), (3, "Данияр А.", 2.5, False),
    ]


async def test_advice_names_the_values_that_pass_the_next_one(client, session, operator):
    week = await _field(session, operator)
    body = (await _race(client, week.id)).json()

    lost = {m["code"]: m["lost"] for m in body["metrics"]}
    assert lost["quality"] == 5 and lost["calls_per_hour"] == 3.75 and lost["overtime"] == 0
    assert [m["code"] for m in body["metrics"]][:2] == ["quality", "calls_per_hour"]
    assert body["advice"]["room"] == 8.75

    nxt = body["advice"]["next"]
    assert (nxt["name"], nxt["gap"]) == ("Данияр А.", 2.5)
    options = {o["code"]: o for o in nxt["options"]}
    # The smallest move first: 80 → 90.1 % of quality, then 9 → 11.1 calls an hour.
    assert [o["code"] for o in nxt["options"]] == ["quality", "calls_per_hour"]
    assert options["quality"]["need"] == 90.1 and options["calls_per_hour"]["need"] == 11.1
    assert all(o["gain"] >= 2.51 for o in nxt["options"])

    podium = body["advice"]["podium"]
    assert (podium["place"], podium["name"], podium["gap"]) == (3, "Данияр А.", 2.5)
    assert podium["plan"]["reachable"] and podium["plan"]["steps"][0]["code"] == "quality"


async def test_a_gap_no_metric_can_close_this_week_says_so(session, operator):
    metrics = race_service.metrics_of(
        {"metrics": [{"code": "quality", "title": "Качество", "unit": "%", "kind": "positive",
                      "value": 96, "target": 100, "points": 24, "max_points": 25}],
         "reported_codes": ["quality"]},
        {},
    )
    assert race_service.pass_options(metrics, 3) == []
    plan = race_service.plan(metrics, 3)
    assert not plan["reachable"] and plan["gain"] == 1


async def test_equal_points_share_the_place_and_the_next_one_is_above_them(
    client, session, operator
):
    week = await _field(session, operator, mine={"quality": 80, "calls_per_hour": 11})
    body = (await _race(client, week.id)).json()
    assert body["me"]["rank"] == 3 and body["me"]["shared_with"] == ["Данияр А."]
    assert (body["next"]["name"], body["next"]["gap"]) == ("Жанна Б.", 5.25)
    assert body["podium"][2]["reached"] and body["advice"]["podium"] is None


async def test_unreported_metrics_are_not_advice(client, session, operator):
    week = await weekly_service.get_or_create_week(session, date(2026, 6, 1))
    await _field(session, operator, mine=False, calculate=False)
    await _metrics(session, week.id, operator.id,
                   {k: v for k, v in {**STRONG, **MINE}.items() if k != "driver_gratitudes"})
    await session.commit()
    body = (await _race(client, week.id)).json()
    gratitude = next(m for m in body["metrics"] if m["code"] == "driver_gratitudes")
    assert gratitude["reported"] is False and gratitude["value"] is None and gratitude["lost"] == 5
    assert body["metrics"][-1]["code"] == "driver_gratitudes"
    advised = [o["code"] for o in body["advice"]["next"]["options"]]
    assert "driver_gratitudes" not in advised


async def test_an_operator_without_metrics_sees_the_field(client, session, operator):
    week = await _field(session, operator, mine=False)
    body = (await _race(client, week.id)).json()
    assert body["me"] is None and body["advice"] is None and body["participants"] == 4
    assert [p["gap"] for p in body["podium"]] == [None, None, None]
    assert all(row["gap"] is None for row in body["standings"])


async def test_weekly_prizes_show_only_when_weeks_pay_places(client, session, operator):
    week = await _field(session, operator)
    assert (await _race(client, week.id)).json()["prizes"] == []
    rules = await get_rules(session)
    rules.contest_period = "week"
    await session.commit()
    body = (await _race(client, week.id)).json()
    assert body["period"] == "week" and body["prizes"] == [300, 200, 150]


async def test_the_race_is_for_operators(client, session, head):
    response = await _race(client, who="head1")
    assert response.status_code == 403


async def test_the_month_table_names_operators_short_for_an_operator(client, session, operator):
    await _field(session, operator)
    item = await months.get_or_create(session, 2026, 6)
    await months.calculate(session, item)
    await session.commit()
    response = await client.get(
        "/api/v1/contest/month", params={"year": 2026, "month": 6},
        headers=auth(await login(client, "op1")),
    )
    assert response.status_code == 200, response.text
    names = {row["name"] for row in response.json()["standings"]}
    assert names == {"Айгерим А.", "Жанна Б.", "Данияр А.", "Оператор Первый", "Тимур Д."}
