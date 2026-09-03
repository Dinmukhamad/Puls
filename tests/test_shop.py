"""Магазин бонусов: резерв, одобрение, отказ, лимиты (п. 4.3.2)."""
from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, InsufficientCoinsError
from app.models.enums import ShopRequestStatus, TxType
from app.models.shop import ShopItem
from app.models.user import User
from app.services import coins as coins_service
from app.services import shop as shop_service


async def _fund(session: AsyncSession, user: User, amount: int) -> None:
    await coins_service.post_transaction(
        session,
        user_id=user.id,
        amount=amount,
        tx_type=TxType.MANUAL_CREDIT,
        reason="Стартовый баланс для теста",
    )
    await session.commit()


async def _item(session: AsyncSession, code: str = "coffee_card") -> ShopItem:
    return await session.scalar(select(ShopItem).where(ShopItem.code == code))


async def test_request_reserves_coins_without_changing_balance(
    session: AsyncSession, operator: User
) -> None:
    await _fund(session, operator, 200)
    item = await _item(session)

    request = await shop_service.create_request(
        session, user=operator, item_id=item.id
    )
    await session.commit()

    account = await coins_service.get_account(session, operator.id)
    assert request.status == ShopRequestStatus.NEW
    assert account.balance == 200
    assert account.reserved == item.price
    assert account.available == 200 - item.price


async def test_approval_writes_off_reserved_coins(
    session: AsyncSession, operator: User, supervisor: User
) -> None:
    await _fund(session, operator, 200)
    item = await _item(session)
    request = await shop_service.create_request(session, user=operator, item_id=item.id)
    await session.commit()

    await shop_service.approve_request(session, request=request, actor=supervisor)
    await session.commit()

    account = await coins_service.get_account(session, operator.id)
    assert request.status == ShopRequestStatus.APPROVED
    assert account.balance == 200 - item.price
    assert account.reserved == 0
    assert account.total_spent == item.price

    purchase = await session.scalar(
        select(coins_service.CoinTransaction).where(
            coins_service.CoinTransaction.shop_request_id == request.id
        )
    )
    assert purchase.tx_type == TxType.PURCHASE
    assert purchase.amount == -item.price


async def test_rejection_returns_coins_with_reason(
    session: AsyncSession, operator: User, supervisor: User
) -> None:
    await _fund(session, operator, 200)
    item = await _item(session)
    request = await shop_service.create_request(session, user=operator, item_id=item.id)
    await session.commit()

    await shop_service.reject_request(
        session, request=request, actor=supervisor, comment="Бонус закончился на складе"
    )
    await session.commit()

    account = await coins_service.get_account(session, operator.id)
    assert request.status == ShopRequestStatus.REJECTED
    assert request.decision_comment == "Бонус закончился на складе"
    assert account.balance == 200
    assert account.reserved == 0


async def test_rejection_requires_a_reason(
    session: AsyncSession, operator: User, supervisor: User
) -> None:
    await _fund(session, operator, 200)
    item = await _item(session)
    request = await shop_service.create_request(session, user=operator, item_id=item.id)
    await session.commit()

    with pytest.raises(ConflictError):
        await shop_service.reject_request(
            session, request=request, actor=supervisor, comment="   "
        )


async def test_purchase_without_enough_coins_is_blocked(
    session: AsyncSession, operator: User
) -> None:
    await _fund(session, operator, 10)
    item = await _item(session)

    with pytest.raises(InsufficientCoinsError) as exc:
        await shop_service.create_request(session, user=operator, item_id=item.id)
    assert exc.value.required == item.price
    assert exc.value.available == 10


async def test_reserved_coins_cannot_be_spent_twice(
    session: AsyncSession, operator: User
) -> None:
    await _fund(session, operator, 200)
    item = await _item(session)  # 120 коинов
    await shop_service.create_request(session, user=operator, item_id=item.id)
    await session.commit()

    with pytest.raises(InsufficientCoinsError):
        await shop_service.create_request(session, user=operator, item_id=item.id)


async def test_operator_can_cancel_own_request(
    session: AsyncSession, operator: User
) -> None:
    await _fund(session, operator, 200)
    item = await _item(session)
    request = await shop_service.create_request(session, user=operator, item_id=item.id)
    await session.commit()

    await shop_service.cancel_request(session, request=request, actor=operator)
    await session.commit()

    account = await coins_service.get_account(session, operator.id)
    assert request.status == ShopRequestStatus.CANCELLED
    assert account.reserved == 0
    assert account.balance == 200


async def test_processed_request_cannot_be_decided_again(
    session: AsyncSession, operator: User, supervisor: User
) -> None:
    await _fund(session, operator, 200)
    item = await _item(session)
    request = await shop_service.create_request(session, user=operator, item_id=item.id)
    await session.commit()
    await shop_service.approve_request(session, request=request, actor=supervisor)
    await session.commit()

    with pytest.raises(ConflictError):
        await shop_service.approve_request(session, request=request, actor=supervisor)


async def test_stock_limit_blocks_new_requests(
    session: AsyncSession, operator: User
) -> None:
    await _fund(session, operator, 500)
    item = await _item(session)
    item.stock_limit = 1
    await session.commit()

    await shop_service.create_request(session, user=operator, item_id=item.id)
    await session.commit()

    with pytest.raises(ConflictError, match="Лимит"):
        await shop_service.create_request(session, user=operator, item_id=item.id)


async def test_price_is_frozen_at_request_time(
    session: AsyncSession, operator: User, supervisor: User
) -> None:
    await _fund(session, operator, 500)
    item = await _item(session)
    original_price = item.price

    request = await shop_service.create_request(session, user=operator, item_id=item.id)
    await session.commit()

    item.price = original_price * 2
    await session.commit()

    await shop_service.approve_request(session, request=request, actor=supervisor)
    await session.commit()

    account = await coins_service.get_account(session, operator.id)
    assert request.price == original_price
    assert account.balance == 500 - original_price
