from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles, supervisor_scope_group_id
from app.database.db import get_db
from app.models.entities import Achievement, Operator, User
from app.modules.achievements.schemas import (
    AchievementRead,
    AchievementUpdate,
    GrantAchievementRequest,
    OperatorAchievementRead,
    OperatorAchievementsResponse,
)
from app.modules.achievements.service import get_operator_achievements_payload, grant_manual
from app.modules.wallet.service import operator_for_user_or_403

router = APIRouter(prefix="/achievements", tags=["achievements"])


@router.get("", response_model=list[AchievementRead])
def list_achievements(db: Session = Depends(get_db), _: User = Depends(get_current_user)) -> list[Achievement]:
    """Каталог всех достижений (включая выключенные — фронту нужно знать
    полный список для настроек, ТЗ 7.4.5)."""
    return list(db.scalars(select(Achievement).order_by(Achievement.id.asc())))


@router.patch("/{achievement_id}", response_model=AchievementRead, dependencies=[Depends(require_roles("admin"))])
def update_achievement(achievement_id: int, payload: AchievementUpdate, db: Session = Depends(get_db)) -> Achievement:
    """Включить/выключить бейдж или поменять награду (ТЗ 7.6: «админ может
    включать/выключать бейджи»)."""
    achievement = db.get(Achievement, achievement_id)
    if not achievement:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Достижение не найдено")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(achievement, key, value)
    db.commit()
    db.refresh(achievement)
    return achievement


def _operator_achievements_payload(db: Session, operator: Operator) -> OperatorAchievementsResponse:
    payload = get_operator_achievements_payload(db, operator)
    return OperatorAchievementsResponse(
        completed=[
            OperatorAchievementRead(
                achievement=AchievementRead.model_validate(r["achievement"]),
                progress_value=r["progress_value"],
                is_completed=r["is_completed"],
                times_awarded=r["times_awarded"],
                completed_at=r["completed_at"],
                last_awarded_at=r["last_awarded_at"],
            )
            for r in payload["completed"]
        ],
        in_progress=[
            OperatorAchievementRead(
                achievement=AchievementRead.model_validate(r["achievement"]),
                progress_value=r["progress_value"],
                is_completed=r["is_completed"],
                times_awarded=r["times_awarded"],
                completed_at=r["completed_at"],
                last_awarded_at=r["last_awarded_at"],
            )
            for r in payload["in_progress"]
        ],
    )


@router.get("/me", response_model=OperatorAchievementsResponse)
def my_achievements(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> OperatorAchievementsResponse:
    operator = operator_for_user_or_403(db, current_user)
    return _operator_achievements_payload(db, operator)


@router.get(
    "/operator/{operator_id}",
    response_model=OperatorAchievementsResponse,
    dependencies=[Depends(require_roles("supervisor", "manager", "admin"))],
)
def operator_achievements(
    operator_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OperatorAchievementsResponse:
    operator = db.get(Operator, operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    group_id = supervisor_scope_group_id(db, current_user)
    if group_id is not None and operator.group_id != group_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Оператор вне вашей группы")
    return _operator_achievements_payload(db, operator)


@router.post(
    "/{achievement_id}/grant",
    response_model=OperatorAchievementRead,
    dependencies=[Depends(require_roles("supervisor", "manager", "admin"))],
)
def grant_achievement(
    achievement_id: int,
    payload: GrantAchievementRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OperatorAchievementRead:
    """Ручная выдача — единственный способ закрыть условия без объективного
    триггера в данных (например `helper` — «помощь новичку»), ТЗ §7.
    Доступ — как у ручных начислений коинов (ТЗ 10.2): supervisor только в
    своей группе, manager/admin без ограничений."""
    achievement = db.get(Achievement, achievement_id)
    if not achievement:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Достижение не найдено")
    operator = db.get(Operator, payload.operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    group_id = supervisor_scope_group_id(db, current_user)
    if group_id is not None and operator.group_id != group_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Оператор вне вашей группы")
    state = grant_manual(db, operator, achievement, current_user, payload.comment)
    db.commit()
    db.refresh(state)
    return OperatorAchievementRead(
        achievement=AchievementRead.model_validate(achievement),
        progress_value=state.progress_value,
        is_completed=state.is_completed,
        times_awarded=state.times_awarded,
        completed_at=state.completed_at,
        last_awarded_at=state.last_awarded_at,
    )
