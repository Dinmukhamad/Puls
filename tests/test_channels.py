"""Operators on the line and in chats: own metrics on 100 points, own places, one coin rate."""

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contest import MetricDefinition, OperatorWeekResult
from app.models.enums import Channel
from app.models.user import User
from app.services import months
from app.services import weekly as weekly_service
from app.services.scoring import (
    band_points,
    channel_definitions,
    channel_max_points,
    score_week,
)
from tests.conftest import auth, login, make_user
from tests.test_rating_race import STRONG, _metrics

JUNE = date(2026, 6, 1)
CHAT = [
    ("c1", "Чат Первая Альфа", 97),
    ("c2", "Чат Второй Бета", 92),
    ("c3", "Чат Третья Гамма", 85.5),
]


async def _field(session: AsyncSession, operator: User) -> dict[str, User]:
    """
    Line: op1 110 points (100 and the overtime bonus), l2 104. Chats, with the norm of hours (25)
    and the overtime bonus (10): quality 97 % → 75, 92 % → 45, 85.5 % → 15, so 110, 80, 50.
    """
    people = {
        "op1": operator,
        "l2": await make_user(session, login="l2", full_name="Линия Вторая Дельта"),
    }
    for login_name, full_name, _ in CHAT:
        people[login_name] = await make_user(session, login=login_name, full_name=full_name)
        people[login_name].channel = Channel.CHAT
    await session.commit()
    week = await weekly_service.get_or_create_week(session, JUNE)
    await _metrics(session, week.id, operator.id, STRONG)
    await _metrics(session, week.id, people["l2"].id, {**STRONG, "quality": 80})
    for login_name, _, quality in CHAT:
        # A line metric uploaded for a chat operator counts for nothing.
        await _metrics(
            session,
            week.id,
            people[login_name].id,
            {
                "chat_quality": quality,
                "chat_hours_norm": 100,
                "chat_overtime": 8,
                "quality": 100,
                "lateness": 0,
                "forbidden_sites": 0,
            },
        )
    await session.commit()
    return people


async def _calculated(session: AsyncSession, operator: User):
    people = await _field(session, operator)
    week = await weekly_service.get_or_create_week(session, JUNE)
    await weekly_service.calculate_week(session, week)
    await session.commit()
    results = {
        r.user_id: r
        for r in await session.scalars(
            select(OperatorWeekResult).where(OperatorWeekResult.week_id == week.id)
        )
    }
    return people, week, results


async def test_chat_quality_scores_by_thresholds(session):
    chat = await session.scalar(
        select(MetricDefinition).where(MetricDefinition.code == "chat_quality")
    )
    assert chat.channel == Channel.CHAT and chat.max_points == 75
    assert [band_points(chat.bands, v) for v in (79.9, 80, 85.5, 86, 92, 96.9, 97, 100)] == [
        0,
        15,
        15,
        30,
        45,
        60,
        75,
        75,
    ]
    definitions = list(
        await session.scalars(select(MetricDefinition).where(MetricDefinition.is_active))
    )
    chat_codes = {d.code for d in channel_definitions(definitions, Channel.CHAT)}
    line_codes = {d.code for d in channel_definitions(definitions, Channel.LINE)}
    # Discipline is common; each channel's own metrics are its own, 100 points each.
    assert {
        "chat_quality", "chat_hours_norm", "chat_overtime", "chat_response_time",
        "chats_per_hour", "lateness", "forbidden_sites",
    } == chat_codes
    assert "chat_quality" not in line_codes and {"quality", "hours_norm", "lateness"} <= line_codes
    assert not {"hours_worked", "driver_gratitudes"} & line_codes
    for channel in Channel:
        assert channel_max_points(definitions, channel) == 100
    chat_definitions = channel_definitions(definitions, Channel.CHAT)
    assert score_week(chat_definitions, {"chat_quality": 92}).final_points == 45
    # Overtime adds up to 10 over the 100, only once the norm of hours is met.
    assert score_week(
        chat_definitions, {"chat_quality": 97, "chat_hours_norm": 100, "chat_overtime": 4}
    ).final_points == 105
    assert score_week(
        chat_definitions, {"chat_quality": 97, "chat_hours_norm": 90, "chat_overtime": 4}
    ).final_points == 97.5


async def test_the_week_ranks_each_channel_and_pays_points_at_one_rate(session, operator):
    people, _, results = await _calculated(session, operator)
    by = {name: results[user.id] for name, user in people.items()}
    assert [by[n].final_points for n in ("c1", "c2", "c3")] == [110, 80, 50]
    # Places within the channel: each channel has its own first place.
    assert [by[n].rank for n in ("op1", "l2", "c1", "c2", "c3")] == [1, 2, 1, 2, 3]
    # A perfect chat week pays as much as a perfect line week: the same rate for 100 points.
    assert by["c1"].coins_from_points == by["op1"].coins_from_points
    codes = {m["code"] for m in by["c2"].breakdown["metrics"]}
    assert codes == {
        "chat_quality", "chat_hours_norm", "chat_overtime", "chat_response_time",
        "chats_per_hour", "lateness", "forbidden_sites",
    }
    assert by["c2"].breakdown["channel"] == "chat"


async def test_the_race_is_within_the_channel(client, session, operator):
    _, week, _ = await _calculated(session, operator)
    body = (
        await client.get(
            "/api/v1/rating/race",
            params={"week_id": week.id},
            headers=auth(await login(client, "c3")),
        )
    ).json()
    # «Имя Ф.» for the others, the viewer's own name in full; nobody from the line.
    assert [r["name"] for r in body["standings"]] == ["Чат А.", "Чат Б.", "Чат Третья Гамма"]
    assert body["participants"] == 3 and body["me"]["rank"] == 3 and body["max_points"] == 100
    option = body["advice"]["next"]["options"][0]
    # From 85.5 % (15 points) passing 30 points ahead takes the 94 % threshold: 60 points.
    assert (option["code"], option["need"], option["gain"]) == ("chat_quality", 94, 45)


async def test_the_rating_compares_the_channels_by_the_average_week(client, session, operator):
    _, week, _ = await _calculated(session, operator)
    body = (
        await client.get(
            "/api/v1/rating/compare",
            params={"period": "week", "week_id": week.id},
            headers=auth(await login(client, "c2")),
        )
    ).json()
    assert body["channel"] == "chat"
    assert [r["name"] for r in body["operators"]] == ["Чат А.", "Чат Второй Бета", "Чат Г."]
    assert [m["code"] for m in body["metrics"]] == [
        "chat_quality", "chat_hours_norm", "chat_overtime",
    ]
    assert body["metrics"][0]["average"] == 91.5 and body["metrics"][0]["place"] == 2
    assert [m["bonus"] for m in body["metrics"]] == [False, False, True]
    channels = {c["channel"]: c for c in body["channels"]}
    assert channels["chat"]["average"] == 80 and channels["chat"]["is_mine"]
    assert channels["line"]["participants"] == 2 and channels["line"]["best"]["points"] == 110
    assert [(m["title"], m["max_points"], m["bonus"]) for m in channels["chat"]["metrics"]] == [
        ("Качество чатов", 75, False),
        ("Норма часов в чатах", 25, False),
        ("Переработки в чатах", 10, True),
    ]


async def test_the_month_plays_its_places_within_each_channel(session, operator):
    people, _, _ = await _calculated(session, operator)
    item = await months.get_or_create(session, 2026, 6)
    results = {r.user_id: r for r in await months.calculate(session, item)}
    await session.commit()
    assert results[people["op1"].id].rank == 1 and results[people["c1"].id].rank == 1
    assert (
        results[people["c1"].id].coins_rank_bonus == results[people["op1"].id].coins_rank_bonus > 0
    )
    assert results[people["c3"].id].rank == 3


async def test_staff_see_one_channel_at_a_time(client, session, operator, head):
    _, week, _ = await _calculated(session, operator)
    headers = auth(await login(client, "head1"))
    chat = (
        await client.get(
            "/api/v1/rating", params={"week_id": week.id, "channel": "chat"}, headers=headers
        )
    ).json()
    assert chat["header"]["participants"] == 3 and [r["rank"] for r in chat["rows"]] == [1, 2, 3]
    line = (await client.get("/api/v1/rating", params={"week_id": week.id}, headers=headers)).json()
    assert line["header"]["participants"] == 2


async def test_staff_set_the_channel_and_the_thresholds(client, session, operator, head):
    headers = auth(await login(client, "head1"))
    response = await client.patch(
        f"/api/v1/admin/users/{operator.id}", headers=headers, json={"channel": "chat"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["channel"] == "chat"
    assert (
        await client.patch(
            f"/api/v1/admin/users/{operator.id}", headers=headers, json={"channel": None}
        )
    ).status_code == 422

    bands = [{"from": 1, "points": 10}, {"from": 3, "points": 30}]
    response = await client.post(
        "/api/v1/admin/config/metrics",
        headers=headers,
        json={
            "code": "chat_speed",
            "title": "Скорость ответа",
            "target_value": 3,
            "channel": "chat",
            "bands": bands,
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["max_points"] == 30 and response.json()["channel"] == "chat"
    wrong = await client.post(
        "/api/v1/admin/config/metrics",
        headers=headers,
        json={
            "code": "chat_wrong",
            "title": "Неверно",
            "target_value": 3,
            "channel": "chat",
            "bands": list(reversed(bands)),
        },
    )
    assert wrong.status_code == 400


async def test_analytics_shows_one_channel_at_a_time(client, session, operator, head):
    _, week, _ = await _calculated(session, operator)
    headers = auth(await login(client, "head1"))

    async def report(**params):
        response = await client.get(
            "/api/v1/analytics/summary", params={"week_id": week.id, **params}, headers=headers
        )
        assert response.status_code == 200, response.text
        return response.json()

    chats = await report(channel="chat")
    assert chats["operator_count"] == 3 and chats["metric_code"] == "chat_quality"
    assert {m["code"] for m in chats["metrics"]} == {
        "chat_quality", "chat_hours_norm", "chat_overtime", "chat_response_time",
        "chats_per_hour", "lateness", "forbidden_sites",
    }
    # Completeness counts the channel's own metrics: every chat operator has the loaded ones.
    reported = {m["code"]: m["reported"] for m in chats["metrics"]}
    assert all(reported[code] == 3 for code in ("chat_quality", "chat_hours_norm", "lateness"))
    # Overtime is a bonus: shown, never a goal someone is below.
    overtime = next(m for m in chats["metrics"] if m["code"] == "chat_overtime")
    assert overtime["bonus"] and overtime["below_target"] == 0
    # Metrics without points are for reference; the quality and the discipline give points.
    scored = {m["code"]: m["scored"] for m in chats["metrics"]}
    assert not scored["chat_response_time"] and not scored["chats_per_hour"]
    assert scored["chat_quality"] and scored["chat_overtime"] and scored["lateness"]
    # A line metric in an old link falls back to the chats' own quality.
    assert (await report(channel="chat", metric_code="quality"))["metric_code"] == "chat_quality"
    line = await report(channel="line")
    assert line["operator_count"] == 2 and line["metric_code"] == "quality"
    assert "chat_quality" not in {m["code"] for m in line["metrics"]}
    everyone = await report()
    assert everyone["operator_count"] == 5 and "chat_quality" in {
        m["code"] for m in everyone["metrics"]
    }


async def test_the_operators_table_places_each_channel_apart(client, session, operator, head):
    _, week, _ = await _calculated(session, operator)
    await weekly_service.close_week(session, week)
    await session.commit()
    headers = auth(await login(client, "head1"))
    for params in ({"week_id": week.id}, {"date_from": "2026-06-01", "date_to": "2026-06-07"}):
        rows = (await client.get("/api/v1/admin/operators", params=params, headers=headers)).json()
        # The line first, then chats, each with its own first place.
        assert [(r["channel"], r["rank"]) for r in rows["items"]] == [
            ("line", 1),
            ("line", 2),
            ("chat", 1),
            ("chat", 2),
            ("chat", 3),
        ], params
    table = "/api/v1/admin/operators"
    chats = (
        await client.get(table, params={"week_id": week.id, "channel": "chat"}, headers=headers)
    ).json()
    assert chats["total"] == 3 and {r["channel"] for r in chats["items"]} == {"chat"}
    csv = (await client.get(f"{table}/export", params={"week_id": week.id}, headers=headers)).text
    assert csv.splitlines()[0].endswith(";Направление") and csv.splitlines()[-1].endswith(";Чаты")


async def test_chat_operators_take_no_calls(client, session, operator):
    from app.core.errors import PermissionDeniedError
    from app.services import city, voice_training

    chat = await make_user(session, login="c9", full_name="Чат Девятый Оператор")
    chat.channel = Channel.CHAT
    await session.commit()
    mine = await city.dashboard(session, chat)
    assert not {"voice", "oktell"} & {d["id"] for d in mine["districts"]}
    assert not {"voice", "oktell"} & {m["district"] for m in mine["missions"]}
    line = await city.dashboard(session, operator)
    assert {"voice", "oktell"} <= {d["id"] for d in line["districts"]}
    try:
        await city.claim(session, chat, "voice_first", None)
    except PermissionDeniedError:
        pass
    else:
        raise AssertionError("a chat operator claimed a call mission")
    assert not voice_training.can_call(chat) and voice_training.can_call(operator)
    response = await client.get("/api/v1/learning/voice", headers=auth(await login(client, "c9")))
    assert response.status_code == 403 and "чатов" in response.json()["detail"]
