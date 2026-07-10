"""
Розыгрыши (ТЗ P2): билеты из Колеса WOW, вход билетами, тираж с несколькими
победителями, взвешенный выбор, начисление приза-коинов, уведомления,
автотираж по дате.
"""
from __future__ import annotations

from datetime import timedelta

from app.core.datetime_utils import now_utc
from tests.conftest import make_operator, make_operator_user
from tests.test_coin_rules_and_group_scope import _login


def _op_client(db_session, make_client):
    op, user, password = make_operator_user(db_session)
    return _login(make_client, user.username, password), op, user


def _give_tickets(db_session, operator, n):
    operator.raffle_tickets = n
    db_session.commit()


# ── Билеты из колеса ─────────────────────────────────────────────────────────

def test_wheel_raffle_ticket_prize_grants_pool_ticket(db_session):
    from app.models import entities as m
    from app.modules.wheel import service as ws
    from app.services.wheel_seed import ensure_default_wheel
    from tests.test_wheel import _FixedRNG as WheelRNG

    campaign = ensure_default_wheel(db_session)
    op = make_operator(db_session)
    prize = m.WheelPrize(
        campaign_id=campaign.id, title="Билет розыгрыша", prize_type="raffle_ticket",
        amount=1, weight=1, color="#fff", is_active=True,
    )
    db_session.add(prize)
    db_session.flush()
    # оставляем активным только наш сектор, чтобы он гарантированно выпал
    db_session.query(m.WheelPrize).filter(
        m.WheelPrize.campaign_id == campaign.id, m.WheelPrize.id != prize.id
    ).update({"is_active": False})
    db_session.commit()

    ws.issue_ticket(db_session, op, campaign, reason_type="manual", reason_text="t", enforce_daily_cap=False)
    db_session.commit()

    result = ws.spin(db_session, op, rng=WheelRNG(1))  # roll=1 → единственный активный сектор
    db_session.commit()
    db_session.refresh(op)
    assert result["prize"]["type"] == "raffle_ticket"
    assert op.raffle_tickets == 1


# ── Вход и тираж ─────────────────────────────────────────────────────────────

def test_operator_enters_raffle_spending_tickets(client, db_session, make_client):
    c, op, user = _op_client(db_session, make_client)
    _give_tickets(db_session, op, 5)
    raffle = client.post("/api/admin/raffles", json={"title": "Тест", "winners_count": 1}).json()

    r = c.post(f"/api/raffles/{raffle['id']}/enter", json={"tickets": 3})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["raffle_tickets"] == 2  # 5 - 3
    entered = next(x for x in data["raffles"] if x["id"] == raffle["id"])
    assert entered["my_tickets_in"] == 3


def test_enter_more_tickets_than_owned_fails(client, db_session, make_client):
    c, op, user = _op_client(db_session, make_client)
    _give_tickets(db_session, op, 2)
    raffle = client.post("/api/admin/raffles", json={"title": "Тест2", "winners_count": 1}).json()

    r = c.post(f"/api/raffles/{raffle['id']}/enter", json={"tickets": 5})
    assert r.status_code == 400
    assert "Недостаточно билетов" in r.json()["detail"]


def test_draw_picks_multiple_distinct_winners(client, db_session, make_client):
    raffle = client.post("/api/admin/raffles", json={"title": "Мульти", "winners_count": 2}).json()
    # три участника
    clients = []
    for _ in range(3):
        c, op, user = _op_client(db_session, make_client)
        _give_tickets(db_session, op, 3)
        c.post(f"/api/raffles/{raffle['id']}/enter", json={"tickets": 3})
        clients.append((op, user))

    r = client.post(f"/api/admin/raffles/{raffle['id']}/draw")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "drawn"
    assert len(data["winners"]) == 2
    winner_ids = {w["operator_id"] for w in data["winners"]}
    assert len(winner_ids) == 2  # разные операторы


def test_draw_with_fewer_participants_than_slots(client, db_session, make_client):
    raffle = client.post("/api/admin/raffles", json={"title": "Мало", "winners_count": 5}).json()
    c, op, user = _op_client(db_session, make_client)
    _give_tickets(db_session, op, 1)
    c.post(f"/api/raffles/{raffle['id']}/enter", json={"tickets": 1})

    data = client.post(f"/api/admin/raffles/{raffle['id']}/draw").json()
    assert data["status"] == "drawn"
    assert len(data["winners"]) == 1  # всего один участник


def test_coin_prize_credited_to_winner(client, db_session, make_client):
    raffle = client.post("/api/admin/raffles", json={
        "title": "Коины", "winners_count": 1, "prize_coins": 50,
    }).json()
    c, op, user = _op_client(db_session, make_client)
    _give_tickets(db_session, op, 1)
    start_balance = op.current_balance
    c.post(f"/api/raffles/{raffle['id']}/enter", json={"tickets": 1})

    client.post(f"/api/admin/raffles/{raffle['id']}/draw")
    db_session.refresh(op)
    assert op.current_balance == start_balance + 50


def test_winner_gets_notification(client, db_session, make_client):
    from app.models import entities as m

    raffle = client.post("/api/admin/raffles", json={"title": "Уведомление", "winners_count": 1}).json()
    c, op, user = _op_client(db_session, make_client)
    _give_tickets(db_session, op, 1)
    c.post(f"/api/raffles/{raffle['id']}/enter", json={"tickets": 1})

    client.post(f"/api/admin/raffles/{raffle['id']}/draw")
    row = db_session.query(m.Notification).filter_by(user_id=user.id, type="raffle_win").first()
    assert row is not None
    assert "Уведомление" in row.title


def test_draw_without_participants_fails(client, db_session):
    raffle = client.post("/api/admin/raffles", json={"title": "Пусто", "winners_count": 1}).json()
    r = client.post(f"/api/admin/raffles/{raffle['id']}/draw")
    assert r.status_code == 400
    assert "Нет участников" in r.json()["detail"]


def test_cancel_returns_tickets(client, db_session, make_client):
    c, op, user = _op_client(db_session, make_client)
    _give_tickets(db_session, op, 4)
    raffle = client.post("/api/admin/raffles", json={"title": "Отмена", "winners_count": 1}).json()
    c.post(f"/api/raffles/{raffle['id']}/enter", json={"tickets": 4})
    db_session.refresh(op)
    assert op.raffle_tickets == 0

    r = client.post(f"/api/admin/raffles/{raffle['id']}/cancel")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled"
    db_session.refresh(op)
    assert op.raffle_tickets == 4  # билеты вернулись


def test_auto_draw_when_end_date_passed(client, db_session, make_client):
    from app.models import entities as m

    c, op, user = _op_client(db_session, make_client)
    _give_tickets(db_session, op, 2)
    raffle = client.post("/api/admin/raffles", json={"title": "Авто", "winners_count": 1}).json()
    c.post(f"/api/raffles/{raffle['id']}/enter", json={"tickets": 2})

    # сдвигаем срок в прошлое напрямую в БД
    r_obj = db_session.get(m.Raffle, raffle["id"])
    r_obj.ends_at = now_utc() - timedelta(hours=1)
    db_session.commit()

    # загрузка списка админом должна лениво разыграть просроченный розыгрыш
    listing = client.get("/api/admin/raffles").json()
    drawn = next(x for x in listing if x["id"] == raffle["id"])
    assert drawn["status"] == "drawn"
    assert len(drawn["winners"]) == 1


def test_weighted_selection_favors_more_tickets(client, db_session, make_client):
    """Проверяем, что вес работает: оператор с подавляющим числом билетов
    почти всегда выигрывает единственное место. Прогоняем несколько тиражей."""
    wins_for_heavy = 0
    runs = 12
    for _ in range(runs):
        raffle = client.post("/api/admin/raffles", json={"title": "Вес", "winners_count": 1}).json()
        heavy_c, heavy_op, _ = _op_client(db_session, make_client)
        light_c, light_op, _ = _op_client(db_session, make_client)
        _give_tickets(db_session, heavy_op, 50)
        _give_tickets(db_session, light_op, 1)
        heavy_c.post(f"/api/raffles/{raffle['id']}/enter", json={"tickets": 50})
        light_c.post(f"/api/raffles/{raffle['id']}/enter", json={"tickets": 1})
        data = client.post(f"/api/admin/raffles/{raffle['id']}/draw").json()
        if data["winners"][0]["operator_id"] == heavy_op.id:
            wins_for_heavy += 1
    # при 50:1 тяжёлый должен брать явное большинство из 12 тиражей
    assert wins_for_heavy >= 9, f"heavy выиграл {wins_for_heavy}/{runs}"


def test_operator_only_sees_own_ticket_count(client, db_session, make_client):
    c, op, user = _op_client(db_session, make_client)
    _give_tickets(db_session, op, 7)
    r = c.get("/api/raffles")
    assert r.status_code == 200, r.text
    assert r.json()["raffle_tickets"] == 7


def test_operator_cannot_access_admin_endpoints(client, db_session, make_client):
    c, op, user = _op_client(db_session, make_client)
    r = c.post("/api/admin/raffles", json={"title": "Нельзя", "winners_count": 1})
    assert r.status_code == 403
