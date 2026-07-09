"""Уведомления (ТЗ P2). Один создающий примитив (`notify_user`/`notify_operator`)
плюс небольшие обёртки под конкретные события — вызываются из других модулей
(достижения, покупки, еженедельный расчёт, колесо) в момент, когда событие
уже случилось, чтобы уведомление не потерялось при откате.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Notification, User


def notify_user(db: Session, user_id: int, *, type: str, title: str, body: str = "", link: str | None = None) -> Notification:
    n = Notification(user_id=user_id, type=type, title=title, body=body, link=link)
    db.add(n)
    db.flush()
    return n


def notify_operator(db: Session, operator_id: int, *, type: str, title: str, body: str = "", link: str | None = None) -> list[Notification]:
    """Уведомление всем активным логинам, привязанным к этому оператору
    (обычно один, но на всякий случай — без предположения об уникальности)."""
    user_ids = db.scalars(
        select(User.id).where(User.operator_id == operator_id, User.is_active.is_(True))
    ).all()
    return [notify_user(db, uid, type=type, title=title, body=body, link=link) for uid in user_ids]


# ── Обёртки под конкретные события ───────────────────────────────────────────

def notify_achievement_granted(db: Session, operator_id: int, achievement_title: str, reward_coins: int) -> None:
    body = f"+{reward_coins} ₡" if reward_coins > 0 else ""
    notify_operator(
        db, operator_id, type="achievement",
        title=f"Получено достижение «{achievement_title}»", body=body, link="cabinet",
    )


def notify_purchase_status(db: Session, operator_id: int, item_title: str, status: str, reject_reason: str | None = None) -> None:
    if status == "approved":
        title, body = f"Заявка на «{item_title}» одобрена", ""
    elif status == "rejected":
        title, body = f"Заявка на «{item_title}» отклонена", reject_reason or ""
    elif status == "completed":
        title, body = f"Бонус «{item_title}» выдан", ""
    else:
        return
    notify_operator(db, operator_id, type=f"purchase_{status}", title=title, body=body, link="shop")


def notify_weekly_accrual(db: Session, operator_id: int, total_coins: int, period_label: str) -> None:
    if total_coins <= 0:
        return
    notify_operator(
        db, operator_id, type="weekly_accrual",
        title=f"Начислено {total_coins} ₡ за неделю", body=period_label, link="cabinet",
    )


def notify_wheel_prize(db: Session, operator_id: int, prize_title: str) -> None:
    notify_operator(
        db, operator_id, type="wheel_prize",
        title=f"Колесо WOW: вы выиграли «{prize_title}»", link="wheel",
    )


def notify_manual_coin_operation(db: Session, operator_id: int, amount: int, reason: str) -> None:
    verb = "Начислено" if amount >= 0 else "Списано"
    notify_operator(
        db, operator_id, type="manual_operation",
        title=f"{verb} {abs(amount)} ₡", body=reason, link="cabinet",
    )
