"""Уведомления (ТЗ P2): каждый видит только свои, независимо от роли."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.datetime_utils import now_utc
from app.core.security import get_current_user
from app.database.db import get_db
from app.models.entities import Notification, User
from app.modules.notifications.schemas import NotificationListResponse, NotificationRead

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListResponse)
def list_notifications(
    unread_only: bool = False,
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    q = select(Notification).where(Notification.user_id == current_user.id)
    if unread_only:
        q = q.where(Notification.is_read.is_(False))
    total = db.scalar(select(func.count()).select_from(q.with_only_columns(Notification.id).subquery())) or 0
    unread_count = db.scalar(
        select(func.count(Notification.id)).where(Notification.user_id == current_user.id, Notification.is_read.is_(False))
    ) or 0
    rows = list(db.scalars(q.order_by(Notification.created_at.desc(), Notification.id.desc()).offset(offset).limit(limit)))
    return {"items": rows, "total": total, "unread_count": unread_count}


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    count = db.scalar(
        select(func.count(Notification.id)).where(Notification.user_id == current_user.id, Notification.is_read.is_(False))
    ) or 0
    return {"unread_count": count}


@router.post("/{notification_id}/read", response_model=NotificationRead)
def mark_read(notification_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Notification:
    n = db.get(Notification, notification_id)
    if not n or n.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Уведомление не найдено")
    if not n.is_read:
        n.is_read = True
        n.read_at = now_utc()
        db.commit()
        db.refresh(n)
    return n


@router.post("/read-all")
def mark_all_read(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    rows = list(db.scalars(
        select(Notification).where(Notification.user_id == current_user.id, Notification.is_read.is_(False))
    ))
    now = now_utc()
    for n in rows:
        n.is_read = True
        n.read_at = now
    db.commit()
    return {"marked": len(rows)}
