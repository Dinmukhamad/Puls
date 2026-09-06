"""Административная панель супервайзера и руководителя (п. 4.4.1-4.4.4)."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.deps import (
    HeadUser,
    PaginationDep,
    SessionDep,
    StaffUser,
    ensure_can_manage,
    visible_users_filter,
)
from app.models.coin import CoinTransaction
from app.models.enums import ShopRequestStatus
from app.models.shop import ShopRequest
from app.models.user import User
from app.schemas.admin import (
    GratitudeIn,
    ManualCoinsBulkIn,
    ManualCoinsIn,
    OperatorRowOut,
    SummaryOut,
)
from app.schemas.cabinet import TransactionOut
from app.schemas.common import Message, Page
from app.schemas.shop import ShopDecision, ShopRejection, ShopRequestOut
from app.services import shop as shop_service
from app.services import staff as staff_service
from app.services import weekly as weekly_service

router = APIRouter(prefix="/admin", tags=["Админ-панель"])


@router.get("/summary", response_model=SummaryOut, summary="Сводная статистика")
async def summary(session: SessionDep, actor: StaffUser, week_id: int | None = None) -> SummaryOut:
    week = await weekly_service.resolve_week(session, week_id, prefer_ranked=True)
    visibility = await visible_users_filter(session, actor)
    data = await staff_service.summary(session, week=week, visibility=visibility)
    return SummaryOut(**asdict(data))


@router.get("/operators", response_model=Page[OperatorRowOut], summary="Таблица операторов")
async def operators(
    session: SessionDep,
    actor: StaffUser,
    pagination: PaginationDep,
    week_id: int | None = None,
    group_id: int | None = None,
    search: Annotated[str | None, Query(description="Поиск по ФИО")] = None,
) -> Page[OperatorRowOut]:
    week = await weekly_service.resolve_week(session, week_id, prefer_ranked=True)
    visibility = await visible_users_filter(session, actor)
    rows, total = await staff_service.operators_table(
        session,
        week=week,
        visibility=visibility,
        group_id=group_id,
        search=search,
        offset=pagination.offset,
        limit=pagination.size,
    )
    items = [OperatorRowOut(**asdict(row)) for row in rows]
    return Page.build(items, total, pagination.page, pagination.size)


@router.get(
    "/operators/export",
    summary="Выгрузка таблицы операторов в CSV",
    response_class=Response,
)
async def export_operators(
    session: SessionDep,
    actor: StaffUser,
    week_id: int | None = None,
    group_id: int | None = None,
) -> Response:
    """CSV с разделителем «;» и BOM - открывается в Excel без настройки импорта."""
    week = await weekly_service.resolve_week(session, week_id, prefer_ranked=True)
    visibility = await visible_users_filter(session, actor)
    rows, _ = await staff_service.operators_table(
        session,
        week=week,
        visibility=visibility,
        group_id=group_id,
        offset=0,
        limit=100_000,
    )
    body = staff_service.operators_csv(rows, week.label if week else None)
    filename = f"operators_{week.label if week else 'all'}.csv"
    return Response(
        content=body.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --------------------------------------------------------------------------- #
# Ручные начисления (п. 4.4.3)
# --------------------------------------------------------------------------- #


@router.post(
    "/coins/manual",
    response_model=TransactionOut,
    summary="Ручное начисление или списание коинов",
)
async def manual_coins(
    session: SessionDep, actor: StaffUser, payload: ManualCoinsIn
) -> TransactionOut:
    target = await staff_service.get_operator(session, payload.user_id)
    await ensure_can_manage(session, actor, target)
    transaction = await staff_service.manual_transaction(
        session,
        actor=actor,
        target=target,
        amount=payload.amount,
        reason=payload.reason,
        request_id=payload.request_id,
    )
    await session.commit()
    item = TransactionOut.model_validate(transaction)
    item.author_name = actor.full_name
    return item


@router.post(
    "/coins/manual/bulk",
    response_model=list[TransactionOut],
    summary="Пакетное начисление нескольким операторам",
)
async def manual_coins_bulk(
    session: SessionDep, actor: StaffUser, payload: ManualCoinsBulkIn
) -> list[TransactionOut]:
    """Начисляет одинаковую сумму с общей причиной. Выполняется одной транзакцией."""
    items: list[TransactionOut] = []
    for user_id in payload.user_ids:
        target = await staff_service.get_operator(session, user_id)
        await ensure_can_manage(session, actor, target)
        transaction = await staff_service.manual_transaction(
            session,
            actor=actor,
            target=target,
            amount=payload.amount,
            reason=payload.reason,
        )
        item = TransactionOut.model_validate(transaction)
        item.author_name = actor.full_name
        items.append(item)
    await session.commit()
    return items


@router.post(
    "/coins/gratitude",
    response_model=TransactionOut,
    summary="Начислить за благодарность от водителя",
)
async def driver_gratitude(
    session: SessionDep, actor: StaffUser, payload: GratitudeIn
) -> TransactionOut:
    target = await staff_service.get_operator(session, payload.user_id)
    await ensure_can_manage(session, actor, target)
    transaction = await staff_service.gratitude(
        session,
        actor=actor,
        target=target,
        driver_ref=payload.driver_ref,
        request_id=payload.request_id,
    )
    await session.commit()
    item = TransactionOut.model_validate(transaction)
    item.author_name = actor.full_name
    return item


@router.get(
    "/coins/transactions",
    response_model=Page[TransactionOut],
    summary="История начислений по всем операторам",
)
async def all_transactions(
    session: SessionDep,
    actor: HeadUser,
    pagination: PaginationDep,
    user_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> Page[TransactionOut]:
    """Полная история операций - доступна руководителю и администратору (п. 4.4.5)."""
    conditions = []
    if user_id is not None:
        conditions.append(CoinTransaction.user_id == user_id)
    if date_from is not None:
        conditions.append(CoinTransaction.created_at >= date_from)
    if date_to is not None:
        conditions.append(CoinTransaction.created_at <= date_to)

    total = int(
        await session.scalar(select(func.count(CoinTransaction.id)).where(*conditions)) or 0
    )
    author = User.__table__.alias("author")
    rows = await session.execute(
        select(CoinTransaction, author.c.full_name)
        .outerjoin(author, author.c.id == CoinTransaction.created_by_id)
        .where(*conditions)
        .order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc())
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    items = []
    for transaction, author_name in rows:
        item = TransactionOut.model_validate(transaction)
        item.author_name = author_name
        items.append(item)
    return Page.build(items, total, pagination.page, pagination.size)


# --------------------------------------------------------------------------- #
# Заявки из магазина (п. 4.4.4)
# --------------------------------------------------------------------------- #


@router.get("/shop/requests", response_model=Page[ShopRequestOut], summary="Очередь заявок")
async def shop_requests(
    session: SessionDep,
    actor: StaffUser,
    pagination: PaginationDep,
    status_filter: Annotated[
        ShopRequestStatus | None, Query(alias="status", description="Фильтр по статусу")
    ] = None,
) -> Page[ShopRequestOut]:
    visibility = await visible_users_filter(session, actor)
    conditions = [visibility]
    if status_filter is not None:
        conditions.append(ShopRequest.status == status_filter)

    total = int(
        await session.scalar(
            select(func.count(ShopRequest.id))
            .join(User, User.id == ShopRequest.user_id)
            .where(*conditions)
        )
        or 0
    )
    rows = await session.scalars(
        select(ShopRequest)
        .join(User, User.id == ShopRequest.user_id)
        .options(
            selectinload(ShopRequest.item),
            selectinload(ShopRequest.user).selectinload(User.group),
            selectinload(ShopRequest.decided_by).selectinload(User.group),
        )
        .where(*conditions)
        .order_by(ShopRequest.created_at.desc())
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    items = [ShopRequestOut.model_validate(row) for row in rows]
    return Page.build(items, total, pagination.page, pagination.size)


@router.post(
    "/shop/requests/{request_id}/approve",
    response_model=ShopRequestOut,
    summary="Одобрить заявку",
)
async def approve(
    session: SessionDep, actor: StaffUser, request_id: int, payload: ShopDecision
) -> ShopRequest:
    request = await shop_service.get_request(session, request_id)
    await ensure_can_manage(session, actor, request.user)
    await shop_service.approve_request(
        session, request=request, actor=actor, comment=payload.comment
    )
    await session.commit()
    return await shop_service.get_request(session, request_id)


@router.post(
    "/shop/requests/{request_id}/reject",
    response_model=ShopRequestOut,
    summary="Отклонить заявку",
)
async def reject(
    session: SessionDep, actor: StaffUser, request_id: int, payload: ShopRejection
) -> ShopRequest:
    """Отклонение снимает резерв: коины возвращаются оператору вместе с причиной."""
    request = await shop_service.get_request(session, request_id)
    await ensure_can_manage(session, actor, request.user)
    await shop_service.reject_request(
        session, request=request, actor=actor, comment=payload.comment
    )
    await session.commit()
    return await shop_service.get_request(session, request_id)


@router.post(
    "/shop/requests/{request_id}/fulfill",
    response_model=ShopRequestOut,
    summary="Отметить бонус выданным",
)
async def fulfill(
    session: SessionDep, actor: StaffUser, request_id: int, payload: ShopDecision
) -> ShopRequest:
    request = await shop_service.get_request(session, request_id)
    await ensure_can_manage(session, actor, request.user)
    await shop_service.fulfill_request(
        session, request=request, actor=actor, comment=payload.comment
    )
    await session.commit()
    return await shop_service.get_request(session, request_id)


@router.post(
    "/shop/requests/{request_id}/refund",
    response_model=Message,
    summary="Вернуть коины по одобренной заявке",
)
async def refund(
    session: SessionDep, actor: HeadUser, request_id: int, payload: ShopRejection
) -> Message:
    request = await shop_service.get_request(session, request_id)
    await shop_service.refund_request(session, request=request, actor=actor, reason=payload.comment)
    await session.commit()
    return Message(detail=f"Коины возвращены по заявке #{request_id}")
