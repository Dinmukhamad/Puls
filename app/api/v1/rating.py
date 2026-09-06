"""Турнирная таблица (п. 4.2)."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.core.deps import CurrentUser, PaginationDep, SessionDep
from app.core.errors import NotFoundError
from app.models.contest import ContestWeek, OperatorWeekResult
from app.models.enums import Role, WeekStatus
from app.schemas.rating import (
    NominationOut,
    PodiumEntry,
    RatingHeader,
    RatingOut,
    RatingProgress,
    RatingProgressPoint,
    RatingRowOut,
    WeekOut,
)
from app.services import rating as rating_service
from app.services import weekly as weekly_service
from app.services.rules import get_rules

router = APIRouter(prefix="/rating", tags=["Рейтинг"])

_MEDALS = {1: "gold", 2: "silver", 3: "bronze"}


@router.get("/weeks", response_model=list[WeekOut], summary="Список недель конкурса")
async def weeks(
    session: SessionDep, _: CurrentUser, limit: Annotated[int, Query(ge=1, le=104)] = 20
) -> list[ContestWeek]:
    rows = await session.scalars(
        select(ContestWeek).order_by(ContestWeek.starts_on.desc()).limit(limit)
    )
    return list(rows)


@router.get("/me/progress", response_model=RatingProgress)
async def my_progress(
    session: SessionDep,
    user: CurrentUser,
    week_id: int | None = None,
    count: Annotated[int, Query(ge=4, le=16)] = 8,
):
    anchor = await weekly_service.resolve_week(session, week_id, prefer_ranked=True)
    end = anchor.starts_on if anchor else date.today() - timedelta(days=date.today().weekday())
    start = end - timedelta(weeks=count - 1)
    rows = await session.execute(
        select(ContestWeek, OperatorWeekResult)
        .outerjoin(
            OperatorWeekResult,
            (OperatorWeekResult.week_id == ContestWeek.id)
            & (OperatorWeekResult.user_id == user.id),
        )
        .where(ContestWeek.starts_on >= start, ContestWeek.starts_on <= end)
    )
    by_date = {week.starts_on: (week, result) for week, result in rows}
    timeline = []
    for index in range(count):
        day = start + timedelta(weeks=index)
        week, result = by_date.get(day, (None, None))
        # An invalidated calculation is a gap until the week is calculated again.
        ready = (
            week is not None
            and week.status in (WeekStatus.CALCULATED, WeekStatus.CLOSED)
            and result is not None
        )
        year, number, _ = day.isocalendar()
        timeline.append(
            RatingProgressPoint(
                week_id=week.id if week else None,
                label=f"{year}-W{number:02d}",
                starts_on=day,
                status=week.status if week else None,
                rank=result.rank if ready else None,
                points=result.final_points if ready else None,
                coins=result.coins_total if ready else None,
            )
        )
    return RatingProgress(points=timeline)


def _to_row(row: rating_service.RatingRow) -> RatingRowOut:
    return RatingRowOut(
        rank=row.rank,
        user_id=row.user_id,
        full_name=row.full_name,
        group_name=row.group_name,
        points=row.points,
        coins_week=row.coins_week,
        balance=row.balance,
        rank_delta=row.rank_delta,
        is_me=row.is_me,
    )


@router.get("", response_model=RatingOut, summary="Турнирная таблица недели")
async def leaderboard(
    session: SessionDep,
    user: CurrentUser,
    pagination: PaginationDep,
    week_id: Annotated[int | None, Query(description="По умолчанию - последняя неделя")] = None,
    group_id: int | None = None,
    search: Annotated[str | None, Query(description="Поиск по ФИО")] = None,
) -> RatingOut:
    """
    Шапка конкурса, пьедестал, номинации и общая таблица одним ответом.

    Оператору чужой баланс не показывается, пока руководитель не включит это
    в настройках (п. 5 «Безопасность»).
    """
    week = await weekly_service.resolve_week(session, week_id, prefer_ranked=True)
    if week is None:
        raise NotFoundError("Ни одной недели конкурса ещё не заведено")

    rules = await get_rules(session)
    show_balance = user.role != Role.OPERATOR or rules.rating_show_balance_to_operators

    rows, total = await rating_service.leaderboard(
        session,
        week=week,
        viewer=user,
        show_balance=show_balance,
        group_id=group_id,
        search=search,
        offset=pagination.offset,
        limit=pagination.size,
    )
    top = await rating_service.podium(session, week=week, viewer=user, show_balance=show_balance)

    my_result = await rating_service.my_row(session, week=week, user_id=user.id)
    my_row_out = None
    if my_result is not None:
        my_row_out = RatingRowOut(
            rank=my_result.rank,
            user_id=user.id,
            full_name=user.full_name,
            group_name=user.group.name if user.group else None,
            points=my_result.final_points,
            coins_week=my_result.coins_total,
            balance=None,
            rank_delta=my_result.rank_delta,
            is_me=True,
        )

    header = RatingHeader(
        contest_title=week.title,
        week_id=week.id,
        week_label=week.label,
        period_start=week.starts_on,
        period_end=week.ends_on,
        status=week.status,
        participants=await rating_service.participants_count(session, week.id),
        updated_at=week.closed_at or week.calculated_at,
    )

    return RatingOut(
        header=header,
        podium=[
            PodiumEntry(**_to_row(row).model_dump(), medal=_MEDALS.get(row.rank or 0, ""))
            for row in top
        ],
        nominations=[
            NominationOut(
                code=n.code,
                title=n.title,
                description=n.description,
                winner_id=n.winner_id,
                winner_name=n.winner_name,
                winner_group=n.winner_group,
                value=n.value,
                coins_awarded=n.coins_awarded,
            )
            for n in await rating_service.nominations(session, week)
        ],
        rows=[_to_row(row) for row in rows],
        total=total,
        page=pagination.page,
        size=pagination.size,
        my_row=my_row_out,
    )


@router.get("/nominations", response_model=list[NominationOut], summary="Номинации недели")
async def nominations(
    session: SessionDep, _: CurrentUser, week_id: int | None = None
) -> list[NominationOut]:
    week = await weekly_service.resolve_week(session, week_id, prefer_ranked=True)
    if week is None:
        raise NotFoundError("Ни одной недели конкурса ещё не заведено")
    return [
        NominationOut(
            code=n.code,
            title=n.title,
            description=n.description,
            winner_id=n.winner_id,
            winner_name=n.winner_name,
            winner_group=n.winner_group,
            value=n.value,
            coins_awarded=n.coins_awarded,
        )
        for n in await rating_service.nominations(session, week)
    ]
