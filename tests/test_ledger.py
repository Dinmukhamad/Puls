"""Неизменяемость журнала операций и согласованность счёта (п. 5 «История», «Аудит»)."""
from __future__ import annotations

import pytest
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import DatabaseError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, InsufficientCoinsError
from app.models.coin import CoinTransaction
from app.models.enums import TxType
from app.models.settings import AuditLog
from app.models.user import User
from app.services import coins as coins_service
from app.services import staff as staff_service


async def _credit(session: AsyncSession, user: User, amount: int) -> CoinTransaction:
    tx = await coins_service.post_transaction(
        session,
        user_id=user.id,
        amount=amount,
        tx_type=TxType.MANUAL_CREDIT,
        reason="Тестовое начисление",
    )
    await session.commit()
    return tx


async def test_balance_after_matches_running_total(
    session: AsyncSession, operator: User
) -> None:
    await _credit(session, operator, 10)
    await _credit(session, operator, 25)
    await coins_service.post_transaction(
        session,
        user_id=operator.id,
        amount=-5,
        tx_type=TxType.MANUAL_DEBIT,
        reason="Тестовое списание",
    )
    await session.commit()

    rows = list(
        await session.scalars(
            select(CoinTransaction)
            .where(CoinTransaction.user_id == operator.id)
            .order_by(CoinTransaction.id)
        )
    )
    assert [row.balance_after for row in rows] == [10, 35, 30]

    account = await coins_service.get_account(session, operator.id)
    ledger_sum = await session.scalar(
        select(func.sum(CoinTransaction.amount)).where(
            CoinTransaction.user_id == operator.id
        )
    )
    assert account.balance == ledger_sum == 30
    assert account.total_earned == 35
    assert account.total_spent == 5


async def test_transaction_cannot_be_updated(
    session: AsyncSession, operator: User
) -> None:
    tx = await _credit(session, operator, 10)
    with pytest.raises(DatabaseError):
        await session.execute(
            update(CoinTransaction).where(CoinTransaction.id == tx.id).values(amount=999)
        )
        await session.commit()
    await session.rollback()


async def test_transaction_cannot_be_deleted(
    session: AsyncSession, operator: User
) -> None:
    tx = await _credit(session, operator, 10)
    with pytest.raises(DatabaseError):
        await session.execute(delete(CoinTransaction).where(CoinTransaction.id == tx.id))
        await session.commit()
    await session.rollback()


async def test_audit_log_cannot_be_deleted(
    session: AsyncSession, operator: User, supervisor: User
) -> None:
    await staff_service.manual_transaction(
        session,
        actor=supervisor,
        target=operator,
        amount=7,
        reason="Помощь новому сотруднику",
    )
    await session.commit()

    entry = await session.scalar(select(AuditLog).where(AuditLog.action == "coins.manual"))
    assert entry is not None
    assert entry.actor_id == supervisor.id

    with pytest.raises(DatabaseError):
        await session.execute(delete(AuditLog).where(AuditLog.id == entry.id))
        await session.commit()
    await session.rollback()


async def test_idempotency_key_prevents_duplicate_accrual(
    session: AsyncSession, operator: User
) -> None:
    first = await coins_service.post_transaction(
        session,
        user_id=operator.id,
        amount=10,
        tx_type=TxType.WEEKLY_POINTS,
        reason="Итог недели",
        idempotency_key="week:1:user:1:points",
    )
    second = await coins_service.post_transaction(
        session,
        user_id=operator.id,
        amount=10,
        tx_type=TxType.WEEKLY_POINTS,
        reason="Итог недели",
        idempotency_key="week:1:user:1:points",
    )
    await session.commit()

    assert first is not None
    assert second is None
    account = await coins_service.get_account(session, operator.id)
    assert account.balance == 10


async def test_zero_amount_is_rejected(session: AsyncSession, operator: User) -> None:
    with pytest.raises(ConflictError):
        await coins_service.post_transaction(
            session,
            user_id=operator.id,
            amount=0,
            tx_type=TxType.MANUAL_CREDIT,
            reason="Пустая операция",
        )


async def test_debit_below_zero_is_rejected(
    session: AsyncSession, operator: User
) -> None:
    await _credit(session, operator, 5)
    with pytest.raises(InsufficientCoinsError):
        await coins_service.post_transaction(
            session,
            user_id=operator.id,
            amount=-6,
            tx_type=TxType.MANUAL_DEBIT,
            reason="Списание сверх баланса",
        )


async def test_manual_operation_records_author(
    session: AsyncSession, operator: User, supervisor: User
) -> None:
    tx = await staff_service.manual_transaction(
        session,
        actor=supervisor,
        target=operator,
        amount=3,
        reason="Благодарность от водителя #1247",
    )
    await session.commit()

    assert tx.created_by_id == supervisor.id
    assert tx.is_manual is True
    assert tx.meta["actor_name"] == supervisor.full_name


async def test_gratitude_uses_configured_bonus(
    session: AsyncSession, operator: User, supervisor: User
) -> None:
    tx = await staff_service.gratitude(
        session, actor=supervisor, target=operator, driver_ref="1247"
    )
    await session.commit()

    assert tx.amount == 3
    assert tx.tx_type == TxType.DRIVER_GRATITUDE
    assert "1247" in tx.reason
