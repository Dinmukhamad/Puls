from __future__ import annotations

import json
import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.datetime_utils import local_day_bounds_utc, now_utc, to_local_iso
from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import (
    Operator,
    User,
    WheelCampaign,
    WheelEligibilityRule,
    WheelManualGrant,
    WheelPrize,
    WheelRuleEvaluationLog,
    WheelSpin,
    WheelTicket,
)
from app.schemas.wheel import (
    AdminSpinRow,
    CampaignCreate,
    CampaignRead,
    CampaignUpdate,
    EvaluationLogRow,
    GrantTokenRequest,
    IssueTicketRequest,
    MySpinRow,
    PrizeCreate,
    PrizeRead,
    PrizeUpdate,
    RuleCreate,
    RuleRead,
    RuleUpdate,
    SpinResult,
    TicketIssuedResponse,
    TokenRow,
    WheelPrizeRead,
    WheelStatus,
    WinnerRow,
    WinnersToday,
)
from app.services import wheel as wheel_service
from app.services import wheel_eligibility
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
    limit: int = Query(default=80, ge=1, le=1000),
):
    stmt = (
        select(WheelSpin)
        .options(selectinload(WheelSpin.operator), selectinload(WheelSpin.ticket))
        .order_by(WheelSpin.created_at.desc())
    )
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
    if prize_type:
        # Фильтр по типу приза — на уровне SQL (join к призу), иначе при
        # применении .limit() ДО python-фильтра можно получить меньше строк,
        # чем limit. Используется текущий тип приза (WheelPrize.prize_type);
        # для отображения строки берётся снапшот из result_payload_json.
        stmt = stmt.join(WheelPrize, WheelPrize.id == WheelSpin.prize_id).where(
            WheelPrize.prize_type == prize_type
        )
    spins = db.scalars(stmt.limit(limit)).all()

    rows = []
    for spin in spins:
        p = _payload(spin)
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


# Алиас ТЗ п.13: GET /api/wheel/history (та же выдача, что и /my-history)
@router.get("/history", response_model=dict)
def wheel_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = Query(default=50, ge=1, le=200),
):
    return my_history(db=db, current_user=current_user, limit=limit)


# ── Победитель дня (ТЗ 10) ───────────────────────────────────────────────────

# Условная «ценность» приза для выбора крупнейшего за день: коины — по сумме,
# остальные типы — фиксированный ранг, чтобы редкие призы были заметны.
_PRIZE_RANK = {
    "manual_reward": 1000, "extra_ticket": 60, "shop_discount": 55,
    "badge": 50, "spin_token": 45,
}


def _winner_weight(prize_type: str, amount: int) -> int:
    if prize_type == "coins":
        return int(amount or 0)
    return _PRIZE_RANK.get(prize_type, 40)


@router.get("/winners-today", response_model=WinnersToday)
def winners_today(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Кто крутил колесо сегодня и самый крупный приз дня (ТЗ п.10)."""
    start, end = local_day_bounds_utc(None)
    spins = db.scalars(
        select(WheelSpin)
        .where(
            WheelSpin.created_at >= start,
            WheelSpin.created_at <= end,
            WheelSpin.status == "completed",
        )
        .order_by(WheelSpin.created_at.desc())
    ).all()

    items: list[WinnerRow] = []
    for spin in spins:
        p = _payload(spin)
        op = spin.operator
        items.append(WinnerRow(
            operator_id=spin.operator_id,
            operator_name=op.full_name if op else "—",
            group_name=(op.group_name or None) if op else None,
            prize=p.get("title", "—"),
            prize_type=p.get("type", ""),
            amount=int(p.get("amount", 0) or 0),
            reason=spin.ticket.reason_text if spin.ticket else None,
            at=to_local_iso(spin.created_at) or "",
        ))

    top = max(items, key=lambda w: _winner_weight(w.prize_type, w.amount), default=None)
    return WinnersToday(date=to_local_iso(start) or "", count=len(items), top=top, items=items)


# ── Админка: кампания (ТЗ 11.1) ──────────────────────────────────────────────

def _campaign_read(c: WheelCampaign) -> dict:
    return CampaignRead(
        id=c.id, title=c.title, description=c.description or "",
        is_active=c.is_active, start_date=c.start_date, end_date=c.end_date,
        max_spins_per_day=c.max_spins_per_day, max_spins_per_week=c.max_spins_per_week,
        ticket_ttl_days=c.ticket_ttl_days,
        created_at=to_local_iso(c.created_at), updated_at=to_local_iso(c.updated_at),
    ).model_dump()


def _deactivate_other_campaigns(db: Session, keep_id: int | None) -> None:
    for other in db.scalars(select(WheelCampaign).where(WheelCampaign.is_active.is_(True))):
        if other.id != keep_id:
            other.is_active = False


@admin_router.get("/campaigns", response_model=dict, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_list_campaigns(db: Session = Depends(get_db)):
    rows = db.scalars(select(WheelCampaign).order_by(WheelCampaign.is_active.desc(), WheelCampaign.id.desc()))
    return {"items": [_campaign_read(c) for c in rows]}


@admin_router.post("/campaigns", response_model=CampaignRead, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_create_campaign(payload: CampaignCreate, db: Session = Depends(get_db)):
    campaign = WheelCampaign(**payload.model_dump())
    db.add(campaign)
    db.flush()
    if campaign.is_active:
        _deactivate_other_campaigns(db, campaign.id)
    db.commit()
    db.refresh(campaign)
    return _campaign_read(campaign)


@admin_router.patch("/campaigns/{campaign_id}", response_model=CampaignRead, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_update_campaign(campaign_id: int, payload: CampaignUpdate, db: Session = Depends(get_db)):
    campaign = db.get(WheelCampaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Кампания не найдена")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(campaign, field, value)
    if campaign.is_active:
        _deactivate_other_campaigns(db, campaign.id)
    db.commit()
    db.refresh(campaign)
    return _campaign_read(campaign)


# ── Админка: правила (ТЗ 14) ─────────────────────────────────────────────────

def _rule_read(r: WheelEligibilityRule) -> dict:
    return RuleRead(
        id=r.id, campaign_id=r.campaign_id, code=r.code, title=r.title,
        description=r.description or "", source_module=r.source_module,
        rule_type=r.rule_type, metric_key=r.metric_key or "", operator=r.operator,
        threshold_value=r.threshold_value, threshold_value_max=r.threshold_value_max,
        period_type=r.period_type, max_tokens_per_period=r.max_tokens_per_period,
        token_ttl_hours=r.token_ttl_hours, is_active=r.is_active, priority=r.priority,
    ).model_dump()


@admin_router.get("/rules", response_model=dict, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_list_rules(db: Session = Depends(get_db), campaign_id: int | None = Query(default=None)):
    stmt = select(WheelEligibilityRule).order_by(WheelEligibilityRule.priority.desc(), WheelEligibilityRule.id.asc())
    if campaign_id:
        stmt = stmt.where(WheelEligibilityRule.campaign_id == campaign_id)
    return {"items": [_rule_read(r) for r in db.scalars(stmt)]}


@admin_router.post("/rules", response_model=RuleRead, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_create_rule(payload: RuleCreate, db: Session = Depends(get_db)):
    campaign_id = payload.campaign_id or wheel_service.require_active_campaign(db).id
    rule = WheelEligibilityRule(
        campaign_id=campaign_id, code=payload.code, title=payload.title,
        description=payload.description, source_module=payload.source_module,
        rule_type=payload.rule_type, metric_key=payload.metric_key, operator=payload.operator,
        threshold_value=payload.threshold_value, threshold_value_max=payload.threshold_value_max,
        period_type=payload.period_type, max_tokens_per_period=payload.max_tokens_per_period,
        token_ttl_hours=payload.token_ttl_hours, is_active=payload.is_active, priority=payload.priority,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _rule_read(rule)


@admin_router.patch("/rules/{rule_id}", response_model=RuleRead, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_update_rule(rule_id: int, payload: RuleUpdate, db: Session = Depends(get_db)):
    rule = db.get(WheelEligibilityRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Правило не найдено")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(rule, field, value)
    db.commit()
    db.refresh(rule)
    return _rule_read(rule)


@admin_router.delete("/rules/{rule_id}", dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_delete_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = db.get(WheelEligibilityRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Правило не найдено")
    # rule_id у билетов и логов — nullable FK. Отвязываем их, чтобы удаление
    # правила не нарушило внешние ключи и не потянуло за собой историю.
    from sqlalchemy import update as _update
    db.execute(_update(WheelTicket).where(WheelTicket.rule_id == rule_id).values(rule_id=None))
    db.execute(_update(WheelRuleEvaluationLog).where(WheelRuleEvaluationLog.rule_id == rule_id).values(rule_id=None))
    db.delete(rule)
    db.commit()
    return {"ok": True, "deleted": rule_id}


# ── Админка: призы (ТЗ 14) ───────────────────────────────────────────────────

def _prize_read(p: WheelPrize) -> dict:
    return PrizeRead(
        id=p.id, campaign_id=p.campaign_id, title=p.title, description=p.description or "",
        prize_type=p.prize_type, amount=p.amount, weight=p.weight, color=p.color,
        is_active=p.is_active, max_wins_total=p.max_wins_total,
        max_wins_per_operator=p.max_wins_per_operator, daily_limit=p.daily_limit,
        weekly_limit=p.weekly_limit, monthly_limit=p.monthly_limit,
        per_operator_daily_limit=p.per_operator_daily_limit,
        per_operator_weekly_limit=p.per_operator_weekly_limit, sort_order=p.sort_order,
    ).model_dump()


@admin_router.get("/prizes", response_model=dict, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_list_prizes(db: Session = Depends(get_db), campaign_id: int | None = Query(default=None)):
    stmt = select(WheelPrize).order_by(WheelPrize.sort_order.asc(), WheelPrize.id.asc())
    if campaign_id:
        stmt = stmt.where(WheelPrize.campaign_id == campaign_id)
    return {"items": [_prize_read(p) for p in db.scalars(stmt)]}


@admin_router.post("/prizes", response_model=PrizeRead, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_create_prize(payload: PrizeCreate, db: Session = Depends(get_db)):
    if payload.prize_type not in wheel_service.PRIZE_TYPES:
        raise HTTPException(status_code=400, detail=f"Недопустимый тип приза: {payload.prize_type}")
    campaign_id = payload.campaign_id or wheel_service.require_active_campaign(db).id
    prize = WheelPrize(campaign_id=campaign_id, **payload.model_dump(exclude={"campaign_id"}))
    db.add(prize)
    db.commit()
    db.refresh(prize)
    return _prize_read(prize)


@admin_router.patch("/prizes/{prize_id}", response_model=PrizeRead, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_update_prize(prize_id: int, payload: PrizeUpdate, db: Session = Depends(get_db)):
    prize = db.get(WheelPrize, prize_id)
    if not prize:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Приз не найден")
    data = payload.model_dump(exclude_unset=True)
    if "prize_type" in data and data["prize_type"] not in wheel_service.PRIZE_TYPES:
        raise HTTPException(status_code=400, detail=f"Недопустимый тип приза: {data['prize_type']}")
    for field, value in data.items():
        setattr(prize, field, value)
    db.commit()
    db.refresh(prize)
    return _prize_read(prize)


# ── Админка: токены (ТЗ 8.5, 14) ─────────────────────────────────────────────

@admin_router.get("/tokens", response_model=dict, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_list_tokens(
    db: Session = Depends(get_db),
    operator_id: int | None = Query(default=None),
    token_status: str | None = Query(default=None),
    limit: int = Query(default=80, ge=1, le=1000),
):
    stmt = select(WheelTicket).options(selectinload(WheelTicket.operator)).order_by(WheelTicket.created_at.desc())
    if operator_id:
        stmt = stmt.where(WheelTicket.operator_id == operator_id)
    if token_status:
        stmt = stmt.where(WheelTicket.status == token_status)
    rows = []
    for t in db.scalars(stmt.limit(limit)):
        op = t.operator
        rows.append(TokenRow(
            id=t.id, operator_id=t.operator_id, operator_name=op.full_name if op else "—",
            rule_id=t.rule_id, reason_type=t.reason_type, reason_text=t.reason_text,
            source_module=t.source_module, source_entity_id=t.source_entity_id,
            status=t.status, created_at=to_local_iso(t.created_at) or "",
            expires_at=to_local_iso(t.expires_at), used_at=to_local_iso(t.used_at),
        ).model_dump())
    return {"items": rows}


@admin_router.post("/tokens/grant", response_model=dict, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_grant_tokens(
    payload: GrantTokenRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    operator = db.get(Operator, payload.operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    campaign = db.get(WheelCampaign, payload.campaign_id) if payload.campaign_id else wheel_service.require_active_campaign(db)
    if not campaign or not campaign.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Кампания не найдена или неактивна")

    grant = WheelManualGrant(
        operator_id=operator.id, campaign_id=campaign.id,
        granted_by_user_id=current_user.id, tokens_count=payload.tokens_count,
        reason=payload.reason, comment=payload.comment,
    )
    db.add(grant)
    db.flush()

    ttl_backup = campaign.ticket_ttl_days
    if payload.ttl_hours:
        campaign.ticket_ttl_days = max(1, round(payload.ttl_hours / 24))
    issued_ids = []
    try:
        for _ in range(payload.tokens_count):
            ticket = wheel_service.issue_ticket(
                db, operator, campaign, reason_type="manual",
                reason_text=payload.reason, source_type="manual_grant",
                source_id=grant.id, created_by=current_user, enforce_daily_cap=False,
            )
            issued_ids.append(ticket.id)
    finally:
        campaign.ticket_ttl_days = ttl_backup
    db.commit()
    return {"granted": len(issued_ids), "token_ids": issued_ids, "grant_id": grant.id}


# ── Админка: логи проверок (ТЗ 8.7, 14) ──────────────────────────────────────

@admin_router.get("/evaluation-logs", response_model=dict, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_evaluation_logs(
    db: Session = Depends(get_db),
    operator_id: int | None = Query(default=None),
    rule_id: int | None = Query(default=None),
    eligible: bool | None = Query(default=None),
    limit: int = Query(default=80, ge=1, le=1000),
):
    stmt = select(WheelRuleEvaluationLog).order_by(WheelRuleEvaluationLog.created_at.desc())
    if operator_id:
        stmt = stmt.where(WheelRuleEvaluationLog.operator_id == operator_id)
    if rule_id:
        stmt = stmt.where(WheelRuleEvaluationLog.rule_id == rule_id)
    if eligible is not None:
        stmt = stmt.where(WheelRuleEvaluationLog.is_eligible.is_(eligible))
    logs = list(db.scalars(stmt.limit(limit)))
    operator_ids = {log.operator_id for log in logs if log.operator_id}
    operators = {}
    if operator_ids:
        operators = {op.id: op for op in db.scalars(select(Operator).where(Operator.id.in_(operator_ids))).all()}
    rows = []
    for log in logs:
        op = operators.get(log.operator_id)
        rows.append(EvaluationLogRow(
            id=log.id, operator_id=log.operator_id, operator_name=op.full_name if op else "—",
            rule_id=log.rule_id, source_module=log.source_module, source_entity_id=log.source_entity_id,
            metric_value=log.metric_value, threshold_value=log.threshold_value, operator=log.operator,
            is_eligible=log.is_eligible, reason=log.reason, created_token_id=log.created_token_id,
            created_at=to_local_iso(log.created_at) or "",
        ).model_dump())
    return {"items": rows}


# ── Админка: статистика (ТЗ 16) ──────────────────────────────────────────────

@admin_router.get("/stats", response_model=dict, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_stats(db: Session = Depends(get_db), day: date | None = Query(default=None)):
    from sqlalchemy import func as _f
    start, end = local_day_bounds_utc(day)

    def _count_tokens(status_):
        return db.scalar(select(_f.count(WheelTicket.id)).where(
            WheelTicket.created_at >= start, WheelTicket.created_at <= end,
            WheelTicket.status == status_,
        )) or 0

    issued = db.scalar(select(_f.count(WheelTicket.id)).where(
        WheelTicket.created_at >= start, WheelTicket.created_at <= end,
        WheelTicket.status != "cancelled",
    )) or 0

    spins = list(db.scalars(select(WheelSpin).where(
        WheelSpin.created_at >= start, WheelSpin.created_at <= end,
        WheelSpin.status == "completed",
    )))
    coins_awarded = 0
    prize_hist: dict[str, int] = {}
    for s in spins:
        p = _payload(s)
        if p.get("type") == "coins":
            coins_awarded += int(p.get("amount", 0) or 0)
        title = p.get("title", "—")
        prize_hist[title] = prize_hist.get(title, 0) + 1

    # Топ источников токенов за день
    src_rows = db.execute(
        select(WheelTicket.reason_type, _f.count(WheelTicket.id))
        .where(WheelTicket.created_at >= start, WheelTicket.created_at <= end, WheelTicket.status != "cancelled")
        .group_by(WheelTicket.reason_type)
        .order_by(_f.count(WheelTicket.id).desc())
    ).all()

    manual_granted = db.scalar(select(_f.count(WheelTicket.id)).where(
        WheelTicket.created_at >= start, WheelTicket.created_at <= end,
        WheelTicket.reason_type == "manual",
    )) or 0

    return {
        "date": to_local_iso(start),
        "tokens_issued": issued,
        "tokens_used": _count_tokens("used"),
        "tokens_expired": _count_tokens("expired"),
        "spins_completed": len(spins),
        "coins_awarded": coins_awarded,
        "manual_granted": manual_granted,
        "prizes_histogram": [{"title": k, "count": v} for k, v in sorted(prize_hist.items(), key=lambda x: -x[1])],
        "top_sources": [{"reason_type": r[0], "count": r[1]} for r in src_rows],
    }
