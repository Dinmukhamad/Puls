"""The week's points as decided for both channels (docs/CHANNELS.md): the overtime bonus, the
channels' nominations, the prize threshold and the badges that count the operator's own metrics."""

from datetime import date, timedelta

from sqlalchemy import select

from app.models.badge import BadgeDefinition
from app.models.contest import MetricDefinition, MonthNominationWinner, NominationDefinition
from app.models.enums import Channel
from app.services import badges, months
from app.services import weekly as weekly_service
from app.services.rules import get_rules
from app.services.scoring import channel_definitions, score_week
from tests.conftest import auth, login, make_user
from tests.test_rating_race import STRONG, _metrics

JUNE = [date(2026, 6, 1) + timedelta(days=7 * n) for n in range(4)]
CHAT_STRONG = {"chat_quality": 97, "chat_hours_norm": 100, "lateness": 0, "forbidden_sites": 0}


async def _line(session):
    return channel_definitions(
        list(await session.scalars(select(MetricDefinition).where(MetricDefinition.is_active))),
        Channel.LINE,
    )


async def test_overtime_is_a_bonus_once_the_norm_is_met(session):
    line = await _line(session)
    base = {**STRONG, "overtime": 0}
    assert score_week(line, base).final_points == 100
    # 1.25 points an hour over the norm, at most 40 % of the hours' 25 points.
    assert score_week(line, {**base, "overtime": 4}).final_points == 105
    assert score_week(line, {**base, "overtime": 8}).final_points == 110
    assert score_week(line, {**base, "overtime": 20}).final_points == 110
    # Below the norm the overtime gives nothing yet; the breakdown says why.
    week = score_week(line, {**base, "hours_norm": 96, "overtime": 8})
    assert week.final_points == 99
    overtime = next(m for m in week.metrics if m.code == "overtime")
    assert overtime.as_dict()["bonus_for"] == "hours_norm" and overtime.unlocked is False
    assert (overtime.points, overtime.max_points) == (0, 10)


async def test_a_bonus_follows_the_points_of_its_metric(client, session, operator, head):
    headers = auth(await login(client, "head1"))
    metrics = {m["code"]: m for m in (await client.get(
        "/api/v1/admin/config/metrics", headers=headers)).json()}
    assert metrics["overtime"]["bonus_for"] == "hours_norm"
    assert metrics["overtime"]["max_points"] == 10 and metrics["overtime"]["bonus_share"] == 0.4
    # The norm of hours worth 30: the overtime bonus becomes 12.
    response = await client.patch(
        f"/api/v1/admin/config/metrics/{metrics['hours_norm']['id']}",
        headers=headers, json={"max_points": 30},
    )
    assert response.status_code == 200, response.text
    overtime = await session.get(MetricDefinition, metrics["overtime"]["id"])
    await session.refresh(overtime)
    assert overtime.max_points == 12
    # A bonus builds on a metric of its own channel that gives points.
    wrong = await client.patch(
        f"/api/v1/admin/config/metrics/{metrics['overtime']['id']}",
        headers=headers, json={"bonus_for": "chat_hours_norm"},
    )
    assert wrong.status_code == 400


async def test_the_channels_play_their_own_nominations(session, operator):
    line_rival = await make_user(session, login="l2", full_name="Линия Вторая")
    line_third = await make_user(session, login="l3", full_name="Линия Третья")
    chats = []
    for n, quality in enumerate((97, 94, 90), start=1):
        chat = await make_user(session, login=f"c{n}", full_name=f"Чат Оператор {n}")
        chat.channel = Channel.CHAT
        chats.append((chat, quality))
    await session.commit()
    for monday in JUNE:
        week = await weekly_service.get_or_create_week(session, monday)
        await _metrics(session, week.id, operator.id, STRONG)
        await _metrics(session, week.id, line_rival.id, {**STRONG, "quality": 90})
        await _metrics(session, week.id, line_third.id, {**STRONG, "quality": 80, "lateness": 1})
        for chat, quality in chats:
            await _metrics(session, week.id, chat.id, {
                **CHAT_STRONG, "chat_quality": quality, "chat_response_time": 100 + quality,
            })
        await session.commit()
        await weekly_service.calculate_week(session, week)
        await session.commit()
    item = await months.get_or_create(session, 2026, 6)
    await months.calculate(session, item)
    await session.commit()
    winners = dict((await session.execute(
        select(NominationDefinition.code, MonthNominationWinner.user_id)
        .join(MonthNominationWinner, MonthNominationWinner.nomination_id == NominationDefinition.id)
        .where(MonthNominationWinner.month_id == item.id)
    )).all())
    best_chat, _ = chats[0]
    # «Без опозданий» in each channel: the chats' best does not take the line's.
    assert winners["no_lateness"] == operator.id and winners["no_lateness_chat"] == best_chat.id
    assert winners["best_quality"] == operator.id and winners["best_chat_quality"] == best_chat.id
    # The fastest reply is the lowest time: 190 s of the 90 % operator against 194 and 197.
    assert winners["fastest_chat_reply"] == chats[2][0].id
    assert "top_gratitudes" not in winners


async def test_a_place_pays_only_with_fifty_points_a_week_on_average(session, operator):
    weak = await make_user(session, login="weak", full_name="Слабая Неделя")
    middle = await make_user(session, login="mid", full_name="Средняя Неделя")
    for monday in JUNE:
        week = await weekly_service.get_or_create_week(session, monday)
        await _metrics(session, week.id, operator.id, STRONG)
        # 25 + 15 + 12.5 + 10 = 62.5 points; the weak one 12.5 + 15 + 12.5 = 40.
        await _metrics(session, week.id, middle.id, {
            "hours_norm": 100, "quality": 50, "efficiency": 50, "calls_per_hour": 6,
        })
        await _metrics(session, week.id, weak.id, {
            "hours_norm": 50, "quality": 50, "efficiency": 50,
        })
        await session.commit()
        await weekly_service.calculate_week(session, week)
        await session.commit()
    item = await months.get_or_create(session, 2026, 6)
    results = {r.user_id: r for r in await months.calculate(session, item)}
    await session.commit()
    assert [results[u.id].rank for u in (operator, middle, weak)] == [1, 2, 3]
    assert results[middle.id].coins_rank_bonus == 200
    assert results[weak.id].coins_rank_bonus == 0
    rules = await get_rules(session)
    rules.prize_min_points = 0
    await session.commit()
    results = {r.user_id: r for r in await months.calculate(session, item)}
    assert results[weak.id].coins_rank_bonus == 150


async def test_the_quality_star_counts_a_chat_operators_own_quality(session, operator):
    chat = await make_user(session, login="c1", full_name="Чат Звезда")
    chat.channel = Channel.CHAT
    await session.commit()
    for monday in JUNE[:2]:
        week = await weekly_service.get_or_create_week(session, monday)
        await _metrics(session, week.id, chat.id, {**CHAT_STRONG, "chat_quality": 96})
        await session.commit()
        await weekly_service.close_week(session, week)
        await session.commit()
    star = await session.scalar(
        select(BadgeDefinition).where(BadgeDefinition.code == "quality_star")
    )
    assert (await badges.evaluate_badge(session, star, chat.id)).unlocked
    assert not (await badges.evaluate_badge(session, star, operator.id)).unlocked
    favourite = await session.scalar(
        select(BadgeDefinition).where(BadgeDefinition.code == "driver_favourite")
    )
    assert favourite.is_active is False


async def test_a_week_of_zero_points_is_nobodys_top_three(session, operator):
    other = await make_user(session, login="o2", full_name="Другой Оператор")
    week = await weekly_service.get_or_create_week(session, JUNE[0])
    for user in (operator, other):
        await _metrics(session, week.id, user.id, {"lateness": 0})
    await session.commit()
    await weekly_service.close_week(session, week)
    await session.commit()
    top = await session.scalar(select(BadgeDefinition).where(BadgeDefinition.code == "top3_week"))
    assert not (await badges.evaluate_badge(session, top, operator.id)).unlocked
