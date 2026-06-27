from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import Operator, User
from app.schemas.operators import OperatorCreate, OperatorRead, OperatorUpdate

router = APIRouter(prefix="/operators", tags=["operators"])


@router.get("", response_model=List[OperatorRead])
def list_operators(db: Session = Depends(get_db), _: User = Depends(require_roles("supervisor", "manager", "admin"))) -> List[Operator]:
    return list(db.scalars(select(Operator).order_by(Operator.group_name.asc(), Operator.full_name.asc())))


@router.get("/me", response_model=OperatorRead)
def my_operator(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Operator:
    if current_user.operator_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Пользователь не привязан к оператору")
    operator = db.get(Operator, current_user.operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    return operator


@router.post("", response_model=OperatorRead, dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def create_operator(payload: OperatorCreate, db: Session = Depends(get_db)) -> Operator:
    operator = Operator(**payload.model_dump())
    db.add(operator)
    db.commit()
    db.refresh(operator)
    return operator


@router.patch("/{operator_id}", response_model=OperatorRead, dependencies=[Depends(require_roles("supervisor", "manager", "admin"))])
def update_operator(operator_id: int, payload: OperatorUpdate, db: Session = Depends(get_db)) -> Operator:
    operator = db.get(Operator, operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(operator, key, value)
    db.commit()
    db.refresh(operator)
    return operator


@router.get("/{operator_id}", response_model=OperatorRead)
def get_operator(
    operator_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Operator:
    if current_user.role == "operator" and current_user.operator_id != operator_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к этому оператору")
    operator = db.get(Operator, operator_id)
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    return operator
