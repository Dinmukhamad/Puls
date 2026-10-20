"""
Violations a supervisor records on the site the moment they notice them (docs/CHANNELS.md).

Foreign sites for now: a supervisor sees three of them, records «3» with a comment, and the week the
day falls in gets them as its metric «Посещение посторонних сайтов». A day of a week that is already
published counts towards the current week instead. At the week's calculation every operator of the
week without a record has 0 sites, so a clean week pays the «без посторонних сайтов» bonus and each
recorded site costs the rules' fine when the week is published.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ensure_can_manage
from app.core.errors import ConflictError, DomainError, NotFoundError
from app.db.base import utcnow
from app.models.contest import ContestWeek, OperatorWeekMetric, Violation
from app.models.enums import Role, WeekStatus
from app.models.progress import Notification
from app.models.user import User
from app.services import weekly as weekly_service
from app.services.economy import local_today
from app.services.rules import get_rules, write_audit
from app.services.weekly import VIOLATION_SOURCE as SOURCE

#: Records are kept to what a supervisor can see in a shift.
MAX_COUNT = 50
#: How far back a noticed day may be: the current and the previous week.
MAX_DAYS_BACK = 14


async def target_week(session: AsyncSession, noticed_on: date) -> ContestWeek:
    """The week of the noticed day, or the current week when that one is already published."""
    week = await weekly_service.get_or_create_week(session, noticed_on)
    if week.status != WeekStatus.CLOSED:
        return week
    current = await weekly_service.get_or_create_week(session, local_today())
    if current.status == WeekStatus.CLOSED:
        raise ConflictError("Текущая неделя уже опубликована", code="week_closed")
    return current


async def refresh_metric(session: AsyncSession, week: ContestWeek, user_id: int, code: str) -> int:
    """The week's metric is the count of the operator's records that stand (not cancelled)."""
    count = int(
        await session.scalar(
            select(func.coalesce(func.sum(Violation.count), 0)).where(
                Violation.week_id == week.id,
                Violation.user_id == user_id,
                Violation.metric_code == code,
                Violation.cancelled_at.is_(None),
            )
        )
        or 0
    )
    row = await session.scalar(
        select(OperatorWeekMetric).where(
            OperatorWeekMetric.week_id == week.id,
            OperatorWeekMetric.user_id == user_id,
            OperatorWeekMetric.metric_code == code,
        )
    )
    if row is None:
        session.add(
            OperatorWeekMetric(
                week_id=week.id, user_id=user_id, metric_code=code, value=count, source=SOURCE
            )
        )
    else:
        row.value, row.source = count, SOURCE
    await session.flush()
    # A changed count changes the week's ranks too: it waits for a new calculation.
    if week.status == WeekStatus.CALCULATED:
        await weekly_service.invalidate_calculation(session, week)
    return count


async def record(
    session: AsyncSession,
    actor: User,
    *,
    user_id: int,
    count: int,
    noticed_on: date | None,
    comment: str,
) -> tuple[Violation, ContestWeek]:
    """Records foreign sites a supervisor noticed for one operator of their team."""
    target = await session.get(User, user_id)
    if target is None or target.role != Role.OPERATOR or not target.is_active:
        raise NotFoundError("Оператор не найден")
    await ensure_can_manage(session, actor, target)
    if not 1 <= count <= MAX_COUNT:
        raise DomainError(f"Количество — от 1 до {MAX_COUNT}", code="invalid_count")
    text = (comment or "").strip()
    if len(text) < 3:
        raise DomainError("Опишите, что обнаружено: какие сайты и когда", code="comment_required")
    today = local_today()
    day = noticed_on or today
    if day > today or (today - day).days > MAX_DAYS_BACK:
        raise DomainError(
            "Дата — сегодня или в пределах двух прошедших недель", code="invalid_date"
        )
    rules = await get_rules(session)
    code = rules.forbidden_sites_metric_code
    week = await target_week(session, day)
    violation = Violation(
        user_id=target.id,
        week_id=week.id,
        metric_code=code,
        count=count,
        noticed_on=day,
        comment=text[:500],
        created_by_id=actor.id,
    )
    session.add(violation)
    await session.flush()
    total = await refresh_metric(session, week, target.id, code)
    fine = count * max(0, rules.forbidden_site_fine)
    session.add(
        Notification(
            user_id=target.id,
            title="Отмечены посторонние сайты",
            body=(
                f"{actor.full_name}: {count} за {day:%d.%m}. «{text[:160]}». "
                f"Попадёт в итоги недели {week.starts_on:%d.%m}–{week.ends_on:%d.%m}"
                + (f": штраф {fine} коинов при публикации недели." if fine else ".")
            ),
            kind="violation",
            link="/cabinet",
        )
    )
    await write_audit(
        session,
        actor_id=actor.id,
        action="violation.create",
        entity_type="violation",
        entity_id=violation.id,
        payload={
            "user_id": target.id, "count": count, "noticed_on": day.isoformat(),
            "week": week.label, "week_total": total, "comment": text[:500],
        },
    )
    return violation, week


async def cancel(session: AsyncSession, actor: User, violation_id: int) -> Violation:
    """Cancels a record made by mistake, while its week is not published."""
    violation = await session.get(Violation, violation_id)
    if violation is None:
        raise NotFoundError("Отметка не найдена")
    target = await session.get(User, violation.user_id)
    await ensure_can_manage(session, actor, target)
    week = await weekly_service.get_week(session, violation.week_id, lock=True)
    if week.status == WeekStatus.CLOSED:
        raise ConflictError("Неделя уже опубликована: отметку не отменить", code="week_closed")
    if violation.cancelled_at is not None:
        return violation
    violation.cancelled_at = utcnow()
    violation.cancelled_by_id = actor.id
    await session.flush()
    total = await refresh_metric(session, week, violation.user_id, violation.metric_code)
    session.add(
        Notification(
            user_id=violation.user_id,
            title="Отметка о посторонних сайтах отменена",
            body=f"{actor.full_name} отменил(а) отметку за {violation.noticed_on:%d.%m}.",
            kind="violation",
            link="/cabinet",
        )
    )
    await write_audit(
        session,
        actor_id=actor.id,
        action="violation.cancel",
        entity_type="violation",
        entity_id=violation.id,
        payload={"user_id": violation.user_id, "week": week.label, "week_total": total},
    )
    return violation
