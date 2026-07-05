"""
Wheel of WOW — автотесты (ТЗ раздел 20, Acceptance Criteria).

Покрываем критичные инварианты:
  * приз выбирается по весу (детерминированно с подставным rng);
  * коины идут ТОЛЬКО через coin_transactions с type=wheel_of_wow + related_spin_id;
  * один билет нельзя использовать дважды; повторный спин не даёт второй приз;
  * ошибка при выдаче приза НЕ списывает билет (откат);
  * дневной/недельный лимиты; персональный лимит приза; TTL билета;
  * нет сектора «ничего».
"""
from __future__ import annotations

from datetime import timedelta

import pytest

from tests.conftest import make_operator, make_operator_user


class _FixedRNG:
    """rng-заглушка: всегда возвращает заданное значение из randint."""
    def __init__(self, value: int):
        self._value = value

    def randint(self, a, b):
        assert a <= self._value <= b, f"roll {self._value} вне диапазона [{a},{b}]"
        return self._value


# ── choose_prize: взвешенный выбор ───────────────────────────────────────────

class _P:
    def __init__(self, id, weight, title="p"):
        self.id, self.weight, self.title = id, weight, title


def test_choose_prize_respects_weight_ranges():
    from app.modules.wheel.service import choose_prize
    prizes = [_P(1, 30), _P(2, 25), _P(3, 3)]  # диапазоны: 1..30, 31..55, 56..58
    assert choose_prize(prizes, rng=_FixedRNG(1)).id == 1
    assert choose_prize(prizes, rng=_FixedRNG(30)).id == 1
    assert choose_prize(prizes, rng=_FixedRNG(31)).id == 2
    assert choose_prize(prizes, rng=_FixedRNG(55)).id == 2
    assert choose_prize(prizes, rng=_FixedRNG(56)).id == 3
    assert choose_prize(prizes, rng=_FixedRNG(58)).id == 3


def test_choose_prize_empty_raises():
    from fastapi import HTTPException
    from app.modules.wheel.service import choose_prize
    with pytest.raises(HTTPException):
        choose_prize([], rng=_FixedRNG(1))


# ── Билеты и статус ──────────────────────────────────────────────────────────

def test_status_without_campaign_is_safe(client, db_session, monkeypatch):
    import app.modules.wheel.service as ws
    op = make_operator(db_session)
    monkeypatch.setattr(ws, "active_campaign", lambda db: None)
    st = ws.wheel_status(db_session, op)
    assert st["campaign"] is None and st["available_tickets"] == 0


def test_manual_ticket_and_spin_lifecycle(client, db_session):
    from app.modules.wheel import service as ws
    from app.services.wheel_seed import ensure_default_wheel

    campaign = ensure_default_wheel(db_session)
    op = make_operator(db_session)
    ticket = ws.issue_ticket(
        db_session, op, campaign, reason_type="manual",
        reason_text="Помощь коллеге", enforce_daily_cap=False,
    )
    db_session.commit()
    assert ticket.status == "available"
    assert len(ws.available_tickets(db_session, op.id)) == 1

    result = ws.spin(db_session, op, rng=_FixedRNG(1))
    db_session.commit()
    assert result["spin_id"]
    db_session.refresh(ticket)
    assert ticket.status == "used" and ticket.used_at is not None
    # второй раз доступных билетов нет
    assert len(ws.available_tickets(db_session, op.id)) == 0


def test_coins_prize_goes_through_transaction(client, db_session):
    from app.models.entities import CoinTransaction, WheelPrize
    from app.modules.wheel import service as ws
    from app.services.wheel_seed import ensure_default_wheel

    campaign = ensure_default_wheel(db_session)
    # оставляем ровно один активный приз-коины, чтобы результат был предсказуем
    for p in db_session.query(WheelPrize).filter_by(campaign_id=campaign.id):
        p.is_active = p.title == "+5 коинов"
    db_session.commit()

    op = make_operator(db_session, balance=0)
    ws.issue_ticket(db_session, op, campaign, reason_type="manual",
                    reason_text="тест", enforce_daily_cap=False)
    db_session.commit()

    result = ws.spin(db_session, op, rng=_FixedRNG(1))
    db_session.commit()
    assert result["prize"]["type"] == "coins" and result["prize"]["amount"] == 5

    db_session.refresh(op)
    assert op.current_balance == 5
    tx = db_session.query(CoinTransaction).filter_by(operator_id=op.id, type="wheel_of_wow").one()
    assert tx.amount == 5
    assert tx.related_spin_id == result["spin_id"]


def test_error_during_grant_does_not_consume_ticket(client, db_session, monkeypatch):
    from app.modules.wheel import service as ws
    from app.services.wheel_seed import ensure_default_wheel

    campaign = ensure_default_wheel(db_session)
    op = make_operator(db_session)
    ticket = ws.issue_ticket(db_session, op, campaign, reason_type="manual",
                             reason_text="тест", enforce_daily_cap=False)
    db_session.commit()

    monkeypatch.setattr(ws, "_grant_prize", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    with pytest.raises(RuntimeError):
        ws.spin(db_session, op, rng=_FixedRNG(1))
    db_session.rollback()  # роутер делает это же

    db_session.refresh(ticket)
    assert ticket.status == "available", "ошибка не должна списывать билет"


def test_expired_ticket_not_spendable(client, db_session):
    from app.modules.wheel import service as ws
    from app.services.wheel_seed import ensure_default_wheel

    campaign = ensure_default_wheel(db_session)
    op = make_operator(db_session)
    ticket = ws.issue_ticket(db_session, op, campaign, reason_type="manual",
                             reason_text="тест", enforce_daily_cap=False)
    # искусственно просрочиваем
    from app.core.datetime_utils import now_utc
    ticket.expires_at = now_utc() - timedelta(minutes=1)
    db_session.commit()

    assert ws.available_tickets(db_session, op.id) == []
    db_session.refresh(ticket)
    assert ticket.status == "expired"


def test_per_operator_prize_limit(client, db_session):
    """+10 коинов имеет max_wins_per_operator=1 — второй раз не выпадет."""
    from app.models.entities import WheelPrize
    from app.modules.wheel import service as ws
    from app.services.wheel_seed import ensure_default_wheel

    campaign = ensure_default_wheel(db_session)
    op = make_operator(db_session)
    # активным оставляем только «+10 коинов» (лимит 1/оператор)
    for p in db_session.query(WheelPrize).filter_by(campaign_id=campaign.id):
        p.is_active = p.title == "+10 коинов"
    db_session.commit()

    eligible = ws._eligible_prizes(db_session, campaign.id, op.id)
    assert len(eligible) == 1 and eligible[0].title == "+10 коинов"

    ws.issue_ticket(db_session, op, campaign, reason_type="manual", reason_text="1", enforce_daily_cap=False)
    db_session.commit()
    ws.spin(db_session, op, rng=_FixedRNG(1))
    db_session.commit()

    # После выигрыша приз исчерпан для этого оператора
    assert ws._eligible_prizes(db_session, campaign.id, op.id) == []


def test_no_nothing_sector_in_seed(client, db_session):
    from app.models.entities import WheelPrize
    from app.services.wheel_seed import ensure_default_wheel
    campaign = ensure_default_wheel(db_session)
    titles = [p.title.lower() for p in db_session.query(WheelPrize).filter_by(campaign_id=campaign.id)]
    assert titles, "сектора должны быть засеяны"
    assert all("ничего" not in t for t in titles)
    assert all("пусто" not in t for t in titles)


def test_daily_spin_limit(client, db_session):
    """max_spins_per_day=1: после успешной прокрутки вторая — 409, даже с билетом."""
    from fastapi import HTTPException
    from app.modules.wheel import service as ws
    from app.services.wheel_seed import ensure_default_wheel

    campaign = ensure_default_wheel(db_session)
    op = make_operator(db_session)
    # два билета, но лимит прокруток в день = 1
    ws.issue_ticket(db_session, op, campaign, reason_type="manual", reason_text="1", enforce_daily_cap=False)
    ws.issue_ticket(db_session, op, campaign, reason_type="manual", reason_text="2", enforce_daily_cap=False)
    db_session.commit()

    ws.spin(db_session, op, rng=_FixedRNG(1))
    db_session.commit()
    with pytest.raises(HTTPException) as exc:
        ws.spin(db_session, op, rng=_FixedRNG(1))
    assert exc.value.status_code == 409


def test_spin_endpoint_repeated_request_no_second_prize(make_client, db_session):
    """HTTP-уровень: после use повторный POST /spin → 409, не второй приз."""
    from app.modules.wheel import service as ws
    from app.services.wheel_seed import ensure_default_wheel

    campaign = ensure_default_wheel(db_session)
    op, user, password = make_operator_user(db_session)
    ws.issue_ticket(db_session, op, campaign, reason_type="manual",
                    reason_text="тест", enforce_daily_cap=False)
    db_session.commit()

    c = make_client()
    assert c.post("/api/auth/login", json={"username": user.username, "password": password}).status_code == 200
    r1 = c.post("/api/wheel/spin")
    assert r1.status_code == 200, r1.text
    r2 = c.post("/api/wheel/spin")
    assert r2.status_code == 409
