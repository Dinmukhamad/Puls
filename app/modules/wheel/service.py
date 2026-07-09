"""
Wheel of WOW вЂ” Р±РёР·РЅРµСЃ-Р»РѕРіРёРєР° (РўР— СЂР°Р·РґРµР»С‹ 13вЂ“15, 19).

РРЅРІР°СЂРёР°РЅС‚С‹ Р±РµР·РѕРїР°СЃРЅРѕСЃС‚Рё (РўР— Рї.19 В«Р§С‚Рѕ РЅРµР»СЊР·СЏ РґРµР»Р°С‚СЊВ»):
  * РїСЂРёР· РІС‹Р±РёСЂР°РµС‚СЃСЏ РўРћР›Р¬РљРћ Р·РґРµСЃСЊ, РЅР° backend (frontend РїРѕР»СѓС‡Р°РµС‚ РіРѕС‚РѕРІС‹Р№
    СЂРµР·СѓР»СЊС‚Р°С‚ Рё Р»РёС€СЊ Р°РЅРёРјРёСЂСѓРµС‚);
  * РєРѕРёРЅС‹ РЅР°С‡РёСЃР»СЏСЋС‚СЃСЏ РўРћР›Р¬РљРћ С‡РµСЂРµР· coins.add_transaction (С‚РёРї "wheel_of_wow",
    related_spin_id) вЂ” РїСЂСЏРјРѕРµ РёР·РјРµРЅРµРЅРёРµ Р±Р°Р»Р°РЅСЃР° Р·Р°РїСЂРµС‰РµРЅРѕ;
  * Р±РёР»РµС‚ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ СЃС‚СЂРѕРіРѕ РѕРґРёРЅ СЂР°Р· вЂ” РіР°СЂР°РЅС‚РёСЂСѓРµС‚СЃСЏ Р±Р»РѕРєРёСЂРѕРІРєРѕР№ СЃС‚СЂРѕРєРё
    Р±РёР»РµС‚Р° (SELECT FOR UPDATE) РїР»СЋСЃ РїСЂРѕРІРµСЂРєРѕР№ СЃС‚Р°С‚СѓСЃР° РїРѕРґ СЌС‚РѕР№ Р±Р»РѕРєРёСЂРѕРІРєРѕР№;
  * РѕС€РёР±РєР° РЅР° Р»СЋР±РѕРј С€Р°РіРµ РїСЂРѕРєСЂСѓС‚РєРё РќР• СЃРїРёСЃС‹РІР°РµС‚ Р±РёР»РµС‚ Рё РќР• РЅР°С‡РёСЃР»СЏРµС‚ РїСЂРёР· вЂ”
    Р±РёР»РµС‚ РїРѕРјРµС‡Р°РµС‚СЃСЏ used РІ СЃР°РјРѕРј РєРѕРЅС†Рµ, РєРѕРјРјРёС‚ РѕРґРёРЅ; РїСЂРё РёСЃРєР»СЋС‡РµРЅРёРё РІС‹Р·С‹РІР°СЋС‰РёР№
    СЂРѕСѓС‚РµСЂ РґРµР»Р°РµС‚ rollback, Рё Р±РёР»РµС‚ РѕСЃС‚Р°С‘С‚СЃСЏ available;
  * РїРѕРІС‚РѕСЂРЅС‹Р№ Р·Р°РїСЂРѕСЃ РЅРµ РІС‹РґР°С‘С‚ РІС‚РѕСЂРѕР№ РїСЂРёР· вЂ” РїРѕСЃР»Рµ used РґРѕСЃС‚СѓРїРЅС‹С… Р±РёР»РµС‚РѕРІ РЅРµС‚.
"""
from __future__ import annotations

import json
import random
from datetime import timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.datetime_utils import local_day_bounds_utc, now_local, now_utc, to_local_iso
from app.models.entities import (
    Operator,
    User,
    WheelCampaign,
    WheelPrize,
    WheelSpin,
    WheelTicket,
)
from app.modules.wallet.service import add_transaction

# Минимальный интервал между прокрутками одного оператора (секунды). Защита
# от быстрых повторных кликов/прямых запросов к API: даже если фронтенд
# по какой-то причине не заблокировал кнопку, backend не даст начать новую
# прокрутку, пока не «отыграла» предыдущая анимация (см. wheel-spin-btn на
# фронте — там анимация ~2.6с). Значение чуть меньше анимации, чтобы не
# отклонять честный клик сразу после того, как кнопка снова стала активна.
MIN_SECONDS_BETWEEN_SPINS = 2.5


# random.SystemRandom вЂ” РєСЂРёРїС‚РѕСЃС‚РѕР№РєРёР№ РёСЃС‚РѕС‡РЅРёРє: РІРµСЃ РїСЂРёР·Р° РЅРµР»СЊР·СЏ РїСЂРµРґСЃРєР°Р·Р°С‚СЊ/
# РІРѕСЃРїСЂРѕРёР·РІРµСЃС‚Рё РїРѕРґР±РѕСЂРѕРј СЃРёРґР°. Р”Р»СЏ С‡РµСЃС‚РЅРѕР№ Р»РѕС‚РµСЂРµРё СЌС‚Рѕ РїСЂР°РІРёР»СЊРЅС‹Р№ РІС‹Р±РѕСЂ.
_rng = random.SystemRandom()

TICKET_AVAILABLE = "available"
TICKET_USED = "used"
TICKET_EXPIRED = "expired"
TICKET_CANCELLED = "cancelled"

# extra_ticket / spin_token вЂ” СЃРёРЅРѕРЅРёРјС‹ (РўР— Рї.7.1 В«РїРѕРІС‚РѕСЂРЅРѕРµ РІСЂР°С‰РµРЅРёРµВ»);
# empty_consolation РґРѕРїСѓСЃС‚РёРј РєР°Рє С‚РёРї, РЅРѕ РўР— Рї.7.2 Р·Р°РїСЂРµС‰Р°РµС‚ РїСѓСЃС‚РѕР№ СЃРµРєС‚РѕСЂ.
PRIZE_TYPES = (
    "coins", "shop_discount", "extra_ticket", "spin_token", "badge",
    "manual_reward", "raffle_ticket", "status", "empty_consolation",
)


# в”Ђв”Ђ РљР°РјРїР°РЅРёСЏ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

def active_campaign(db: Session) -> WheelCampaign | None:
    """
    Wheel is always available while at least one campaign exists.
    Dates and disabled flags are legacy settings and must not stop the wheel.
    """
    return db.scalar(
        select(WheelCampaign).order_by(WheelCampaign.is_active.desc(), WheelCampaign.id.desc())
    )


def require_active_campaign(db: Session) -> WheelCampaign:
    campaign = active_campaign(db)
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Активная кампания колеса не найдена")
    return campaign


# в”Ђв”Ђ Р‘РёР»РµС‚С‹ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

def _expire_stale_tickets(db: Session, operator_id: int) -> None:
    """Р›РµРЅРёРІРѕРµ РёСЃС‚РµС‡РµРЅРёРµ: available-Р±РёР»РµС‚С‹ СЃ РёСЃС‚С‘РєС€РёРј СЃСЂРѕРєРѕРј в†’ expired.
    Р’С‹Р·С‹РІР°РµС‚СЃСЏ РїСЂРё Р»СЋР±РѕРј С‡С‚РµРЅРёРё СЃС‚Р°С‚СѓСЃР°/РїСЂРѕРєСЂСѓС‚РєРµ вЂ” РѕС‚РґРµР»СЊРЅС‹Р№ РєСЂРѕРЅ РЅРµ РЅСѓР¶РµРЅ."""
    now = now_utc()
    stale = db.scalars(
        select(WheelTicket).where(
            WheelTicket.operator_id == operator_id,
            WheelTicket.status == TICKET_AVAILABLE,
            WheelTicket.expires_at.is_not(None),
            WheelTicket.expires_at < now,
        )
    ).all()
    for ticket in stale:
        ticket.status = TICKET_EXPIRED
    if stale:
        # SessionLocal РЅР°СЃС‚СЂРѕРµРЅ СЃ autoflush=False вЂ” Р±РµР· СЏРІРЅРѕРіРѕ flush РїРѕСЃР»РµРґСѓСЋС‰РёР№
        # SELECT РїРѕ status=available РїСЂРѕС‡РёС‚Р°РµС‚ СЃС‚Р°СЂРѕРµ Р·РЅР°С‡РµРЅРёРµ РёР· Р‘Р” Рё РІРµСЂРЅС‘С‚
        # СѓР¶Рµ РёСЃС‚С‘РєС€РёР№ Р±РёР»РµС‚.
        db.flush()


def available_tickets(db: Session, operator_id: int) -> list[WheelTicket]:
    _expire_stale_tickets(db, operator_id)
    return db.scalars(
        select(WheelTicket)
        .where(
            WheelTicket.operator_id == operator_id,
            WheelTicket.status == TICKET_AVAILABLE,
        )
        .order_by(WheelTicket.created_at.asc())  # FIFO: СЃС‚Р°СЂС‹Р№ Р±РёР»РµС‚ СЃРіРѕСЂРёС‚ РїРµСЂРІС‹Рј
    ).all()


def issue_ticket(
    db: Session,
    operator: Operator,
    campaign: WheelCampaign,
    *,
    reason_type: str,
    reason_text: str,
    source_type: str = "manual",
    source_id: int | None = None,
    created_by: User | None = None,
    enforce_daily_cap: bool = True,
) -> WheelTicket:
    """
    Р’С‹РґР°С‘С‚ Р±РёР»РµС‚. РџРѕ СѓРјРѕР»С‡Р°РЅРёСЋ СЃРѕР±Р»СЋРґР°РµС‚ РґРЅРµРІРЅРѕР№ Р»РёРјРёС‚ Р’Р«Р”РђР§Р (РўР— Рї.4.3:
    В«РјР°РєСЃРёРјСѓРј 1 Р±РёР»РµС‚ РІ РґРµРЅСЊВ»), СЃС‡РёС‚Р°СЏ СѓР¶Рµ РІС‹РґР°РЅРЅС‹Рµ Р·Р° Р»РѕРєР°Р»СЊРЅС‹Р№ РґРµРЅСЊ Р±РёР»РµС‚С‹.
    Р СѓС‡РЅР°СЏ РІС‹РґР°С‡Р° СЃСѓРїРµСЂРІР°Р№Р·РµСЂРѕРј РјРѕР¶РµС‚ РѕР±С…РѕРґРёС‚СЊ Р»РёРјРёС‚ (enforce_daily_cap=False) вЂ”
    СЌС‚Рѕ РѕСЃРѕР·РЅР°РЅРЅРѕРµ СЂРµС€РµРЅРёРµ РёР· РўР— (СЂСѓС‡РЅР°СЏ РІС‹РґР°С‡Р° Р·Р° РєРѕРЅРєСЂРµС‚РЅСѓСЋ Р·Р°СЃР»СѓРіСѓ).
    """
    if enforce_daily_cap:
        day_start, day_end = local_day_bounds_utc()
        issued_today = db.scalar(
            select(func.count(WheelTicket.id)).where(
                WheelTicket.operator_id == operator.id,
                WheelTicket.campaign_id == campaign.id,
                WheelTicket.created_at >= day_start,
                WheelTicket.created_at <= day_end,
                WheelTicket.status != TICKET_CANCELLED,
            )
        )
        if issued_today and issued_today >= 1:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Билет за сегодня уже выдан")

    ttl_days = campaign.ticket_ttl_days or 3
    ticket = WheelTicket(
        operator_id=operator.id,
        campaign_id=campaign.id,
        reason_type=reason_type,
        reason_text=reason_text.strip(),
        source_type=source_type,
        source_id=source_id,
        status=TICKET_AVAILABLE,
        expires_at=now_utc() + timedelta(days=ttl_days),
        created_by_user_id=created_by.id if created_by else None,
    )
    db.add(ticket)
    db.flush()
    return ticket


# в”Ђв”Ђ Р›РёРјРёС‚С‹ РїСЂРѕРєСЂСѓС‚РѕРє в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

def _last_spin_at(db: Session, operator_id: int):
    """Момент последней ЗАВЕРШЁННОЙ прокрутки — источник для проверки
    минимального интервала между прокрутками (см. MIN_SECONDS_BETWEEN_SPINS)."""
    return db.scalar(
        select(func.max(WheelSpin.completed_at)).where(
            WheelSpin.operator_id == operator_id,
            WheelSpin.status == "completed",
        )
    )


def _spins_used_today(db: Session, operator_id: int) -> int:
    day_start, day_end = local_day_bounds_utc()
    return db.scalar(
        select(func.count(WheelSpin.id)).where(
            WheelSpin.operator_id == operator_id,
            WheelSpin.status == "completed",
            WheelSpin.created_at >= day_start,
            WheelSpin.created_at <= day_end,
        )
    ) or 0


def _spins_used_this_week(db: Session, operator_id: int) -> int:
    # РќРµРґРµР»СЏ = РїРѕСЃР»РµРґРЅРёРµ 7 Р»РѕРєР°Р»СЊРЅС‹С… РґРЅРµР№, СЃС‡РёС‚Р°СЏ СЃРµРіРѕРґРЅСЏ (СЃРєРѕР»СЊР·СЏС‰РµРµ РѕРєРЅРѕ).
    day_start, _ = local_day_bounds_utc()
    week_start = day_start - timedelta(days=6)
    return db.scalar(
        select(func.count(WheelSpin.id)).where(
            WheelSpin.operator_id == operator_id,
            WheelSpin.status == "completed",
            WheelSpin.created_at >= week_start,
        )
    ) or 0


def wheel_status(db: Session, operator: Operator) -> dict:
    campaign = active_campaign(db)
    if not campaign:
        return {
            "campaign": None,
            "available_tickets": 0,
            "spins_used_today": 0,
            "max_spins_per_day": 0,
            "spins_used_this_week": 0,
            "max_spins_per_week": 0,
            "next_ticket_reason": None,
            "can_spin": False,
            "reason_if_cannot_spin": "Активная кампания колеса не найдена",
            "last_prize": None,
        }
    tickets = available_tickets(db, operator.id)
    next_ticket = tickets[0] if tickets else None
    used_today = _spins_used_today(db, operator.id)
    used_week = _spins_used_this_week(db, operator.id)

    can_spin = True
    reason = None
    if not tickets:
        can_spin, reason = False, "Нет доступных билетов"
    elif campaign.max_spins_per_day and used_today >= campaign.max_spins_per_day:
        can_spin, reason = False, "Достигнут дневной лимит прокруток"
    elif campaign.max_spins_per_week and used_week >= campaign.max_spins_per_week:
        can_spin, reason = False, "Достигнут недельный лимит прокруток"

    last_prize = _last_prize(db, operator.id)
    return {
        "campaign": {"id": campaign.id, "title": campaign.title},
        "available_tickets": len(tickets),
        "spins_used_today": used_today,
        "max_spins_per_day": campaign.max_spins_per_day,
        "spins_used_this_week": used_week,
        "max_spins_per_week": campaign.max_spins_per_week,
        "next_ticket_reason": next_ticket.reason_text if next_ticket else None,
        "can_spin": can_spin,
        "reason_if_cannot_spin": reason,
        "last_prize": last_prize,
    }


def _last_prize(db: Session, operator_id: int) -> dict | None:
    from app.models.entities import WheelOperatorDailyState
    state = db.scalars(
        select(WheelOperatorDailyState)
        .where(WheelOperatorDailyState.operator_id == operator_id, WheelOperatorDailyState.last_prize_title.is_not(None))
        .order_by(WheelOperatorDailyState.date.desc())
    ).first()
    if not state or not state.last_prize_title:
        return None
    return {
        "title": state.last_prize_title,
        "type": state.last_prize_type,
        "value": state.last_prize_value,
        "at": to_local_iso(state.last_spin_at),
    }


# в”Ђв”Ђ Р’С‹Р±РѕСЂ РїСЂРёР·Р° РїРѕ РІРµСЃСѓ (РўР— СЂР°Р·РґРµР» 14) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

def _wins_in_window(db, prize_id, *, operator_id=None, days=None) -> int:
    stmt = select(func.count(WheelSpin.id)).where(
        WheelSpin.prize_id == prize_id,
        WheelSpin.status == "completed",
    )
    if operator_id is not None:
        stmt = stmt.where(WheelSpin.operator_id == operator_id)
    if days is not None:
        day_start, _ = local_day_bounds_utc()
        window_start = day_start - timedelta(days=days - 1)
        stmt = stmt.where(WheelSpin.created_at >= window_start)
    return db.scalar(stmt) or 0


def _eligible_prizes(db: Session, campaign_id: int, operator_id: int) -> list[WheelPrize]:
    prizes = db.scalars(
        select(WheelPrize).where(
            WheelPrize.campaign_id == campaign_id,
            WheelPrize.is_active.is_(True),
            WheelPrize.weight > 0,
        )
    ).all()

    eligible: list[WheelPrize] = []
    for prize in prizes:
        # РћР±С‰РёР№ Р»РёРјРёС‚ РІС‹РёРіСЂС‹С€РµР№ РїСЂРёР·Р° (Р·Р° РІСЃС‘ РІСЂРµРјСЏ)
        if prize.max_wins_total and _wins_in_window(db, prize.id) >= prize.max_wins_total:
            continue
        # РџРµСЂСЃРѕРЅР°Р»СЊРЅС‹Р№ Р»РёРјРёС‚ РІС‹РёРіСЂС‹С€РµР№ РїСЂРёР·Р° (Р·Р° РІСЃС‘ РІСЂРµРјСЏ)
        if prize.max_wins_per_operator and _wins_in_window(db, prize.id, operator_id=operator_id) >= prize.max_wins_per_operator:
            continue
        # Р›РёРјРёС‚С‹ РїРѕ СЃРєРѕР»СЊР·СЏС‰РёРј РѕРєРЅР°Рј (РўР— 8.2)
        if prize.daily_limit and _wins_in_window(db, prize.id, days=1) >= prize.daily_limit:
            continue
        if prize.weekly_limit and _wins_in_window(db, prize.id, days=7) >= prize.weekly_limit:
            continue
        if prize.monthly_limit and _wins_in_window(db, prize.id, days=30) >= prize.monthly_limit:
            continue
        if prize.per_operator_daily_limit and _wins_in_window(db, prize.id, operator_id=operator_id, days=1) >= prize.per_operator_daily_limit:
            continue
        if prize.per_operator_weekly_limit and _wins_in_window(db, prize.id, operator_id=operator_id, days=7) >= prize.per_operator_weekly_limit:
            continue
        eligible.append(prize)
    return eligible


def choose_prize(prizes: list[WheelPrize], rng=_rng) -> WheelPrize:
    """
    Р’Р·РІРµС€РµРЅРЅС‹Р№ РІС‹Р±РѕСЂ. Р’С‹РЅРµСЃРµРЅ РѕС‚РґРµР»СЊРЅРѕ Рё РїСЂРёРЅРёРјР°РµС‚ rng вЂ” С‡С‚РѕР±С‹ С‚РµСЃС‚С‹ РјРѕРіР»Рё
    РїРѕРґР°С‚СЊ РґРµС‚РµСЂРјРёРЅРёСЂРѕРІР°РЅРЅС‹Р№ РіРµРЅРµСЂР°С‚РѕСЂ Рё РїСЂРѕРІРµСЂРёС‚СЊ СЂР°СЃРїСЂРµРґРµР»РµРЅРёРµ/РіСЂР°РЅРёС†С‹.
    """
    if not prizes:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Нет доступных призов")
    total_weight = sum(p.weight for p in prizes)
    if total_weight <= 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Нет доступных призов")
    # 1..total_weight РІРєР»СЋС‡РёС‚РµР»СЊРЅРѕ, РґРёР°РїР°Р·РѕРЅРЅС‹Р№ РѕР±С…РѕРґ
    roll = rng.randint(1, total_weight)
    cursor = 0
    for prize in prizes:
        cursor += prize.weight
        if roll <= cursor:
            return prize
    return prizes[-1]  # РЅРµРґРѕСЃС‚РёР¶РёРјРѕ, СЃС‚СЂР°С…РѕРІРєР° РѕС‚ РѕС€РёР±РѕРє РѕРєСЂСѓРіР»РµРЅРёСЏ


# в”Ђв”Ђ РџСЂРѕРєСЂСѓС‚РєР° в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

def spin(db: Session, operator: Operator, *, rng=_rng) -> dict:
    """
    Атомарная прокрутка. Вся работа — в одной транзакции; коммит делает
    вызывающий роутер, он же откатывает при исключении (билет не списывается).
    """
    campaign = require_active_campaign(db)

    # Лимиты прокруток
    if campaign.max_spins_per_day and _spins_used_today(db, operator.id) >= campaign.max_spins_per_day:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Достигнут дневной лимит прокруток")
    if campaign.max_spins_per_week and _spins_used_this_week(db, operator.id) >= campaign.max_spins_per_week:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Достигнут недельный лимит прокруток")

    _expire_stale_tickets(db, operator.id)

    # Берём старейший доступный билет С БЛОКИРОВКОЙ строки. На PostgreSQL это
    # сериализует параллельные прокрутки одного оператора: второй запрос ждёт
    # первый, после коммита видит билет used и доступных не находит.
    ticket = db.scalars(
        select(WheelTicket)
        .where(
            WheelTicket.operator_id == operator.id,
            WheelTicket.status == TICKET_AVAILABLE,
        )
        .order_by(WheelTicket.created_at.asc())
        .limit(1)
        .with_for_update()
    ).first()
    if not ticket:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Нет доступных билетов")
    if ticket.expires_at and ticket.expires_at < now_utc():
        ticket.status = TICKET_EXPIRED
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Билет истёк")

    # Защита от слишком быстрых повторных прокруток (см. MIN_SECONDS_BETWEEN_SPINS
    # выше) — только теперь, когда мы точно знаем, что билет есть и он валиден:
    # «нет билетов» (409) должно оставаться приоритетнее «слишком быстро» (429),
    # а не наоборот. Даже если фронтенд не заблокировал кнопку вовремя или запрос
    # пришёл напрямую в API, следующая прокрутка не начнётся, пока не «отыграла»
    # предыдущая.
    last_spin_at = _last_spin_at(db, operator.id)
    if last_spin_at is not None:
        elapsed = (now_utc() - last_spin_at).total_seconds()
        if elapsed < MIN_SECONDS_BETWEEN_SPINS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Подождите ещё {MIN_SECONDS_BETWEEN_SPINS - elapsed:.1f} сек. перед следующей прокруткой",
            )

    prize = choose_prize(_eligible_prizes(db, campaign.id, operator.id), rng=rng)

    # РЎРЅРёРјРѕРє РїСЂРёР·Р° вЂ” РёСЃС‚РѕСЂРёСЏ РЅРµ РґРѕР»Р¶РЅР° В«РїРѕРµС…Р°С‚СЊВ» РїСЂРё Р±СѓРґСѓС‰РµРј СЂРµРґР°РєС‚РёСЂРѕРІР°РЅРёРё СЃРµРєС‚РѕСЂРѕРІ
    payload = {
        "prize_id": prize.id,
        "title": prize.title,
        "type": prize.prize_type,
        "amount": prize.amount,
        "color": prize.color,
    }
    spin_row = WheelSpin(
        operator_id=operator.id,
        ticket_id=ticket.id,
        campaign_id=campaign.id,
        prize_id=prize.id,
        status="created",
        result_payload_json=json.dumps(payload, ensure_ascii=False),
    )
    db.add(spin_row)
    db.flush()  # РЅСѓР¶РµРЅ spin_row.id РґР»СЏ related_spin_id

    message = _grant_prize(db, operator, campaign, prize, spin_row)

    # Р—Р°РІРµСЂС€Р°РµРј РІ СЃР°РјРѕРј РєРѕРЅС†Рµ вЂ” РµСЃР»Рё С‡С‚Рѕ-С‚Рѕ РІС‹С€Рµ СѓРїР°Р»Рѕ, Р±РёР»РµС‚ РѕСЃС‚Р°Р»СЃСЏ available
    ticket.status = TICKET_USED
    ticket.used_at = now_utc()
    spin_row.status = "completed"
    spin_row.completed_at = now_utc()

    _update_daily_state_after_spin(db, operator.id, prize)

    return {
        "spin_id": spin_row.id,
        "prize": {"id": prize.id, "title": prize.title, "type": prize.prize_type, "amount": prize.amount, "color": prize.color},
        "reason": ticket.reason_text,
        "message": message,
    }


def _grant_prize(db, operator, campaign, prize: WheelPrize, spin_row: WheelSpin) -> str:
    """РќР°С‡РёСЃР»РµРЅРёРµ РїСЂРёР·Р° РїРѕ С‚РёРїСѓ. РљРѕРёРЅС‹ вЂ” РўРћР›Р¬РљРћ С‡РµСЂРµР· add_transaction.
    XP-С‚РёРїР° Р·РґРµСЃСЊ РЅРµС‚ РЅР°РјРµСЂРµРЅРЅРѕ: XP-РјРѕРґСѓР»СЏ РІ СЃРёСЃС‚РµРјРµ РїРѕРєР° РЅРµ СЃСѓС‰РµСЃС‚РІСѓРµС‚."""
    if prize.prize_type == "coins":
        add_transaction(
            db, operator, prize.amount, "wheel_of_wow",
            comment=f"Приз Wheel of WOW: {prize.title}",
            related_spin_id=spin_row.id,
        )
        return f"Вы выиграли {prize.title}"

    if prize.prize_type in ("extra_ticket", "spin_token"):
        # РџРѕРІС‚РѕСЂРЅРѕРµ РІСЂР°С‰РµРЅРёРµ = РЅРѕРІС‹Р№ С‚РѕРєРµРЅ, РІ РѕР±С…РѕРґ РґРЅРµРІРЅРѕРіРѕ Р»РёРјРёС‚Р° Р’Р«Р”РђР§Р
        # (СЌС‚Рѕ СЃР°Рј РїСЂРёР· РєРѕР»РµСЃР°, Р° РЅРµ РЅРѕРІРѕРµ РґРѕСЃС‚РёР¶РµРЅРёРµ). РўР— 12.2.
        issue_ticket(
            db, operator, campaign,
            reason_type="extra_ticket",
            reason_text=f"Дополнительный билет с колеса (прокрутка #{spin_row.id})",
            source_type="wheel_spin", source_id=spin_row.id,
            enforce_daily_cap=False,
        )
        return "Вы выиграли дополнительный билет"

    # raffle_ticket | shop_discount | badge | status | manual_reward |
    # empty_consolation вЂ” С„РёРєСЃРёСЂСѓСЋС‚СЃСЏ РІ РёСЃС‚РѕСЂРёРё РїСЂРѕРєСЂСѓС‚РєРё; РІС‹РґР°С‡Р°/РІСЂСѓС‡РµРЅРёРµ вЂ”
    # РѕС„С„Р»Р°Р№РЅ-РїСЂРѕС†РµСЃСЃ СЂСѓРєРѕРІРѕРґРёС‚РµР»СЏ (Р±РёР»РµС‚ РІ СЂРѕР·С‹РіСЂС‹С€, СЃС‚Р°С‚СѓСЃ РґРЅСЏ Рё С‚.Рї.).
    # Р‘Р°Р»Р°РЅСЃ РЅРµ С‚СЂРѕРіР°РµРј.
    labels = {
        "shop_discount": f"Скидка в магазине: {prize.title}",
        "badge": f"Бейдж: {prize.title}",
        "raffle_ticket": f"Билет в розыгрыш: {prize.title}",
        "status": f"Статус: {prize.title}",
        "manual_reward": f"Ручной приз: {prize.title}",
        "empty_consolation": prize.title,
    }
    return f"Вы выиграли {labels.get(prize.prize_type, prize.title)}"


def _update_daily_state_after_spin(db: Session, operator_id: int, prize: WheelPrize) -> None:
    """РћР±РЅРѕРІР»СЏРµС‚ wheel_operator_daily_state РїРѕСЃР»Рµ РїСЂРѕРєСЂСѓС‚РєРё (РўР— 8.8)."""
    from app.models.entities import WheelOperatorDailyState
    today = now_local().date()
    day_start, day_end = local_day_bounds_utc(today)

    def _count(status_):
        return db.scalar(
            select(func.count(WheelTicket.id)).where(
                WheelTicket.operator_id == operator_id,
                WheelTicket.status == status_,
                WheelTicket.created_at >= day_start,
                WheelTicket.created_at <= day_end,
            )
        ) or 0

    state = db.scalars(
        select(WheelOperatorDailyState).where(
            WheelOperatorDailyState.operator_id == operator_id,
            WheelOperatorDailyState.date == today,
        )
    ).first()
    if not state:
        state = WheelOperatorDailyState(operator_id=operator_id, date=today)
        db.add(state)
    state.active_tokens_count = _count(TICKET_AVAILABLE)
    state.used_tokens_count = _count(TICKET_USED)
    state.expired_tokens_count = _count(TICKET_EXPIRED)
    state.last_spin_at = now_utc()
    state.last_prize_title = prize.title
    state.last_prize_type = prize.prize_type
    state.last_prize_value = prize.amount
