"""Scoped, atomic manual coin operations with a confirmed recipient snapshot."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta

import jwt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import ensure_can_manage, managed_operators_filter
from app.core.errors import ConflictError, DomainError, NotFoundError, PermissionDeniedError
from app.models.coin import CoinTransaction
from app.models.enums import Role
from app.models.user import CoinAccount, Group, User
from app.schemas.admin import (
    ManualCoinsBulkIn,
    ManualCoinsPreviewIn,
    ManualCoinsPreviewOut,
    ManualCoinsRecipientOut,
    ManualCoinsSelection,
)
from app.services.locking import lock_user
from app.services.rules import get_rules
from app.services.staff import manual_transaction

_PREVIEW_TYPE = "manual_coins_preview"


def _digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _selection(payload: ManualCoinsSelection) -> dict:
    return {
        "user_ids": sorted(set(payload.user_ids)),
        "group_ids": sorted(set(payload.group_ids)),
        "all_operators": payload.all_operators,
    }


async def _validate_amount(session: AsyncSession, amount: int) -> None:
    rules = await get_rules(session)
    maximum = min(rules.manual_max_abs_amount, 9999)
    if not amount or abs(amount) > maximum:
        raise DomainError(
            f"Разовая операция ограничена {maximum} коинами",
            code="amount_out_of_range",
        )


async def _recipients(
    session: AsyncSession, actor: User, payload: ManualCoinsSelection
) -> list[User]:
    if not actor.is_active or actor.role not in (Role.SUPERVISOR, Role.HEAD, Role.ADMIN):
        raise PermissionDeniedError("Недостаточно прав для этой операции")
    selection = _selection(payload)
    visibility = await managed_operators_filter(session, actor)
    conditions = [visibility]
    if selection["group_ids"]:
        group_ids = selection["group_ids"]
        groups = list(await session.scalars(select(Group).where(Group.id.in_(group_ids))))
        if len(groups) != len(group_ids):
            raise NotFoundError("Одна из выбранных групп не найдена")
        if actor.role == Role.SUPERVISOR and any(
            group.supervisor_id != actor.id for group in groups
        ):
            raise PermissionDeniedError("Можно выбрать только свои группы операторов")
        conditions.append(User.group_id.in_(group_ids))
    if selection["user_ids"]:
        conditions.append(User.id.in_(selection["user_ids"]))
    users = list(
        await session.scalars(
            select(User)
            .where(*conditions)
            .order_by(User.id)
            .execution_options(populate_existing=True)
        )
    )
    if selection["user_ids"] and len(users) != len(selection["user_ids"]):
        # Never silently drop a nonexistent, wrong-role, or foreign operator.
        raise PermissionDeniedError("Один из выбранных операторов недоступен")
    return users


def _preview_token(
    actor: User, payload: ManualCoinsPreviewIn, user_ids: list[int], now: datetime
) -> str:
    return jwt.encode(
        {
            "type": _PREVIEW_TYPE,
            "sub": str(actor.id),
            "selection": _digest(_selection(payload)),
            "amount": payload.amount,
            "user_ids": user_ids,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=10)).timestamp()),
        },
        settings.SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def _preview_ids(actor: User, payload: ManualCoinsBulkIn, *, allow_expired: bool) -> list[int]:
    try:
        data = jwt.decode(
            payload.selection_token,
            settings.SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
            options={"verify_exp": not allow_expired},
        )
        user_ids = data.get("user_ids")
        if (
            data.get("type") != _PREVIEW_TYPE
            or data.get("sub") != str(actor.id)
            or data.get("selection") != _digest(_selection(payload))
            or data.get("amount") != payload.amount
            or not isinstance(user_ids, list)
            or any(type(user_id) is not int or user_id <= 0 for user_id in user_ids)
            or user_ids != sorted(set(user_ids))
        ):
            raise jwt.InvalidTokenError("Invalid coin selection")
        return user_ids
    except jwt.PyJWTError as exc:
        raise ConflictError(
            "Выбор операторов устарел. Проверьте операцию ещё раз.",
            code="selection_changed",
        ) from exc


async def preview(
    session: AsyncSession, *, actor: User, payload: ManualCoinsPreviewIn
) -> ManualCoinsPreviewOut:
    await _validate_amount(session, payload.amount)
    recipients = await _recipients(session, actor, payload)
    user_ids = [user.id for user in recipients]
    balance = func.coalesce(CoinAccount.balance, 0)
    reserved = func.coalesce(CoinAccount.reserved, 0)
    rows = (
        await session.execute(
            select(balance, reserved)
            .select_from(User)
            .outerjoin(CoinAccount, CoinAccount.user_id == User.id)
            .where(User.id.in_(user_ids))
        )
    ).all()
    insufficient = sum(
        1 for balance_value, reserve_value in rows
        if payload.amount < 0 and balance_value - reserve_value < -payload.amount
    )
    balances = sum(row[0] for row in rows)
    reserves = sum(row[1] for row in rows)
    count = len(user_ids)
    now = datetime.now(UTC)
    return ManualCoinsPreviewOut(
        count=count,
        eligible_count=count - insufficient,
        insufficient_count=insufficient,
        balance=balances,
        reserved=reserves,
        available=balances - reserves,
        min_available=min((row[0] - row[1] for row in rows), default=None),
        amount=payload.amount,
        total_amount=payload.amount * count,
        can_submit=count > 0 and insufficient == 0,
        selection_token=_preview_token(actor, payload, user_ids, now),
        recipients=[
            ManualCoinsRecipientOut(user_id=user.id, full_name=user.full_name)
            for user in recipients
        ],
        expires_at=datetime.fromtimestamp(
            int((now + timedelta(minutes=10)).timestamp()), UTC
        ),
    )


async def apply(
    session: AsyncSession, *, actor: User, payload: ManualCoinsBulkIn
) -> list[CoinTransaction]:
    """Caller commits once; any failure rolls back every recipient and audit entry."""
    if actor.role not in (Role.SUPERVISOR, Role.HEAD, Role.ADMIN):
        raise PermissionDeniedError("Недостаточно прав для этой операции")
    # Staff are never recipients, so actor -> ascending operator IDs cannot cycle.
    # SQLite's first write also serializes competing batches before their reads.
    await lock_user(session, actor.id)
    await session.refresh(actor)
    if not actor.is_active or actor.role not in (Role.SUPERVISOR, Role.HEAD, Role.ADMIN):
        raise PermissionDeniedError("Недостаточно прав для этой операции")
    confirmed_ids = (
        _preview_ids(actor, payload, allow_expired=True) if payload.selection_token else None
    )
    fingerprint = _digest(
        {
            **_selection(payload),
            "amount": payload.amount,
            "reason": payload.reason.strip(),
            "confirmed_ids": confirmed_ids,
        }
    )
    prefix = f"manual:{actor.id}:bulk:{payload.request_id}:" if payload.request_id else None
    if prefix:
        previous = list(
            await session.scalars(
                select(CoinTransaction)
                .where(CoinTransaction.idempotency_key.startswith(prefix, autoescape=True))
                .order_by(CoinTransaction.user_id)
            )
        )
        if previous:
            if any(
                (transaction.meta or {}).get("batch_payload") != fingerprint
                or (transaction.meta or {}).get("batch_count") != len(previous)
                for transaction in previous
            ):
                raise ConflictError("Этот запрос уже использован для другой операции")
            # Read the committed original result before resolving today's membership
            # or checking preview expiry; retries must never add new recipients.
            return previous
    if payload.selection_token:
        _preview_ids(actor, payload, allow_expired=False)
    await _validate_amount(session, payload.amount)
    # Directory updates lock groups before operators. Protect supervisor ownership
    # with that same order, then re-read the recipients after their own locks.
    # NO KEY UPDATE protects supervisor changes while allowing foreign-key
    # KEY SHARE reads from a transfer that already holds an operator's lock.
    group_query = select(Group).order_by(Group.id).with_for_update(key_share=True)
    if actor.role == Role.SUPERVISOR:
        group_query = group_query.where(Group.supervisor_id == actor.id)
    elif payload.group_ids:
        group_query = group_query.where(Group.id.in_(set(payload.group_ids)))
    elif payload.user_ids:
        group_query = group_query.where(Group.id.in_(
            select(User.group_id).where(User.id.in_(set(payload.user_ids)))
        ))
    await session.execute(group_query.execution_options(populate_existing=True))
    recipients = await _recipients(session, actor, payload)
    ids = [user.id for user in recipients]
    if confirmed_ids is not None and ids != confirmed_ids:
        raise ConflictError(
            "Состав выбранных операторов изменился. Проверьте операцию ещё раз.",
            code="selection_changed",
        )
    if not recipients:
        raise DomainError("В выбранных группах нет операторов", code="empty_selection")
    # Lock/reload recipients before rechecking scope. Existing single/manual and
    # shop operations also lock accounts; all batches take them in the same order.
    for user_id in ids:
        await lock_user(session, user_id)
    recipients = await _recipients(session, actor, payload)
    if [user.id for user in recipients] != ids:
        raise ConflictError(
            "Состав выбранных операторов изменился. Проверьте операцию ещё раз.",
            code="selection_changed",
        )
    for recipient in recipients:
        if recipient.role != Role.OPERATOR:
            raise PermissionDeniedError("Один из выбранных операторов недоступен")
        await ensure_can_manage(session, actor, recipient)
    if session.get_bind().dialect.name != "sqlite":
        await session.execute(
            select(CoinAccount.user_id)
            .where(CoinAccount.user_id.in_(ids))
            .order_by(CoinAccount.user_id)
            .with_for_update()
        )
    transactions = []
    for recipient in recipients:
        transaction = await manual_transaction(
            session,
            actor=actor,
            target=recipient,
            amount=payload.amount,
            reason=payload.reason,
            request_id=f"bulk:{payload.request_id}:{recipient.id}" if prefix else None,
            meta={"batch_payload": fingerprint, "batch_count": len(recipients)},
        )
        transactions.append(transaction)
    return transactions
