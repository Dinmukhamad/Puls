from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from sqlalchemy import case, func, or_, select

from app.core.deps import (
    CurrentUser,
    PaginationDep,
    SessionDep,
    StaffUser,
    managed_operators_filter,
)
from app.core.errors import DomainError, PermissionDeniedError
from app.models.coin import CoinTransaction
from app.models.enums import TX_GROUPS, Role, TxType
from app.models.user import CoinAccount, Group, User
from app.schemas.common import Page
from app.schemas.wallet import (
    WalletGroup,
    WalletOperator,
    WalletReport,
    WalletSummary,
    WalletTransaction,
)

router = APIRouter(tags=["Кошелёк"])
HistoryKind = Literal["accrual", "writeoff", "refund", "purchase"]


async def wallet_operators_filter(session, actor):
    # Explicit section grants may open this read view to an operator, whose
    # financial data remains personal. Supervisors see only their own teams.
    if actor.role == Role.OPERATOR:
        return User.id == actor.id
    return await managed_operators_filter(session, actor)


async def report(session, viewer, visibility, pagination, date_from, date_to, kind, user_id=None):
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
                func.coalesce(func.sum(CoinAccount.total_earned), 0),
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
        conditions.append(CoinTransaction.tx_type.in_(TX_GROUPS["purchase"]))
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
        select(CoinTransaction, User.full_name, author.c.full_name, author.c.role)
        .join(User, User.id == CoinTransaction.user_id)
        .outerjoin(
            author,
            author.c.id == CoinTransaction.created_by_id,
        )
        .where(*conditions)
        .order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc())
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    items = []
    for transaction, name, author_name, author_role in rows:
        # Ledger attribution is part of the recipient's financial history; only
        # the author's name/role are exposed, never their profile. Manual entries
        # carry a snapshot that survives a rename or deletion of the author.
        meta = transaction.meta or {}
        recorded_name = meta.get("actor_name") or author_name
        recorded_role = meta.get("actor_role") or author_role
        is_staff_entry = (
            transaction.created_by_id is not None
            or recorded_name is not None
            or transaction.tx_type
            in (TxType.MANUAL_CREDIT, TxType.MANUAL_DEBIT, TxType.DRIVER_GRATITUDE)
        )
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
            author_name=recorded_name,
            author_role=recorded_role,
            is_system=not is_staff_entry,
        )
        items.append(item)
    return WalletReport(
        summary=WalletSummary(
            balance=account[0],
            reserved=account[1],
            available=account[0] - account[1],
            accounts=account[2],
            earned_total=account[3],
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
    return await report(session, user, User.id == user.id, pagination, date_from, date_to, kind)


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
    visibility = await wallet_operators_filter(session, actor)
    return await report(session, actor, visibility, pagination, date_from, date_to, kind, user_id)


@router.get("/admin/wallet/operators", response_model=Page[WalletOperator])
async def operators(
    session: SessionDep,
    actor: StaffUser,
    pagination: PaginationDep,
    search: Annotated[str | None, Query(max_length=150)] = None,
    user_id: Annotated[int | None, Query(gt=0)] = None,
):
    conditions = [await wallet_operators_filter(session, actor)]
    if user_id is not None:
        conditions.append(User.id == user_id)
    if search and (term := search.strip()):
        # Treat SQL wildcard characters as literal search text.
        conditions.append(
            or_(
                User.full_name.icontains(term, autoescape=True),
                User.login.icontains(term, autoescape=True),
            )
        )
    total = int(await session.scalar(select(func.count(User.id)).where(*conditions)) or 0)
    balance = func.coalesce(CoinAccount.balance, 0)
    reserved = func.coalesce(CoinAccount.reserved, 0)
    rows = await session.execute(
        select(
            User.id.label("user_id"),
            User.full_name,
            Group.name.label("group_name"),
            User.is_active,
            balance.label("balance"),
            reserved.label("reserved"),
            (balance - reserved).label("available"),
        )
        .outerjoin(CoinAccount, CoinAccount.user_id == User.id)
        .outerjoin(Group, Group.id == User.group_id)
        .where(*conditions)
        .order_by(User.full_name, User.id)
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    return Page.build(
        [WalletOperator(**row) for row in rows.mappings()],
        total,
        pagination.page,
        pagination.size,
    )


@router.get("/admin/wallet/groups", response_model=list[WalletGroup])
async def groups(session: SessionDep, actor: StaffUser):
    visibility = await wallet_operators_filter(session, actor)
    conditions = []
    if actor.role == Role.SUPERVISOR:
        conditions.append(Group.supervisor_id == actor.id)
    elif actor.role not in (Role.HEAD, Role.ADMIN):
        return []
    rows = await session.execute(
        select(
            Group.id.label("group_id"),
            Group.name,
            func.count(User.id).label("operators_count"),
        )
        .outerjoin(User, (User.group_id == Group.id) & visibility)
        .where(*conditions)
        .group_by(Group.id, Group.name)
        .order_by(Group.name, Group.id)
    )
    return [WalletGroup(**row) for row in rows.mappings()]
