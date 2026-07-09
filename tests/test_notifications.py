"""
Уведомления (ТЗ P2): список/непрочитанные/отметка прочитанным + проверка,
что события (достижение, статус заявки, еженедельный расчёт, приз колеса,
ручная операция) реально создают уведомление у нужного оператора.
"""
from __future__ import annotations

from datetime import date

from tests.conftest import make_operator_user
from tests.test_coin_rules_and_group_scope import _login
from tests.test_weekly_accrual_engine import _reset_coin_rules


def _op_client(db_session, make_client):
    op, user, password = make_operator_user(db_session)
    return _login(make_client, user.username, password), op, user


def test_list_and_unread_count(db_session, make_client):
    from app.modules.notifications.service import notify_user

    c, op, user = _op_client(db_session, make_client)
    notify_user(db_session, user.id, type="test", title="Первое")
    notify_user(db_session, user.id, type="test", title="Второе")
    db_session.commit()

    r = c.get("/api/notifications")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total"] == 2
    assert data["unread_count"] == 2
    assert data["items"][0]["title"] == "Второе"  # новые сверху

    r_count = c.get("/api/notifications/unread-count")
    assert r_count.json()["unread_count"] == 2


def test_mark_read_and_read_all(db_session, make_client):
    from app.modules.notifications.service import notify_user

    c, op, user = _op_client(db_session, make_client)
    n1 = notify_user(db_session, user.id, type="test", title="Первое")
    notify_user(db_session, user.id, type="test", title="Второе")
    db_session.commit()

    r = c.post(f"/api/notifications/{n1.id}/read")
    assert r.status_code == 200, r.text
    assert r.json()["is_read"] is True

    r_count = c.get("/api/notifications/unread-count")
    assert r_count.json()["unread_count"] == 1

    r_all = c.post("/api/notifications/read-all")
    assert r_all.status_code == 200, r_all.text
    assert r_all.json()["marked"] == 1

    assert c.get("/api/notifications/unread-count").json()["unread_count"] == 0


def test_notifications_isolated_per_user(db_session, make_client):
    from app.modules.notifications.service import notify_user

    _, _, user_a = _op_client(db_session, make_client)
    c_b, _, user_b = _op_client(db_session, make_client)
    notify_user(db_session, user_a.id, type="test", title="Для А")
    db_session.commit()

    r = c_b.get("/api/notifications")
    assert r.json()["total"] == 0


def test_cannot_mark_read_someone_elses_notification(db_session, make_client):
    from app.modules.notifications.service import notify_user

    _, _, user_a = _op_client(db_session, make_client)
    c_b, _, _ = _op_client(db_session, make_client)
    n = notify_user(db_session, user_a.id, type="test", title="Для А")
    db_session.commit()

    r = c_b.post(f"/api/notifications/{n.id}/read")
    assert r.status_code == 404


# ── События ───────────────────────────────────────────────────────────────

def test_achievement_grant_creates_notification(client, db_session):
    from app.models import entities as m
    from app.modules.achievements.service import ensure_default_achievements, grant_manual

    ensure_default_achievements(db_session)
    op, user, password = make_operator_user(db_session)
    achievement = db_session.query(m.Achievement).filter_by(code="helper").first()
    admin_user = db_session.query(m.User).filter_by(role="admin").first()

    grant_manual(db_session, op, achievement, admin_user, comment="тест")
    db_session.commit()

    from app.modules.notifications.service import notify_user  # noqa: F401
    row = db_session.query(m.Notification).filter_by(user_id=user.id).first()
    assert row is not None
    assert "Помощник команды" in row.title


def test_purchase_approve_creates_notification(client, db_session, make_client):
    from app.models import entities as m

    c, op, user = _op_client(db_session, make_client)
    op.current_balance = 100
    db_session.commit()
    item = m.ShopItem(title="Тест-товар", price=10)
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)

    r_purchase = c.post("/api/shop/purchases", json={"shop_item_id": item.id})
    assert r_purchase.status_code == 200, r_purchase.text
    purchase_id = r_purchase.json()["id"]

    r_approve = client.post(f"/api/shop/purchases/{purchase_id}/approve")
    assert r_approve.status_code == 200, r_approve.text

    row = db_session.query(m.Notification).filter_by(user_id=user.id, type="purchase_approved").first()
    assert row is not None
    assert "Тест-товар" in row.title


def test_purchase_reject_creates_notification(client, db_session, make_client):
    from app.models import entities as m

    c, op, user = _op_client(db_session, make_client)
    op.current_balance = 100
    db_session.commit()
    item = m.ShopItem(title="Тест-товар2", price=10)
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)

    r_purchase = c.post("/api/shop/purchases", json={"shop_item_id": item.id})
    purchase_id = r_purchase.json()["id"]

    r_reject = client.post(f"/api/shop/purchases/{purchase_id}/reject", json={"reason": "нет в наличии"})
    assert r_reject.status_code == 200, r_reject.text

    row = db_session.query(m.Notification).filter_by(user_id=user.id, type="purchase_rejected").first()
    assert row is not None
    assert "нет в наличии" in row.body


def test_weekly_accrual_creates_notification(client, db_session):
    _reset_coin_rules(client)
    week_start, week_end = date(2026, 11, 2), date(2026, 11, 8)
    op, user, password = _weekly_row_with_login(db_session, week_start, week_end, final_score=50)

    r = client.post("/api/weekly-results/apply", json={
        "period_start": str(week_start), "period_end": str(week_end), "mode": "manual",
    })
    assert r.status_code == 200, r.text

    from app.models import entities as m
    row = db_session.query(m.Notification).filter_by(user_id=user.id, type="weekly_accrual").first()
    assert row is not None


def test_wheel_prize_creates_notification(db_session, make_client):
    from app.modules.wheel import service as ws
    from app.services.wheel_seed import ensure_default_wheel

    campaign = ensure_default_wheel(db_session)
    c, op, user = _op_client(db_session, make_client)
    ws.issue_ticket(db_session, op, campaign, reason_type="manual", reason_text="тест", enforce_daily_cap=False)
    db_session.commit()

    r = c.post("/api/wheel/spin")
    assert r.status_code == 200, r.text

    from app.models import entities as m
    row = db_session.query(m.Notification).filter_by(user_id=user.id, type="wheel_prize").first()
    assert row is not None


def test_manual_coin_operation_creates_notification(client, db_session):
    from app.models import entities as m

    op, user, password = make_operator_user(db_session)
    r = client.post("/api/coins/manual-operation", json={
        "operator_id": op.id, "operation": "credit", "amount": 15, "reason": "тестовое начисление",
    })
    assert r.status_code == 200, r.text

    row = db_session.query(m.Notification).filter_by(user_id=user.id, type="manual_operation").first()
    assert row is not None
    assert "15" in row.title


def _weekly_row_with_login(db_session, week_start, week_end, **kwargs):
    from app.models import entities as m

    op, user, password = make_operator_user(db_session)
    defaults = {"final_score": 50, "contest_points": 50, "lateness_count": 0, "violation_count": 0}
    defaults.update(kwargs)
    row = m.WeeklyResult(operator_id=op.id, week_start=week_start, week_end=week_end, **defaults)
    db_session.add(row)
    db_session.commit()
    return op, user, password
