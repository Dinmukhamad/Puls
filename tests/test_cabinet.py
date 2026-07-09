"""
Личный кабинет оператора (ТЗ §5): один агрегирующий эндпоинт вместо 4-5
отдельных запросов.

Проверяем:
  * до apply — coin_calculation.is_final == False (предварительный расчёт,
    тот же движок, что и preview);
  * после apply — is_final == True, совпадает с WeeklyAccrualDetail,
    wallet.earned_this_week == total_week_coins;
  * без единой WeeklyResult — не падает, просто null-секции;
  * оператор не может смотреть чужой кабинет через /cabinet/operator/{id};
  * супервайзер ограничен своей группой, как и везде в этой сессии.
"""
from __future__ import annotations

from datetime import date

from tests.conftest import make_operator, make_operator_user
from tests.test_coin_rules_and_group_scope import (
    _login,
    _make_group,
    _make_operator_in_group,
    _make_role_user,
)
from tests.test_weekly_accrual_engine import _reset_coin_rules


def _login_operator(make_client, user, password):
    c = make_client()
    r = c.post("/api/auth/login", json={"username": user.username, "password": password})
    assert r.status_code == 200, r.text
    return c


def test_cabinet_before_apply_shows_preview_calculation(client, db_session, make_client):
    week_start, week_end = date(2026, 6, 1), date(2026, 6, 7)
    _reset_coin_rules(client)
    op, user, pwd = make_operator_user(db_session)
    from app.models import entities as m
    row = m.WeeklyResult(
        operator_id=op.id, week_start=week_start, week_end=week_end,
        final_score=100, contest_points=100, quality_score=90, efficiency_score=80,
        calls_per_hour_score=5, lateness_count=0, violation_count=0, thanks_count=0,
    )
    db_session.add(row)
    db_session.commit()

    op_client = _login_operator(make_client, user, pwd)
    r = op_client.get("/api/cabinet/me")
    assert r.status_code == 200, r.text
    data = r.json()

    assert data["operator"]["id"] == op.id
    assert data["week_metrics"]["quality"] == 90
    assert data["coin_calculation"]["is_final"] is False
    assert data["coin_calculation"]["base_coins"] == 20  # floor(100/5)
    bonus_types = {b["type"] for b in data["coin_calculation"]["bonuses"]}
    assert "top" in bonus_types  # единственный оператор периода — rank 1
    assert "no_late" in bonus_types
    assert data["wallet"]["earned_this_week"] == data["coin_calculation"]["total_week_coins"]


def test_cabinet_after_apply_shows_final_calculation(client, db_session, make_client):
    week_start, week_end = date(2026, 6, 8), date(2026, 6, 14)
    _reset_coin_rules(client)
    op, user, pwd = make_operator_user(db_session)
    from app.models import entities as m
    row = m.WeeklyResult(
        operator_id=op.id, week_start=week_start, week_end=week_end,
        final_score=50, contest_points=50, lateness_count=0, violation_count=0,
    )
    db_session.add(row)
    db_session.commit()

    r_apply = client.post("/api/weekly-results/apply", json={
        "period_start": str(week_start), "period_end": str(week_end), "mode": "manual",
    })
    assert r_apply.status_code == 200, r_apply.text

    op_client = _login_operator(make_client, user, pwd)
    r = op_client.get("/api/cabinet/me")
    data = r.json()

    assert data["coin_calculation"]["is_final"] is True
    assert data["wallet"]["earned_this_week"] == data["coin_calculation"]["total_week_coins"]
    db_session.refresh(op)
    assert data["wallet"]["balance"] == op.current_balance


def test_cabinet_with_no_weekly_data_does_not_crash(make_client, db_session):
    op, user, pwd = make_operator_user(db_session)
    op_client = _login_operator(make_client, user, pwd)

    r = op_client.get("/api/cabinet/me")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["week_metrics"] is None
    assert data["coin_calculation"] is None
    assert data["wallet"]["earned_this_week"] == 0
    assert data["recent_transactions"] == []


def test_operator_cannot_view_others_cabinet(make_client, db_session):
    op, user, pwd = make_operator_user(db_session)
    other = make_operator(db_session, full_name="ЧужойКабинет")
    op_client = _login_operator(make_client, user, pwd)

    r = op_client.get(f"/api/cabinet/operator/{other.id}")
    assert r.status_code == 403, r.text


def test_supervisor_cabinet_scoped_to_own_group(db_session, make_client):
    group_a = _make_group(db_session, "CabinetA")
    group_b = _make_group(db_session, "CabinetB")
    op_own = _make_operator_in_group(db_session, group_a, full_name="СвойКабинет")
    op_other = _make_operator_in_group(db_session, group_b, full_name="ЧужойКабинет2")

    supervisor, pwd = _make_role_user(db_session, role="supervisor", group_id=group_a.id)
    sup_client = _login(make_client, supervisor.username, pwd)

    r_own = sup_client.get(f"/api/cabinet/operator/{op_own.id}")
    assert r_own.status_code == 200, r_own.text

    r_other = sup_client.get(f"/api/cabinet/operator/{op_other.id}")
    assert r_other.status_code == 403, r_other.text


def test_recent_transactions_limited_and_ordered(client, db_session, make_client):
    from app.models import entities as m

    op, user, pwd = make_operator_user(db_session)
    for i in range(3):
        db_session.add(m.CoinTransaction(operator_id=op.id, amount=i + 1, type="manual_add", comment=f"тест {i}"))
    db_session.commit()

    op_client = _login_operator(make_client, user, pwd)
    r = op_client.get("/api/cabinet/me")
    txs = r.json()["recent_transactions"]
    assert len(txs) == 3
    # последняя добавленная — первая в списке (created_at.desc())
    assert txs[0]["comment"] == "тест 2"
