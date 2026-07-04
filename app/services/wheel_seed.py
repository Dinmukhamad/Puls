"""
Идемпотентный сид Wheel of WOW: одна активная кампания + сектора с весами
из ТЗ (раздел 7) + правила выдачи токенов (ТЗ 8.4) + настройки (ТЗ 8.9).
Вызывается на старте; при существующих записях — no-op, поэтому веса/лимиты,
отредактированные руководителем, не перезатираются.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    WheelCampaign,
    WheelEligibilityRule,
    WheelPrize,
    WheelSetting,
)

# (title, prize_type, amount, weight, color, max_wins_total, max_wins_per_operator)
# Веса — из ТЗ п.7. Сектора "ничего" нет (ТЗ п.6.3): минимум — «+1 коин».
_DEFAULT_PRIZES = [
    ("+3 коина",              "coins",         3, 30, "#FACC15", 0, 0),
    ("+5 коинов",             "coins",         5, 25, "#38BDF8", 0, 0),
    ("Бейдж дня",             "badge",         1, 15, "#A78BFA", 0, 0),
    ("Скидка 10% в магазине", "shop_discount", 10, 10, "#34D399", 0, 0),
    ("Дополнительный билет",  "extra_ticket",  1,  7, "#FB7185", 0, 0),
    ("+10 коинов",            "coins",        10,  3, "#F97316", 10, 1),
    ("Ручной приз",           "manual_reward", 1,  1, "#E11D48", 0, 0),
    ("+1 коин",               "coins",         1,  5, "#94A3B8", 0, 0),  # минимальный приз
]


def ensure_default_wheel(db: Session) -> WheelCampaign:
    campaign = db.scalars(
        select(WheelCampaign).where(WheelCampaign.is_active.is_(True)).order_by(WheelCampaign.id.desc())
    ).first()
    if campaign:
        # Кампания уже есть (существующая установка) — призы не трогаем, но
        # правила и настройки досеиваем идемпотентно, иначе движок правил на
        # проде окажется пустым.
        _ensure_default_rules(db, campaign)
        _ensure_default_settings(db)
        return campaign

    campaign = WheelCampaign(
        title="Wheel of WOW",
        description="Крутите колесо за выполнение дневных целей",
        is_active=True,
        max_spins_per_day=1,
        max_spins_per_week=3,
        ticket_ttl_days=3,
    )
    db.add(campaign)
    db.flush()

    for order, (title, ptype, amount, weight, color, cap_total, cap_op) in enumerate(_DEFAULT_PRIZES):
        db.add(WheelPrize(
            campaign_id=campaign.id, title=title, prize_type=ptype, amount=amount,
            weight=weight, color=color, is_active=True,
            max_wins_total=cap_total, max_wins_per_operator=cap_op, sort_order=order,
        ))

    _ensure_default_rules(db, campaign)
    _ensure_default_settings(db)
    return campaign


# (code, title, source_module, rule_type, metric_key, operator, threshold,
#  period_type, max_tokens, ttl_hours, is_active). ТЗ 8.4 / раздел 18 (MVP).
_DEFAULT_RULES = [
    ("test_score_80", "Тест дня пройден на 80%+", "tests", "test_score",
     "test_score", "gte", 80, "daily", 1, 24, True),
    ("simulation_passed_80", "Симуляция пройдена на 80%+", "tests", "simulation_passed",
     "test_score", "gte", 80, "daily", 1, 24, True),
    ("quality_90", "Качество звонков за период 90+", "period_reports", "quality_score",
     "quality_avg", "gte", 90, "weekly", 1, 72, True),
    ("no_late_day", "Нет опозданий за период", "period_reports", "no_late",
     "late_minutes", "eq", 0, "weekly", 1, 72, True),
]


def _ensure_default_rules(db: Session, campaign: WheelCampaign) -> None:
    existing = {
        r.code for r in db.scalars(
            select(WheelEligibilityRule).where(WheelEligibilityRule.campaign_id == campaign.id)
        )
    }
    for (code, title, module, rtype, metric, op, thr, period, cap, ttl, active) in _DEFAULT_RULES:
        if code in existing:
            continue
        db.add(WheelEligibilityRule(
            campaign_id=campaign.id, code=code, title=title, source_module=module,
            rule_type=rtype, metric_key=metric, operator=op, threshold_value=thr,
            period_type=period, max_tokens_per_period=cap, token_ttl_hours=ttl,
            is_active=active,
        ))


# (key, value, description). ТЗ 8.9.
_DEFAULT_SETTINGS = [
    ("wheel_enabled", "true", "Глобальный тумблер колеса"),
    ("default_token_ttl_hours", "24", "TTL токена по умолчанию, часов"),
    ("max_daily_spins_per_operator", "1", "Макс. прокруток в день на оператора"),
    ("max_weekly_spins_per_operator", "3", "Макс. прокруток в неделю на оператора"),
    ("allow_manual_grants", "true", "Разрешить ручную выдачу токенов"),
    ("show_prize_probabilities", "false", "Показывать оператору вероятности призов"),
]


def _ensure_default_settings(db: Session) -> None:
    existing = {s.key for s in db.scalars(select(WheelSetting))}
    for key, value, desc in _DEFAULT_SETTINGS:
        if key not in existing:
            db.add(WheelSetting(key=key, value=value, description=desc))
