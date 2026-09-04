"""Магазин бонусов: каталог, заявки и их согласование (п. 4.3, 4.4.4)."""
from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ConflictError, InsufficientCoinsError, NotFoundError
from app.db.base import utcnow
from app.models.enums import ShopRequestStatus, TxType
from app.models.shop import ShopItem, ShopRequest
from app.models.user import CoinAccount, User
from app.services import coins as coins_service

#: Статусы, которые считаются «выданными» при подсчёте лимитов.
CONSUMING_STATUSES = (
    ShopRequestStatus.NEW,
    ShopRequestStatus.APPROVED,
    ShopRequestStatus.FULFILLED,
)


async def get_item(session: AsyncSession, item_id: int) -> ShopItem:
    item = await session.get(ShopItem, item_id)
    if item is None:
        raise NotFoundError(f"Бонус id={item_id} не найден")
    return item


async def get_request(session: AsyncSession, request_id: int) -> ShopRequest:
    request = await session.scalar(
        select(ShopRequest)
        .options(
            selectinload(ShopRequest.item),
            # Группы нужны сериализации ответа: без них ORM полезет в базу
            # во время формирования JSON и запрос упадёт.
            selectinload(ShopRequest.user).selectinload(User.group),
            selectinload(ShopRequest.decided_by).selectinload(User.group),
        )
        .where(ShopRequest.id == request_id)
    )
    if request is None:
        raise NotFoundError(f"Заявка id={request_id} не найдена")
    return request


async def _issued_count(session: AsyncSession, item_id: int) -> int:
    total = await session.scalar(
        select(func.count(ShopRequest.id)).where(
            ShopRequest.item_id == item_id,
            ShopRequest.status.in_(CONSUMING_STATUSES),
        )
    )
    return int(total or 0)


async def _user_month_count(session: AsyncSession, item_id: int, user_id: int) -> int:
    today = date.today()
    month_start = datetime(today.year, today.month, 1, tzinfo=UTC)
    total = await session.scalar(
        select(func.count(ShopRequest.id)).where(
            ShopRequest.item_id == item_id,
            ShopRequest.user_id == user_id,
            ShopRequest.status.in_(CONSUMING_STATUSES),
            ShopRequest.created_at >= month_start,
        )
    )
    return int(total or 0)


async def check_availability(
    session: AsyncSession, item: ShopItem, user_id: int
) -> str | None:
    """Возвращает причину, по которой бонус недоступен, либо ``None``."""
    if not item.is_active:
        return "Бонус временно недоступен"
    if item.stock_limit is not None:
        issued = await _issued_count(session, item.id)
        if issued >= item.stock_limit:
            return "Лимит выдач по этому бонусу исчерпан"
    if item.per_user_monthly_limit is not None:
        used = await _user_month_count(session, item.id, user_id)
        if used >= item.per_user_monthly_limit:
            return (
                f"Достигнут месячный лимит: {item.per_user_monthly_limit} шт. на оператора"
            )
    return None


async def create_request(
    session: AsyncSession, *, user: User, item_id: int, comment: str | None = None
) -> ShopRequest:
    """
    Создаёт заявку на бонус и резервирует коины (шаг 9 п. 7).

    Если у бонуса снят флаг ``requires_approval``, заявка сразу проводится как
    покупка - согласование супервайзера не требуется.
    """
    item = await get_item(session, item_id)

    blocked = await check_availability(session, item, user.id)
    if blocked:
        raise ConflictError(blocked, code="item_unavailable")

    account = await coins_service.get_account(session, user.id, lock=True)
    if account.available < item.price:
        raise InsufficientCoinsError(required=item.price, available=account.available)

    request = ShopRequest(
        user_id=user.id,
        item_id=item.id,
        price=item.price,
        comment=comment,
        status=ShopRequestStatus.NEW,
    )
    session.add(request)
    await session.flush()

    await coins_service.reserve(session, user.id, item.price)

    if not item.requires_approval:
        await approve_request(session, request=request, actor=None, auto=True)

    await session.refresh(request)
    return request


async def approve_request(
    session: AsyncSession,
    *,
    request: ShopRequest,
    actor: User | None,
    comment: str | None = None,
    auto: bool = False,
) -> ShopRequest:
    """Одобряет заявку: резерв превращается в списание (шаг 10 п. 7)."""
    _ensure_open(request)

    item = request.item or await get_item(session, request.item_id)
    await coins_service.commit_reserve(
        session,
        user_id=request.user_id,
        amount=request.price,
        reason=f"Покупка бонуса «{item.title}»",
        shop_request_id=request.id,
        created_by_id=actor.id if actor else None,
    )

    request.status = ShopRequestStatus.APPROVED
    request.decided_by_id = actor.id if actor else None
    request.decided_at = utcnow()
    request.decision_comment = comment or ("Автоодобрение" if auto else None)
    await session.flush()
    return request


async def reject_request(
    session: AsyncSession, *, request: ShopRequest, actor: User, comment: str
) -> ShopRequest:
    """Отклоняет заявку и возвращает зарезервированные коины оператору."""
    _ensure_open(request)
    if not comment or not comment.strip():
        raise ConflictError("Укажите причину отказа - оператор должен её видеть")

    await coins_service.release_reserve(session, request.user_id, request.price)
    request.status = ShopRequestStatus.REJECTED
    request.decided_by_id = actor.id
    request.decided_at = utcnow()
    request.decision_comment = comment.strip()
    await session.flush()
    return request


async def cancel_request(
    session: AsyncSession, *, request: ShopRequest, actor: User
) -> ShopRequest:
    """Оператор отзывает собственную ещё не рассмотренную заявку."""
    _ensure_open(request)
    if request.user_id != actor.id:
        raise ConflictError("Отозвать можно только собственную заявку")

    await coins_service.release_reserve(session, request.user_id, request.price)
    request.status = ShopRequestStatus.CANCELLED
    request.decided_at = utcnow()
    request.decision_comment = "Отозвана оператором"
    await session.flush()
    return request


async def fulfill_request(
    session: AsyncSession, *, request: ShopRequest, actor: User, comment: str | None = None
) -> ShopRequest:
    """Отмечает фактическую выдачу бонуса (п. 4.4.4)."""
    if request.status != ShopRequestStatus.APPROVED:
        raise ConflictError(
            "Отметить выполненной можно только одобренную заявку", code="bad_status"
        )
    request.status = ShopRequestStatus.FULFILLED
    request.fulfilled_by_id = actor.id
    request.fulfilled_at = utcnow()
    if comment:
        request.decision_comment = comment
    await session.flush()
    return request


async def refund_request(
    session: AsyncSession, *, request: ShopRequest, actor: User, reason: str
) -> ShopRequest:
    """
    Возврат по уже одобренной заявке: бонус не удалось выдать.

    Коины возвращаются отдельной операцией в истории - списание из журнала
    не удаляется, так как журнал неизменяем (п. 5 «История»).
    """
    if request.status not in (ShopRequestStatus.APPROVED, ShopRequestStatus.FULFILLED):
        raise ConflictError("Возврат возможен только по одобренной заявке", code="bad_status")

    await coins_service.post_transaction(
        session,
        user_id=request.user_id,
        amount=request.price,
        tx_type=TxType.PURCHASE_REFUND,
        reason=f"Возврат по заявке #{request.id}: {reason}",
        shop_request_id=request.id,
        created_by_id=actor.id,
    )
    request.status = ShopRequestStatus.REJECTED
    request.decision_comment = f"Возврат: {reason}"
    request.decided_by_id = actor.id
    request.decided_at = utcnow()
    await session.flush()
    return request


def _ensure_open(request: ShopRequest) -> None:
    if request.status != ShopRequestStatus.NEW:
        raise ConflictError(
            f"Заявка уже обработана (статус: {request.status})", code="bad_status"
        )


async def catalog_for_user(
    session: AsyncSession, user_id: int, *, include_inactive: bool = False
) -> tuple[list[ShopItem], CoinAccount, dict[int, str | None]]:
    """Каталог с пометкой доступности каждой позиции для конкретного оператора."""
    stmt = select(ShopItem).order_by(ShopItem.sort_order, ShopItem.price)
    if not include_inactive:
        stmt = stmt.where(ShopItem.is_active.is_(True))
    items = list(await session.scalars(stmt))
    account = await coins_service.get_account(session, user_id)
    blocked = {item.id: await check_availability(session, item, user_id) for item in items}
    return items, account, blocked
