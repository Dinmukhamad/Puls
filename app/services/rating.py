"""Турнирная таблица недели (п. 4.2)."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contest import (
    ContestWeek,
    NominationDefinition,
    NominationWinner,
    OperatorWeekResult,
)
from app.models.user import CoinAccount, Group, User


@dataclass(slots=True)
class RatingRow:
    """Строка общей таблицы (п. 4.2.4)."""

    rank: int | None
    user_id: int
    full_name: str
    group_name: str | None
    points: float
    coins_week: int
    balance: int | None
    rank_delta: int | None
    lateness: float
    forbidden_sites: float
    is_me: bool


@dataclass(slots=True)
class NominationRow:
    code: str
    title: str
    description: str | None
    winner_id: int | None
    winner_name: str | None
    winner_group: str | None
    value: float
    coins_awarded: int


def _base_query(week_id: int) -> Select:
    return (
        select(
            OperatorWeekResult,
            User.full_name,
            Group.name,
            CoinAccount.balance,
        )
        .join(User, User.id == OperatorWeekResult.user_id)
        .outerjoin(Group, Group.id == User.group_id)
        .outerjoin(CoinAccount, CoinAccount.user_id == User.id)
        .where(OperatorWeekResult.week_id == week_id)
    )


async def leaderboard(
    session: AsyncSession,
    *,
    week: ContestWeek,
    viewer: User,
    show_balance: bool,
    group_id: int | None = None,
    search: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[RatingRow], int]:
    """
    Страница общей таблицы и общее число участников недели.

    ``show_balance`` управляет видимостью чужого баланса: оператору по умолчанию
    показываются только имя, место и результат недели (п. 5 «Безопасность»).
    """
    stmt = _base_query(week.id)
    count_stmt = (
        select(func.count(OperatorWeekResult.id))
        .join(User, User.id == OperatorWeekResult.user_id)
        .where(OperatorWeekResult.week_id == week.id)
    )

    if group_id is not None:
        stmt = stmt.where(User.group_id == group_id)
        count_stmt = count_stmt.where(User.group_id == group_id)
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(User.full_name.ilike(pattern))
        count_stmt = count_stmt.where(User.full_name.ilike(pattern))

    total = int(await session.scalar(count_stmt) or 0)

    stmt = stmt.order_by(
        OperatorWeekResult.rank.is_(None),
        OperatorWeekResult.rank,
        OperatorWeekResult.final_points.desc(),
    ).offset(offset).limit(limit)

    rows = await session.execute(stmt)
    result: list[RatingRow] = []
    for record, full_name, group_name, balance in rows:
        is_me = record.user_id == viewer.id
        result.append(
            RatingRow(
                rank=record.rank,
                user_id=record.user_id,
                full_name=full_name,
                group_name=group_name,
                points=record.final_points,
                coins_week=record.coins_total,
                balance=(balance or 0) if (show_balance or is_me) else None,
                rank_delta=record.rank_delta,
                lateness=record.lateness_count,
                forbidden_sites=record.forbidden_sites_count,
                is_me=is_me,
            )
        )
    return result, total


async def podium(
    session: AsyncSession, *, week: ContestWeek, viewer: User, show_balance: bool
) -> list[RatingRow]:
    """Пьедестал: топ-3 недели (п. 4.2.2)."""
    rows, _ = await leaderboard(
        session, week=week, viewer=viewer, show_balance=show_balance, limit=3
    )
    return [row for row in rows if row.rank is not None and row.rank <= 3]


async def my_row(
    session: AsyncSession, *, week: ContestWeek, user_id: int
) -> OperatorWeekResult | None:
    return await session.scalar(
        select(OperatorWeekResult).where(
            OperatorWeekResult.week_id == week.id,
            OperatorWeekResult.user_id == user_id,
        )
    )


async def nominations(session: AsyncSession, week: ContestWeek) -> list[NominationRow]:
    """Номинации недели с победителями; без победителя - с пустым слотом."""
    definitions = list(
        await session.scalars(
            select(NominationDefinition)
            .where(NominationDefinition.is_active.is_(True))
            .order_by(NominationDefinition.sort_order, NominationDefinition.id)
        )
    )
    winners = await session.execute(
        select(NominationWinner, User.full_name, Group.name)
        .join(User, User.id == NominationWinner.user_id)
        .outerjoin(Group, Group.id == User.group_id)
        .where(NominationWinner.week_id == week.id)
    )
    winner_map = {w.nomination_id: (w, name, group) for w, name, group in winners}

    rows: list[NominationRow] = []
    for definition in definitions:
        found = winner_map.get(definition.id)
        if found is None:
            rows.append(
                NominationRow(
                    code=definition.code,
                    title=definition.title,
                    description=definition.description,
                    winner_id=None,
                    winner_name=None,
                    winner_group=None,
                    value=0.0,
                    coins_awarded=0,
                )
            )
            continue
        winner, name, group_name = found
        rows.append(
            NominationRow(
                code=definition.code,
                title=definition.title,
                description=definition.description,
                winner_id=winner.user_id,
                winner_name=name,
                winner_group=group_name,
                value=winner.value,
                coins_awarded=winner.coins_awarded,
            )
        )
    return rows


async def participants_count(session: AsyncSession, week_id: int) -> int:
    return int(
        await session.scalar(
            select(func.count(OperatorWeekResult.id)).where(
                OperatorWeekResult.week_id == week_id
            )
        )
        or 0
    )
