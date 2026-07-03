from __future__ import annotations

import json
import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.datetime_utils import local_day_bounds_utc, to_local_iso
from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import Operator, User, WheelCampaign, WheelPrize, WheelSpin
from app.schemas.wheel import (
    AdminSpinRow,
    IssueTicketRequest,
    MySpinRow,
    SpinResult,
    TicketIssuedResponse,
    WheelPrizeRead,
    WheelStatus,
)
from app.services import wheel as wheel_service
from app.services.coins import operator_for_user_or_403
from app.services.rating import rating_cache_invalidate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/wheel", tags=["wheel"])
admin_router = APIRouter(prefix="/admin/wheel", tags=["wheel-admin"])

STAFF_ROLES = ("supervisor", "manager", "admin")


# ── Оператор ─────────────────────────────────────────────────────────────────

@router.get("/status", response_model=WheelStatus)
def get_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    operator = operator_for_user_or_403(db, current_user)
    status_data = wheel_service.wheel_status(db, operator)
    db.commit()  # ленивое истечение билетов могло изменить статусы
    return status_data


@router.get("/prizes", response_model=dict)
def get_prizes(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    campaign = wheel_service.active_campaign(db)
    if not campaign:
        return {"items": []}
    prizes = db.scalars(
        select(WheelPrize)
        .where(WheelPrize.campaign_id == campaign.id, WheelPrize.is_active.is_(True))
        .order_by(WheelPrize.sort_order.asc(), WheelPrize.id.asc())
    ).all()
    items = [
        WheelPrizeRead(id=p.id, title=p.title, type=p.prize_type, amount=p.amount, color=p.color).model_dump()
        for p in prizes
    ]
    return {"items": items}


@router.post("/spin", response_model=SpinResult)
def post_spin(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    operator = operator_for_user_or_403(db, current_user)
    try:
        result = wheel_service.spin(db, operator)
        db.commit()
    except HTTPException:
        db.rollback()  # билет остаётся available — ошибка не списывает прокрутку
        raise
    except Exception:
        db.rollback()
        logger.exception("Прокрутка колеса упала для operator_id=%s", operator.id)
        raise HTTPException(
            status_code=500,
            detail="Не удалось прокрутить колесо. Попробуйте позже или обратитесь к администратору.",
        ) from None
    # Приз-коины виден в рейтинге/номинациях — сбрасываем кеш
    if result["prize"]["type"] == "coins":
        rating_cache_invalidate()
    return result


@router.get("/my-history", response_model=dict)
def my_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = Query(default=50, ge=1, le=200),
):
    operator = operator_for_user_or_403(db, current_user)
    spins = db.scalars(
        select(WheelSpin)
        .where(WheelSpin.operator_id == operator.id, WheelSpin.status == "completed")
        .order_by(WheelSpin.created_at.desc())
        .limit(limit)
    ).all()
    return {"items": [_my_row(s) for s in spins]}


def _payload(spin: WheelSpin) -> dict:
    try:
        return json.loads(spin.result_payload_json or "{}")
    except (ValueError, TypeError):
        return {}


def _my_row(spin: WheelSpin) -> dict:
    p = _payload(spin)
    return MySpinRow(
        date=to_local_iso(spin.created_at) or "",
        reason=spin.ticket.reason_text if spin.ticket else None,
        prize=p.get("title", "—"),
        prize_type=p.get("type", ""),
        amount=int(p.get("amount", 0) or 0),
        status=spin.status,
    ).model_dump()


# ── Супервайзер / руководитель ───────────────────────────────────────────────

@admin_router.get("/spins", response_model=dict, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_spins(
    db: Session = Depends(get_db),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    operator_id: int | None = Query(default=None),
    prize_type: str | None = Query(default=None),
    spin_status: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
):
    stmt = select(WheelSpin).order_by(WheelSpin.created_at.desc())
    if date_from:
        start, _ = local_day_bounds_utc(date_from)
        stmt = stmt.where(WheelSpin.created_at >= start)
    if date_to:
        _, end = local_day_bounds_utc(date_to)
        stmt = stmt.where(WheelSpin.created_at <= end)
    if operator_id:
        stmt = stmt.where(WheelSpin.operator_id == operator_id)
    if spin_status:
        stmt = stmt.where(WheelSpin.status == spin_status)
    spins = db.scalars(stmt.limit(limit)).all()

    rows = []
    for spin in spins:
        p = _payload(spin)
        if prize_type and p.get("type") != prize_type:
            continue
        op = spin.operator
        rows.append(
            AdminSpinRow(
                id=spin.id,
                date=to_local_iso(spin.created_at) or "",
                operator_id=spin.operator_id,
                operator_name=op.full_name if op else "—",
                group_name=(op.group_name or None) if op else None,
                reason=spin.ticket.reason_text if spin.ticket else None,
                prize=p.get("title", "—"),
                prize_type=p.get("type", ""),
                amount=int(p.get("amount", 0) or 0),
                status=spin.status,
            ).model_dump()
        )
    return {"items": rows}


@admin_router.post("/tickets", response_model=TicketIssuedResponse, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def issue_ticket(
    payload: IssueTicketRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    operator = db.get(Operator, payload.operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")

    if payload.campaign_id:
        campaign = db.get(WheelCampaign, payload.campaign_id)
        if not campaign or not campaign.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Кампания не найдена или неактивна")
    else:
        campaign = wheel_service.require_active_campaign(db)

    # Ручная выдача может обойти дневной лимит (осознанно, ТЗ п.4.2) и
    # использует свой ttl, если задан
    if payload.ttl_days:
        campaign_ttl_backup = campaign.ticket_ttl_days
        campaign.ticket_ttl_days = payload.ttl_days
        try:
            ticket = wheel_service.issue_ticket(
                db, operator, campaign,
                reason_type="manual", reason_text=payload.reason_text,
                source_type="manual", created_by=current_user,
                enforce_daily_cap=False,
            )
        finally:
            campaign.ticket_ttl_days = campaign_ttl_backup
    else:
        ticket = wheel_service.issue_ticket(
            db, operator, campaign,
            reason_type="manual", reason_text=payload.reason_text,
            source_type="manual", created_by=current_user,
            enforce_daily_cap=False,
        )
    db.commit()
    db.refresh(ticket)
    return TicketIssuedResponse(
        ticket_id=ticket.id, operator_id=ticket.operator_id,
        status=ticket.status, expires_at=ticket.expires_at,
    )
