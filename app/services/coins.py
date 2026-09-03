"""
Работа с балансом коинов.

Единственный модуль, которому разрешено изменять ``coin_accounts`` и писать
в ``coin_transactions``. Любое изменение баланса проходит через
:func:`post_transaction`, поэтому журнал всегда сходится с агрегатами счёта.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import ConflictError, InsufficientCoinsError, NotFoundError
from app.models.coin import CoinTransaction
from app.models.enums import TX_GROUPS, TxType
from app.models.user import CoinAccount, User


@dataclass(slots=True)
class BalanceSnapshot:
    """Состояние счёта для показа в кабинете (п. 4.1.1)."""

    balance: int
    reserved: int
    available: int
    total_earned: int
    total_spent: int


async def get_account(session: AsyncSession, user_id: int, *, lock: bool = False) -> CoinAccount:
    """
    Возвращает счёт оператора, создавая его при первом обращении.

    ``lock=True`` берёт строку под ``SELECT ... FOR UPDATE`` на СУБД, где это
    поддерживается: без блокировки две одновременные заявки могли бы
    зарезервировать одни и те же коины дважды.
    """
    stmt = select(CoinAccount).where(CoinAccount.user_id == user_id)
    if lock and not settings.is_sqlite:
        stmt = stmt.with_for_update()

    account = await session.scalar(stmt)
    if account is None:
        exists = await session.scalar(select(User.id).where(User.id == user_id))
        if exists is None:
            raise NotFoundError(f"Пользователь id={user_id} не найден")
        account = CoinAccount(user_id=user_id, balance=0, reserved=0)
        session.add(account)
        await session.flush()
    return account


def snapshot(account: CoinAccount) -> BalanceSnapshot:
    return BalanceSnapshot(
        balance=account.balance,
        reserved=account.reserved,
        available=account.available,
        total_earned=account.total_earned,
        total_spent=account.total_spent,
    )


async def post_transaction(
    session: AsyncSession,
    *,
    user_id: int,
    amount: int,
    tx_type: TxType,
    reason: str,
    created_by_id: int | None = None,
    week_id: int | None = None,
    shop_request_id: int | None = None,
    idempotency_key: str | None = None,
    meta: dict[str, Any] | None = None,
    allow_negative_balance: bool = False,
) -> CoinTransaction | None:
    """
    Проводит операцию с коинами и записывает её в журнал.

    Возвращает ``None``, если операция с таким ``idempotency_key`` уже была
    проведена: повторный запуск еженедельного расчёта не должен начислять коины
    второй раз.

    :raises ConflictError: при нулевой сумме.
    :raises InsufficientCoinsError: если списание уводит баланс в минус.
    """
    if amount == 0:
        raise ConflictError("Нулевая операция не имеет смысла")

    if idempotency_key:
        already = await session.scalar(
            select(CoinTransaction.id).where(
                CoinTransaction.idempotency_key == idempotency_key
            )
        )
        if already is not None:
            return None

    account = await get_account(session, user_id, lock=True)

    if amount < 0 and not allow_negative_balance:
        # Списывать можно только свободные коины: зарезервированные под заявки
        # уже обещаны магазину.
        spendable = account.balance if tx_type == TxType.PURCHASE else account.available
        if spendable + amount < 0:
            raise InsufficientCoinsError(required=-amount, available=spendable)

    account.balance += amount
    if amount > 0:
        account.total_earned += amount
    else:
        account.total_spent += -amount

    transaction = CoinTransaction(
        user_id=user_id,
        amount=amount,
        tx_type=tx_type,
        reason=reason,
        balance_after=account.balance,
        created_by_id=created_by_id,
        week_id=week_id,
        shop_request_id=shop_request_id,
        idempotency_key=idempotency_key,
        meta=meta,
    )
    session.add(transaction)
    await session.flush()
    return transaction


async def reserve(session: AsyncSession, user_id: int, amount: int) -> CoinAccount:
    """
    Резервирует коины под заявку из магазина (шаг 9 п. 7).

    Резерв не меняет баланс: коины остаются на счёте, но недоступны к трате
    до решения супервайзера.
    """
    if amount <= 0:
        raise ConflictError("Сумма резерва должна быть положительной")

    account = await get_account(session, user_id, lock=True)
    if account.available < amount:
        raise InsufficientCoinsError(required=amount, available=account.available)

    account.reserved += amount
    await session.flush()
    return account


async def release_reserve(session: AsyncSession, user_id: int, amount: int) -> CoinAccount:
    """Снимает резерв без списания: заявка отклонена или отозвана."""
    account = await get_account(session, user_id, lock=True)
    account.reserved = max(0, account.reserved - amount)
    await session.flush()
    return account


async def commit_reserve(
    session: AsyncSession,
    *,
    user_id: int,
    amount: int,
    reason: str,
    shop_request_id: int,
    created_by_id: int | None,
) -> CoinTransaction:
    """
    Превращает резерв в фактическое списание: заявка одобрена (шаг 10 п. 7).

    Резерв снимается до проведения операции, иначе проверка доступного остатка
    вычла бы те же коины дважды.
    """
    account = await get_account(session, user_id, lock=True)
    account.reserved = max(0, account.reserved - amount)
    await session.flush()

    transaction = await post_transaction(
        session,
        user_id=user_id,
        amount=-amount,
        tx_type=TxType.PURCHASE,
        reason=reason,
        shop_request_id=shop_request_id,
        created_by_id=created_by_id,
    )
    assert transaction is not None  # без idempotency_key всегда создаётся запись
    return transaction


async def earned_between(
    session: AsyncSession, user_id: int, start: object, end: object
) -> int:
    """Сумма начислений за период (используется для блока «за текущую неделю»)."""
    total = await session.scalar(
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.user_id == user_id,
            CoinTransaction.amount > 0,
            CoinTransaction.created_at >= start,
            CoinTransaction.created_at < end,
        )
    )
    return int(total or 0)


def resolve_tx_types(group: str | None) -> tuple[TxType, ...] | None:
    """Раскрывает фильтр истории (`accrual` / `writeoff` / `purchase`) в типы операций."""
    if not group:
        return None
    return TX_GROUPS.get(group)
