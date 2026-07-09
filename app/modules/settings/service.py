from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import AuditLog, CoinRule, User, now_utc


def get_active_coin_rule(db: Session) -> CoinRule:
    """Возвращает активные правила начисления, создавая дефолтные (курс 5:1),
    если в базе ещё ни одной записи нет (например, на инстансе без миграции 0023
    или в тестовой БД, поднятой через create_all).
    """
    rule = db.scalar(select(CoinRule).where(CoinRule.is_active.is_(True)).order_by(CoinRule.id.desc()))
    if rule:
        return rule
    rule = CoinRule()
    db.add(rule)
    db.flush()
    return rule


def update_coin_rule(db: Session, payload_dict: dict, current_user: User) -> CoinRule:
    """Обновляет активные правила. Старые транзакции не пересчитываются (ТЗ 4.7) —
    новые значения влияют только на будущие начисления.
    """
    rule = get_active_coin_rule(db)

    before = {
        key: getattr(rule, key)
        for key in payload_dict
    }

    for key, value in payload_dict.items():
        setattr(rule, key, value)
    rule.updated_at = now_utc()
    rule.updated_by_user_id = current_user.id

    changed = {k: {"before": before[k], "after": v} for k, v in payload_dict.items() if before[k] != v}
    if changed:
        db.add(AuditLog(
            action="coin_rules_updated",
            entity_type="coin_rule",
            entity_id=rule.id,
            details=str(changed),
            performed_by_user_id=current_user.id,
        ))

    db.flush()
    return rule
