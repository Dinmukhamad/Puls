from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import AuditLog, Group, Operator, User, now_utc

router = APIRouter(prefix="/groups", tags=["groups"])


class GroupCreate(BaseModel):
    name: str
    status: str = "active"


class GroupUpdate(BaseModel):
    name: str | None = None
    status: str | None = None


class GroupRead(BaseModel):
    id: int
    name: str
    status: str
    operator_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


def _audit_group(db: Session, action: str, group: Group, details: str, user: User) -> None:
    db.add(AuditLog(
        action=action,
        entity_type="group",
        entity_id=group.id,
        details=details,
        performed_by_user_id=user.id,
    ))


@router.get("", response_model=list[GroupRead])
def list_groups(
    active_only: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[dict]:
    """List all groups. Pass ?active_only=true to get only active groups."""
    q = select(
        Group,
        func.count(Operator.id).label("operator_count")
    ).outerjoin(Operator, Operator.group_id == Group.id).group_by(Group.id)

    if active_only:
        q = q.where(Group.status == "active")

    rows = db.execute(q.order_by(Group.name.asc())).all()
    return [
        {
            "id": g.id,
            "name": g.name,
            "status": g.status,
            "operator_count": count or 0,
            "created_at": g.created_at,
            "updated_at": g.updated_at,
        }
        for g, count in rows
    ]


@router.post("", response_model=GroupRead)
def create_group(
    payload: GroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("manager", "admin")),
) -> dict:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Название группы обязательно")
    if payload.status not in ("active", "inactive"):
        raise HTTPException(status_code=400, detail="Статус должен быть active или inactive")

    existing = db.scalar(select(Group).where(func.lower(Group.name) == name.lower()))
    if existing:
        raise HTTPException(status_code=409, detail=f"Группа '{name}' уже существует")

    group = Group(name=name, status=payload.status)
    db.add(group)
    db.flush()
    _audit_group(db, "group_created", group, f"Создана группа {group.name} со статусом {group.status}", current_user)
    db.commit()
    db.refresh(group)
    return {
        "id": group.id, "name": group.name, "status": group.status,
        "operator_count": 0, "created_at": group.created_at, "updated_at": group.updated_at
    }


@router.patch("/{group_id}", response_model=GroupRead)
def update_group(
    group_id: int,
    payload: GroupUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("manager", "admin")),
) -> dict:
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")

    changes = []
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Название группы обязательно")
        existing = db.scalar(select(Group).where(func.lower(Group.name) == name.lower(), Group.id != group_id))
        if existing:
            raise HTTPException(status_code=409, detail=f"Группа '{name}' уже существует")
        if group.name != name:
            old_name = group.name
            group.name = name
            db.query(Operator).filter(Operator.group_id == group.id).update(
                {"group_name": name},
                synchronize_session=False,
            )
            changes.append(f"name: {old_name} → {name}")
    if payload.status is not None:
        if payload.status not in ("active", "inactive"):
            raise HTTPException(status_code=400, detail="Некорректный статус")
        if group.status != payload.status:
            changes.append(f"status: {group.status} → {payload.status}")
            group.status = payload.status
    if payload.name is not None or payload.status is not None:
        group.updated_at = now_utc()
    if changes:
        _audit_group(db, "group_updated", group, "; ".join(changes), current_user)

    db.commit()
    db.refresh(group)
    count = db.scalar(select(func.count(Operator.id)).where(Operator.group_id == group_id)) or 0
    return {
        "id": group.id, "name": group.name, "status": group.status,
        "operator_count": count, "created_at": group.created_at, "updated_at": group.updated_at
    }


@router.post("/{group_id}/disable", response_model=GroupRead)
def disable_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("manager", "admin")),
) -> dict:
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    group.status = "inactive"
    group.updated_at = now_utc()
    _audit_group(db, "group_disabled", group, f"Группа {group.name} отключена", current_user)
    db.commit()
    db.refresh(group)
    count = db.scalar(select(func.count(Operator.id)).where(Operator.group_id == group_id)) or 0
    return {
        "id": group.id, "name": group.name, "status": group.status,
        "operator_count": count, "created_at": group.created_at, "updated_at": group.updated_at
    }


@router.post("/{group_id}/enable", response_model=GroupRead)
def enable_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("manager", "admin")),
) -> dict:
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    group.status = "active"
    group.updated_at = now_utc()
    _audit_group(db, "group_enabled", group, f"Группа {group.name} включена", current_user)
    db.commit()
    db.refresh(group)
    count = db.scalar(select(func.count(Operator.id)).where(Operator.group_id == group_id)) or 0
    return {
        "id": group.id, "name": group.name, "status": group.status,
        "operator_count": count, "created_at": group.created_at, "updated_at": group.updated_at
    }


@router.delete("/{group_id}")
def delete_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
) -> dict:
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")

    operator_count = db.scalar(select(func.count(Operator.id)).where(Operator.group_id == group_id)) or 0
    if operator_count:
        raise HTTPException(
            status_code=409,
            detail="Группу нельзя удалить, так как в ней есть операторы. Сначала переведите операторов в другую группу или отключите группу.",
        )

    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    _audit_group(db, "group_deleted", group, f"Удалена группа {group.name}", current_user)
    try:
        db.flush()
        db.execute(text("DELETE FROM groups WHERE id = :gid"), {"gid": group_id})
        db.commit()
    except IntegrityError:
        # На группу ссылаются исторические данные или учётные записи
        # (users.group_id, operator_daily_metrics.group_id и т.п.). Не удаляем
        # историю — возвращаем понятную ошибку вместо необработанного 500.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=(
                "Группу нельзя удалить: с ней связаны исторические данные или "
                "учётные записи. Отключите группу вместо удаления."
            ),
        ) from None
    return {"ok": True}
