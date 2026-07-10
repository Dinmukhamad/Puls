"""Розыгрыши (ТЗ P2). Админ управляет розыгрышами и запускает тираж;
оператор смотрит свои билеты и входит в розыгрыш."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import Raffle, User
from app.modules.raffles import service as raffle_service
from app.modules.raffles.schemas import (
    OperatorRaffleView,
    RaffleCreate,
    RaffleEnterRequest,
    RaffleRead,
)
from app.modules.wallet.service import operator_for_user_or_403

router = APIRouter(prefix="/raffles", tags=["raffles"])
admin_router = APIRouter(prefix="/admin/raffles", tags=["raffles-admin"])

STAFF_ROLES = ("supervisor", "manager", "admin")


def _serialize(db: Session, raffle: Raffle, *, my_operator_id: int | None = None) -> dict:
    participants, total_tickets = raffle_service.raffle_entries_count(db, raffle.id)
    winners = [
        {
            "operator_id": w.operator_id,
            "operator_name": w.operator.full_name if w.operator else "",
            "tickets_at_draw": w.tickets_at_draw,
            "prize_coins": w.prize_coins,
        }
        for w in raffle.winners
    ]
    my_tickets_in = 0
    if my_operator_id:
        from sqlalchemy import select

        from app.models.entities import RaffleEntry
        entry = db.scalar(
            select(RaffleEntry).where(
                RaffleEntry.raffle_id == raffle.id, RaffleEntry.operator_id == my_operator_id
            )
        )
        my_tickets_in = entry.tickets if entry else 0
    return {
        "id": raffle.id,
        "title": raffle.title,
        "description": raffle.description,
        "prize_coins": raffle.prize_coins,
        "prize_description": raffle.prize_description,
        "winners_count": raffle.winners_count,
        "status": raffle.status,
        "ends_at": raffle.ends_at,
        "created_at": raffle.created_at,
        "drawn_at": raffle.drawn_at,
        "participants": participants,
        "total_tickets": total_tickets,
        "winners": winners,
        "my_tickets_in": my_tickets_in,
    }


# ── Админ ────────────────────────────────────────────────────────────────────

@admin_router.get("", response_model=list[RaffleRead], dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_list_raffles(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    raffles = raffle_service.list_raffles(db, current_user)
    return [_serialize(db, r) for r in raffles]


@admin_router.post("", response_model=RaffleRead, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_create_raffle(
    payload: RaffleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    raffle = raffle_service.create_raffle(
        db,
        title=payload.title, description=payload.description,
        prize_coins=payload.prize_coins, prize_description=payload.prize_description,
        winners_count=payload.winners_count, ends_at=payload.ends_at, actor=current_user,
    )
    return _serialize(db, raffle)


@admin_router.post("/{raffle_id}/draw", response_model=RaffleRead, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_draw_raffle(
    raffle_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    raffle = raffle_service.draw_raffle(db, raffle_id, current_user)
    db.refresh(raffle)
    return _serialize(db, raffle)


@admin_router.post("/{raffle_id}/cancel", response_model=RaffleRead, dependencies=[Depends(require_roles(*STAFF_ROLES))])
def admin_cancel_raffle(raffle_id: int, db: Session = Depends(get_db)):
    raffle = raffle_service.cancel_raffle(db, raffle_id)
    return _serialize(db, raffle)


# ── Оператор ─────────────────────────────────────────────────────────────────

@router.get("", response_model=OperatorRaffleView)
def my_raffles(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    operator = operator_for_user_or_403(db, current_user)
    view = raffle_service.operator_raffle_view(db, operator)
    return {
        "raffle_tickets": view["raffle_tickets"],
        "raffles": [_serialize(db, r, my_operator_id=operator.id) for r in view["raffles"]],
    }


@router.post("/{raffle_id}/enter", response_model=OperatorRaffleView)
def enter_raffle(
    raffle_id: int,
    payload: RaffleEnterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    operator = operator_for_user_or_403(db, current_user)
    raffle_service.enter_raffle(db, raffle_id, operator, payload.tickets)
    db.refresh(operator)
    view = raffle_service.operator_raffle_view(db, operator)
    return {
        "raffle_tickets": view["raffle_tickets"],
        "raffles": [_serialize(db, r, my_operator_id=operator.id) for r in view["raffles"]],
    }
