from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import Group, Operator, User

router = APIRouter(prefix="/groups", tags=["groups"])


class GroupCreate(BaseModel):
    name: str
    status: str = "active"


class GroupUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None


class GroupRead(BaseModel):
    id: int
    name: str
    status: str
    operator_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=List[GroupRead])
def list_groups(
    active_only: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> List[dict]:
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
    _: User = Depends(require_roles("manager", "admin")),
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
    _: User = Depends(require_roles("manager", "admin")),
) -> dict:
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")

    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Название группы обязательно")
        existing = db.scalar(select(Group).where(func.lower(Group.name) == name.lower(), Group.id != group_id))
        if existing:
            raise HTTPException(status_code=409, detail=f"Группа '{name}' уже существует")
        group.name = name
    if payload.status is not None:
        if payload.status not in ("active", "inactive"):
            raise HTTPException(status_code=400, detail="Некорректный статус")
        group.status = payload.status
    if payload.name is not None or payload.status is not None:
        group.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(group)
    count = db.scalar(select(func.count(Operator.id)).where(Operator.group_id == group_id)) or 0
    return {
        "id": group.id, "name": group.name, "status": group.status,
        "operator_count": count, "created_at": group.created_at, "updated_at": group.updated_at
    }
