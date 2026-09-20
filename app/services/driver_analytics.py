"""Read-only operator progress, including users who have never opened the simulator."""

from collections import defaultdict
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.deps import visible_users_filter
from app.core.errors import NotFoundError
from app.models.driver import DriverOrder
from app.models.driver_shift import DriverShift
from app.models.enums import Role
from app.models.user import User
from app.services.driver_analytics_details import ERRORS, order_activity, session_summary, timestamp
from app.services.driver_shifts import CHECKS


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
    days=30,
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
        tenure_days = (today - person.hired_on).days if person.hired_on else None
        bucket = (
            "unknown"
            if tenure_days is None
            else "future"
            if tenure_days < 0
            else "new"
            if tenure_days <= 30
            else "recent"
            if tenure_days <= 90
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
        current_summary = session_summary(current) if current else None
        checks = current_summary["checks"] if current_summary else []
        summaries = [session_summary(s) for s in history]
        last_at = max((s["last_activity_at"] for s in summaries), default=None)
        if order:
            last_at = max(last_at, order_activity(order))
        attention = []
        if current_summary and current_summary["errors"]:
            attention.append("errors")
        if current_summary and current_summary["passed"] is False:
            attention.append("failed")
        if active and last_at and datetime.now(UTC) - last_at > timedelta(hours=24):
            attention.append("stale")
        items.append(
            {
                "user_id": person.id,
                "full_name": person.full_name,
                "login": person.login,
                "is_active": person.is_active,
                "hired_on": person.hired_on,
                "tenure_days": tenure_days,
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
                "errors": sum(s["errors"] for s in summaries),
                "hints": sum(s["hints"] for s in summaries),
                "last_activity_at": last_at,
                "attention": attention,
                "done_checks": current_summary["done_checks"] if current_summary else 0,
                "required_checks": current_summary["required_checks"] if current_summary else 0,
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
    selected_ids = {row["user_id"] for row in items}
    selected_shifts = [s for uid in selected_ids for s in shifts_by_user[uid]]
    all_summaries = [session_summary(s) for s in selected_shifts]
    scores = [s["score"] for s in all_summaries if s["finished_at"] and s["score"] is not None]
    skills = []
    for key, _, title, _ in CHECKS:
        checks = [next((c for c in row["checks"] if c["key"] == key), None) for row in items]
        skills.append(
            {
                "key": key,
                "title": title,
                "done": sum(bool(c and c["required"] and c["done"]) for c in checks),
                "pending": sum(bool(c and c["required"] and not c["done"]) for c in checks),
                "not_required": sum(bool(c and not c["required"]) for c in checks),
                "not_started": sum(c is None for c in checks),
            }
        )
    trend = {
        (today - timedelta(days=offset)).isoformat(): {
            "date": (today - timedelta(days=offset)).isoformat(),
            "orders": 0,
            "started": 0,
            "finished": 0,
        }
        for offset in range(days - 1, -1, -1)
    }
    for s in selected_shifts:
        for field, value in (("started", s.created_at), ("finished", s.finished_at)):
            key = timestamp(value).date().isoformat() if value else None
            if key in trend:
                trend[key][field] += 1
    completed_dates = await session.scalars(
        select(DriverOrder.finished_at).where(
            DriverOrder.shift_id.in_([s.id for s in selected_shifts]),
            DriverOrder.user_id.in_(selected_ids),
            DriverOrder.stage == "complete",
            DriverOrder.finished_at
            >= datetime.combine(today - timedelta(days=days - 1), datetime.min.time(), UTC),
        )
    )
    for value in completed_dates:
        key = timestamp(value).date().isoformat()
        if key in trend:
            trend[key]["orders"] += 1
    return {
        "items": items,
        "operators": options,
        "summary": summary,
        "target_orders": target_orders,
        "updated_at": datetime.now(UTC),
        "skills": skills,
        "activity": list(trend.values()),
        "insights": {
            "average_score": round(sum(scores) / len(scores), 1) if scores else None,
            "scored_sessions": len(scores),
            "sessions": len(selected_shifts),
            "finished_sessions": sum(s.finished_at is not None for s in selected_shifts),
            "needs_attention": sum(bool(r["attention"]) for r in items),
            "error_breakdown": [
                {
                    "key": key,
                    "title": title,
                    "value": sum(s.data.get(key, 0) for s in selected_shifts),
                }
                for key, title in ERRORS.items()
            ],
        },
    }
