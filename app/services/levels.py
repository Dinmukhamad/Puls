"""
Расчёт уровня оператора по накопленным коинам (п. 6.2 ТЗ).

Ступени описаны данными, а не кодом: руководитель меняет пороги и названия
через админ-панель, не трогая релиз.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.level import LevelDefinition


@dataclass(slots=True)
class LevelProgress:
    """Текущая ступень и путь до следующей."""

    current: LevelDefinition | None
    next: LevelDefinition | None
    total_earned: int
    #: Сколько коинов не хватает до следующей ступени; 0 на последней.
    remaining: int
    #: Доля пройденного отрезка между ступенями, 0..1.
    fraction: float
    #: Порядковый номер ступени, начиная с единицы.
    index: int
    total_levels: int


async def active_levels(session: AsyncSession) -> list[LevelDefinition]:
    """Ступени по возрастанию порога."""
    rows = await session.scalars(
        select(LevelDefinition)
        .where(LevelDefinition.is_active.is_(True))
        .order_by(LevelDefinition.min_earned, LevelDefinition.id)
    )
    return list(rows)


def resolve(levels: list[LevelDefinition], total_earned: int) -> LevelProgress:
    """
    Определяет ступень для накопленной суммы.

    Чистая функция: список ступеней передаётся снаружи, чтобы не ходить в базу
    на каждого оператора при расчёте таблицы.
    """
    if not levels:
        return LevelProgress(
            current=None,
            next=None,
            total_earned=total_earned,
            remaining=0,
            fraction=0.0,
            index=0,
            total_levels=0,
        )

    reached = [level for level in levels if total_earned >= level.min_earned]
    current = reached[-1] if reached else None
    index = len(reached)

    # Следующая ступень - первая, порог которой ещё не взят.
    upcoming = [level for level in levels if level.min_earned > total_earned]
    following = upcoming[0] if upcoming else None

    if following is None:
        return LevelProgress(
            current=current,
            next=None,
            total_earned=total_earned,
            remaining=0,
            fraction=1.0,
            index=index,
            total_levels=len(levels),
        )

    floor = current.min_earned if current else 0
    span = following.min_earned - floor
    fraction = (total_earned - floor) / span if span > 0 else 0.0

    return LevelProgress(
        current=current,
        next=following,
        total_earned=total_earned,
        remaining=max(0, following.min_earned - total_earned),
        fraction=max(0.0, min(1.0, fraction)),
        index=index,
        total_levels=len(levels),
    )


async def for_user(session: AsyncSession, total_earned: int) -> LevelProgress:
    return resolve(await active_levels(session), total_earned)
