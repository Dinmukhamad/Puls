"""
Бейджи и достижения (п. 4.1.4).

Правила описаны данными, а не кодом: каждый бейдж - это ``rule_type`` плюс
параметры. Один и тот же расчёт используется и для выдачи бейджа, и для
подсказки «сколько осталось» по заблокированным бейджам.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.badge import BadgeDefinition, UserBadge
from app.models.contest import (
    ContestWeek,
    NominationWinner,
    OperatorWeekMetric,
    OperatorWeekResult,
)
from app.models.enums import BadgeRule, WeekStatus
from app.models.user import CoinAccount


@dataclass(slots=True)
class BadgeProgress:
    """Состояние одного бейджа у оператора."""

    badge: BadgeDefinition
    unlocked: bool
    current: float
    target: float
    hint: str

    @property
    def percent(self) -> float:
        if self.target <= 0:
            return 100.0 if self.unlocked else 0.0
        return round(min(100.0, self.current / self.target * 100), 1)


async def _closed_weeks(session: AsyncSession, limit: int | None = None) -> list[ContestWeek]:
    """Закрытые недели от свежей к старой."""
    stmt = (
        select(ContestWeek)
        .where(ContestWeek.status == WeekStatus.CLOSED)
        .order_by(ContestWeek.starts_on.desc())
    )
    if limit:
        stmt = stmt.limit(limit)
    return list(await session.scalars(stmt))


async def _metric_by_week(
    session: AsyncSession, user_id: int, metric_code: str, week_ids: list[int]
) -> dict[int, float]:
    if not week_ids:
        return {}
    rows = await session.execute(
        select(OperatorWeekMetric.week_id, OperatorWeekMetric.value).where(
            OperatorWeekMetric.user_id == user_id,
            OperatorWeekMetric.metric_code == metric_code,
            OperatorWeekMetric.week_id.in_(week_ids),
        )
    )
    return {week_id: float(value) for week_id, value in rows}


async def _streak_length(
    session: AsyncSession,
    user_id: int,
    metric_code: str,
    *,
    predicate,
    max_weeks: int,
) -> int:
    """
    Длина текущей серии закрытых недель, где показатель удовлетворяет условию.

    Неделя без выгруженного показателя обрывает серию: подтвердить дисциплину
    можно только фактическими данными.
    """
    weeks = await _closed_weeks(session, limit=max_weeks)
    if not weeks:
        return 0
    values = await _metric_by_week(session, user_id, metric_code, [w.id for w in weeks])
    streak = 0
    for week in weeks:
        value = values.get(week.id)
        if value is None or not predicate(value):
            break
        streak += 1
    return streak


async def _best_rank_reached(session: AsyncSession, user_id: int, max_rank: int) -> bool:
    best = await session.scalar(
        select(func.min(OperatorWeekResult.rank))
        .join(ContestWeek, ContestWeek.id == OperatorWeekResult.week_id)
        .where(
            OperatorWeekResult.user_id == user_id,
            ContestWeek.status == WeekStatus.CLOSED,
            OperatorWeekResult.rank.is_not(None),
        )
    )
    return best is not None and best <= max_rank


async def evaluate_badge(
    session: AsyncSession, badge: BadgeDefinition, user_id: int
) -> BadgeProgress:
    """Считает прогресс оператора по одному бейджу."""
    params = badge.rule_params or {}
    rule = BadgeRule(badge.rule_type)

    if rule == BadgeRule.TOP_RANK:
        max_rank = int(params.get("max_rank", 3))
        unlocked = await _best_rank_reached(session, user_id, max_rank)
        return BadgeProgress(
            badge=badge,
            unlocked=unlocked,
            current=1.0 if unlocked else 0.0,
            target=1.0,
            hint=(
                "Получен"
                if unlocked
                else f"Займите место не ниже {max_rank} в рейтинге недели"
            ),
        )

    if rule == BadgeRule.ZERO_METRIC_STREAK:
        metric = str(params.get("metric", "lateness"))
        need = int(params.get("weeks", 3))
        streak = await _streak_length(
            session, user_id, metric, predicate=lambda v: v == 0, max_weeks=need
        )
        return BadgeProgress(
            badge=badge,
            unlocked=streak >= need,
            current=float(streak),
            target=float(need),
            hint=(
                "Получен"
                if streak >= need
                else f"Серия {streak} из {need} недель, осталось {need - streak}"
            ),
        )

    if rule == BadgeRule.METRIC_THRESHOLD_STREAK:
        metric = str(params.get("metric", "quality"))
        threshold = float(params.get("gte", 0))
        need = int(params.get("weeks", 1))
        streak = await _streak_length(
            session, user_id, metric, predicate=lambda v: v >= threshold, max_weeks=need
        )
        return BadgeProgress(
            badge=badge,
            unlocked=streak >= need,
            current=float(streak),
            target=float(need),
            hint=(
                "Получен"
                if streak >= need
                else f"Нужно {need} нед. подряд со значением не ниже {threshold:g}"
            ),
        )

    if rule == BadgeRule.METRIC_TOTAL:
        metric = str(params.get("metric", "driver_gratitudes"))
        target = float(params.get("gte", 1))
        total = await session.scalar(
            select(func.coalesce(func.sum(OperatorWeekMetric.value), 0.0))
            .join(ContestWeek, ContestWeek.id == OperatorWeekMetric.week_id)
            .where(
                OperatorWeekMetric.user_id == user_id,
                OperatorWeekMetric.metric_code == metric,
                ContestWeek.status == WeekStatus.CLOSED,
            )
        )
        total = float(total or 0.0)
        return BadgeProgress(
            badge=badge,
            unlocked=total >= target,
            current=total,
            target=target,
            hint=(
                "Получен"
                if total >= target
                else f"Накоплено {total:g} из {target:g}"
            ),
        )

    if rule == BadgeRule.TOTAL_EARNED:
        target = float(params.get("gte", 100))
        earned = await session.scalar(
            select(CoinAccount.total_earned).where(CoinAccount.user_id == user_id)
        )
        earned = float(earned or 0)
        return BadgeProgress(
            badge=badge,
            unlocked=earned >= target,
            current=earned,
            target=target,
            hint=(
                "Получен"
                if earned >= target
                else f"Заработайте ещё {int(target - earned)} коинов"
            ),
        )

    if rule == BadgeRule.NOMINATION_COUNT:
        target = float(params.get("gte", 1))
        count = await session.scalar(
            select(func.count(NominationWinner.id)).where(
                NominationWinner.user_id == user_id
            )
        )
        count = float(count or 0)
        return BadgeProgress(
            badge=badge,
            unlocked=count >= target,
            current=count,
            target=target,
            hint=(
                "Получен"
                if count >= target
                else f"Выиграно номинаций: {int(count)} из {int(target)}"
            ),
        )

    return BadgeProgress(badge=badge, unlocked=False, current=0.0, target=1.0, hint="")


async def user_badge_board(
    session: AsyncSession, user_id: int
) -> list[tuple[BadgeProgress, UserBadge | None]]:
    """
    Доска достижений оператора: полученные и заблокированные бейджи с подсказками.
    """
    definitions = list(
        await session.scalars(
            select(BadgeDefinition)
            .where(BadgeDefinition.is_active.is_(True))
            .order_by(BadgeDefinition.sort_order, BadgeDefinition.id)
        )
    )
    awards = list(
        await session.scalars(select(UserBadge).where(UserBadge.user_id == user_id))
    )
    latest_award: dict[int, UserBadge] = {}
    for award in awards:
        current = latest_award.get(award.badge_id)
        if current is None or award.awarded_at > current.awarded_at:
            latest_award[award.badge_id] = award

    board: list[tuple[BadgeProgress, UserBadge | None]] = []
    for definition in definitions:
        progress = await evaluate_badge(session, definition, user_id)
        award = latest_award.get(definition.id)
        if award is not None:
            progress.unlocked = True
            progress.hint = "Получен"
        board.append((progress, award))
    return board


async def evaluate_for_week(session: AsyncSession, week: ContestWeek) -> int:
    """
    Выдаёт бейджи участникам закрытой недели. Возвращает количество новых наград.

    Вызывается после закрытия недели; повторный вызов не создаёт дубликатов
    благодаря уникальному ограничению (user, badge, week).
    """
    definitions = list(
        await session.scalars(
            select(BadgeDefinition)
            .where(BadgeDefinition.is_active.is_(True))
            .order_by(BadgeDefinition.sort_order, BadgeDefinition.id)
        )
    )
    if not definitions:
        return 0

    participants = list(
        await session.scalars(
            select(OperatorWeekResult.user_id).where(OperatorWeekResult.week_id == week.id)
        )
    )
    existing_rows = await session.execute(
        select(UserBadge.user_id, UserBadge.badge_id).where(
            UserBadge.user_id.in_(participants)
        )
    )
    already: set[tuple[int, int]] = {tuple(row) for row in existing_rows}

    awarded = 0
    for user_id in participants:
        for definition in definitions:
            if not definition.is_repeatable and (user_id, definition.id) in already:
                continue
            progress = await evaluate_badge(session, definition, user_id)
            if not progress.unlocked:
                continue
            session.add(
                UserBadge(user_id=user_id, badge_id=definition.id, week_id=week.id)
            )
            already.add((user_id, definition.id))
            awarded += 1

    await session.flush()
    return awarded
