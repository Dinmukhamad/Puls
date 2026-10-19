"""Operators on the line and in chats: own metrics on 100 points, own places, one coin rate."""

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contest import MetricDefinition, OperatorWeekResult
from app.models.enums import Channel
from app.models.user import User
from app.services import months
from app.services import weekly as weekly_service
from app.services.scoring import band_points, channel_definitions, score_week
from tests.conftest import auth, login, make_user
from tests.test_rating_race import STRONG, _metrics

JUNE = date(2026, 6, 1)
CHAT = [
    ("c1", "Чат Первая Альфа", 97),
    ("c2", "Чат Второй Бета", 92),
    ("c3", "Чат Третья Гамма", 85.5),
]


async def _field(session: AsyncSession, operator: User) -> dict[str, User]:
    """Line: op1 100 points, l2 95. Chats: quality 97 % → 100, 92 % → 60, 85.5 % → 20."""
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
            {"chat_quality": quality, "quality": 100, "lateness": 0, "forbidden_sites": 0},
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
    assert chat.channel == Channel.CHAT and chat.max_points == 100
    assert [band_points(chat.bands, v) for v in (79.9, 80, 85.5, 86, 92, 96.9, 97, 100)] == [
        0,
        20,
        20,
        40,
        60,
        80,
        100,
        100,
    ]
    definitions = list(await session.scalars(select(MetricDefinition)))
    chat_codes = {d.code for d in channel_definitions(definitions, Channel.CHAT)}
    line_codes = {d.code for d in channel_definitions(definitions, Channel.LINE)}
    # Discipline is common; each channel's own metrics are its own, 100 points each.
    assert {"chat_quality", "lateness", "forbidden_sites"} == chat_codes
    assert "chat_quality" not in line_codes and {"quality", "lateness"} <= line_codes
    for channel in Channel:
        mine = channel_definitions(definitions, channel)
        assert sum(d.max_points for d in mine if d.kind == "positive") == 100
    assert (
        score_week(
            channel_definitions(definitions, Channel.CHAT), {"chat_quality": 92}
        ).final_points
        == 60
    )


async def test_the_week_ranks_each_channel_and_pays_points_at_one_rate(session, operator):
    people, _, results = await _calculated(session, operator)
    by = {name: results[user.id] for name, user in people.items()}
    assert [by[n].final_points for n in ("c1", "c2", "c3")] == [100, 60, 20]
    # Places within the channel: each channel has its own first place.
    assert [by[n].rank for n in ("op1", "l2", "c1", "c2", "c3")] == [1, 2, 1, 2, 3]
    # A perfect chat week pays as much as a perfect line week: the same rate for 100 points.
    assert by["c1"].coins_from_points == by["op1"].coins_from_points
    codes = {m["code"] for m in by["c2"].breakdown["metrics"]}
    assert codes == {"chat_quality", "lateness", "forbidden_sites"}
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
    # From 85.5 % (20 points) passing 60 points takes the 94 % threshold: 80 points.
    assert (option["code"], option["need"], option["gain"]) == ("chat_quality", 94, 60)


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
    assert [m["code"] for m in body["metrics"]] == ["chat_quality"]
    assert body["metrics"][0]["average"] == 91.5 and body["metrics"][0]["place"] == 2
    channels = {c["channel"]: c for c in body["channels"]}
    assert channels["chat"]["average"] == 60 and channels["chat"]["is_mine"]
    assert channels["line"]["participants"] == 2 and channels["line"]["best"]["points"] == 100
    assert [m["title"] for m in channels["chat"]["metrics"]] == ["Качество чатов"]


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
