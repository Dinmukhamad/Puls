"""Личный кабинет оператора (ТЗ §5): один агрегирующий эндпоинт вместо 4-5
отдельных запросов (баланс, рейтинг, показатели недели, прозрачный расчёт
коинов, достижения, история). Данные не пересчитываются здесь — берутся из
уже существующих источников (wallet, rating, weekly_results/accrual_service,
achievements), это просто витрина."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.datetime_utils import local_day_bounds_utc, now_utc, to_local_iso
from app.core.security import get_current_user, supervisor_scope_group_id
from app.database.db import get_db
from app.models.entities import CoinTransaction, Operator, User, WeeklyAccrualDetail, WeeklyResult, WheelSpin
from app.modules.achievements.service import get_operator_achievements_payload
from app.modules.operator_levels.service import operator_level_summary
from app.modules.rating.service import my_rating, rating_rows
from app.modules.wallet.service import operator_for_user_or_403
from app.modules.weekly_results.accrual_service import calculate_period_accrual
from app.modules.wheel.service import wheel_status
from app.modules.work_norms.service import calculate_norm_for_period

router = APIRouter(prefix="/cabinet", tags=["cabinet"])

# Целевое качество — фиксированный ориентир для дисплея (ТЗ 5.4 пример: 95%).
# В проекте нет отдельной настройки под это; в отличие от hours_target (норма
# часов), для quality нет источника, из которого её можно было бy взять по
# оператору/группе — если появится, перенести в coin_rules или Group.
DEFAULT_QUALITY_TARGET = 95.0


_BONUS_TYPES = {
    "bonus_top_coins": ("top", "Место в рейтинге недели"),
    "bonus_no_late_coins": ("no_late", "Неделя без опозданий"),
    "bonus_no_violation_coins": ("no_violation", "Неделя без нарушений"),
    "bonus_nomination_coins": ("nomination", "Номинация недели"),
    "bonus_thanks_coins": ("driver_thanks", "Благодарность от водителя"),
}


def _bonuses_list(source: dict) -> list[dict]:
    return [
        {"type": bonus_type, "label": label, "coins": source[key]}
        for key, (bonus_type, label) in _BONUS_TYPES.items()
        if source.get(key)
    ]


def _latest_weekly_result(db: Session, operator_id: int) -> WeeklyResult | None:
    return db.scalar(
        select(WeeklyResult)
        .where(WeeklyResult.operator_id == operator_id)
        .order_by(WeeklyResult.week_end.desc())
    )


def _coin_calculation_and_week_metrics(db: Session, operator: Operator) -> tuple[dict | None, dict | None]:
    row = _latest_weekly_result(db, operator.id)
    if not row:
        return None, None

    norm = calculate_norm_for_period(db, operator.rate, row.week_start, row.week_end, row.hours_score)
    week_metrics = {
        "period_start": str(row.week_start),
        "period_end": str(row.week_end),
        "hours": row.hours_score,
        "hours_target": norm.individual_norm_hours,
        "quality": row.quality_score,
        "quality_target": DEFAULT_QUALITY_TARGET,
        "efficiency": row.efficiency_score,
        "calls_per_hour": row.calls_per_hour_score,
        "late_minutes": row.lateness_count,
        "violations": row.violation_count,
        "thanks_count": row.thanks_count,
    }

    detail = db.scalar(
        select(WeeklyAccrualDetail).where(
            WeeklyAccrualDetail.operator_id == operator.id,
            WeeklyAccrualDetail.period_start == row.week_start,
            WeeklyAccrualDetail.period_end == row.week_end,
        )
    )
    if detail:
        coin_calculation = {
            "period_start": str(row.week_start),
            "period_end": str(row.week_end),
            "contest_points": detail.contest_points,
            "base_coins": detail.base_coins,
            "bonuses": _bonuses_list({
                "bonus_top_coins": detail.bonus_top_coins,
                "bonus_no_late_coins": detail.bonus_no_late_coins,
                "bonus_no_violation_coins": detail.bonus_no_violation_coins,
                "bonus_nomination_coins": detail.bonus_nomination_coins,
                "bonus_thanks_coins": detail.bonus_thanks_coins,
            }),
            "total_week_coins": detail.total_coins,
            "is_final": True,
        }
        return coin_calculation, week_metrics

    # Ещё не применено (никто не нажал «Начислить») — считаем предварительно,
    # тем же движком, что и /weekly-results/preview, чтобы цифры совпадали.
    accruals = calculate_period_accrual(db, row.week_start, row.week_end)
    acc = next((a for a in accruals if a.operator.id == operator.id), None)
    if not acc:
        return None, week_metrics

    coin_calculation = {
        "period_start": str(row.week_start),
        "period_end": str(row.week_end),
        "contest_points": acc.contest_points,
        "base_coins": acc.base_coins,
        "bonuses": _bonuses_list({
            "bonus_top_coins": acc.bonus_top_coins,
            "bonus_no_late_coins": acc.bonus_no_late_coins,
            "bonus_no_violation_coins": acc.bonus_no_violation_coins,
            "bonus_nomination_coins": acc.bonus_nomination_coins,
            "bonus_thanks_coins": acc.bonus_thanks_coins,
        }),
        "total_week_coins": acc.total_coins,
        "is_final": False,  # предварительный расчёт — ещё не начислено
    }
    return coin_calculation, week_metrics


def _achievements_list(db: Session, operator: Operator) -> dict:
    payload = get_operator_achievements_payload(db, operator)

    def _row(r: dict) -> dict:
        a = r["achievement"]
        return {
            "code": a.code,
            "title": a.title,
            "description": a.description,
            "icon": a.icon,
            "progress_value": r["progress_value"],
            "condition_value": a.condition_value,
            "is_completed": r["is_completed"],
            "times_awarded": r["times_awarded"],
            "completed_at": r["completed_at"].isoformat() if r["completed_at"] else None,
        }

    return {
        "completed": [_row(r) for r in payload["completed"]],
        "in_progress": [_row(r) for r in payload["in_progress"]],
    }


def _recent_transactions(db: Session, operator_id: int, limit: int = 10) -> list[dict]:
    rows = db.execute(
        select(CoinTransaction, User)
        .outerjoin(User, User.id == CoinTransaction.created_by_user_id)
        .where(CoinTransaction.operator_id == operator_id)
        .order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc())
        .limit(limit)
    )
    return [
        {
            "id": tx.id,
            "date": tx.created_at.isoformat(),
            "type": tx.type,
            "amount": tx.amount,
            "comment": tx.comment,
            "author": user.full_name if user else "Система",
        }
        for tx, user in rows
    ]


_PRIZE_RANK = {
    "manual_reward": 1000,
    "extra_ticket": 60,
    "shop_discount": 55,
    "badge": 50,
    "spin_token": 45,
}


def _spin_payload(spin: WheelSpin) -> dict:
    try:
        return json.loads(spin.result_payload_json or "{}")
    except (TypeError, ValueError):
        return {}


def _winner_weight(prize_type: str, amount: int) -> int:
    if prize_type == "coins":
        return int(amount or 0)
    return _PRIZE_RANK.get(prize_type, 40)


def _wheel_winners_today(db: Session) -> dict:
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

    items: list[dict] = []
    for spin in spins:
        payload = _spin_payload(spin)
        operator = spin.operator
        items.append({
            "operator_id": spin.operator_id,
            "operator_name": operator.full_name if operator else "—",
            "group_name": (operator.group_name or None) if operator else None,
            "prize": payload.get("title", "—"),
            "prize_type": payload.get("type", ""),
            "amount": int(payload.get("amount", 0) or 0),
            "reason": spin.ticket.reason_text if spin.ticket else None,
            "at": to_local_iso(spin.created_at) or "",
        })

    top = max(items, key=lambda row: _winner_weight(row.get("prize_type") or "", row.get("amount") or 0), default=None)
    return {"date": to_local_iso(start) or "", "count": len(items), "top": top, "items": items}


def _top_week(db: Session, limit: int = 5) -> list[dict]:
    return rating_rows(db)[:limit]


def _enrich_wheel_status(status: dict) -> dict:
    if not status:
        return {}
    available = int(status.get("available_tickets") or 0)
    if not status.get("campaign"):
        message = status.get("reason_if_cannot_spin") or "Колесо временно недоступно"
    elif available > 0:
        message = status.get("next_ticket_reason") or "Есть доступный билет"
    else:
        message = status.get("reason_if_cannot_spin") or "Нет доступных билетов"
    return {**status, "message": message}


def _build_cabinet_payload(db: Session, operator: Operator) -> dict:
    rating = my_rating(db, operator)
    coin_calculation, week_metrics = _coin_calculation_and_week_metrics(db, operator)

    place = rating.get("place")
    place_change = rating.get("place_change")
    previous_place = (place + place_change) if (place is not None and place_change is not None) else None

    latest_result = _latest_weekly_result(db, operator.id)
    level = operator_level_summary(
        db,
        operator,
        latest_result.week_start if latest_result else None,
        latest_result.week_end if latest_result else None,
    )

    return {
        "generated_at": now_utc().isoformat(),
        "operator": {
            "id": operator.id,
            "full_name": operator.full_name,
            "group": operator.group_name or None,
            "position": operator.position,
        },
        "wallet": {
            "balance": operator.current_balance or 0,
            "reserved": operator.reserved_balance or 0,
            "total_earned": operator.total_earned or 0,
            "total_spent": operator.total_spent or 0,
            "earned_this_week": coin_calculation["total_week_coins"] if coin_calculation else 0,
        },
        "rating": {
            "place": place,
            "total_participants": rating.get("total_participants") or 0,
            "previous_place": previous_place,
            "delta": place_change,
        },
        "week_metrics": week_metrics,
        "coin_calculation": coin_calculation,
        "level": level,
        "wheel": _enrich_wheel_status(wheel_status(db, operator)),
        "winners_today": _wheel_winners_today(db),
        "top_week": _top_week(db),
        "achievements": _achievements_list(db, operator),
        "recent_transactions": _recent_transactions(db, operator.id),
        "section_errors": {},
    }


@router.get("/me")
def my_cabinet(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    operator = operator_for_user_or_403(db, current_user)
    return _build_cabinet_payload(db, operator)


@router.get("/operator/{operator_id}")
def operator_cabinet(
    operator_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Для supervisor/manager/admin — тот же кабинет, но по чужому оператору
    (ТЗ 5.2: «супервайзер может смотреть операторов своей группы»)."""
    if current_user.role == "operator":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа")
    operator = db.get(Operator, operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    group_id = supervisor_scope_group_id(db, current_user)
    if group_id is not None and operator.group_id != group_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Оператор вне вашей группы")
    return _build_cabinet_payload(db, operator)
