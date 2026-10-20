"""The coin economy's monthly rules: fines with carry-over, limits, the shop budget and the report.

The plan (docs/COIN_ECONOMY.md): an average operator earns about 1000 coins a month; the city burns
most of them at its monthly season reset, the shop the part that costs the company money (by the
rate in tenge, within the month's budget), paid spins and raffle tickets a little more. Months are
calendar months in the company's time zone (settings.TIMEZONE).
"""

from __future__ import annotations

import statistics
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import DomainError
from app.models.coin import CoinTransaction
from app.models.enums import Role, ShopRequestStatus, TxType
from app.models.progress import Notification
from app.models.shop import ShopItem, ShopRequest
from app.models.user import CoinAccount, User
from app.services import coins as coins_service
from app.services.rules import get_rules

#: Shop requests that hold or spent their item: they count against the month's stock and budget.
SHOP_TAKEN = (ShopRequestStatus.NEW, ShopRequestStatus.APPROVED, ShopRequestStatus.FULFILLED)

#: How the report groups the journal: what issues coins and what burns them.
ISSUED = {
    "results": (TxType.WEEKLY_POINTS, TxType.NO_LATENESS_BONUS, TxType.NO_SITES_BONUS),
    "contest": (TxType.RANK_BONUS, TxType.NOMINATION_BONUS),
    "gratitude": (TxType.DRIVER_GRATITUDE,),
    "learning": (TxType.LEARNING_REWARD, TxType.ACHIEVEMENT_REWARD),
    "games": (TxType.GAME_REWARD,),
    "manual": (TxType.MANUAL_CREDIT,),
}
BURNED = {
    "city": (TxType.CITY_BUILD, TxType.CITY_CONTRIBUTION),
    "shop": (TxType.PURCHASE,),
    "games": (TxType.GAME_STAKE,),
    "fines": (TxType.FINE,),
    "manual": (TxType.MANUAL_DEBIT,),
}


def zone() -> ZoneInfo:
    return ZoneInfo(get_settings().TIMEZONE)


def local_today(now: datetime | None = None) -> date:
    """Today where the contact centre works (settings.TIMEZONE), not on the server's clock."""
    return (now or datetime.now(UTC)).astimezone(zone()).date()


def this_month(now: datetime | None = None) -> tuple[int, int]:
    local = (now or datetime.now(UTC)).astimezone(zone())
    return local.year, local.month


def month_range(year: int, month: int) -> tuple[datetime, datetime]:
    """The month's start and the next month's start, as UTC moments."""
    start = datetime(year, month, 1, tzinfo=zone())
    end = datetime(year + month // 12, month % 12 + 1, 1, tzinfo=zone())
    return start.astimezone(UTC), end.astimezone(UTC)


def week_month(starts_on: date) -> tuple[int, int]:
    """The month a contest week belongs to: its Thursday's, so each week is in exactly one."""
    thursday = starts_on + timedelta(days=3)
    return thursday.year, thursday.month


def is_last_week_of_month(starts_on: date) -> bool:
    return week_month(starts_on + timedelta(days=7)) != week_month(starts_on)


async def _month_sum(session: AsyncSession, *conditions) -> int:
    start, end = month_range(*this_month())
    total = await session.scalar(
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.created_at >= start, CoinTransaction.created_at < end, *conditions
        )
    )
    return int(total or 0)


# --------------------------------------------------------------------------- #
# Limits
# --------------------------------------------------------------------------- #


async def check_manual_limit(session: AsyncSession, actor: User, amount: int) -> None:
    """A supervisor credits at most `manual_monthly_limit` coins a month to all operators together.

    Heads and administrators are not limited: their operations are rare and audited.
    """
    if amount <= 0 or actor.role != Role.SUPERVISOR:
        return
    rules = await get_rules(session)
    limit = rules.manual_monthly_limit
    if not limit:
        return
    given = await _month_sum(
        session,
        CoinTransaction.created_by_id == actor.id,
        CoinTransaction.tx_type == TxType.MANUAL_CREDIT,
    )
    if given + amount > limit:
        raise DomainError(
            f"Лимит ручных начислений супервайзера — {limit} коинов в месяц: "
            f"уже начислено {given}, осталось {max(0, limit - given)}",
            code="manual_monthly_limit",
        )


async def check_gratitude_limit(session: AsyncSession, target_id: int) -> None:
    rules = await get_rules(session)
    limit = rules.gratitude_monthly_limit
    if not limit:
        return
    start, end = month_range(*this_month())
    count = await session.scalar(
        select(func.count(CoinTransaction.id)).where(
            CoinTransaction.user_id == target_id,
            CoinTransaction.tx_type == TxType.DRIVER_GRATITUDE,
            CoinTransaction.created_at >= start,
            CoinTransaction.created_at < end,
        )
    )
    if int(count or 0) >= limit:
        raise DomainError(
            f"За месяц оплачивается не больше {limit} благодарностей водителей одному оператору",
            code="gratitude_monthly_limit",
        )


# --------------------------------------------------------------------------- #
# Fines
# --------------------------------------------------------------------------- #


async def collect_fine(
    session: AsyncSession,
    *,
    user_id: int,
    amount: int,
    reason: str,
    key: str,
    week_id: int | None = None,
    actor_id: int | None = None,
) -> int:
    """Debits a fine together with what is left of earlier ones; returns the coins debited.

    The operator never goes below zero: what the free coins do not cover waits in `fine_debt`
    for the next closing. Repeating the same key does nothing.
    """
    # A week closes in one transaction, so a fine is either collected with its week or not at all.
    already = await session.scalar(
        select(CoinTransaction.id).where(CoinTransaction.idempotency_key == key)
    )
    if already is not None:
        return 0
    account = await coins_service.get_account(session, user_id, lock=True)
    due = max(0, amount) + account.fine_debt
    if due <= 0:
        return 0
    taken = min(due, max(0, account.available))
    account.fine_debt = due - taken
    if taken:
        carried = f" Остаток {account.fine_debt} спишется при следующем закрытии недели." \
            if account.fine_debt else ""
        await coins_service.post_transaction(
            session,
            user_id=user_id,
            amount=-taken,
            tx_type=TxType.FINE,
            reason=reason + carried,
            week_id=week_id,
            created_by_id=actor_id,
            idempotency_key=key,
            meta={"due": due, "carried": account.fine_debt},
            evaluate_achievements=False,
        )
        # Operators see no ledger in their wallet: the fine reaches them as a notification.
        session.add(Notification(
            user_id=user_id, title="Штраф", body=f"−{taken} коинов · {reason + carried}",
            kind="coins", link="/wallet",
        ))
    await session.flush()
    return taken


# --------------------------------------------------------------------------- #
# Shop: the month's stock and budget
# --------------------------------------------------------------------------- #


def _month_requests(*conditions):
    start, end = month_range(*this_month())
    return (
        ShopRequest.created_at >= start,
        ShopRequest.created_at < end,
        ShopRequest.status.in_(SHOP_TAKEN),
        *conditions,
    )


async def month_stock_left(session: AsyncSession, item: ShopItem) -> int | None:
    if item.monthly_stock is None:
        return None
    taken = await session.scalar(
        select(func.count(ShopRequest.id)).where(
            *_month_requests(ShopRequest.item_id == item.id)
        )
    )
    return max(0, item.monthly_stock - int(taken or 0))


async def budget_spent(session: AsyncSession) -> int:
    """Tenge of the month's shop requests, by the items' cost to the company."""
    total = await session.scalar(
        select(func.coalesce(func.sum(ShopItem.cost_tenge), 0))
        .select_from(ShopRequest)
        .join(ShopItem, ShopItem.id == ShopRequest.item_id)
        .where(*_month_requests())
    )
    return int(total or 0)


async def shop_block(session: AsyncSession, item: ShopItem) -> str | None:
    """Why the item cannot be requested this month, or None."""
    left = await month_stock_left(session, item)
    if left is not None and left <= 0:
        return "В этом месяце этот бонус закончился. Новые появятся 1-го числа"
    rules = await get_rules(session)
    budget = rules.shop_monthly_budget_tenge
    if budget and item.cost_tenge and await budget_spent(session) + item.cost_tenge > budget:
        return "Бюджет магазина на этот месяц исчерпан. Новый — с 1-го числа"
    return None


# --------------------------------------------------------------------------- #
# The month's report
# --------------------------------------------------------------------------- #


async def report(session: AsyncSession, year: int, month: int) -> dict:
    """Coins issued and burned over a month, the shop's tenge and how much operators hold.

    Balance in months of income = the median balance / the average income of an operator who
    earned anything that month. Above 1.5 coins pile up (inflation), below 0.3 they are short.
    """
    start, end = month_range(year, month)
    rows = (await session.execute(
        select(CoinTransaction.tx_type, func.sum(CoinTransaction.amount))
        .join(User, User.id == CoinTransaction.user_id)
        .where(
            CoinTransaction.created_at >= start,
            CoinTransaction.created_at < end,
            User.role == Role.OPERATOR,
        )
        .group_by(CoinTransaction.tx_type)
    )).all()
    by_type = {str(t): int(v or 0) for t, v in rows}
    refunds = by_type.get(TxType.PURCHASE_REFUND, 0)
    issued = {k: sum(by_type.get(t, 0) for t in types) for k, types in ISSUED.items()}
    burned = {k: -sum(by_type.get(t, 0) for t in types) for k, types in BURNED.items()}
    # Refunds return coins taken by the shop or the city: they are not new coins.
    burned["shop"] = max(0, burned["shop"] - refunds)
    corrections = by_type.get(TxType.CORRECTION, 0)
    total_issued = sum(issued.values()) + max(0, corrections)
    total_burned = sum(burned.values()) + max(0, -corrections)

    earners = (await session.execute(
        select(CoinTransaction.user_id, func.sum(CoinTransaction.amount))
        .join(User, User.id == CoinTransaction.user_id)
        .where(
            CoinTransaction.created_at >= start,
            CoinTransaction.created_at < end,
            CoinTransaction.amount > 0,
            CoinTransaction.tx_type != TxType.PURCHASE_REFUND,
            User.role == Role.OPERATOR,
        )
        .group_by(CoinTransaction.user_id)
    )).all()
    incomes = [int(v) for _, v in earners if v]
    balances = [int(b) for b in await session.scalars(
        select(CoinAccount.balance)
        .join(User, User.id == CoinAccount.user_id)
        .where(User.role == Role.OPERATOR, User.is_active.is_(True))
    )]
    operators = len(balances)
    average_income = round(sum(incomes) / len(incomes)) if incomes else 0
    median_balance = round(statistics.median(balances)) if balances else 0
    months_held = round(median_balance / average_income, 2) if average_income else None
    signal = (
        "inflation" if months_held is not None and months_held > 1.5
        else "shortage" if months_held is not None and months_held < 0.3
        else "balanced" if months_held is not None
        else "no_data"
    )

    rules = await get_rules(session)
    tenge = await session.scalar(
        select(func.coalesce(func.sum(ShopItem.cost_tenge), 0))
        .select_from(ShopRequest)
        .join(ShopItem, ShopItem.id == ShopRequest.item_id)
        .where(
            ShopRequest.created_at >= start,
            ShopRequest.created_at < end,
            ShopRequest.status.in_(SHOP_TAKEN),
        )
    )
    debts = await session.scalar(select(func.coalesce(func.sum(CoinAccount.fine_debt), 0)))
    return {
        "year": year,
        "month": month,
        "operators": operators,
        "earners": len(incomes),
        "issued": issued,
        "burned": burned,
        "corrections": corrections,
        "total_issued": total_issued,
        "total_burned": total_burned,
        "net": total_issued - total_burned,
        "average_income": average_income,
        "median_balance": median_balance,
        "months_held": months_held,
        "signal": signal,
        "shop_tenge": int(tenge or 0),
        "shop_budget_tenge": rules.shop_monthly_budget_tenge,
        "coin_rate_tenge": rules.coin_rate_tenge,
        "fine_debt": int(debts or 0),
    }
