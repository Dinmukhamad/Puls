"""Розыгрыши (ТЗ P2).

Механика:
- Билеты розыгрыша начисляются оператору из Колеса WOW (приз raffle_ticket)
  и копятся в operators.raffle_tickets. За коины не покупаются.
- Оператор входит в конкретный розыгрыш, вкладывая N своих билетов
  (списываются из пула). Больше билетов — выше шанс.
- Розыгрыш выбирает winners_count РАЗНЫХ победителей, взвешенно по числу
  вложенных билетов (один человек не может занять два места — тянем без
  возврата по операторам). Если участников меньше, чем мест — победителями
  становятся все участники.
- Приз победителю: если prize_coins > 0 — начисляется на баланс автоматически
  через add_transaction; prize_description — свободный текст (офлайн-приз).
- Выбор победителя: вручную (кнопка админа) ИЛИ автоматически по ends_at —
  ленивая проверка при загрузке списка (как со scheduled→open у тестов),
  чтобы не зависеть от фонового планировщика.
"""
from __future__ import annotations

import random

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.datetime_utils import now_utc
from app.models.entities import (
    Operator,
    Raffle,
    RaffleEntry,
    RaffleWinner,
    User,
)
from app.modules.wallet.service import add_transaction

_rng = random.Random()


def grant_raffle_ticket(db: Session, operator: Operator, count: int = 1) -> None:
    """Начислить билет(ы) розыгрыша в пул оператора. Вызывается из Колеса WOW."""
    operator.raffle_tickets = (operator.raffle_tickets or 0) + count


def _auto_draw_due_raffles(db: Session, actor: User | None) -> None:
    """Ленивый автотираж: любой активный розыгрыш с наступившим ends_at
    разыгрывается здесь же. Вызывается при загрузке списка."""
    now = now_utc()
    due = db.scalars(
        select(Raffle).where(
            Raffle.status == "active",
            Raffle.ends_at.is_not(None),
            Raffle.ends_at < now,
        )
    ).all()
    for raffle in due:
        try:
            _draw_raffle(db, raffle, actor)
        except HTTPException:
            # например, нет участников — не срываем загрузку списка
            continue


def list_raffles(db: Session, actor: User | None = None) -> list[Raffle]:
    _auto_draw_due_raffles(db, actor)
    db.commit()
    return list(
        db.scalars(
            select(Raffle)
            .options(selectinload(Raffle.winners).selectinload(RaffleWinner.operator))
            .order_by(Raffle.status.asc(), Raffle.created_at.desc())
        )
    )


def create_raffle(db: Session, *, title, description, prize_coins, prize_description,
                  winners_count, ends_at, actor: User) -> Raffle:
    raffle = Raffle(
        title=title.strip(),
        description=(description or "").strip(),
        prize_coins=max(0, prize_coins or 0),
        prize_description=(prize_description or "").strip(),
        winners_count=max(1, winners_count or 1),
        ends_at=ends_at,
        status="active",
        created_by_user_id=actor.id if actor else None,
    )
    db.add(raffle)
    db.commit()
    db.refresh(raffle)
    return raffle


def cancel_raffle(db: Session, raffle_id: int) -> Raffle:
    raffle = db.get(Raffle, raffle_id)
    if not raffle:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Розыгрыш не найден")
    if raffle.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Розыгрыш уже завершён или отменён")
    # Возвращаем вложенные билеты участникам — розыгрыш не состоялся.
    entries = db.scalars(select(RaffleEntry).where(RaffleEntry.raffle_id == raffle.id)).all()
    for entry in entries:
        op = db.get(Operator, entry.operator_id)
        if op:
            op.raffle_tickets = (op.raffle_tickets or 0) + entry.tickets
    raffle.status = "cancelled"
    db.commit()
    db.refresh(raffle)
    return raffle


def enter_raffle(db: Session, raffle_id: int, operator: Operator, tickets: int) -> RaffleEntry:
    if tickets < 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нужно вложить хотя бы 1 билет")

    raffle = db.get(Raffle, raffle_id, with_for_update=True)
    if not raffle or raffle.status != "active":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Розыгрыш недоступен")
    if raffle.ends_at and raffle.ends_at < now_utc():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Приём билетов завершён")

    # Блокируем строку оператора — билеты это ресурс, та же защита от гонки,
    # что и на балансе коинов при покупке в магазине.
    operator = db.get(Operator, operator.id, with_for_update=True)
    if (operator.raffle_tickets or 0) < tickets:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Недостаточно билетов: есть {operator.raffle_tickets or 0}",
        )

    operator.raffle_tickets -= tickets
    entry = db.scalar(
        select(RaffleEntry).where(
            RaffleEntry.raffle_id == raffle.id, RaffleEntry.operator_id == operator.id
        )
    )
    if entry:
        entry.tickets += tickets
    else:
        entry = RaffleEntry(raffle_id=raffle.id, operator_id=operator.id, tickets=tickets)
        db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def draw_raffle(db: Session, raffle_id: int, actor: User | None) -> Raffle:
    raffle = db.get(Raffle, raffle_id, with_for_update=True)
    if not raffle:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Розыгрыш не найден")
    result = _draw_raffle(db, raffle, actor)
    db.commit()
    db.refresh(result)
    return result


def _draw_raffle(db: Session, raffle: Raffle, actor: User | None) -> Raffle:
    if raffle.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Розыгрыш уже проведён или отменён")

    entries = db.scalars(select(RaffleEntry).where(RaffleEntry.raffle_id == raffle.id)).all()
    entries = [e for e in entries if e.tickets > 0]
    if not entries:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нет участников — розыгрыш невозможен")

    # Взвешенный выбор БЕЗ возврата по операторам: один человек не занимает
    # два призовых места. Пока есть места и кандидаты — тянем взвешенно.
    pool = [(e.operator_id, e.tickets) for e in entries]
    winners: list[tuple[int, int]] = []
    slots = min(raffle.winners_count, len(pool))
    for _ in range(slots):
        total = sum(w for _, w in pool)
        r = _rng.uniform(0, total)
        acc = 0.0
        for i, (op_id, weight) in enumerate(pool):
            acc += weight
            if r <= acc:
                winners.append((op_id, weight))
                pool.pop(i)
                break

    from app.modules.notifications.service import notify_operator
    for op_id, tickets_at_draw in winners:
        db.add(RaffleWinner(
            raffle_id=raffle.id, operator_id=op_id,
            tickets_at_draw=tickets_at_draw, prize_coins=raffle.prize_coins,
        ))
        if raffle.prize_coins > 0:
            op = db.get(Operator, op_id)
            if op:
                add_transaction(
                    db, op, raffle.prize_coins, "raffle_prize",
                    comment=f"Приз розыгрыша: {raffle.title}",
                    created_by=actor,
                )
        prize_txt = f"+{raffle.prize_coins} ₡" if raffle.prize_coins > 0 else (raffle.prize_description or "")
        notify_operator(
            db, op_id, type="raffle_win",
            title=f"Вы выиграли в розыгрыше «{raffle.title}»", body=prize_txt, link="cabinet",
        )

    raffle.status = "drawn"
    raffle.drawn_at = now_utc()
    return raffle


def operator_raffle_view(db: Session, operator: Operator) -> dict:
    """Данные для оператора: сколько у него билетов + список розыгрышей
    с его участием."""
    _auto_draw_due_raffles(db, None)
    db.commit()
    raffles = list(
        db.scalars(
            select(Raffle)
            .options(selectinload(Raffle.winners))
            .order_by(Raffle.status.asc(), Raffle.created_at.desc())
        )
    )
    my_entries = {
        e.raffle_id: e.tickets
        for e in db.scalars(select(RaffleEntry).where(RaffleEntry.operator_id == operator.id))
    }
    return {
        "raffle_tickets": operator.raffle_tickets or 0,
        "raffles": raffles,
        "my_entries": my_entries,
    }


def raffle_entries_count(db: Session, raffle_id: int) -> tuple[int, int]:
    """(число участников, сумма вложенных билетов) — для админ-карточки."""
    participants = db.scalar(
        select(func.count(RaffleEntry.id)).where(RaffleEntry.raffle_id == raffle_id, RaffleEntry.tickets > 0)
    ) or 0
    total_tickets = db.scalar(
        select(func.coalesce(func.sum(RaffleEntry.tickets), 0)).where(RaffleEntry.raffle_id == raffle_id)
    ) or 0
    return participants, total_tickets
