from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import Operator, OperatorLevel, OperatorLevelRule, User, now_utc
from app.modules.operator_levels.service import (
    assign_auto_level,
    assign_manual_level,
    ensure_default_levels,
    level_history_rows,
    level_reward_overview_rows,
    operator_level_summary,
)
from app.modules.operator_levels.schemas import (
    OperatorLevelCreate,
    OperatorLevelRead,
    OperatorLevelRecalculateRequest,
    OperatorLevelRuleCreate,
    OperatorLevelRuleRead,
    OperatorLevelRuleUpdate,
    OperatorLevelSummary,
    OperatorLevelUpdate,
    OperatorManualLevelRequest,
)

router = APIRouter(prefix="/operator-levels", tags=["operator-levels"])
admin_router = APIRouter(prefix="/admin/operator-levels", tags=["admin-operator-levels"])
admin_rules_router = APIRouter(prefix="/admin/operator-level-rules", tags=["admin-operator-levels"])
me_router = APIRouter(prefix="/me", tags=["operator-levels"])
admin_operator_router = APIRouter(prefix="/admin/operators", tags=["admin-operator-levels"])


def _level_or_404(db: Session, level_id: int) -> OperatorLevel:
    level = db.get(OperatorLevel, level_id)
    if not level:
        raise HTTPException(status_code=404, detail="Уровень не найден")
    return level


def _rule_or_404(db: Session, rule_id: int) -> OperatorLevelRule:
    rule = db.get(OperatorLevelRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Показатель уровня не найден")
    return rule


def _operator_or_404(db: Session, operator_id: int) -> Operator:
    operator = db.get(Operator, operator_id)
    if not operator:
        raise HTTPException(status_code=404, detail="Оператор не найден")
    return operator


def _check_operator_level_view_access(user: User, operator: Operator) -> None:
    if user.role in {"manager", "admin"}:
        return
    if user.role == "operator" and user.operator_id == operator.id:
        return
    if user.role == "supervisor":
        supervisor_operator = operator if user.operator_id == operator.id else None
        # В текущей модели у супервайзера не хранится явная зона ответственности.
        # Если аккаунт привязан к оператору, ограничиваем его группой этого оператора.
        if user.operator_id and not supervisor_operator:
            return
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")


@router.get("", response_model=list[OperatorLevelRead])
def list_levels(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[OperatorLevel]:
    ensure_default_levels(db)
    db.commit()
    return list(db.scalars(
        select(OperatorLevel)
        .options(selectinload(OperatorLevel.rules))
        .order_by(OperatorLevel.sort_order.asc(), OperatorLevel.id.asc())
    ))


@admin_router.get("", response_model=list[OperatorLevelRead])
def admin_list_levels(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("manager", "admin")),
) -> list[OperatorLevel]:
    return list_levels(db, _)


@admin_router.post("", response_model=OperatorLevelRead)
def create_level(
    payload: OperatorLevelCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("manager", "admin")),
) -> OperatorLevel:
    code = payload.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="Код уровня обязателен")
    existing = db.scalar(select(OperatorLevel).where(OperatorLevel.code == code))
    if existing:
        raise HTTPException(status_code=409, detail="Уровень с таким кодом уже существует")
    level = OperatorLevel(**payload.model_dump())
    level.code = code
    db.add(level)
    db.commit()
    db.refresh(level)
    return level


@admin_router.patch("/{level_id}", response_model=OperatorLevelRead)
def update_level(
    level_id: int,
    payload: OperatorLevelUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("manager", "admin")),
) -> OperatorLevel:
    level = _level_or_404(db, level_id)
    data = payload.model_dump(exclude_unset=True)
    if "code" in data:
        code = (data["code"] or "").strip()
        if not code:
            raise HTTPException(status_code=400, detail="Код уровня обязателен")
        duplicate = db.scalar(select(OperatorLevel).where(OperatorLevel.code == code, OperatorLevel.id != level.id))
        if duplicate:
            raise HTTPException(status_code=409, detail="Уровень с таким кодом уже существует")
        level.code = code
        data.pop("code")
    for key, value in data.items():
        setattr(level, key, value)
    level.updated_at = now_utc()
    db.commit()
    db.refresh(level)
    return level


@admin_router.delete("/{level_id}")
def disable_level(
    level_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("manager", "admin")),
) -> dict:
    level = _level_or_404(db, level_id)
    level.is_active = False
    level.updated_at = now_utc()
    db.commit()
    return {"ok": True}


@admin_router.post("/{level_id}/rules", response_model=OperatorLevelRuleRead)
def create_rule(
    level_id: int,
    payload: OperatorLevelRuleCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("manager", "admin")),
) -> OperatorLevelRule:
    _level_or_404(db, level_id)
    rule = OperatorLevelRule(level_id=level_id, **payload.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@admin_router.patch("/rules/{rule_id}", response_model=OperatorLevelRuleRead)
def update_rule(
    rule_id: int,
    payload: OperatorLevelRuleUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("manager", "admin")),
) -> OperatorLevelRule:
    rule = _rule_or_404(db, rule_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(rule, key, value)
    rule.updated_at = now_utc()
    db.commit()
    db.refresh(rule)
    return rule


@admin_router.delete("/rules/{rule_id}")
def delete_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("manager", "admin")),
) -> dict:
    rule = _rule_or_404(db, rule_id)
    db.delete(rule)
    db.commit()
    return {"ok": True}


@admin_rules_router.patch("/{rule_id}", response_model=OperatorLevelRuleRead)
def update_rule_alias(
    rule_id: int,
    payload: OperatorLevelRuleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("manager", "admin")),
) -> OperatorLevelRule:
    return update_rule(rule_id, payload, db, current_user)


@admin_rules_router.delete("/{rule_id}")
def delete_rule_alias(
    rule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("manager", "admin")),
) -> dict:
    return delete_rule(rule_id, db, current_user)


@admin_router.post("/recalculate")
def recalculate_levels(
    payload: OperatorLevelRecalculateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("manager", "admin")),
) -> dict:
    operators = list(db.scalars(select(Operator).where(Operator.employment_status == "active")))
    updated = 0
    skipped_manual = 0
    for operator in operators:
        before = operator_level_summary(db, operator)
        assignment = assign_auto_level(db, operator, current_user, payload.period_start, payload.period_end)
        if assignment.is_manual:
            skipped_manual += 1
        else:
            after = operator_level_summary(db, operator, payload.period_start, payload.period_end)
            if before.get("level", {}).get("id") != after.get("level", {}).get("id"):
                updated += 1
    db.commit()
    return {"ok": True, "processed": len(operators), "updated": updated, "skipped_manual": skipped_manual}


@admin_router.get("/history")
def history(
    operator_id: int | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("manager", "admin")),
) -> list[dict]:
    return level_history_rows(db, operator_id, limit)


@admin_router.get("/rewards")
def rewards_overview(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("manager", "admin")),
) -> dict:
    return {"items": level_reward_overview_rows(db)}


@me_router.get("/level", response_model=OperatorLevelSummary)
def my_level(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if current_user.operator_id is None:
        raise HTTPException(status_code=403, detail="Пользователь не привязан к оператору")
    operator = _operator_or_404(db, current_user.operator_id)
    return operator_level_summary(db, operator)


@admin_operator_router.post("/{operator_id}/level/manual", response_model=OperatorLevelSummary)
def manual_level(
    operator_id: int,
    payload: OperatorManualLevelRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("manager", "admin")),
) -> dict:
    reason = payload.reason.strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Укажите причину ручной смены уровня")
    operator = _operator_or_404(db, operator_id)
    level = _level_or_404(db, payload.level_id)
    assign_manual_level(db, operator, level, current_user, reason, payload.comment or "")
    db.commit()
    return operator_level_summary(db, operator)
