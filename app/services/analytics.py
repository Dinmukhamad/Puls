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
from app.models.enums import MetricDirection, MetricKind, Role, ShopRequestStatus, WeekStatus
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
#: A chosen date range keeps at least this many trend points: a short range is
#: shown after the days or weeks right before it, so the chart is never a lone dot.
RANGE_MIN_POINTS = {"day": 7, "week": 8}
#: Dates a custom range may use; the comparison window before it must stay valid.
RANGE_FIRST_DAY, RANGE_LAST_DAY = date(1900, 1, 1), date(9998, 12, 31)
#: Рабочих дней в неделе: недельная норма 40 ч — это 5 дней по 8 ч.
WORKDAYS_PER_WEEK = 5


@dataclass(frozen=True)
class Period:
    start: date
    end: date
    label: str
    week_id: int | None = None


def month_start(day: date, shift: int = 0) -> date:
    index = day.year * 12 + day.month - 1 + shift
    return date(index // 12, index % 12 + 1, 1)


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def range_label(first: date, last: date) -> str:
    return f"{first:%d.%m.%Y}" if first == last else f"{first:%d.%m.%Y}–{last:%d.%m.%Y}"


async def range_bounds(
    session: AsyncSession, date_from: date | None, date_to: date | None
) -> tuple[date, date]:
    """Both ends of a chosen range; without dates — the latest contest week."""
    if date_from is None and date_to is None:
        latest = await session.scalar(
            select(ContestWeek).order_by(ContestWeek.starts_on.desc()).limit(1)
        )
        if latest is not None:
            return latest.starts_on, latest.ends_on
        monday = week_start(date.today())
        return monday, monday + timedelta(days=6)
    if date_from is None or date_to is None:
        raise DomainError("Укажите начало и конец периода", code="invalid_period")
    if date_from < RANGE_FIRST_DAY or date_to > RANGE_LAST_DAY:
        raise DomainError("Период выходит за допустимые даты", code="invalid_period")
    return date_from, date_to


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


def summed(metric: MetricDefinition) -> bool:
    """Значение недели складывается из дней: часы и штуки. Проценты и «в час» — нет."""
    unit = (metric.unit or "").strip()
    return bool(unit) and "%" not in unit and "/" not in unit


def target_for(metric: MetricDefinition, grain: str = "week") -> float:
    """Цель показателя за один период аналитики.

    В настройках цель задана на неделю. За день суммируемый показатель должен набрать её
    пятую часть: 40 ч в неделю — 8 ч в день. Лимит нарушений не делится: любое нарушение
    и так требует внимания.
    """
    if grain == "day" and metric.kind != MetricKind.ANTI and summed(metric):
        return round(metric.target_value / WORKDAYS_PER_WEEK, 4)
    return metric.target_value


def at_target(value: float | None, metric: MetricDefinition, grain: str = "week") -> bool | None:
    if value is None:
        return None
    target = target_for(metric, grain)
    if metric.direction == MetricDirection.LOWER_IS_BETTER:
        return value <= target
    return value >= target


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

    async def load_months(first: date, last: date) -> None:
        """Monthly values from the first day of `first` to the end of `last`."""
        # A month is the mean of its weekly values (weeks that start in it);
        # daily values fill the months that have no weekly ones.
        end = month_start(last, 1) - timedelta(days=1)
        weekly: dict[tuple[date, int, str], list[float]] = {}
        for item, user_id, code, value in await weekly_rows(first, end):
            weekly.setdefault((month_start(item.starts_on), user_id, code), []).append(value)
        daily: dict[tuple[date, int, str], list[float]] = {}
        for day, user_id, code, value in await daily_rows(first, end):
            daily.setdefault((month_start(day), user_id, code), []).append(value)
        for key in daily.keys() | weekly.keys():
            keep(key, average(weekly.get(key) or daily[key]))

    async def load_weeks(first_start: date, last_start: date) -> dict[date, int]:
        """Weekly values by week start; returns the contest week ids of those starts."""
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
        return by_start

    def week_periods(
        first_start: date, last_start: date, by_start: dict[date, int]
    ) -> list[Period]:
        periods = []
        for offset in range((last_start - first_start).days // 7 + 1):
            start = first_start + timedelta(weeks=offset)
            year, number, _ = start.isocalendar()
            periods.append(
                Period(
                    start, start + timedelta(days=6), f"{year}-W{number:02d}", by_start.get(start)
                )
            )
        return periods

    def month_periods(first_month: date, count: int) -> list[Period]:
        months = [month_start(first_month, i) for i in range(count + 1)]
        return [
            Period(start, following - timedelta(days=1), f"{MONTHS[start.month - 1]} {start.year}")
            for start, following in pairwise(months)
        ]

    week: ContestWeek | None = None
    custom_range = grain == "range"
    #: Starts of the periods the cards cover and of the equal window before them.
    current_starts: list[date] = []
    previous_starts: list[date] = []
    context_points = 0
    if custom_range:
        # The cards cover the whole chosen range: every day, week or month of it is
        # averaged and compared with the same number of periods right before it.
        date_from, date_to = await range_bounds(session, date_from, date_to)
        days = (date_to - date_from).days + 1
        grain = "day" if days <= MAX_DAYS else "week" if days <= MAX_WEEKS * 7 else "month"
        # Whole contest weeks are read by their weekly values, like the former weekly
        # view: weekly totals meet weekly targets instead of a day's share of them.
        whole_weeks = date_from.weekday() == 0 and date_to.weekday() == 6
        if grain == "day" and whole_weeks and any(await weekly_rows(date_from, date_to)):
            grain = "week"
        if grain == "day":
            context_points = max(0, RANGE_MIN_POINTS["day"] - days)
            first_day = date_from - timedelta(days=max(days, context_points))
            rows = await daily_rows(first_day, date_to)
            # Weekly uploads have no daily split: then the range is read by its weeks.
            if any(day >= date_from for day, *_ in rows) or not any(
                await weekly_rows(week_start(date_from), date_to)
            ):
                for day, user_id, code, value in rows:
                    keep((day, user_id, code), value)
                current_starts = [date_from + timedelta(days=i) for i in range(days)]
                previous_starts = [date_from - timedelta(days=days - i) for i in range(days)]
                periods = [
                    Period(day, day, f"{day:%d.%m}")
                    for day in (
                        date_from - timedelta(days=context_points - i)
                        for i in range(context_points + days)
                    )
                ]
            else:
                grain = "week"
        if grain == "week":
            first_start, last_start = week_start(date_from), week_start(date_to)
            count = (last_start - first_start).days // 7 + 1
            context_points = max(0, RANGE_MIN_POINTS["week"] - count)
            by_start = await load_weeks(
                first_start - timedelta(weeks=max(count, context_points)), last_start
            )
            current_starts = [first_start + timedelta(weeks=i) for i in range(count)]
            previous_starts = [first_start - timedelta(weeks=count - i) for i in range(count)]
            periods = week_periods(
                first_start - timedelta(weeks=context_points), last_start, by_start
            )
        elif grain == "month":
            first_month, last_month = month_start(date_from), month_start(date_to)
            count = (
                (last_month.year - first_month.year) * 12 + last_month.month - first_month.month + 1
            )
            if count > MAX_MONTHS:
                raise DomainError(
                    f"Период не может быть длиннее {MAX_MONTHS} месяцев", code="period_too_long"
                )
            await load_months(month_start(first_month, -count), last_month)
            current_starts = [month_start(first_month, i) for i in range(count)]
            previous_starts = [month_start(first_month, i - count) for i in range(count)]
            periods = month_periods(first_month, count)
        week = await session.scalar(
            select(ContestWeek).where(ContestWeek.starts_on == week_start(date_to))
        )
    elif grain == "day":
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
        periods = month_periods(first_month, count)
        await load_months(periods[0].start, periods[-1].start)
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
        periods = week_periods(first_start, last_start, await load_weeks(first_start, last_start))

    starts = [period.start for period in periods]
    anchor = starts[-1]
    previous_start = starts[-2] if len(starts) > 1 else None
    selected = periods[-1]
    if not custom_range:
        current_starts = [anchor]
        previous_starts = [previous_start] if previous_start else []
    #: A range of exactly one contest week keeps that week's points, places and coins.
    whole_week = bool(
        week and custom_range and (week.starts_on, week.ends_on) == (date_from, date_to)
    )

    def observation(user_id: int, code: str, start: date | None) -> float | None:
        return recorded.get((start, user_id, code)) if start else None

    def observations(cohort: list[int], code: str, start: date | None) -> list[float | None]:
        return [observation(user_id, code, start) for user_id in cohort]

    def value_over(user_id: int, code: str, period_starts: list[date]) -> float | None:
        """One period keeps its recorded value; several are averaged."""
        if len(period_starts) == 1:
            return observation(user_id, code, period_starts[0])
        return average([observation(user_id, code, start) for start in period_starts])

    def cohort_over(cohort: list[int], code: str, period_starts: list[date]) -> list[float | None]:
        return [value_over(user_id, code, period_starts) for user_id in cohort]

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
    # Coins of a week are those posted for it; for days, months and other ranges,
    # those posted inside the period.
    coin_from, coin_to = (date_from, date_to) if custom_range else (selected.start, selected.end)
    coin_period = (
        CoinTransaction.week_id == week.id
        if week and (whole_week or not custom_range)
        else CoinTransaction.created_at.between(
            datetime.combine(coin_from, time.min, UTC),
            datetime.combine(coin_to, time.max, UTC),
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
        if ids and (week or grain != "week" or custom_range)
        else 0
    )
    rules = await get_rules(session)
    result = AnalyticsOut(
        week=WeekOut.model_validate(week) if week else None,
        grain=grain,
        custom_range=custom_range,
        context_points=context_points,
        period_label=range_label(date_from, date_to) if custom_range else selected.label,
        period_from=date_from if custom_range else selected.start,
        period_to=date_to if custom_range else selected.end,
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
    if grain == "day":
        result.methodology += (
            f" По дням недельная цель часов и количеств делится на {WORKDAYS_PER_WEEK} рабочих "
            "дней: 40 ч в неделю — 8 ч в день. Цели в процентах и «в час» и лимиты нарушений "
            "не меняются."
        )
    if custom_range:
        step = {"day": "дням", "week": "неделям", "month": "месяцам"}[grain]
        result.methodology += (
            f" Карточки и списки — среднее по {step} всего выбранного периода, сравнение — "
            "с таким же по длине периодом перед ним."
        )
        if grain == "week":
            result.methodology += (
                " Недели берутся целиком: если период начинается или заканчивается внутри "
                "недели, учитывается вся неделя."
            )
    for metric in definitions:
        current_values = cohort_over(ids, metric.code, current_starts)
        value = average(current_values)
        previous = average(cohort_over(ids, metric.code, previous_starts))
        delta, improved = change(value, previous, metric.direction)
        reported = sum(value is not None for value in current_values)
        result.metrics.append(
            MetricSummary(
                code=metric.code,
                title=metric.title,
                unit=metric.unit,
                direction=metric.direction,
                kind=metric.kind,
                target=target_for(metric, grain),
                value=value,
                previous=previous,
                delta=delta,
                improved=improved,
                reported=reported,
                total=len(users),
                coverage=reported / len(users) if users else None,
                below_target=sum(
                    at_target(value, metric, grain) is False for value in current_values
                ),
                description=metric.description,
                penalty_per_unit=metric.penalty_per_unit,
                trend=[average(observations(ids, metric.code, start)) for start in starts],
            )
        )
    result.operators_with_data = sum(
        any(value_over(user_id, metric.code, current_starts) is not None for metric in definitions)
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
        and (whole_week or (grain == "week" and not custom_range))
        and week.status in (WeekStatus.CALCULATED, WeekStatus.CLOSED)
        else {}
    )

    def comparison(identifier: int, name: str, cohort: list[int]) -> ComparisonSeries:
        values = [average(observations(cohort, chosen.code, start)) for start in starts]
        current_values = cohort_over(cohort, chosen.code, current_starts)
        value = average(current_values)
        previous = average(cohort_over(cohort, chosen.code, previous_starts))
        delta, improved = change(value, previous, chosen.direction)
        return ComparisonSeries(
            id=identifier,
            name=name,
            value=value,
            previous=previous,
            delta=delta,
            improved=improved,
            reported=sum(value is not None for value in current_values),
            total=len(cohort),
            values=values,
        )

    group_members: dict[int, list[int]] = {}
    group_names: dict[int, str] = {}
    for user in users:
        values = {
            metric.code: value_over(user.id, metric.code, current_starts) for metric in definitions
        }
        value = values[chosen.code]
        previous = value_over(user.id, chosen.code, previous_starts)
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
                target_met=at_target(value, chosen, grain),
                points=score.final_points if score else None,
                rank=score.rank if score else None,
                missing_metrics=[code for code, value in values.items() if value is None],
                values=values,
                trend=[observation(user.id, chosen.code, start) for start in starts],
                previous_values={
                    metric.code: value_over(user.id, metric.code, previous_starts)
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
