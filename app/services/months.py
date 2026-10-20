"""The monthly contest: places and nominations among all operators, once a month.

The weeks pay the points, the discipline bonuses and the fines (services/weekly.py). A month is
made of the weeks whose Thursday falls in it (economy.week_month), so each week is in exactly one.
Its standings rank the operators by the sum of their final points over those weeks (sports
ranking: tied operators share a place). A nomination compares each operator's average of the
metric over the weeks they reported it; only operators in at least half of the month's weeks take
part, so one good week is not a month. "Best progress" compares the month's points with the
previous month's. Closing pays the places' and nominations' coins once (idempotency keys); the
month closes by itself when its last week is closed, or by a head.
"""

from __future__ import annotations

import math
from datetime import date, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError
from app.db.base import utcnow
from app.models.contest import (
    ContestMonth,
    ContestWeek,
    MonthNominationWinner,
    NominationDefinition,
    OperatorMonthResult,
    OperatorWeekResult,
)
from app.models.enums import Channel, MetricDirection, Role, TxType, WeekStatus
from app.models.progress import Notification
from app.models.user import User
from app.services import coins as coins_service
from app.services.economy import is_last_week_of_month, week_month
from app.services.rules import get_rules
from app.services.weekly import PROGRESS_METRIC, in_scope, prize_reached

MONTHS = (
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
)


def month_name(year: int, month: int) -> str:
    return f"{MONTHS[month - 1]} {year}"


def calendar_weeks(year: int, month: int) -> list[date]:
    """The Mondays of the month's weeks, by their Thursdays."""
    first = date(year, month, 1)
    monday = first - timedelta(days=first.weekday())
    out = []
    while True:
        if week_month(monday) == (year, month):
            out.append(monday)
        elif out:
            break
        monday += timedelta(days=7)
        if monday > first + timedelta(days=40):
            break
    return out


async def get_or_create(session: AsyncSession, year: int, month: int) -> ContestMonth:
    item = await session.scalar(
        select(ContestMonth).where(ContestMonth.year == year, ContestMonth.month == month)
    )
    if item is None:
        item = ContestMonth(year=year, month=month)
        session.add(item)
        await session.flush()
    return item


async def month_weeks(session: AsyncSession, year: int, month: int) -> list[ContestWeek]:
    mondays = calendar_weeks(year, month)
    return list(await session.scalars(
        select(ContestWeek)
        .where(ContestWeek.starts_on.in_(mondays))
        .order_by(ContestWeek.starts_on)
    ))


def _previous(year: int, month: int) -> tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


async def _points(session: AsyncSession, weeks: list[ContestWeek]) -> dict[int, float]:
    if not weeks:
        return {}
    out: dict[int, float] = {}
    for user_id, points in await session.execute(
        select(OperatorWeekResult.user_id, OperatorWeekResult.final_points).where(
            OperatorWeekResult.week_id.in_([w.id for w in weeks])
        )
    ):
        out[user_id] = out.get(user_id, 0.0) + float(points or 0)
    return out


def _rank(results: list[OperatorMonthResult], channels: dict[int, str] | None = None) -> None:
    """Places by the month's points, within each channel (docs/CHANNELS.md): 1, 2, 2, 4."""
    if channels:
        groups: dict[str, list[OperatorMonthResult]] = {}
        for result in results:
            groups.setdefault(channels.get(result.user_id, Channel.LINE), []).append(result)
        for group in groups.values():
            _rank(group)
        return
    ordered = sorted(results, key=lambda r: (-r.points, r.user_id))
    previous, place = None, 0
    for index, result in enumerate(ordered, start=1):
        if previous is None or abs(result.points - previous) >= 1e-9:
            place = index
        result.rank = place
        previous = result.points


async def calculate(session: AsyncSession, item: ContestMonth) -> list[OperatorMonthResult]:
    """Recomputes the month's standings and nominations without paying anything."""
    if item.status == WeekStatus.CLOSED:
        raise ConflictError(f"Месяц {item.label} уже закрыт", code="month_closed")
    rules = await get_rules(session)
    weeks = [w for w in await month_weeks(session, item.year, item.month)
             if w.status in (WeekStatus.CALCULATED, WeekStatus.CLOSED)]
    await session.execute(delete(MonthNominationWinner).where(
        MonthNominationWinner.month_id == item.id))
    await session.execute(delete(OperatorMonthResult).where(
        OperatorMonthResult.month_id == item.id))
    await session.flush()
    if not weeks:
        item.status = WeekStatus.CALCULATED
        item.calculated_at = utcnow()
        await session.flush()
        return []

    rows = list(await session.scalars(
        select(OperatorWeekResult)
        .join(User, User.id == OperatorWeekResult.user_id)
        .where(OperatorWeekResult.week_id.in_([w.id for w in weeks]), User.role == Role.OPERATOR)
    ))
    previous = await _points(session, await month_weeks(session, *_previous(item.year, item.month)))
    by_user: dict[int, list[OperatorWeekResult]] = {}
    for row in rows:
        by_user.setdefault(row.user_id, []).append(row)

    results = []
    for user_id, mine in by_user.items():
        sums: dict[str, list[float]] = {}
        for row in mine:
            breakdown = row.breakdown or {}
            reported = set(breakdown.get("reported_codes") or [])
            scored = {m.get("code") for m in breakdown.get("metrics", [])}
            for metric in breakdown.get("metrics", []):
                code, value = metric.get("code"), metric.get("value")
                if value is not None and (not reported or code in reported):
                    sums.setdefault(code, []).append(float(value))
            for code, count in (
                (rules.lateness_metric_code, row.lateness_count),
                (rules.forbidden_sites_metric_code, row.forbidden_sites_count),
            ):
                if code in reported and code not in scored:
                    sums.setdefault(code, []).append(float(count or 0))
        points = sum(float(r.final_points or 0) for r in mine)
        results.append(OperatorMonthResult(
            month_id=item.id,
            user_id=user_id,
            points=round(points, 4),
            weeks=len(mine),
            breakdown={
                "averages": {code: sum(v) / len(v) for code, v in sums.items()},
                "previous_points": previous.get(user_id),
                "weeks_total": len(weeks),
            },
        ))
    # The month's places, and their prizes, are played for within each channel.
    channels = {
        user_id: channel or Channel.LINE
        for user_id, channel in (await session.execute(
            select(User.id, User.channel).where(User.id.in_(list(by_user) or [0]))
        )).all()
    }
    _rank(results, channels)
    for result in results:
        # A place pays only with an average week of at least the rules' points.
        average = result.points / len(weeks)
        result.coins_rank_bonus = (
            rules.rank_bonus(result.rank) if prize_reached(average, rules) else 0
        )
        session.add(result)
    await session.flush()

    bonus = await _nominations(session, item, results, len(weeks), rules, channels)
    for result in results:
        result.coins_nomination_bonus = bonus.get(result.user_id, 0)
    item.status = WeekStatus.CALCULATED
    item.calculated_at = utcnow()
    await session.flush()
    return results


def _value(nomination: NominationDefinition, result: OperatorMonthResult) -> float | None:
    breakdown = result.breakdown or {}
    if nomination.metric_code == PROGRESS_METRIC:
        previous = breakdown.get("previous_points")
        return None if previous is None else result.points - float(previous)
    return (breakdown.get("averages") or {}).get(nomination.metric_code)


async def _nominations(
    session, item, results, weeks_total, rules, channels: dict[int, str] | None = None
) -> dict[int, int]:
    enough = math.ceil(weeks_total / 2)
    eligible = [r for r in results if r.weeks >= enough]
    bonus: dict[int, int] = {}
    for nomination in await session.scalars(
        select(NominationDefinition)
        .where(NominationDefinition.is_active.is_(True))
        .order_by(NominationDefinition.sort_order, NominationDefinition.id)
    ):
        # A channel's nomination is played for among its operators (docs/CHANNELS.md).
        scoped = [r for r in results if in_scope(nomination, (channels or {}).get(r.user_id))]
        if len(scoped) < rules.nomination_min_participants:
            continue
        candidates = []
        for result in (r for r in eligible if r in scoped):
            value = _value(nomination, result)
            if value is None:
                continue
            if nomination.require_zero and value != 0:
                continue
            if nomination.min_value is not None and value < nomination.min_value:
                continue
            candidates.append((result, value))
        if not candidates:
            continue
        if nomination.require_zero:
            winner, value = max(candidates, key=lambda p: (p[0].points, -p[0].user_id))
        else:
            higher = nomination.direction == MetricDirection.HIGHER_IS_BETTER
            winner, value = max(candidates, key=lambda p: (
                p[1] if higher else -p[1], p[0].points, -p[0].user_id))
        reward = nomination.coins_reward or rules.nomination_bonus_default
        session.add(MonthNominationWinner(
            month_id=item.id, nomination_id=nomination.id, user_id=winner.user_id,
            value=value, coins_awarded=reward,
        ))
        bonus[winner.user_id] = bonus.get(winner.user_id, 0) + reward
    await session.flush()
    return bonus


async def close(session: AsyncSession, item: ContestMonth, *, actor_id: int | None = None) -> dict:
    """Closes the month and pays its places and nominations; a closed month is left as it is."""
    if item.status == WeekStatus.CLOSED:
        return {"month": item.label, "already_closed": True, "coins_awarded": 0}
    weeks = await month_weeks(session, item.year, item.month)
    if any(w.status != WeekStatus.CLOSED for w in weeks):
        raise ConflictError(
            "Сначала закройте все недели месяца: места считаются по их итогам",
            code="month_weeks_open",
        )
    results = await calculate(session, item)
    rules = await get_rules(session)
    name = month_name(item.year, item.month)
    titles = {n.id: n.title for n in await session.scalars(select(NominationDefinition))}
    winners = list(await session.scalars(
        select(MonthNominationWinner).where(MonthNominationWinner.month_id == item.id)))
    paid = 0

    async def pay(user_id: int, amount: int, tx_type: TxType, reason: str, key: str) -> None:
        nonlocal paid
        if amount <= 0:
            return
        tx = await coins_service.post_transaction(
            session, user_id=user_id, amount=amount, tx_type=tx_type, reason=reason,
            created_by_id=actor_id, idempotency_key=f"month:{item.id}:user:{user_id}:{key}",
            meta={"month": item.label}, evaluate_achievements=False,
        )
        if tx is not None:
            paid += amount

    for result in results:
        if result.coins_rank_bonus:
            await pay(result.user_id, result.coins_rank_bonus, TxType.RANK_BONUS,
                      f"{result.rank} место в конкурсе за {name}", "rank")
            session.add(Notification(
                user_id=result.user_id, title=f"{result.rank} место в конкурсе месяца",
                body=f"За {name}: +{result.coins_rank_bonus} коинов", kind="coins",
                link="/wallet",
            ))
    for winner in winners:
        title = titles.get(winner.nomination_id, "Номинация месяца")
        await pay(winner.user_id, winner.coins_awarded, TxType.NOMINATION_BONUS,
                  f"Номинация «{title}» за {name}", f"nomination:{winner.nomination_id}")
        session.add(Notification(
            user_id=winner.user_id, title=f"Номинация месяца: {title}",
            body=f"За {name}: +{winner.coins_awarded} коинов", kind="coins", link="/wallet",
        ))
    item.status = WeekStatus.CLOSED
    item.closed_at = utcnow()
    item.closed_by_id = actor_id
    item.rules_snapshot = rules.as_snapshot()
    await session.flush()
    from app.services.badges import award_achievements

    for user_id in {r.user_id for r in results}:
        await award_achievements(session, user_id)
    return {"month": item.label, "already_closed": False, "coins_awarded": paid,
            "participants": len(results), "nominations": len(winners)}


async def close_after_week(session: AsyncSession, week: ContestWeek, *, actor_id=None) -> None:
    """Updates the week's month: closes it after its last week, else refreshes its standings."""
    year, month = week_month(week.starts_on)
    item = await get_or_create(session, year, month)
    if item.status == WeekStatus.CLOSED:
        return
    weeks = await month_weeks(session, year, month)
    if is_last_week_of_month(week.starts_on) and all(w.status == WeekStatus.CLOSED for w in weeks):
        await close(session, item, actor_id=actor_id)
    else:
        await calculate(session, item)


def empty_view(year: int, month: int) -> dict:
    """A month nobody has results for yet."""
    return {
        "id": None, "year": year, "month": month, "label": f"{year}-{month:02d}",
        "name": month_name(year, month), "status": "open", "closed_at": None, "weeks": [],
        "weeks_planned": len(calendar_weeks(year, month)), "standings": [], "nominations": [],
    }


async def view(session: AsyncSession, item: ContestMonth, *, viewer: User | None = None) -> dict:
    """The month's standings, nominations and weeks for the screens."""
    from app.core.visibility import ranking_name

    results = list(await session.scalars(
        select(OperatorMonthResult)
        .where(OperatorMonthResult.month_id == item.id)
        .order_by(OperatorMonthResult.rank, OperatorMonthResult.user_id)
    ))
    users = {u.id: u for u in await session.scalars(
        select(User).where(User.id.in_([r.user_id for r in results] or [0])))}
    winners = list(await session.scalars(
        select(MonthNominationWinner).where(MonthNominationWinner.month_id == item.id)))
    titles = {n.id: n.title for n in await session.scalars(select(NominationDefinition))}
    weeks = await month_weeks(session, item.year, item.month)

    def who(user_id: int) -> str | None:
        user = users.get(user_id)
        if user is None:
            return None
        return user.full_name if viewer is None else ranking_name(viewer, user)

    return {
        "id": item.id,
        "year": item.year,
        "month": item.month,
        "label": item.label,
        "name": month_name(item.year, item.month),
        "status": str(item.status),
        "closed_at": item.closed_at,
        "weeks": [{"id": w.id, "label": w.label, "starts_on": w.starts_on, "status": str(w.status)}
                  for w in weeks],
        "weeks_planned": len(calendar_weeks(item.year, item.month)),
        "standings": [
            {
                "user_id": r.user_id, "name": who(r.user_id), "rank": r.rank,
                "points": round(r.points, 2), "weeks": r.weeks,
                "coins_rank_bonus": r.coins_rank_bonus,
                "coins_nomination_bonus": r.coins_nomination_bonus,
                "mine": viewer is not None and viewer.id == r.user_id,
                # Places are within the channel (docs/CHANNELS.md).
                "channel": (users[r.user_id].channel if r.user_id in users else None) or "line",
            }
            for r in results
        ],
        "nominations": [
            {"nomination_id": w.nomination_id, "title": titles.get(w.nomination_id, ""),
             "user_id": w.user_id, "name": who(w.user_id), "value": round(w.value, 2),
             "coins": w.coins_awarded}
            for w in winners
        ],
    }
