from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import User
from app.modules.settings.schemas import CoinRuleRead, CoinRuleUpdate
from app.modules.settings.service import get_active_coin_rule, update_coin_rule

router = APIRouter(prefix="/settings", tags=["settings"])


def _to_read(rule) -> CoinRuleRead:
    data = CoinRuleRead.model_validate(rule)
    data.updated_by_name = rule.updated_by.full_name if rule.updated_by else None
    return data


@router.get(
    "/coin-rules",
    response_model=CoinRuleRead,
    dependencies=[Depends(require_roles("supervisor", "manager", "admin"))],
)
def get_coin_rules(db: Session = Depends(get_db)) -> CoinRuleRead:
    """Текущие правила начисления. Супервайзер — только просмотр (ТЗ 4.2)."""
    rule = get_active_coin_rule(db)
    db.commit()  # фиксируем возможное создание дефолтной записи
    return _to_read(rule)


@router.put(
    "/coin-rules",
    response_model=CoinRuleRead,
    dependencies=[Depends(require_roles("manager", "admin"))],
)
def put_coin_rules(
    payload: CoinRuleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CoinRuleRead:
    """Изменить правила начисления. Доступ — manager/admin (ТЗ 4.2). Применяется
    к следующему расчёту, прошлые транзакции не трогает (ТЗ 4.7)."""
    payload_dict = payload.model_dump(exclude_unset=True)
    rule = update_coin_rule(db, payload_dict, current_user)
    db.commit()
    db.refresh(rule)
    return _to_read(rule)
