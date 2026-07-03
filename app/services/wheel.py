"""
Wheel of WOW — бизнес-логика (ТЗ разделы 13–15, 19).

Инварианты безопасности (ТЗ п.19 «Что нельзя делать»):
  * приз выбирается ТОЛЬКО здесь, на backend (frontend получает готовый
    результат и лишь анимирует);
  * коины начисляются ТОЛЬКО через coins.add_transaction (тип "wheel_of_wow",
    related_spin_id) — прямое изменение баланса запрещено;
  * билет используется строго один раз — гарантируется блокировкой строки
    билета (SELECT FOR UPDATE) плюс проверкой статуса под этой блокировкой;
  * ошибка на любом шаге прокрутки НЕ списывает билет и НЕ начисляет приз —
    билет помечается used в самом конце, коммит один; при исключении вызывающий
    роутер делает rollback, и билет остаётся available;
  * повторный запрос не выдаёт второй приз — после used доступных билетов нет.
"""
from __future__ import annotations

import json
import random
from datetime import timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.datetime_utils import local_day_bounds_utc, now_local, now_utc
from app.models.entities import (
    Operator,
    User,
    WheelCampaign,
    WheelPrize,
    WheelSpin,
    WheelTicket,
)
from app.services.coins import add_transaction

# random.SystemRandom — криптостойкий источник: вес приза нельзя предсказать/
# воспроизвести подбором сида. Для честной лотереи это правильный выбор.
_rng = random.SystemRandom()

TICKET_AVAILABLE = "available"
TICKET_USED = "used"
TICKET_EXPIRED = "expired"
TICKET_CANCELLED = "cancelled"

PRIZE_TYPES = ("coins", "shop_discount", "extra_ticket", "badge", "manual_reward")


# ── Кампания ─────────────────────────────────────────────────────────────────

def active_campaign(db: Session) -> WheelCampaign | None:
    """
    Активная кампания. Если их несколько — берём самую свежую (по id), чтобы
    поведение было детерминированным, а не зависело от порядка вставки.
    Учитываем окно дат кампании (start_date/end_date), если заданы.
    """
    today = now_local().date()
    stmt = (
        select(WheelCampaign)
        .where(WheelCampaign.is_active.is_(True))
        .order_by(WheelCampaign.id.desc())
    )
    for campaign in db.scalars(stmt):
        if campaign.start_date and today < campaign.start_date:
            continue
        if campaign.end_date and today > campaign.end_date:
            continue
        return campaign
    return None


def require_active_campaign(db: Session) -> WheelCampaign:
    campaign = active_campaign(db)
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Активная кампания колеса не найдена")
    return campaign


# ── Билеты ───────────────────────────────────────────────────────────────────

def _expire_stale_tickets(db: Session, operator_id: int) -> None:
    """Ленивое истечение: available-билеты с истёкшим сроком → expired.
    Вызывается при любом чтении статуса/прокрутке — отдельный крон не нужен."""
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
        # SessionLocal настроен с autoflush=False — без явного flush последующий
        # SELECT по status=available прочитает старое значение из БД и вернёт
        # уже истёкший билет.
        db.flush()


def available_tickets(db: Session, operator_id: int) -> list[WheelTicket]:
    _expire_stale_tickets(db, operator_id)
    return db.scalars(
        select(WheelTicket)
        .where(
            WheelTicket.operator_id == operator_id,
            WheelTicket.status == TICKET_AVAILABLE,
        )
        .order_by(WheelTicket.created_at.asc())  # FIFO: старый билет сгорит первым
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
    Выдаёт билет. По умолчанию соблюдает дневной лимит ВЫДАЧИ (ТЗ п.4.3:
    «максимум 1 билет в день»), считая уже выданные за локальный день билеты.
    Ручная выдача супервайзером может обходить лимит (enforce_daily_cap=False) —
    это осознанное решение из ТЗ (ручная выдача за конкретную заслугу).
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


# ── Лимиты прокруток ─────────────────────────────────────────────────────────

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
    # Неделя = последние 7 локальных дней, считая сегодня (скользящее окно).
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
        }
    tickets = available_tickets(db, operator.id)
    next_ticket = tickets[0] if tickets else None
    return {
        "campaign": {"id": campaign.id, "title": campaign.title},
        "available_tickets": len(tickets),
        "spins_used_today": _spins_used_today(db, operator.id),
        "max_spins_per_day": campaign.max_spins_per_day,
        "spins_used_this_week": _spins_used_this_week(db, operator.id),
        "max_spins_per_week": campaign.max_spins_per_week,
        "next_ticket_reason": next_ticket.reason_text if next_ticket else None,
    }


# ── Выбор приза по весу (ТЗ раздел 14) ───────────────────────────────────────

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
        # Общий лимит выигрышей приза
        if prize.max_wins_total:
            total = db.scalar(
                select(func.count(WheelSpin.id)).where(
                    WheelSpin.prize_id == prize.id,
                    WheelSpin.status == "completed",
                )
            ) or 0
            if total >= prize.max_wins_total:
                continue
        # Персональный лимит выигрышей приза
        if prize.max_wins_per_operator:
            per_op = db.scalar(
                select(func.count(WheelSpin.id)).where(
                    WheelSpin.prize_id == prize.id,
                    WheelSpin.operator_id == operator_id,
                    WheelSpin.status == "completed",
                )
            ) or 0
            if per_op >= prize.max_wins_per_operator:
                continue
        eligible.append(prize)
    return eligible


def choose_prize(prizes: list[WheelPrize], rng=_rng) -> WheelPrize:
    """
    Взвешенный выбор. Вынесен отдельно и принимает rng — чтобы тесты могли
    подать детерминированный генератор и проверить распределение/границы.
    """
    if not prizes:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Нет доступных призов")
    total_weight = sum(p.weight for p in prizes)
    if total_weight <= 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Нет доступных призов")
    # 1..total_weight включительно, диапазонный обход
    roll = rng.randint(1, total_weight)
    cursor = 0
    for prize in prizes:
        cursor += prize.weight
        if roll <= cursor:
            return prize
    return prizes[-1]  # недостижимо, страховка от ошибок округления


# ── Прокрутка ────────────────────────────────────────────────────────────────

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

    prize = choose_prize(_eligible_prizes(db, campaign.id, operator.id), rng=rng)

    # Снимок приза — история не должна «поехать» при будущем редактировании секторов
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
    db.flush()  # нужен spin_row.id для related_spin_id

    message = _grant_prize(db, operator, campaign, prize, spin_row)

    # Завершаем в самом конце — если что-то выше упало, билет остался available
    ticket.status = TICKET_USED
    ticket.used_at = now_utc()
    spin_row.status = "completed"
    spin_row.completed_at = now_utc()

    return {
        "spin_id": spin_row.id,
        "prize": {"id": prize.id, "title": prize.title, "type": prize.prize_type, "amount": prize.amount, "color": prize.color},
        "reason": ticket.reason_text,
        "message": message,
    }


def _grant_prize(db, operator, campaign, prize: WheelPrize, spin_row: WheelSpin) -> str:
    """Начисление приза по типу. Коины — ТОЛЬКО через add_transaction."""
    if prize.prize_type == "coins":
        add_transaction(
            db, operator, prize.amount, "wheel_of_wow",
            comment=f"Приз Wheel of WOW: {prize.title}",
            related_spin_id=spin_row.id,
        )
        return f"Вы выиграли {prize.title}"

    if prize.prize_type == "extra_ticket":
        # Доп. билет выдаём в обход дневного лимита выдачи — это сам приз колеса,
        # а не новое достижение.
        issue_ticket(
            db, operator, campaign,
            reason_type="extra_ticket",
            reason_text=f"Дополнительный билет с колеса (прокрутка #{spin_row.id})",
            source_type="wheel_spin", source_id=spin_row.id,
            enforce_daily_cap=False,
        )
        return "Вы выиграли дополнительный билет"

    # shop_discount | badge | manual_reward — фиксируются в истории прокрутки,
    # выдача/вручение — оффлайн-процесс руководителя. Баланс не трогаем.
    labels = {
        "shop_discount": f"Скидка в магазине: {prize.title}",
        "badge": f"Бейдж: {prize.title}",
        "manual_reward": f"Ручной приз: {prize.title}",
    }
    return f"Вы выиграли {labels.get(prize.prize_type, prize.title)}"
