"""
Идемпотентный сид Wheel of WOW: одна активная кампания + сектора с весами
из ТЗ (раздел 7). Вызывается на старте; при существующей кампании — no-op,
поэтому веса/лимиты, отредактированные руководителем, не перезатираются.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import WheelCampaign, WheelPrize

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
    return campaign
