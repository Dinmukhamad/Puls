"""
«Рейтинг» for operators: compare yourself with everyone — the table of a week or a month, the places
and points week by week, a colleague, the teams, and each metric against all operators.

Other operators appear as «Имя Ф.» (``visibility.ranking_name``) with their places and points,
the way «Гонка недели» shows them. Their metrics are never shown one by one: a metric shows the
operator's own value, the average and the best value of everyone who reported it.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.visibility import ranking_name
from app.models.contest import (
    ContestMonth,
    ContestWeek,
    MetricDefinition,
    OperatorMonthResult,
)
from app.models.enums import Channel, MetricDirection, MetricKind, Role
from app.models.user import Group, User
from app.services import months, race, weekly
from app.services.economy import week_month
from app.services.scoring import channel_definitions

#: Weeks of history beside a week: the week itself and the five before it.
TRAIL = 6


def _week(week: ContestWeek, live: bool = False) -> dict:
    return {"id": week.id, "label": week.label, "starts_on": week.starts_on,
            "ends_on": week.ends_on, "status": str(week.status), "live": live}


def _ranked(rows: list[dict], key: str = "points") -> None:
    """Sports ranking: equal points share a place (1, 2, 2, 4)."""
    rows.sort(key=lambda r: (-r[key], r.get("name") or ""))
    previous, place = None, 0
    for index, row in enumerate(rows, start=1):
        if previous is None or abs(row[key] - previous) > race.EPS:
            place = index
        row["rank"] = place
        previous = row[key]


def metric_table(
    values: dict[int, dict[str, float]],
    definitions: list[MetricDefinition],
    viewer_id: int,
    my_points: dict[str, float] | None = None,
) -> list[dict]:
    """
    Each scored metric: the viewer's value, the average and the best value of everyone who
    reported it.
    ``values`` holds one value per operator and metric (a week's value or the month's average).
    """
    out = []
    for definition in definitions:
        if definition.kind != MetricKind.POSITIVE or not definition.max_points:
            continue
        reported = [v[definition.code] for v in values.values() if definition.code in v]
        if not reported:
            continue
        lower = definition.direction == MetricDirection.LOWER_IS_BETTER
        mine = values.get(viewer_id, {}).get(definition.code)
        best = min(reported) if lower else max(reported)
        better = None if mine is None else sum(
            1 for v in reported if (v < mine if lower else v > mine))
        out.append({
            "code": definition.code, "title": definition.title, "unit": definition.unit,
            "direction": str(definition.direction), "target": definition.target_value,
            "me": None if mine is None else round(mine, 2),
            "average": round(sum(reported) / len(reported), 2),
            "best": round(best, 2),
            "reported": len(reported),
            # Where the viewer stands on this metric alone: 1 is the best value.
            "place": None if better is None else better + 1,
            "points": None if my_points is None or definition.code not in my_points
            else round(my_points[definition.code], 2),
            "max_points": definition.max_points,
            "bonus": bool(definition.bonus_for),
        })
    return out


Values = dict[int, dict[str, float]]


def _week_values(runners: list[race.Runner]) -> tuple[Values, Values]:
    """Reported metric values and their points per operator, from the week's breakdowns."""
    values: Values = {}
    points: Values = {}
    for runner in runners:
        breakdown = runner.breakdown or {}
        reported = breakdown.get("reported_codes")
        for item in breakdown.get("metrics", []):
            code, value = item.get("code"), item.get("value")
            if value is None or (reported is not None and code not in reported):
                continue
            values.setdefault(runner.user.id, {})[code] = float(value)
            points.setdefault(runner.user.id, {})[code] = float(item.get("points") or 0)
    return values, points


def _teams(rows: list[dict], weeks: list[dict], viewer: User, groups: dict[int, str]) -> list[dict]:
    """Teams by the average points of their operators; the best operator of each team by name."""
    by_group: dict[int, list[dict]] = {}
    for row in rows:
        if row["group_id"] is not None:
            by_group.setdefault(row["group_id"], []).append(row)
    teams = []
    for group_id, members in by_group.items():
        best = min(members, key=lambda r: r["rank"])
        trail = []
        for index in range(len(weeks)):
            marks = [m["trail"][index]["points"] for m in members if m["trail"][index]]
            trail.append(round(sum(marks) / len(marks), 2) if marks else None)
        teams.append({
            "group_id": group_id, "name": groups.get(group_id, "Команда"),
            "members": len(members),
            "points": round(sum(m["points"] for m in members) / len(members), 2),
            "total": round(sum(m["points"] for m in members), 2),
            "best": {"name": best["name"], "points": best["points"], "is_me": best["is_me"]},
            "is_mine": group_id == viewer.group_id,
            "trail": trail,
        })
    _ranked(teams)
    return teams


async def _groups(session: AsyncSession) -> dict[int, str]:
    return dict((await session.execute(select(Group.id, Group.name))).all())


async def _trail(
    session: AsyncSession, weeks: list[ContestWeek], channel: str
) -> tuple[list[dict], dict[int, list[dict | None]]]:
    """Places and points of the channel's operators in each week; weeks without data are dropped."""
    shown: list[dict] = []
    marks: dict[int, dict[int, dict]] = {}
    for week in weeks:
        runners, live = await race.standings(session, week, channel)
        if not runners:
            continue
        shown.append(_week(week, live))
        for runner in runners:
            marks.setdefault(runner.user.id, {})[week.id] = {
                "rank": runner.rank, "points": round(runner.points, 2)}
    return shown, {
        user_id: [mine.get(w["id"]) for w in shown] for user_id, mine in marks.items()
    }


def _row(user: User, viewer: User, groups: dict[int, str], **fields) -> dict:
    return {
        "user_id": user.id, "name": ranking_name(viewer, user) or "Оператор",
        "group_id": user.group_id, "group": groups.get(user.group_id) if user.group_id else None,
        "is_me": user.id == viewer.id, **fields,
    }


def _channels(
    points: dict[int, float], users: dict[int, User], viewer: User,
    definitions: list[MetricDefinition],
) -> list[dict]:
    """
    The channels side by side (docs/CHANNELS.md): each scores its own metrics on 100 points, so the
    average week of an operator compares fairly. ``points`` are each operator's points of a week.
    """
    out = []
    own = viewer.channel or Channel.LINE
    for channel in Channel:
        # An operator sees their own channel only (docs/CHANNELS.md).
        if Role(viewer.role) == Role.OPERATOR and channel != own:
            continue
        mine = {
            uid: p for uid, p in points.items() if (users[uid].channel or Channel.LINE) == channel
        }
        best = max(mine, key=lambda uid: mine[uid], default=None)
        out.append({
            "channel": str(channel), "participants": len(mine),
            "average": round(sum(mine.values()) / len(mine), 2) if mine else None,
            "best": None if best is None else {
                "name": ranking_name(viewer, users[best]) or "Оператор",
                "points": round(mine[best], 2), "is_me": best == viewer.id},
            "is_mine": channel == own,
            "metrics": [
                {"title": d.title, "max_points": d.max_points, "bonus": bool(d.bonus_for)}
                for d in channel_definitions(definitions, channel)
                if d.kind == MetricKind.POSITIVE and d.max_points
            ],
        })
    return out


async def week_view(session: AsyncSession, viewer: User, week_id: int | None) -> dict:
    week = await weekly.get_week(session, week_id) if week_id else await race.default_week(session)
    if week is None:
        return _empty("week")
    channel = viewer.channel or Channel.LINE
    # Operators compete within their channel; the channels are compared by their average week.
    runners, live = await race.standings(session, week, channel)
    everyone, _ = await race.standings(session, week)
    groups = await _groups(session)
    history = list(reversed(list(await session.scalars(
        select(ContestWeek).where(ContestWeek.starts_on <= week.starts_on)
        .order_by(ContestWeek.starts_on.desc()).limit(TRAIL)
    ))))
    weeks, trail = await _trail(session, history, channel)
    rows = [
        _row(r.user, viewer, groups, rank=r.rank, points=round(r.points, 2),
             rank_delta=r.rank_delta, weeks=None, prize=None,
             trail=trail.get(r.user.id, [None] * len(weeks)))
        for r in runners
    ]
    values, points = _week_values(runners)
    definitions = await weekly.active_metric_definitions(session)
    year, month = week_month(week.starts_on)
    return {
        "period": "week", "title": week.label, "status": str(week.status), "live": live,
        "week": _week(week, live), "month": _month(year, month), "channel": channel,
        "participants": len(rows), "weeks": weeks, "operators": rows,
        "teams": _teams(rows, weeks, viewer, groups),
        "metrics": metric_table(
            values, channel_definitions(definitions, channel), viewer.id, points.get(viewer.id)),
        "channels": _channels({r.user.id: r.points for r in everyone},
                              {r.user.id: r.user for r in everyone}, viewer, definitions),
    }


async def month_view(
    session: AsyncSession, viewer: User, year: int | None, month: int | None
) -> dict:
    if year is None or month is None:
        week = await race.default_week(session)
        today = date.today()
        year, month = week_month(week.starts_on) if week else (today.year, today.month)
    channel = viewer.channel or Channel.LINE
    item = await session.scalar(
        select(ContestMonth).where(ContestMonth.year == year, ContestMonth.month == month))
    weeks, trail = await _trail(session, await months.month_weeks(session, year, month), channel)
    groups = await _groups(session)
    everyone = list(await session.scalars(
        select(OperatorMonthResult).where(OperatorMonthResult.month_id == item.id)
    )) if item else []
    users = {u.id: u for u in await session.scalars(
        select(User).where(User.id.in_([r.user_id for r in everyone] or [0])))}
    results = [r for r in everyone if r.user_id in users
               and (users[r.user_id].channel or Channel.LINE) == channel]
    rows = [
        _row(users[r.user_id], viewer, groups, rank=r.rank, points=round(r.points, 2),
             rank_delta=None, weeks=r.weeks,
             prize=r.coins_rank_bonus + r.coins_nomination_bonus,
             trail=trail.get(r.user_id, [None] * len(weeks)))
        for r in results if r.user_id in users
    ]
    rows.sort(key=lambda r: (r["rank"] or 10**6, r["name"]))
    averages = {r.user_id: dict((r.breakdown or {}).get("averages") or {}) for r in results}
    definitions = await weekly.active_metric_definitions(session)
    # A month's points depend on how many weeks counted: the channels compare by the average week.
    per_week = {r.user_id: r.points / r.weeks for r in everyone if r.user_id in users and r.weeks}
    return {
        "period": "month", "title": months.month_name(year, month),
        "status": str(item.status) if item else "open", "live": False,
        "week": None, "month": _month(year, month), "channel": channel,
        "participants": len(rows), "weeks": weeks, "operators": rows,
        "teams": _teams(rows, weeks, viewer, groups),
        "metrics": metric_table(averages, channel_definitions(definitions, channel), viewer.id),
        "channels": _channels(per_week, users, viewer, definitions),
    }


def _month(year: int, month: int) -> dict:
    return {"year": year, "month": month, "name": months.month_name(year, month),
            "weeks_planned": len(months.calendar_weeks(year, month))}


def _empty(period: str) -> dict:
    return {"period": period, "title": "", "status": "open", "live": False, "week": None,
            "month": None, "channel": Channel.LINE, "participants": 0, "weeks": [],
            "operators": [], "teams": [], "metrics": [], "channels": []}
