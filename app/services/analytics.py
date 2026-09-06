"""Read-only, role-scoped weekly analytics from actual metrics and results."""

from __future__ import annotations

import math
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import supervised_group_ids, visible_users_filter
from app.core.errors import DomainError, PermissionDeniedError
from app.models.coin import CoinTransaction
from app.models.contest import ContestWeek, MetricDefinition, OperatorWeekMetric, OperatorWeekResult
from app.models.enums import MetricDirection, Role, ShopRequestStatus
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
from app.services.weekly import get_week


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
    week = (
        await get_week(session, week_id)
        if week_id is not None
        else await session.scalar(
            select(ContestWeek).order_by(ContestWeek.starts_on.desc()).limit(1)
        )
    )
    anchor = week.starts_on if week else date.today() - timedelta(days=date.today().weekday())
    starts = [anchor - timedelta(weeks=offset) for offset in range(7, -1, -1)]
    weeks = list(
        await session.scalars(
            select(ContestWeek).where(
                ContestWeek.starts_on >= starts[0], ContestWeek.starts_on <= anchor
            )
        )
    )
    by_start = {item.starts_on: item for item in weeks}
    week_ids = [item.id for item in weeks]
    recorded: dict[tuple[int, int, str], float] = {}
    if ids and week_ids:
        rows = await session.execute(
            select(
                OperatorWeekMetric.week_id,
                OperatorWeekMetric.user_id,
                OperatorWeekMetric.metric_code,
                OperatorWeekMetric.value,
            ).where(OperatorWeekMetric.week_id.in_(week_ids), OperatorWeekMetric.user_id.in_(ids))
        )
        for recorded_week, user_id, code, value in rows:
            if value is not None and math.isfinite(value):
                recorded[(recorded_week, user_id, code)] = value

    def observation(user_id: int, code: str, start: date) -> float | None:
        period = by_start.get(start)
        return recorded.get((period.id, user_id, code)) if period else None

    def observations(cohort: list[int], code: str, start: date) -> list[float | None]:
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
    awarded = (
        int(
            await session.scalar(
                select(func.sum(CoinTransaction.amount)).where(
                    CoinTransaction.user_id.in_(ids),
                    CoinTransaction.week_id == week.id,
                    CoinTransaction.amount > 0,
                )
            )
            or 0
        )
        if ids and week
        else 0
    )
    result = AnalyticsOut(
        week=WeekOut.model_validate(week) if week else None,
        metric_code=chosen.code if chosen else None,
        operator_count=len(users),
        operators_with_data=0,
        pending_requests=pending,
        coins_awarded=awarded,
    )
    for metric in definitions:
        current_values = observations(ids, metric.code, anchor)
        value = average(current_values)
        previous = average(observations(ids, metric.code, starts[-2]))
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
            )
        )
    result.operators_with_data = sum(
        any(observation(user_id, metric.code, anchor) is not None for metric in definitions)
        for user_id in ids
    )
    if chosen is None:
        return result
    for start in starts:
        period = by_start.get(start)
        year, number, _ = start.isocalendar()
        values = observations(ids, chosen.code, start)
        result.trend.append(
            TrendPoint(
                week_id=period.id if period else None,
                label=f"{year}-W{number:02d}",
                starts_on=start,
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
        if week and ids
        else {}
    )

    def comparison(identifier: int, name: str, cohort: list[int]) -> ComparisonSeries:
        values = [average(observations(cohort, chosen.code, start)) for start in starts]
        delta, improved = change(values[-1], values[-2], chosen.direction)
        return ComparisonSeries(
            id=identifier,
            name=name,
            value=values[-1],
            previous=values[-2],
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
        previous = observation(user.id, chosen.code, starts[-2])
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
