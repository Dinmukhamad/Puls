"""Training evidence for dashboards. Never expose raw simulator payloads or device data."""

from datetime import UTC, datetime

from sqlalchemy import select

from app.core.deps import visible_users_filter
from app.core.errors import NotFoundError
from app.models.driver import DriverOrder
from app.models.driver_shift import DriverShift
from app.models.enums import Role
from app.models.user import User
from app.services.driver_shifts import checked_result

OPTIONAL = {
    "route": "route_event",
    "photo": "require_photo",
    "support": "require_support",
    "documents": "require_documents",
}
ERRORS = {
    "missed": "Пропущенные заказы",
    "cancelled": "Отменённые заказы",
    "support_errors": "Ошибки в поддержке",
    "invalid_actions": "Ошибочные действия",
}
ACTION_NAMES = {
    "online": "Выход на линию",
    "offline": "Уход с линии",
    "photo_step": "Ракурс фотоконтроля",
    "photo_submit": "Фотоконтроль пройден",
    "doc_sign": "Документ подписан",
    "provider": "Выбран способ подписания",
    "park": "Выбран парк",
    "route_change": "Изменён маршрут",
    "support_open": "Открыто обращение в поддержку",
    "support_answer": "Ответ в поддержке",
    "hint": "Использована подсказка",
    "error": "Ошибочное действие",
    "wallet": "Операция с учебным балансом",
    "learning": "Открыт учебный материал",
    "accept": "Заказ принят",
    "arrive": "Прибытие к пассажиру",
    "start_trip": "Поездка начата",
    "finish_trip": "Поездка завершена",
    "pay": "Заказ оплачен",
    "cancel": "Заказ отменён",
    "missed": "Заказ пропущен",
    "found": "Заказ найден",
    "offer": "Получено предложение заказа",
    "reached_pickup": "Достигнута точка подачи",
    "reached_destination": "Достигнута точка назначения",
    "route_changed": "Изменён маршрут",
    "route_recalculated": "Маршрут перестроен",
}
VIEW_NAMES = {
    "orders": "Заказы",
    "money": "Деньги",
    "transaction": "Детали операции",
    "photo": "Фотоконтроль",
    "rating": "Рейтинг",
    "priority": "Приоритет",
    "documents": "Документы",
    "support": "Поддержка",
    "park": "Парк",
    "profile": "Профиль",
    "chats": "Чаты",
    "learning": "Обучение",
}


def timestamp(value):
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def last_activity(shift):
    return max(
        filter(
            None,
            [
                timestamp(shift.created_at),
                timestamp(shift.finished_at),
                *(timestamp(e.get("at")) for e in shift.events),
            ],
        )
    )


def order_activity(order):
    return max(
        filter(
            None,
            [timestamp(order.stage_started_at), *(timestamp(e.get("at")) for e in order.events)],
        )
    )


def checks_for(shift):
    stored = (shift.result or {}).get("checks")
    checks = stored if stored is not None else checked_result(shift, shift.data)["checks"]
    return [
        {
            "key": c["key"],
            "title": c["title"],
            "done": c["done"],
            "required": bool(shift.config.get(OPTIONAL[c["key"]], True))
            if c["key"] in OPTIONAL
            else True,
            "path": c.get("path", ""),
        }
        for c in checks
    ]


def session_summary(shift):
    checks = checks_for(shift)
    score = (shift.result or {}).get("score")
    threshold = shift.data.get("training_pass_percent")
    passed = (
        (score >= threshold)
        if (shift.finished_at and score is not None and threshold is not None)
        else None
    )
    return {
        "id": shift.id,
        "title": shift.config.get("title", "Учебная смена"),
        "mode": shift.mode,
        "created_at": timestamp(shift.created_at),
        "finished_at": timestamp(shift.finished_at),
        "last_activity_at": last_activity(shift),
        "orders": shift.data.get("completed", 0),
        "target": shift.config.get("target_orders", 0),
        "score": score,
        "pass_percent": threshold,
        "passed": passed,
        "elapsed_seconds": max(
            0, int((timestamp(shift.finished_at) - timestamp(shift.created_at)).total_seconds())
        )
        if shift.finished_at
        else None,
        "errors": sum(shift.data.get(key, 0) for key in ERRORS),
        "error_breakdown": {key: shift.data.get(key, 0) for key in ERRORS},
        "hints": shift.data.get("hints", 0),
        "checks": checks,
        "done_checks": sum(c["done"] and c["required"] for c in checks),
        "required_checks": sum(c["required"] for c in checks),
    }


async def visible_operator(session, actor, user_id):
    person = await session.scalar(
        select(User).where(
            await visible_users_filter(session, actor),
            User.role == Role.OPERATOR,
            User.id == user_id,
        )
    )
    if person is None:
        raise NotFoundError("Оператор не найден")
    return person


async def participant(session, actor, user_id):
    person = await visible_operator(session, actor, user_id)
    history = [
        s
        for s in await session.scalars(
            select(DriverShift)
            .where(
                DriverShift.user_id == person.id,
                DriverShift.is_preview.is_(False),
            )
            .order_by(DriverShift.created_at.desc(), DriverShift.id.desc())
        )
        if not s.data.get("demo_used", False)
    ]
    summaries = [session_summary(s) for s in history]
    active_order = await session.scalar(
        select(DriverOrder).where(
            DriverOrder.user_id == user_id,
            DriverOrder.active_slot == 1,
        )
    )
    if active_order:
        for summary in summaries:
            if summary["id"] == active_order.shift_id:
                summary["last_activity_at"] = max(
                    summary["last_activity_at"], order_activity(active_order)
                )
    scores = [s["score"] for s in summaries if s["finished_at"] and s["score"] is not None]
    return {
        "user_id": person.id,
        "full_name": person.full_name,
        "login": person.login,
        "hired_on": person.hired_on,
        "is_active": person.is_active,
        "sessions": summaries,
        "completed_orders": sum(s["orders"] for s in summaries),
        "errors": sum(s["errors"] for s in summaries),
        "hints": sum(s["hints"] for s in summaries),
        "average_score": round(sum(scores) / len(scores), 1) if scores else None,
        "scored_sessions": len(scores),
    }


async def journey(session, actor, user_id, shift_id):
    await visible_operator(session, actor, user_id)
    shift = await session.scalar(
        select(DriverShift).where(
            DriverShift.id == shift_id,
            DriverShift.user_id == user_id,
            DriverShift.is_preview.is_(False),
        )
    )
    if shift is None or shift.data.get("demo_used", False):
        raise NotFoundError("Смена не найдена")
    orders = list(
        await session.scalars(
            select(DriverOrder)
            .where(
                DriverOrder.shift_id == shift.id,
                DriverOrder.user_id == user_id,
            )
            .order_by(DriverOrder.created_at, DriverOrder.id)
        )
    )
    events = [
        {
            "at": timestamp(shift.created_at),
            "title": "Начало смены",
            "kind": "milestone",
            "order_id": None,
        }
    ]
    order_actions = {(o.id, e.get("action")) for o in orders for e in o.events}
    for event in shift.events:
        action, details = event.get("action", ""), event.get("details") or {}
        order_id = details.get("order_id")
        if action.startswith("order_"):
            action = action.removeprefix("order_")
            if (order_id, action) in order_actions:
                continue
        title = ACTION_NAMES.get(action)
        wrong_answer = action == "support_answer" and details.get("correct") is False
        if action == "support_answer":
            title = "Неверный ответ в поддержке" if wrong_answer else "Ответ в поддержке"
        if action == "visit":
            view = VIEW_NAMES.get(details.get("view"))
            title = f"Открыт раздел «{view}»" if view else None
        if title and timestamp(event.get("at")):
            events.append(
                {
                    "at": timestamp(event["at"]),
                    "title": title,
                    "kind": "error"
                    if action in ("error", "missed", "cancel") or wrong_answer
                    else "hint"
                    if action == "hint"
                    else "action",
                    "order_id": order_id,
                    "detail": str(details.get("reason", ""))[:300] if action == "error" else None,
                }
            )
    order_rows = []
    for index, order in enumerate(orders, 1):
        timeline = []
        for event in order.events:
            at = timestamp(event.get("at"))
            if not at:
                continue
            timeline.append(
                {"at": at, "stage": event.get("to", ""), "action": event.get("action", "")}
            )
            title = ACTION_NAMES.get(event.get("action"))
            if title:
                events.append(
                    {
                        "at": at,
                        "title": f"Заказ {index} · {title}",
                        "kind": "error" if event.get("action") in ("cancel", "missed") else "order",
                        "order_id": order.id,
                    }
                )
        order_rows.append(
            {
                "id": order.id,
                "number": index,
                "origin": order.origin,
                "destination": order.destination,
                "stage": order.stage,
                "created_at": timestamp(order.created_at),
                "finished_at": timestamp(order.finished_at),
                "timeline": timeline,
            }
        )
    if shift.finished_at:
        events.append(
            {
                "at": timestamp(shift.finished_at),
                "title": "Смена завершена",
                "kind": "milestone",
                "order_id": None,
            }
        )
    events.sort(key=lambda e: e["at"])
    summary = session_summary(shift)
    summary["last_activity_at"] = max(
        [summary["last_activity_at"], *(order_activity(o) for o in orders)]
    )
    return {
        "session": summary,
        "orders": order_rows,
        "events": events,
    }
