"""HTTP-слой рейтинга (ТЗ §15.1).

Только приём параметров, проверка прав/текущего пользователя, вызов service и
возврат результата. Вся бизнес-логика — в app/modules/rating/service.py,
номинации — в nominations.py, расчёты — в calculators.py, SQL — в repository.py.

Имена rating_rows / build_nominations / nominations_cache_* импортированы в
namespace этого модуля намеренно: endpoint /nominations резолвит rating_rows
здесь, что позволяет тестам monkeypatch'ить app.modules.rating.router.rating_rows.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database.db import get_db
from app.models.entities import Operator, User
from app.modules.rating import service
from app.modules.rating.nominations import (
    build_nominations,
    nominations_cache_get,
    nominations_cache_set,
)
from app.modules.rating.service import rating_rows

router = APIRouter(prefix="/rating", tags=["rating"])
PRIVILEGED_RATING_ROLES = {"supervisor", "manager", "admin"}


def _get_operator_for_user(db: Session, user: User) -> Operator | None:
    if user.operator_id:
        return db.get(Operator, user.operator_id)
    return None


def _get_requested_operator(db: Session, user: User, operator_id: int | None) -> Operator | None:
    if operator_id is None:
        return _get_operator_for_user(db, user)

    if user.role not in PRIVILEGED_RATING_ROLES and user.operator_id != operator_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")

    op = db.get(Operator, operator_id)
    if not op:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    return op


@router.get("")
def get_rating(
    week_start: date | None = None,
    week_end: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    op = _get_operator_for_user(db, current_user)
    return service.rating_overview(db, op, week_start, week_end)


@router.get("/me")
def get_my_rating(
    operator_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    op = _get_requested_operator(db, current_user, operator_id)
    if not op:
        return {"no_operator": True}
    return service.my_rating(db, op)


@router.get("/me/comparison")
def get_my_comparison(
    metric: str = "points",
    operator_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    op = _get_requested_operator(db, current_user, operator_id)
    if not op:
        return {"metric": metric, "items": []}
    return service.comparison(db, op, metric, is_self=current_user.operator_id == op.id)


@router.get("/operator-dynamics")
def get_operator_dynamics(
    mode: str = "points",        # points | coins | rank
    limit: int = 4,
    operator_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    op = _get_requested_operator(db, current_user, operator_id)
    if not op:
        return {"operator_id": None, "items": [], "summary": {}, "components_summary": {}}
    return service.operator_dynamics(db, op, mode, limit)


@router.get("/me/dynamics")
def get_my_dynamics(
    type: str = "place",
    weeks: int = 8,
    operator_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    op = _get_requested_operator(db, current_user, operator_id)
    if not op:
        return {"type": type, "items": []}
    return service.my_dynamics(db, op, type, weeks)


@router.get("/me/transactions")
def get_my_transactions(
    limit: int = 5,
    operator_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    op = _get_requested_operator(db, current_user, operator_id)
    if not op:
        return []
    return service.my_transactions(db, op, limit)


@router.get("/nominations")
def get_nominations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Номинации недели. Пользователь-независимая часть кешируется на 5 минут,
    персональный флаг is_current_user вычисляется на каждый запрос — иначе
    первый пользователь «застолбил» бы свой флаг в кеше для всех остальных.
    """
    data = nominations_cache_get()
    if data is None:
        data = build_nominations(rating_rows(db))
        nominations_cache_set(data)

    op = _get_operator_for_user(db, current_user)
    my_operator_id = op.id if op else None
    items = [
        {**item, "is_current_user": item.get("winner_operator_id") == my_operator_id}
        for item in data["items"]
    ]
    return {"items": items}


@router.get("/race")
def get_rating_race(
    group_id: int | None = None,
    mode: str = "top10",  # top10 | top20 | my_zone | all
    operator_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    me = _get_requested_operator(db, current_user, operator_id)
    return service.race(db, me, group_id, mode)
