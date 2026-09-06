"""
Операции супервайзера и руководителя: ручные начисления, сводка, выгрузки.

Соответствует п. 3.3, 4.4.1-4.4.3 ТЗ.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import ColumnElement, and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, DomainError, NotFoundError
from app.db.base import utcnow
from app.models.coin import CoinTransaction
from app.models.contest import ContestWeek, OperatorWeekResult
from app.models.enums import Role, ShopRequestStatus, TxType
from app.models.progress import Notification
from app.models.shop import ShopRequest
from app.models.user import CoinAccount, Group, User
from app.services import coins as coins_service
from app.services.locking import lock_user
from app.services.rules import get_rules, write_audit


@dataclass(slots=True)
class OperatorRow:
    """Строка административной таблицы операторов (п. 4.4.2)."""

    user_id: int
    full_name: str
    login: str
    group_name: str | None
    points: float
    rank: int | None
    coins_week: int
    balance: int
    reserved: int
    total_earned: int
    total_spent: int
    lateness: float
    forbidden_sites: float


@dataclass(slots=True)
class StaffSummary:
    """Сводная статистика админ-панели (п. 4.4.1)."""

    operators_total: int
    operators_active: int
    coins_awarded_this_week: int
    new_shop_requests: int
    average_rank: float | None
    week_label: str | None
    week_status: str | None


async def manual_transaction(
    session: AsyncSession,
    *,
    actor: User,
    target: User,
    amount: int,
    reason: str,
    tx_type: TxType | None = None,
    request_id: str | None = None,
) -> CoinTransaction:
    """
    Ручное начисление или списание коинов (п. 3.3).

    Комментарий обязателен, а сама операция и её автор попадают в неизменяемый
    журнал: запись нельзя отредактировать или удалить (п. 5 «Аудит»).
    """
    cleaned = (reason or "").strip()
    resolved_type = tx_type or (TxType.MANUAL_CREDIT if amount > 0 else TxType.MANUAL_DEBIT)
    key = f"manual:{actor.id}:{request_id}" if request_id else None
    if key:
        await lock_user(session, actor.id)
        previous = await session.scalar(
            select(CoinTransaction).where(CoinTransaction.idempotency_key == key)
        )
        if previous:
            if (previous.user_id, previous.amount, previous.reason, previous.tx_type) != (
                target.id,
                amount,
                cleaned,
                resolved_type,
            ):
                raise ConflictError("Этот запрос уже использован для другой операции")
            return previous
    rules = await get_rules(session)

    if target.role != Role.OPERATOR:
        raise DomainError("Коины начисляются только операторам")
    if amount == 0:
        raise DomainError("Количество коинов не может быть нулевым")
    if abs(amount) > rules.manual_max_abs_amount:
        raise DomainError(
            f"Разовая операция ограничена {rules.manual_max_abs_amount} коинами",
            code="amount_out_of_range",
        )

    if len(cleaned) < rules.manual_reason_min_length:
        raise DomainError(
            f"Комментарий обязателен и должен содержать не менее "
            f"{rules.manual_reason_min_length} символов",
            code="reason_required",
        )

    transaction = await coins_service.post_transaction(
        session,
        user_id=target.id,
        amount=amount,
        tx_type=resolved_type,
        reason=cleaned,
        created_by_id=actor.id,
        idempotency_key=key,
        meta={"actor_name": actor.full_name, "actor_role": str(actor.role)},
    )
    assert transaction is not None
    session.add(
        Notification(
            user_id=target.id,
            title="Начислены коины" if amount > 0 else "Списаны коины",
            body=f"{amount:+d} коинов · {cleaned}",
            kind="coins",
            link="/wallet",
        )
    )

    await write_audit(
        session,
        actor_id=actor.id,
        action="coins.manual",
        entity_type="user",
        entity_id=target.id,
        payload={"amount": amount, "tx_type": str(resolved_type)},
        comment=cleaned,
    )
    return transaction


async def gratitude(
    session: AsyncSession,
    *,
    actor: User,
    target: User,
    driver_ref: str | None,
    request_id: str | None = None,
) -> CoinTransaction:
    """Начисление за благодарность от водителя фиксированным бонусом (п. 3.2)."""
    rules = await get_rules(session)
    suffix = f" #{driver_ref}" if driver_ref else ""
    return await manual_transaction(
        session,
        actor=actor,
        target=target,
        amount=rules.driver_gratitude_bonus,
        reason=f"Благодарность от водителя{suffix}",
        tx_type=TxType.DRIVER_GRATITUDE,
        request_id=request_id,
    )


async def operators_table(
    session: AsyncSession,
    *,
    week: ContestWeek | None,
    visibility: ColumnElement[bool],
    group_id: int | None = None,
    search: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[OperatorRow], int]:
    """Список операторов с показателями недели и балансами."""
    conditions = [User.role == Role.OPERATOR, visibility]
    if group_id is not None:
        conditions.append(User.group_id == group_id)
    if search:
        conditions.append(User.full_name.ilike(f"%{search.strip()}%"))

    total = int(await session.scalar(select(func.count(User.id)).where(*conditions)) or 0)

    # Результат недели подтягивается левым соединением: оператор без выгруженных
    # показателей всё равно должен попасть в таблицу с нулями.
    result_join = and_(
        OperatorWeekResult.user_id == User.id,
        OperatorWeekResult.week_id == (week.id if week else -1),
    )
    stmt = (
        select(User, Group.name, CoinAccount, OperatorWeekResult)
        .outerjoin(Group, Group.id == User.group_id)
        .outerjoin(CoinAccount, CoinAccount.user_id == User.id)
        .outerjoin(OperatorWeekResult, result_join)
        .where(*conditions)
        .order_by(
            OperatorWeekResult.rank.is_(None),
            OperatorWeekResult.rank,
            User.full_name,
        )
        .offset(offset)
        .limit(limit)
    )

    rows = await session.execute(stmt)
    table: list[OperatorRow] = []
    for user, group_name, account, result in rows:
        table.append(
            OperatorRow(
                user_id=user.id,
                full_name=user.full_name,
                login=user.login,
                group_name=group_name,
                points=result.final_points if result else 0.0,
                rank=result.rank if result else None,
                coins_week=result.coins_total if result else 0,
                balance=account.balance if account else 0,
                reserved=account.reserved if account else 0,
                total_earned=account.total_earned if account else 0,
                total_spent=account.total_spent if account else 0,
                lateness=result.lateness_count if result else 0.0,
                forbidden_sites=result.forbidden_sites_count if result else 0.0,
            )
        )
    return table, total


async def summary(
    session: AsyncSession, *, week: ContestWeek | None, visibility: ColumnElement[bool]
) -> StaffSummary:
    """Сводка для верхнего блока админ-панели."""
    operators_total = int(
        await session.scalar(
            select(func.count(User.id)).where(User.role == Role.OPERATOR, visibility)
        )
        or 0
    )
    operators_active = int(
        await session.scalar(
            select(func.count(User.id)).where(
                User.role == Role.OPERATOR, User.is_active.is_(True), visibility
            )
        )
        or 0
    )

    week_start = utcnow() - timedelta(days=7)
    coins_week = int(
        await session.scalar(
            select(func.coalesce(func.sum(CoinTransaction.amount), 0))
            .join(User, User.id == CoinTransaction.user_id)
            .where(
                CoinTransaction.amount > 0,
                CoinTransaction.created_at >= week_start,
                visibility,
            )
        )
        or 0
    )

    new_requests = int(
        await session.scalar(
            select(func.count(ShopRequest.id))
            .join(User, User.id == ShopRequest.user_id)
            .where(ShopRequest.status == ShopRequestStatus.NEW, visibility)
        )
        or 0
    )

    average_rank = None
    if week is not None:
        average_rank = await session.scalar(
            select(func.avg(OperatorWeekResult.rank))
            .join(User, User.id == OperatorWeekResult.user_id)
            .where(
                OperatorWeekResult.week_id == week.id,
                OperatorWeekResult.rank.is_not(None),
                visibility,
            )
        )

    return StaffSummary(
        operators_total=operators_total,
        operators_active=operators_active,
        coins_awarded_this_week=coins_week,
        new_shop_requests=new_requests,
        average_rank=round(float(average_rank), 2) if average_rank is not None else None,
        week_label=week.label if week else None,
        week_status=str(week.status) if week else None,
    )


def operators_csv(rows: list[OperatorRow], week_label: str | None) -> str:
    """
    Выгрузка таблицы операторов в CSV (п. 4.4.2).

    Разделитель - точка с запятой: так Excel с русской локалью открывает файл
    сразу по колонкам.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    writer.writerow(
        [
            "Неделя",
            "ФИО",
            "Логин",
            "Группа",
            "Место",
            "Баллы",
            "Коины за неделю",
            "Баланс",
            "В резерве",
            "Всего начислено",
            "Всего потрачено",
            "Опоздания",
            "Посторонние сайты",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                week_label or "",
                row.full_name,
                row.login,
                row.group_name or "",
                row.rank if row.rank is not None else "",
                f"{row.points:g}",
                row.coins_week,
                row.balance,
                row.reserved,
                row.total_earned,
                row.total_spent,
                f"{row.lateness:g}",
                f"{row.forbidden_sites:g}",
            ]
        )
    return buffer.getvalue()


async def get_operator(session: AsyncSession, user_id: int) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFoundError(f"Пользователь id={user_id} не найден")
    return user
