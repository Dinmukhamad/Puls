"""Read-only operator progress, including users who have never opened the simulator."""

from collections import defaultdict
from datetime import UTC, datetime

from sqlalchemy import select

from app.core.deps import visible_users_filter
from app.core.errors import NotFoundError
from app.models.driver import DriverOrder
from app.models.driver_shift import DriverShift
from app.models.enums import Role
from app.models.user import User
from app.services.driver_shifts import checked_result


async def report(
    session,
    actor,
    *,
    operator_ids=None,
    tenure="all",
    state=None,
    activity=None,
    employment="active",
    target_orders=5,
):
    people = list(
        await session.scalars(
            select(User)
            .where(
                await visible_users_filter(session, actor),
                User.role == Role.OPERATOR,
            )
            .order_by(User.full_name, User.id)
        )
    )
    ids = {person.id for person in people}
    if operator_ids and not set(operator_ids).issubset(ids):
        raise NotFoundError("Один или несколько операторов недоступны")
    # Options are independent of filters so selected names never disappear.
    options = [{"id": p.id, "full_name": p.full_name, "login": p.login} for p in people]
    shifts_by_user = defaultdict(list)
    shifts = list(
        await session.scalars(
            select(DriverShift)
            .where(
                DriverShift.user_id.in_(ids),
                DriverShift.is_preview.is_(False),
            )
            .order_by(DriverShift.created_at.desc(), DriverShift.id.desc())
        )
    )
    for shift in shifts:
        if not shift.data.get("demo_used", False):
            shifts_by_user[shift.user_id].append(shift)
    orders = {
        order.shift_id: order
        for order in await session.scalars(
            select(DriverOrder)
            .join(DriverShift, DriverOrder.shift_id == DriverShift.id)
            .where(
                DriverShift.user_id.in_(ids),
                DriverShift.is_preview.is_(False),
                DriverShift.active_slot == 1,
                DriverShift.finished_at.is_(None),
                DriverOrder.active_slot == 1,
            )
        )
    }
    today = datetime.now(UTC).date()
    items = []
    for person in people:
        days = (today - person.hired_on).days if person.hired_on else None
        bucket = (
            "unknown"
            if days is None
            else "future"
            if days < 0
            else "new"
            if days <= 30
            else "recent"
            if days <= 90
            else "experienced"
        )
        if operator_ids and person.id not in operator_ids:
            continue
        if tenure != "all" and tenure != bucket:
            continue
        if employment != "all" and person.is_active != (employment == "active"):
            continue
        history = shifts_by_user[person.id]
        latest = history[0] if history else None
        active = next((s for s in history if s.active_slot == 1 and not s.finished_at), None)
        current = active or latest
        completed = sum(s.data.get("completed", 0) for s in history)
        progress = (
            "completed"
            if completed >= target_orders
            else ("in_progress" if history else "not_started")
        )
        order = orders.get(active.id) if active else None
        stage = (
            order.stage
            if order
            else (
                "photo"
                if active and active.data.get("photo_status") != "passed"
                else "searching"
                if active and active.data.get("online")
                else "preparing"
                if active
                else "finished"
                if latest
                else "not_started"
            )
        )
        if state and progress != state:
            continue
        if activity == "active" and not active:
            continue
        if activity == "inactive" and active:
            continue
        checks = checked_result(current, current.data)["checks"] if current else []
        items.append(
            {
                "user_id": person.id,
                "full_name": person.full_name,
                "login": person.login,
                "is_active": person.is_active,
                "hired_on": person.hired_on,
                "tenure_days": days,
                "state": progress,
                "completed_orders": completed,
                "sessions": len(history),
                "active_shift": active is not None,
                "current_stage": stage,
                "scenario": current.config.get("title") if current else None,
                "session_orders": current.data.get("completed", 0) if current else 0,
                "session_target": current.config.get("target_orders") if current else None,
                "mode": current.mode if current else None,
                "score": (current.result or {}).get("score") if current else None,
                "checks": checks,
            }
        )
    summary = {
        key: sum(row["state"] == key for row in items)
        for key in ("not_started", "in_progress", "completed")
    }
    summary.update(
        total=len(items),
        completed_orders=sum(r["completed_orders"] for r in items),
        active=sum(r["active_shift"] for r in items),
    )
    return {
        "items": items,
        "operators": options,
        "summary": summary,
        "target_orders": target_orders,
        "updated_at": datetime.now(UTC),
    }
