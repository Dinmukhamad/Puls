"""Личный кабинет оператора (п. 4.1)."""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser, PaginationDep, SessionDep
from app.models.coin import CoinTransaction
from app.models.shop import ShopRequest
from app.models.user import User
from app.schemas.cabinet import (
    BadgeOut,
    BalanceBlock,
    DashboardOut,
    TransactionOut,
    WeekMetricsBlock,
)
from app.schemas.common import Page
from app.schemas.shop import ShopRequestOut
from app.services import badges as badges_service
from app.services import cabinet as cabinet_service
from app.services import coins as coins_service
from app.services import weekly as weekly_service

router = APIRouter(prefix="/me", tags=["Кабинет оператора"])

HistoryFilter = Literal["accrual", "writeoff", "purchase"]


@router.get("/dashboard", response_model=DashboardOut, summary="Сводка кабинета")
async def dashboard(
    session: SessionDep,
    user: CurrentUser,
    week_id: Annotated[int | None, Query(description="По умолчанию - текущая неделя")] = None,
) -> DashboardOut:
    week = (
        await weekly_service.get_week(session, week_id)
        if week_id is not None
        else await cabinet_service.current_week(session)
    )
    unlocked, total_badges = await cabinet_service.badge_counters(session, user.id)
    return DashboardOut(
        user_id=user.id,
        full_name=user.full_name,
        group_name=user.group.name if user.group else None,
        balance=await cabinet_service.balance_block(session, user=user, week=week),
        week=await cabinet_service.week_block(session, user_id=user.id, week=week),
        badges_unlocked=unlocked,
        badges_total=total_badges,
        my_nominations=await cabinet_service.my_nominations(
            session, user_id=user.id, week=week
        ),
        pending_shop_requests=await cabinet_service.pending_requests_count(
            session, user.id
        ),
    )


@router.get("/balance", response_model=BalanceBlock, summary="Блок «Мой баланс»")
async def balance(
    session: SessionDep, user: CurrentUser, week_id: int | None = None
) -> BalanceBlock:
    week = (
        await weekly_service.get_week(session, week_id)
        if week_id is not None
        else await cabinet_service.current_week(session)
    )
    return await cabinet_service.balance_block(session, user=user, week=week)


@router.get("/week", response_model=WeekMetricsBlock, summary="Показатели недели")
async def week_metrics(
    session: SessionDep, user: CurrentUser, week_id: int | None = None
) -> WeekMetricsBlock:
    week = (
        await weekly_service.get_week(session, week_id)
        if week_id is not None
        else await cabinet_service.current_week(session)
    )
    return await cabinet_service.week_block(session, user_id=user.id, week=week)


@router.get(
    "/transactions",
    response_model=Page[TransactionOut],
    summary="История начислений и списаний",
)
async def transactions(
    session: SessionDep,
    user: CurrentUser,
    pagination: PaginationDep,
    date_from: Annotated[datetime | None, Query(description="С какой даты включительно")] = None,
    date_to: Annotated[datetime | None, Query(description="По какую дату включительно")] = None,
    kind: Annotated[
        HistoryFilter | None,
        Query(description="Фильтр по типу: начисление, списание или покупка"),
    ] = None,
) -> Page[TransactionOut]:
    """История операций оператора с фильтрами по периоду и типу (п. 4.1.3)."""
    conditions = [CoinTransaction.user_id == user.id]
    if date_from is not None:
        conditions.append(CoinTransaction.created_at >= date_from)
    if date_to is not None:
        conditions.append(CoinTransaction.created_at <= date_to)
    tx_types = coins_service.resolve_tx_types(kind)
    if tx_types:
        conditions.append(CoinTransaction.tx_type.in_(tx_types))

    total = int(
        await session.scalar(select(func.count(CoinTransaction.id)).where(*conditions)) or 0
    )
    rows = await session.execute(
        select(CoinTransaction, User.full_name)
        .outerjoin(User, User.id == CoinTransaction.created_by_id)
        .where(*conditions)
        .order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc())
        .offset(pagination.offset)
        .limit(pagination.size)
    )

    items = []
    for transaction, author in rows:
        item = TransactionOut.model_validate(transaction)
        item.author_name = author
        items.append(item)

    return Page.build(items, total, pagination.page, pagination.size)


@router.get("/badges", response_model=list[BadgeOut], summary="Мои достижения")
async def my_badges(session: SessionDep, user: CurrentUser) -> list[BadgeOut]:
    """Полученные и заблокированные бейджи с подсказкой, чего не хватает (п. 4.1.4)."""
    board = await badges_service.user_badge_board(session, user.id)
    return [
        BadgeOut(
            code=progress.badge.code,
            title=progress.badge.title,
            description=progress.badge.description,
            icon=progress.badge.icon,
            unlocked=progress.unlocked,
            awarded_at=award.awarded_at if award else None,
            progress_current=progress.current,
            progress_target=progress.target,
            progress_percent=progress.percent,
            hint=progress.hint,
        )
        for progress, award in board
    ]


@router.get(
    "/shop-requests",
    response_model=Page[ShopRequestOut],
    summary="Мои заявки из магазина",
)
async def my_requests(
    session: SessionDep, user: CurrentUser, pagination: PaginationDep
) -> Page[ShopRequestOut]:
    total = int(
        await session.scalar(
            select(func.count(ShopRequest.id)).where(ShopRequest.user_id == user.id)
        )
        or 0
    )
    rows = await session.scalars(
        select(ShopRequest)
        .options(
            selectinload(ShopRequest.item),
            selectinload(ShopRequest.decided_by),
        )
        .where(ShopRequest.user_id == user.id)
        .order_by(ShopRequest.created_at.desc())
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    items = [ShopRequestOut.model_validate(row) for row in rows]
    return Page.build(items, total, pagination.page, pagination.size)
