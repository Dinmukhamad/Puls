"""Read-only, role-scoped analytics by day, week or month from actual metrics and results."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from itertools import pairwise

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import supervised_group_ids, visible_users_filter
from app.core.errors import DomainError, PermissionDeniedError
from app.models.coin import CoinTransaction
from app.models.contest import (
    ContestWeek,
    MetricDefinition,
    OperatorDayMetric,
    OperatorWeekMetric,
    OperatorWeekResult,
)
from app.models.enums import MetricDirection, Role, ShopRequestStatus, WeekStatus
from app.models.shop import ShopRequest
from app.models.user import Group, User
from app.schemas.analytics import (
    AnalyticsOperator,
    AnalyticsOut,
    ComparisonSeries,
    MetricSummary,
    TrendPoint,
)
from app.schemas.rating import WeekOut
from app.services.rules import get_rules
from app.services.weekly import get_week

MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
#: Longest ranges, so a page never asks for years of daily rows.
MAX_DAYS, MAX_WEEKS, MAX_MONTHS = 31, 26, 24


@dataclass(frozen=True)
class Period:
    start: date
    end: date
    label: str
    week_id: int | None = None


def month_start(day: date, shift: int = 0) -> date:
    index = day.year * 12 + day.month - 1 + shift
    return date(index // 12, index % 12 + 1, 1)


def average(values: list[float | None]) -> float | None:
    observed = [value for value in values if value is not None and math.isfinite(value)]
    return round(sum(observed) / len(observed), 4) if observed else None


def change(
    value: float | None, previous: float | None, direction: str
) -> tuple[float | None, bool | None]:
    if value is None or previous is None:
        return None, None
    delta = round(value - previous, 4)
    if delta == 0:
        return delta, None
    return delta, delta > 0 if direction == MetricDirection.HIGHER_IS_BETTER else delta < 0


def at_target(value: float | None, metric: MetricDefinition) -> bool | None:
    if value is None:
        return None
    if metric.direction == MetricDirection.LOWER_IS_BETTER:
        return value <= metric.target_value
    return value >= metric.target_value


async def report(
    session: AsyncSession,
    actor: User,
    *,
    week_id: int | None = None,
    grain: str = "week",
    date_from: date | None = None,
    date_to: date | None = None,
    group_id: int | None = None,
    metric_code: str | None = None,
    operator_ids: list[int] | None = None,
    own: bool = False,
) -> AnalyticsOut:
    if group_id is not None:
        group = await session.get(Group, group_id)
        allowed = actor.has_role_at_least(Role.HEAD) or group_id in await supervised_group_ids(
            session, actor
        )
        if group is None or not allowed:
            raise PermissionDeniedError("Группа недоступна для вашей роли")
    visibility = User.id == actor.id if own else await visible_users_filter(session, actor)
    conditions = [visibility, User.role == Role.OPERATOR, User.is_active.is_(True)]
    if group_id is not None:
        conditions.append(User.group_id == group_id)
    users = list(
        await session.scalars(
            select(User)
            .options(selectinload(User.group))
            .where(*conditions)
            .order_by(User.full_name)
        )
    )
    ids = [user.id for user in users]
    selected_ids = list(dict.fromkeys(operator_ids or []))
    if len(selected_ids) > 5:
        raise DomainError("Можно сравнить до пяти операторов", code="comparison_limit")
    if any(user_id not in ids for user_id in selected_ids):
        raise PermissionDeniedError("Оператор недоступен в выбранной команде")

    definitions = list(
        await session.scalars(
            select(MetricDefinition)
            .where(MetricDefinition.is_active.is_(True))
            .order_by(MetricDefinition.sort_order, MetricDefinition.id)
        )
    )
    definitions_by_code = {metric.code: metric for metric in definitions}
    if metric_code is not None and metric_code not in definitions_by_code:
        raise DomainError("Показатель не найден или отключён", code="unknown_metric")
    chosen = definitions_by_code.get(metric_code or "quality") or (
        definitions[0] if definitions else None
    )
    if date_from and date_to and date_from > date_to:
        raise DomainError("Начало периода позже конца", code="invalid_period")
    recorded: dict[tuple[date, int, str], float] = {}

    def keep(key: tuple[date, int, str], value: float | None) -> None:
        if value is not None and math.isfinite(value):
            recorded[key] = value

    async def weekly_rows(first: date, last: date) -> list[tuple[ContestWeek, int, str, float]]:
        if not ids:
            return []
        rows = await session.execute(
            select(
                ContestWeek,
                OperatorWeekMetric.user_id,
                OperatorWeekMetric.metric_code,
                OperatorWeekMetric.value,
            )
            .join(OperatorWeekMetric, OperatorWeekMetric.week_id == ContestWeek.id)
            .where(
                ContestWeek.starts_on >= first,
                ContestWeek.starts_on <= last,
                OperatorWeekMetric.user_id.in_(ids),
            )
        )
        return list(rows)

    async def daily_rows(first: date, last: date) -> list[tuple[date, int, str, float]]:
        if not ids:
            return []
        rows = await session.execute(
            select(
                OperatorDayMetric.day,
                OperatorDayMetric.user_id,
                OperatorDayMetric.metric_code,
                OperatorDayMetric.value,
            ).where(
                OperatorDayMetric.day >= first,
                OperatorDayMetric.day <= last,
                OperatorDayMetric.user_id.in_(ids),
            )
        )
        return list(rows)

    week: ContestWeek | None = None
    if grain == "day":
        last_day = (
            date_to
            or (
                await session.scalar(
                    select(func.max(OperatorDayMetric.day)).where(
                        OperatorDayMetric.user_id.in_(ids)
                    )
                )
                if ids
                else None
            )
            or date.today()
        )
        first_day = date_from or last_day - timedelta(days=13)
        if (last_day - first_day).days >= MAX_DAYS:
            raise DomainError(
                f"По дням можно смотреть не больше {MAX_DAYS} дней", code="period_too_long"
            )
        periods = [
            Period(
                first_day + timedelta(days=i),
                first_day + timedelta(days=i),
                f"{first_day + timedelta(days=i):%d.%m}",
            )
            for i in range((last_day - first_day).days + 1)
        ]
        for day, user_id, code, value in await daily_rows(first_day, last_day):
            keep((day, user_id, code), value)
    elif grain == "month":
        latest = (
            date_to or await session.scalar(select(func.max(ContestWeek.starts_on))) or date.today()
        )
        last_month = month_start(latest)
        first_month = month_start(date_from) if date_from else month_start(last_month, -5)
        count = (last_month.year - first_month.year) * 12 + last_month.month - first_month.month + 1
        if count > MAX_MONTHS:
            raise DomainError(
                f"По месяцам можно смотреть не больше {MAX_MONTHS} месяцев", code="period_too_long"
            )
        months = [month_start(first_month, i) for i in range(count + 1)]
        periods = [
            Period(start, following - timedelta(days=1), f"{MONTHS[start.month - 1]} {start.year}")
            for start, following in pairwise(months)
        ]
        # A month is the mean of its weekly values (weeks that start in it);
        # daily values fill the months that have no weekly ones.
        weekly: dict[tuple[date, int, str], list[float]] = {}
        for item, user_id, code, value in await weekly_rows(periods[0].start, periods[-1].end):
            weekly.setdefault((month_start(item.starts_on), user_id, code), []).append(value)
        daily: dict[tuple[date, int, str], list[float]] = {}
        for day, user_id, code, value in await daily_rows(periods[0].start, periods[-1].end):
            daily.setdefault((month_start(day), user_id, code), []).append(value)
        for key in daily.keys() | weekly.keys():
            keep(key, average(weekly.get(key) or daily[key]))
    else:
        if date_from or date_to:
            last_start = (date_to or date.today()) - timedelta(
                days=(date_to or date.today()).weekday()
            )
            first_start = (
                (date_from - timedelta(days=date_from.weekday()))
                if date_from
                else last_start - timedelta(weeks=7)
            )
            if (last_start - first_start).days // 7 + 1 > MAX_WEEKS:
                raise DomainError(
                    f"По неделям можно смотреть не больше {MAX_WEEKS} недель",
                    code="period_too_long",
                )
            week = await session.scalar(
                select(ContestWeek).where(ContestWeek.starts_on == last_start)
            )
        else:
            week = (
                await get_week(session, week_id)
                if week_id is not None
                else await session.scalar(
                    select(ContestWeek).order_by(ContestWeek.starts_on.desc()).limit(1)
                )
            )
            last_start = (
                week.starts_on if week else date.today() - timedelta(days=date.today().weekday())
            )
            first_start = last_start - timedelta(weeks=7)
        by_start: dict[date, int] = {}
        for item, user_id, code, value in await weekly_rows(first_start, last_start):
            by_start[item.starts_on] = item.id
            keep((item.starts_on, user_id, code), value)
        for item in await session.scalars(
            select(ContestWeek).where(
                ContestWeek.starts_on >= first_start, ContestWeek.starts_on <= last_start
            )
        ):
            by_start[item.starts_on] = item.id
        periods = []
        for offset in range((last_start - first_start).days // 7 + 1):
            start = first_start + timedelta(weeks=offset)
            year, number, _ = start.isocalendar()
            periods.append(
                Period(
                    start, start + timedelta(days=6), f"{year}-W{number:02d}", by_start.get(start)
                )
            )

    starts = [period.start for period in periods]
    anchor = starts[-1]
    previous_start = starts[-2] if len(starts) > 1 else None
    selected = periods[-1]

    def observation(user_id: int, code: str, start: date | None) -> float | None:
        return recorded.get((start, user_id, code)) if start else None

    def observations(cohort: list[int], code: str, start: date | None) -> list[float | None]:
        return [observation(user_id, code, start) for user_id in cohort]

    pending = (
        int(
            await session.scalar(
                select(func.count(ShopRequest.id)).where(
                    ShopRequest.user_id.in_(ids), ShopRequest.status == ShopRequestStatus.NEW
                )
            )
            or 0
        )
        if ids
        else 0
    )
    # Coins of a week are those posted for it; for days and months, those posted inside the period.
    coin_period = (
        CoinTransaction.week_id == week.id
        if week
        else CoinTransaction.created_at.between(
            datetime.combine(selected.start, time.min, UTC),
            datetime.combine(selected.end, time.max, UTC),
        )
    )
    awarded = (
        int(
            await session.scalar(
                select(func.sum(CoinTransaction.amount)).where(
                    CoinTransaction.user_id.in_(ids), coin_period, CoinTransaction.amount > 0
                )
            )
            or 0
        )
        if ids and (week or grain != "week")
        else 0
    )
    rules = await get_rules(session)
    result = AnalyticsOut(
        week=WeekOut.model_validate(week) if week else None,
        grain=grain,
        period_label=selected.label,
        period_from=selected.start,
        period_to=selected.end,
        metric_code=chosen.code if chosen else None,
        operator_count=len(users),
        operators_with_data=0,
        pending_requests=pending,
        coins_awarded=awarded,
        lateness_metric_code=rules.lateness_metric_code,
    )
    if grain == "month":
        result.methodology += (
            " Месячные значения — среднее загруженных недель, начинающихся в месяце; "
            "если недельных значений нет — среднее дней. В том числе опоздания: "
            "это среднее за исходный период, а не число событий за весь месяц."
        )
    for metric in definitions:
        current_values = observations(ids, metric.code, anchor)
        value = average(current_values)
        previous = average(observations(ids, metric.code, previous_start))
        delta, improved = change(value, previous, metric.direction)
        reported = sum(value is not None for value in current_values)
        result.metrics.append(
            MetricSummary(
                code=metric.code,
                title=metric.title,
                unit=metric.unit,
                direction=metric.direction,
                kind=metric.kind,
                target=metric.target_value,
                value=value,
                previous=previous,
                delta=delta,
                improved=improved,
                reported=reported,
                total=len(users),
                coverage=reported / len(users) if users else None,
                below_target=sum(at_target(value, metric) is False for value in current_values),
                description=metric.description,
                penalty_per_unit=metric.penalty_per_unit,
                trend=[average(observations(ids, metric.code, start)) for start in starts],
            )
        )
    result.operators_with_data = sum(
        any(observation(user_id, metric.code, anchor) is not None for metric in definitions)
        for user_id in ids
    )
    if chosen is None:
        return result
    for period in periods:
        values = observations(ids, chosen.code, period.start)
        result.trend.append(
            TrendPoint(
                week_id=period.week_id,
                label=period.label,
                starts_on=period.start,
                value=average(values),
                reported=sum(value is not None for value in values),
            )
        )

    calculated = (
        {
            item.user_id: item
            for item in await session.scalars(
                select(OperatorWeekResult).where(
                    OperatorWeekResult.week_id == week.id, OperatorWeekResult.user_id.in_(ids)
                )
            )
        }
        if week
        and ids
        and grain == "week"
        and week.status in (WeekStatus.CALCULATED, WeekStatus.CLOSED)
        else {}
    )

    def comparison(identifier: int, name: str, cohort: list[int]) -> ComparisonSeries:
        values = [average(observations(cohort, chosen.code, start)) for start in starts]
        previous = values[-2] if len(values) > 1 else None
        delta, improved = change(values[-1], previous, chosen.direction)
        return ComparisonSeries(
            id=identifier,
            name=name,
            value=values[-1],
            previous=previous,
            delta=delta,
            improved=improved,
            reported=sum(value is not None for value in observations(cohort, chosen.code, anchor)),
            total=len(cohort),
            values=values,
        )

    group_members: dict[int, list[int]] = {}
    group_names: dict[int, str] = {}
    for user in users:
        values = {metric.code: observation(user.id, metric.code, anchor) for metric in definitions}
        value = values[chosen.code]
        previous = observation(user.id, chosen.code, previous_start)
        delta, improved = change(value, previous, chosen.direction)
        score = calculated.get(user.id)
        result.operators.append(
            AnalyticsOperator(
                user_id=user.id,
                full_name=user.full_name,
                group_id=user.group_id,
                group_name=user.group.name if user.group else None,
                value=value,
                previous=previous,
                delta=delta,
                improved=improved,
                target_met=at_target(value, chosen),
                points=score.final_points if score else None,
                rank=score.rank if score else None,
                missing_metrics=[code for code, value in values.items() if value is None],
                values=values,
                trend=[observation(user.id, chosen.code, start) for start in starts],
                previous_values={
                    metric.code: observation(user.id, metric.code, previous_start)
                    for metric in definitions
                },
                trends={
                    metric.code: [observation(user.id, metric.code, start) for start in starts]
                    for metric in definitions
                },
            )
        )
        group_key = user.group_id or 0
        group_members.setdefault(group_key, []).append(user.id)
        group_names[group_key] = user.group.name if user.group else "Без группы"
        if user.id in selected_ids:
            result.comparisons.append(comparison(user.id, user.full_name, [user.id]))
    result.groups = [
        comparison(key, group_names[key], cohort) for key, cohort in group_members.items()
    ]
    return result
