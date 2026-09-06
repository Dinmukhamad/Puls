from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from sqlalchemy import case, func, select

from app.core.deps import CurrentUser, PaginationDep, SessionDep, StaffUser, visible_users_filter
from app.core.errors import DomainError, PermissionDeniedError
from app.models.coin import CoinTransaction
from app.models.enums import Role, TxType
from app.models.user import CoinAccount, User
from app.schemas.common import Page
from app.schemas.wallet import WalletReport, WalletSummary, WalletTransaction

router = APIRouter(tags=["Кошелёк"])
HistoryKind = Literal["accrual", "writeoff", "refund", "purchase"]


async def report(session, visibility, pagination, date_from, date_to, kind, user_id=None):
    if date_from and date_to and date_from > date_to:
        raise DomainError("Начало периода не может быть позже окончания")
    if date_to == date.max:
        raise DomainError("Выберите дату окончания до 31 декабря 9999 года")
    users = [visibility]
    if user_id is not None:
        if await session.scalar(select(User.id).where(visibility, User.id == user_id)) is None:
            raise PermissionDeniedError("Кошелёк сотрудника недоступен")
        users.append(User.id == user_id)
    account = (
        await session.execute(
            select(
                func.coalesce(func.sum(CoinAccount.balance), 0),
                func.coalesce(func.sum(CoinAccount.reserved), 0),
                func.count(CoinAccount.user_id),
            )
            .join(User, User.id == CoinAccount.user_id)
            .where(*users)
        )
    ).one()
    conditions = list(users)
    if date_from:
        conditions.append(CoinTransaction.created_at >= datetime.combine(date_from, time.min, UTC))
    if date_to:
        conditions.append(
            CoinTransaction.created_at
            < datetime.combine(date_to + timedelta(days=1), time.min, UTC)
        )
    aggregate = (
        await session.execute(
            select(
                func.coalesce(
                    func.sum(
                        case(
                            (
                                (CoinTransaction.amount > 0)
                                & (CoinTransaction.tx_type != TxType.PURCHASE_REFUND),
                                CoinTransaction.amount,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ),
                func.coalesce(
                    func.sum(case((CoinTransaction.amount < 0, -CoinTransaction.amount), else_=0)),
                    0,
                ),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                CoinTransaction.tx_type == TxType.PURCHASE_REFUND,
                                CoinTransaction.amount,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ),
            )
            .join(User, User.id == CoinTransaction.user_id)
            .where(*conditions)
        )
    ).one()
    # KPI describe the whole selected interval; the type filter applies to the ledger.
    if kind == "accrual":
        conditions.extend(
            [CoinTransaction.amount > 0, CoinTransaction.tx_type != TxType.PURCHASE_REFUND]
        )
    elif kind == "writeoff":
        conditions.append(CoinTransaction.amount < 0)
    elif kind == "refund":
        conditions.append(CoinTransaction.tx_type == TxType.PURCHASE_REFUND)
    elif kind == "purchase":
        conditions.append(CoinTransaction.tx_type == TxType.PURCHASE)
    total = int(
        await session.scalar(
            select(func.count(CoinTransaction.id))
            .join(User, User.id == CoinTransaction.user_id)
            .where(*conditions)
        )
        or 0
    )
    author = User.__table__.alias("wallet_author")
    rows = await session.execute(
        select(CoinTransaction, User.full_name, author.c.full_name)
        .join(User, User.id == CoinTransaction.user_id)
        .outerjoin(author, author.c.id == CoinTransaction.created_by_id)
        .where(*conditions)
        .order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc())
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    items = []
    for transaction, name, author_name in rows:
        item = WalletTransaction(
            **{
                key: getattr(transaction, key)
                for key in (
                    "id",
                    "user_id",
                    "amount",
                    "tx_type",
                    "reason",
                    "balance_after",
                    "created_at",
                    "week_id",
                    "shop_request_id",
                )
            },
            full_name=name,
            author_name=author_name,
        )
        items.append(item)
    return WalletReport(
        summary=WalletSummary(
            balance=account[0],
            reserved=account[1],
            available=account[0] - account[1],
            accounts=account[2],
            awarded=aggregate[0],
            spent=aggregate[1],
            refunded=aggregate[2],
        ),
        history=Page.build(items, total, pagination.page, pagination.size),
    )


@router.get("/me/wallet", response_model=WalletReport)
async def mine(
    session: SessionDep,
    user: CurrentUser,
    pagination: PaginationDep,
    date_from: date | None = None,
    date_to: date | None = None,
    kind: HistoryKind | None = None,
):
    return await report(session, User.id == user.id, pagination, date_from, date_to, kind)


@router.get("/admin/wallet", response_model=WalletReport)
async def team(
    session: SessionDep,
    actor: StaffUser,
    pagination: PaginationDep,
    date_from: date | None = None,
    date_to: date | None = None,
    kind: HistoryKind | None = None,
    user_id: Annotated[int | None, Query(gt=0)] = None,
):
    visibility = (await visible_users_filter(session, actor)) & (User.role == Role.OPERATOR)
    return await report(session, visibility, pagination, date_from, date_to, kind, user_id)
