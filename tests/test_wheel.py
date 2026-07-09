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


def test_rapid_second_spin_blocked_by_cooldown_not_a_second_prize(db_session):
    """Защита от быстрых повторных прокруток (жалоба: «нажал второй раз сразу
    же — выпал следующий приз»). Даже с двумя реальными билетами и без
    дневного/недельного лимита — вторая прокрутка сразу после первой должна
    получить 429, а не полноценный второй приз."""
    from fastapi import HTTPException

    from app.modules.wheel import service as ws
    from app.services.wheel_seed import ensure_default_wheel

    campaign = ensure_default_wheel(db_session)
    op = make_operator(db_session)
    campaign.max_spins_per_day = 0  # без лимита — изолируем именно cooldown
    campaign.max_spins_per_week = 0
    ws.issue_ticket(db_session, op, campaign, reason_type="manual", reason_text="1", enforce_daily_cap=False)
    ws.issue_ticket(db_session, op, campaign, reason_type="manual", reason_text="2", enforce_daily_cap=False)
    db_session.commit()

    ws.spin(db_session, op, rng=_FixedRNG(1))
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        ws.spin(db_session, op, rng=_FixedRNG(1))
    assert exc.value.status_code == 429
    # второй билет остался нетронутым — не «сгорел» на отклонённой попытке
    assert len(ws.available_tickets(db_session, op.id)) == 1


def test_spin_allowed_again_after_cooldown_elapses(db_session):
    """После того как «отыграл» минимальный интервал — вторая честная
    прокрутка обычным порядком проходит и списывает второй билет.

    Настраиваем «прошлый спин» напрямую в БД (а не через реальный первый
    ws.spin()) — так тест не зависит от того, какие призы у кампании сейчас
    активны/лимитированы из-за побочных эффектов других тестов в этом файле.
    """
    from datetime import timedelta

    from app.models.entities import WheelSpin
    from app.modules.wheel import service as ws
    from app.services.wheel_seed import ensure_default_wheel

    campaign = ensure_default_wheel(db_session)
    op = make_operator(db_session)
    campaign.max_spins_per_day = 0
    campaign.max_spins_per_week = 0
    ticket = ws.issue_ticket(db_session, op, campaign, reason_type="manual", reason_text="1", enforce_daily_cap=False)
    db_session.commit()

    old_spin = WheelSpin(
        operator_id=op.id, ticket_id=ticket.id, campaign_id=campaign.id, prize_id=None,
        status="completed", result_payload_json="{}",
        completed_at=ws.now_utc() - timedelta(seconds=ws.MIN_SECONDS_BETWEEN_SPINS + 1),
    )
    db_session.add(old_spin)
    db_session.commit()

    result = ws.spin(db_session, op, rng=_FixedRNG(1))
    db_session.commit()
    assert result["spin_id"]
    assert len(ws.available_tickets(db_session, op.id)) == 0


def test_spin_blocked_when_last_spin_was_recent(db_session):
    """Симметричный случай: если последний завершённый спин был совсем
    недавно (по данным в БД), новая прокрутка должна получить 429 — билет
    при этом остаётся нетронутым."""
    from datetime import timedelta

    from fastapi import HTTPException

    from app.models.entities import WheelSpin
    from app.modules.wheel import service as ws
    from app.services.wheel_seed import ensure_default_wheel

    campaign = ensure_default_wheel(db_session)
    op = make_operator(db_session)
    campaign.max_spins_per_day = 0
    campaign.max_spins_per_week = 0
    ticket = ws.issue_ticket(db_session, op, campaign, reason_type="manual", reason_text="1", enforce_daily_cap=False)
    db_session.commit()

    recent_spin = WheelSpin(
        operator_id=op.id, ticket_id=ticket.id, campaign_id=campaign.id, prize_id=None,
        status="completed", result_payload_json="{}",
        completed_at=ws.now_utc() - timedelta(seconds=0.5),
    )
    db_session.add(recent_spin)
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        ws.spin(db_session, op, rng=_FixedRNG(1))
    assert exc.value.status_code == 429
    assert len(ws.available_tickets(db_session, op.id)) == 1


def test_campaign_accepts_spin_limits_up_to_new_ceiling(client, db_session):
    """Регрессия: раньше max_spins_per_day/week были ограничены 50/200 —
    легитимное значение вроде 100 в день отклонялось 422 с сырым JSON вместо
    понятной ошибки. Потолок поднят (500/2000), 0 по-прежнему значит
    «без лимита» (см. wheel/service.py)."""
    from app.services.wheel_seed import ensure_default_wheel

    campaign = ensure_default_wheel(db_session)
    r = client.patch(f"/api/admin/wheel/campaigns/{campaign.id}", json={
        "max_spins_per_day": 100, "max_spins_per_week": 500,
    })
    assert r.status_code == 200, r.text
    assert r.json()["max_spins_per_day"] == 100
    assert r.json()["max_spins_per_week"] == 500

    r_over = client.patch(f"/api/admin/wheel/campaigns/{campaign.id}", json={"max_spins_per_day": 501})
    assert r_over.status_code == 422


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


# ── Массовая выдача билетов ──────────────────────────────────────────────────

def test_bulk_issue_tickets_multiple_operators_and_quantity(client, db_session):
    from app.services.wheel_seed import ensure_default_wheel

    ensure_default_wheel(db_session)
    op1 = make_operator(db_session, full_name="Массовый1")
    op2 = make_operator(db_session, full_name="Массовый2")

    r = client.post("/api/admin/wheel/tickets/bulk", json={
        "operator_ids": [op1.id, op2.id],
        "quantity": 3,
        "reason_text": "Массовая выдача за конкурс",
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["issued_count"] == 6  # 2 оператора × 3 билета
    assert len(data["ticket_ids"]) == 6
    assert data["failed"] == []

    from app.modules.wheel import service as ws
    assert len(ws.available_tickets(db_session, op1.id)) == 3
    assert len(ws.available_tickets(db_session, op2.id)) == 3


def test_bulk_issue_tickets_unknown_operator_reported_but_others_succeed(client, db_session):
    from app.services.wheel_seed import ensure_default_wheel

    ensure_default_wheel(db_session)
    op = make_operator(db_session, full_name="Массовый3")
    bogus_id = 999_999

    r = client.post("/api/admin/wheel/tickets/bulk", json={
        "operator_ids": [op.id, bogus_id],
        "quantity": 1,
        "reason_text": "тест",
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["issued_count"] == 1
    assert len(data["failed"]) == 1
    assert data["failed"][0]["operator_id"] == bogus_id


def test_bulk_issue_tickets_requires_staff_role(make_client, db_session):
    from app.services.wheel_seed import ensure_default_wheel
    from tests.test_coin_rules_and_group_scope import _login

    ensure_default_wheel(db_session)
    op, user, pwd = make_operator_user(db_session)
    op_client = _login(make_client, user.username, pwd)
    r = op_client.post("/api/admin/wheel/tickets/bulk", json={
        "operator_ids": [op.id], "quantity": 1, "reason_text": "тест",
    })
    assert r.status_code == 403
