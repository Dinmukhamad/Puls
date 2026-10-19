"""
«Гонка недели»: where an operator stands among all operators of a week and what closes the gaps.

The standings come from the week's calculated results; a week nobody has calculated yet is scored
live from the metrics loaded so far, the way the cabinet shows its forecast. Other operators appear
as «Имя Ф.» (``visibility.ranking_name``). The advice uses the operator's own metrics only: how many
points each one still lacks and which value would take the next place or a podium place.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import PermissionDeniedError
from app.core.visibility import ranking_name
from app.models.contest import (
    TEST_SOURCE,
    ContestWeek,
    MetricDefinition,
    OperatorWeekMetric,
    OperatorWeekResult,
)
from app.models.enums import Channel, MetricDirection, MetricKind, Role, WeekStatus
from app.models.user import User
from app.services import weekly
from app.services.rules import get_rules
from app.services.scoring import band_points, channel_definitions, channel_max_points, score_week

PODIUM = 3
#: Points are kept to hundredths: passing someone takes one hundredth more than they have.
PASS = 0.01
EPS = 1e-9


@dataclass(slots=True)
class Runner:
    user: User
    points: float
    penalty: float
    rank: int = 0
    rank_delta: int | None = None
    breakdown: dict | None = None


async def _has_data(session: AsyncSession, week: ContestWeek) -> bool:
    result = await session.scalar(
        select(OperatorWeekResult.id).where(OperatorWeekResult.week_id == week.id).limit(1)
    )
    if result is not None:
        return True
    metric = await session.scalar(
        select(OperatorWeekMetric.id)
        .where(OperatorWeekMetric.week_id == week.id, OperatorWeekMetric.source != TEST_SOURCE)
        .limit(1)
    )
    return metric is not None


async def default_week(session: AsyncSession) -> ContestWeek | None:
    """This week as soon as any of its metrics are loaded, otherwise the latest calculated week."""
    year, number, _ = date.today().isocalendar()
    week = await session.scalar(
        select(ContestWeek).where(ContestWeek.iso_year == year, ContestWeek.iso_week == number)
    )
    if week is not None and await _has_data(session, week):
        return week
    return await weekly.resolve_week(session, None, prefer_ranked=True)


def _rank(runners: list[Runner]) -> None:
    """Sports ranking as in the weekly calculation: equal points share a place (1, 2, 2, 4)."""
    runners.sort(key=lambda r: (-r.points, r.penalty, r.user.id))
    previous: float | None = None
    place = 0
    for index, runner in enumerate(runners, start=1):
        if previous is None or abs(runner.points - previous) > EPS:
            place = index
        runner.rank = place
        previous = runner.points


async def standings(
    session: AsyncSession, week: ContestWeek, channel: str | None = None
) -> tuple[list[Runner], bool]:
    """
    The operators of the week, best first, and whether they were scored live (not calculated).
    With ``channel``, only that channel's operators: each channel races on its own
    (docs/CHANNELS.md).
    """
    query = (
        select(OperatorWeekResult, User)
        .join(User, User.id == OperatorWeekResult.user_id)
        .where(OperatorWeekResult.week_id == week.id, User.role == Role.OPERATOR)
    )
    if channel is not None:
        query = query.where(User.channel == channel)
    rows = (await session.execute(query)).all()
    if rows:
        runners = [
            Runner(
                user=user, points=result.final_points, penalty=result.penalty_points,
                rank_delta=result.rank_delta, breakdown=result.breakdown,
            )
            for result, user in rows
        ]
        _rank(runners)
        return runners, False
    if week.status == WeekStatus.CLOSED:
        return [], False

    values = await weekly._load_metric_values(session, week.id)
    if not values:
        return [], True
    definitions = await weekly.active_metric_definitions(session)
    query = select(User).where(User.id.in_(values.keys()), User.role == Role.OPERATOR)
    if channel is not None:
        query = query.where(User.channel == channel)
    runners = []
    for user in await session.scalars(query):
        mine = values.get(user.id, {})
        score = score_week(channel_definitions(definitions, user.channel), mine)
        runners.append(Runner(
            user=user, points=score.final_points, penalty=score.penalty_points,
            breakdown={"metrics": [m.as_dict() for m in score.metrics],
                       "reported_codes": sorted(mine)},
        ))
    _rank(runners)
    previous = await weekly.previous_week(session, week)
    if previous is not None:
        before = dict((await session.execute(
            select(OperatorWeekResult.user_id, OperatorWeekResult.rank)
            .where(OperatorWeekResult.week_id == previous.id)
        )).all())
        for runner in runners:
            if before.get(runner.user.id):
                runner.rank_delta = before[runner.user.id] - runner.rank
    return runners, True


# --------------------------------------------------------------------------- #
# Metrics: what the operator still lacks and what would close a gap
# --------------------------------------------------------------------------- #


def points_for(direction: str, target: float, max_points: float, value: float) -> float:
    """The scoring formula of one positive metric (scoring.score_metric), for a value to try."""
    if target <= 0:
        completion = 1.0 if value > 0 else 0.0
    elif direction == MetricDirection.LOWER_IS_BETTER:
        completion = 1.0 if value <= 0 else min(1.0, target / value)
    else:
        completion = value / target
    return round(max(0.0, min(completion, 1.0)) * max_points, 2)


def _step(unit: str | None) -> float:
    """Counts are whole; hours, percent and calls per hour move by tenths."""
    return 1.0 if (unit or "").strip() == "шт" else 0.1


def value_for(metric: dict, wanted: float) -> float | None:
    """The value that scores ``wanted`` points on this metric, rounded the way it can be reached."""
    target, top, step = metric["target"], metric["max_points"], _step(metric["unit"])
    if wanted > top + EPS or wanted <= 0:
        return None
    if metric.get("bands"):
        # Thresholds: the lowest one that gives at least the points wanted.
        reach = [float(b["from"]) for b in metric["bands"] if float(b["points"]) + EPS >= wanted]
        return min(reach) if reach else None
    if target <= 0:
        return step
    if metric["direction"] == MetricDirection.LOWER_IS_BETTER:
        return round(math.floor(top * target / wanted / step + EPS) * step, 2)
    return round(math.ceil(wanted / top * target / step - EPS) * step, 2)


def _option(metric: dict, gain: float) -> dict | None:
    """Raising one metric by ``gain`` points: the value to reach and what it really brings."""
    need = value_for(metric, metric["points"] + gain)
    if need is None:
        return None
    got = band_points(metric["bands"], need) if metric.get("bands") else points_for(
        metric["direction"], metric["target"], metric["max_points"], need)
    return {
        "code": metric["code"], "title": metric["title"], "unit": metric["unit"],
        "value": metric["value"], "need": need, "gain": round(got - metric["points"], 2),
    }


def metrics_of(
    breakdown: dict | None, directions: dict[str, str], bands: dict[str, list] | None = None
) -> list[dict]:
    """The operator's positive metrics with the points they still lack, the biggest loss first."""
    if not breakdown:
        return []
    reported = breakdown.get("reported_codes")
    out = []
    for item in breakdown.get("metrics", []):
        if item.get("kind") != str(MetricKind.POSITIVE) or not item.get("max_points"):
            continue
        shown = reported is None or item["code"] in reported
        value = item.get("value") if shown else None
        direction = directions.get(item["code"], str(MetricDirection.HIGHER_IS_BETTER))
        target, top = float(item.get("target") or 0), float(item["max_points"])
        steps = (bands or {}).get(item["code"])
        out.append({
            "code": item["code"], "title": item["title"], "unit": item.get("unit"),
            "direction": direction, "value": value, "target": target,
            "points": round(float(item.get("points") or 0), 2), "max_points": top,
            "lost": round(top - float(item.get("points") or 0), 2), "reported": value is not None,
            # A unit more of a "more is better" metric is worth max/target points up to the target;
            # a metric with thresholds moves by steps instead.
            "per_unit": round(top / target, 2)
            if target > 0 and direction == MetricDirection.HIGHER_IS_BETTER and not steps else None,
            "bands": steps,
        })
    out.sort(key=lambda m: (not m["reported"], -m["lost"]))
    return out


def _effort(option: dict, metric: dict) -> float:
    """How far a value has to move, relative to the target: the smallest change is the easiest."""
    base = metric["target"] or 1.0
    return abs(option["need"] - (metric["value"] or 0.0)) / base


def pass_options(metrics: list[dict], gap: float, limit: int = 3) -> list[dict]:
    """Single metrics that alone gain enough to pass someone ``gap`` points ahead, easiest first."""
    wanted = gap + PASS
    options = []
    for metric in metrics:
        if not metric["reported"] or metric["lost"] + EPS < wanted:
            continue
        option = _option(metric, wanted)
        if option is not None:
            options.append((_effort(option, metric), option))
    options.sort(key=lambda pair: pair[0])
    return [option for _, option in options[:limit]]


def plan(metrics: list[dict], gap: float) -> dict:
    """Metrics to bring up, biggest loss first, until they add up to passing ``gap``."""
    wanted = gap + PASS
    steps, total = [], 0.0
    for metric in metrics:
        if not metric["reported"] or metric["lost"] <= EPS:
            continue
        gain = min(metric["lost"], wanted - total)
        option = _option(metric, gain)
        if option is None:
            continue
        steps.append(option)
        total += option["gain"]
        if total + EPS >= wanted:
            return {"reachable": True, "steps": steps, "gain": round(total, 2)}
    return {"reachable": False, "steps": steps, "gain": round(total, 2)}


# --------------------------------------------------------------------------- #
# The race
# --------------------------------------------------------------------------- #


def _place(runner: Runner, viewer: User, mine: float | None) -> dict:
    return {
        "rank": runner.rank,
        "name": ranking_name(viewer, runner.user) or "Оператор",
        "points": round(runner.points, 2),
        "gap": None if mine is None else round(runner.points - mine, 2),
        "rank_delta": runner.rank_delta,
        "is_me": runner.user.id == viewer.id,
    }


async def race(session: AsyncSession, viewer: User, week_id: int | None) -> dict:
    """«Гонка недели» for an operator: places, gaps up and down, the podium and what to improve."""
    if Role(viewer.role) != Role.OPERATOR:
        raise PermissionDeniedError(
            "«Гонка недели» — раздел операторов: здесь оператор сравнивает себя с другими."
        )
    week = await weekly.get_week(session, week_id) if week_id else await default_week(session)
    rules = await get_rules(session)
    period = rules.contest_period
    empty = {
        "week": None, "live": False, "period": period, "prizes": [], "participants": 0,
        "max_points": 0.0, "me": None, "next": None, "behind": None, "podium": [],
        "standings": [], "metrics": [], "advice": None,
    }
    if week is None:
        return empty

    channel = viewer.channel or Channel.LINE
    runners, live = await standings(session, week, channel)
    every = list(await session.scalars(select(MetricDefinition)))
    directions = {d.code: str(d.direction) for d in every}
    bands = {d.code: d.bands for d in every if d.bands}
    me = next((r for r in runners if r.user.id == viewer.id), None)
    mine = me.points if me else None
    others = [r for r in runners if r.user.id != viewer.id]

    metrics = metrics_of(me.breakdown if me else None, directions, bands)
    if not metrics:
        top = channel_max_points(await weekly.active_metric_definitions(session), channel)
    else:
        top = sum(m["max_points"] for m in metrics)

    data = {
        **empty,
        "week": {
            "id": week.id, "label": week.label, "starts_on": week.starts_on,
            "ends_on": week.ends_on, "status": str(week.status),
        },
        "live": live,
        "prizes": [rules.rank_bonus(place) for place in range(1, PODIUM + 1)]
        if period == "week" else [],
        "participants": len(runners),
        "max_points": round(top, 2),
        "standings": [_place(r, viewer, mine) for r in runners],
        "metrics": metrics,
    }
    # The podium as the places to reach: to be k-th, have at least what the k-th best of the
    # others has (an equal score shares the place).
    data["podium"] = [
        {
            "place": k,
            "name": _place(others[k - 1], viewer, mine)["name"],
            "points": round(others[k - 1].points, 2),
            "gap": None if mine is None else round(max(0.0, others[k - 1].points - mine), 2),
            "reached": mine is not None and mine + EPS >= others[k - 1].points,
        }
        for k in range(1, min(PODIUM, len(others)) + 1)
    ]
    if me is None:
        return data

    above = [r for r in others if r.points > mine + EPS]
    below = [r for r in others if r.points < mine - EPS]
    shared = [r for r in others if abs(r.points - mine) <= EPS]
    data["me"] = {
        "rank": me.rank, "points": round(mine, 2), "rank_delta": me.rank_delta,
        "shared_with": [_place(r, viewer, mine)["name"] for r in shared],
    }
    if above:
        nearest = above[-1]
        data["next"] = {**_place(nearest, viewer, mine), "gap": round(nearest.points - mine, 2)}
    if below:
        nearest = below[0]
        data["behind"] = {**_place(nearest, viewer, mine), "lead": round(mine - nearest.points, 2)}

    advice: dict = {"room": round(sum(m["lost"] for m in metrics), 2), "next": None, "podium": None}
    if data["next"]:
        advice["next"] = {
            "rank": data["next"]["rank"], "name": data["next"]["name"],
            "gap": data["next"]["gap"], "options": pass_options(metrics, data["next"]["gap"]),
            "plan": plan(metrics, data["next"]["gap"]),
        }
    # Outside the podium: what it takes to pass the third place of the others.
    if me.rank > PODIUM and len(others) >= PODIUM:
        third = others[PODIUM - 1]
        gap = round(third.points - mine, 2)
        advice["podium"] = {"place": PODIUM, "name": data["podium"][PODIUM - 1]["name"],
                            "gap": gap, "plan": plan(metrics, gap)}
    data["advice"] = advice
    return data
