"""Серверная последовательность учебного заказа, без реальных платежей."""

import secrets
from datetime import UTC
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select, update

from app.core.errors import ConflictError, NotFoundError
from app.db.base import utcnow
from app.models.driver import DriverOrder, DriverProfile
from app.services import driver_auth

DURATIONS = {"searching": 3, "pickup": 8, "waiting": 4, "trip": 38, "payment": 2}
TRANSITIONS = {
    "offer": ("searching", "offer"),
    "accept": ("offer", "pickup"),
    "arrive": ("pickup", "waiting"),
    "start_trip": ("waiting", "trip"),
    "finish": ("trip", "payment"),
    "pay": ("payment", "complete"),
}


def order_data(order):
    return {
        key: getattr(order, key)
        for key in (
            "id",
            "stage",
            "origin",
            "destination",
            "payment",
            "fare",
            "commission",
            "park",
            "version",
            "events",
            "created_at",
            "stage_started_at",
            "finished_at",
        )
    } | {"duration_seconds": DURATIONS.get(order.stage, 0), "net": order.fare - order.commission}


async def state(session, user_id):
    latest = await session.scalar(
        select(DriverOrder)
        .where(DriverOrder.user_id == user_id)
        .order_by(DriverOrder.created_at.desc(), DriverOrder.id.desc())
        .limit(1)
    )
    completed = (DriverOrder.user_id == user_id, DriverOrder.stage == "complete")
    count, gross, commission = (
        await session.execute(
            select(
                func.count(DriverOrder.id),
                func.coalesce(func.sum(DriverOrder.fare), 0),
                func.coalesce(func.sum(DriverOrder.commission), 0),
            ).where(*completed)
        )
    ).one()
    history = await session.scalars(
        select(DriverOrder)
        .where(*completed)
        .order_by(DriverOrder.finished_at.desc(), DriverOrder.id.desc())
        .limit(20)
    )
    return {
        "order": order_data(latest) if latest else None,
        "order_summary": {
            "count": count,
            "gross": gross,
            "commission": commission,
            "net": gross - commission,
        },
        "order_history": [order_data(item) for item in history],
        "server_now": utcnow(),
    }


async def active_order(session, user_id):
    return await session.scalar(
        select(DriverOrder.id).where(
            DriverOrder.user_id == user_id,
            DriverOrder.active_slot == 1,
        )
    )


async def require_profile(session, user_id, device):
    await driver_auth.require_verified(session, user_id, device)
    profile = await session.scalar(
        select(DriverProfile)
        .where(
            DriverProfile.user_id == user_id,
        )
        .with_for_update()
    )
    if not profile or profile.stage != "offline" or not profile.park:
        raise ConflictError("Сначала завершите вход в водительский профиль")
    return profile


async def create(session, user_id, payload, device):
    profile = await require_profile(session, user_id, device)
    existing = await session.get(DriverOrder, str(payload.id))
    if existing:
        if existing.user_id != user_id:
            raise ConflictError("Создайте новый учебный заказ")
        if (existing.origin, existing.destination) != (payload.origin, payload.destination):
            raise ConflictError("Этот запрос уже использован для другого маршрута")
        return  # Повтор после потери ответа не меняет выбранную оплату и этап.
    if await active_order(session, user_id):
        raise ConflictError("Сначала завершите или отмените текущий учебный заказ")
    fare = 1960
    commission = int(
        (Decimal(fare) * Decimal(str(profile.park["commission"])) / 100).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )
    session.add(
        DriverOrder(
            id=str(payload.id),
            user_id=user_id,
            active_slot=1,
            stage="searching",
            origin=payload.origin,
            destination=payload.destination,
            payment=secrets.choice(("cash", "card")),
            fare=fare,
            commission=commission,
            park=dict(profile.park),
            version=0,
            events=[],
        )
    )
    await session.flush()


async def act(session, user_id, order_id, payload, device):
    await require_profile(session, user_id, device)
    order = await session.scalar(
        select(DriverOrder)
        .where(
            DriverOrder.id == str(order_id),
            DriverOrder.user_id == user_id,
        )
        .with_for_update()
    )
    if not order:
        raise NotFoundError("Учебный заказ не найден")
    previous = next(
        (event for event in order.events if event["request_id"] == str(payload.request_id)), None
    )
    if previous:
        if previous["action"] != payload.action:
            raise ConflictError("Этот запрос уже использован для другого действия")
        return
    if payload.action == "cancel":
        if order.stage not in ("searching", "offer", "pickup", "waiting"):
            raise ConflictError("Этот заказ уже нельзя отменить: завершите поездку и оплату")
        target = "cancelled"
    else:
        source, target = TRANSITIONS[payload.action]
        if order.stage != source:
            raise ConflictError(
                "Этап заказа изменился. Обновите заказ и продолжите с сохранённого этапа."
            )
        started = (
            order.stage_started_at.replace(tzinfo=UTC)
            if order.stage_started_at.tzinfo is None
            else order.stage_started_at
        )
        if (utcnow() - started).total_seconds() < DURATIONS.get(source, 0):
            raise ConflictError("Дождитесь завершения текущего этапа")
    now = utcnow()
    values = {
        "stage": target,
        "stage_started_at": now,
        "version": order.version + 1,
        "events": [
            *order.events,
            {
                "request_id": str(payload.request_id),
                "action": payload.action,
                "from": order.stage,
                "to": target,
                "at": now.isoformat(),
            },
        ],
    }
    if target in ("complete", "cancelled"):
        values.update(active_slot=None, finished_at=now)
    changed = await session.execute(
        update(DriverOrder)
        .where(
            DriverOrder.id == order.id,
            DriverOrder.version == order.version,
        )
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    if changed.rowcount != 1:
        raise ConflictError("Заказ изменён в другом окне. Обновите его состояние.")
    await session.refresh(order)
