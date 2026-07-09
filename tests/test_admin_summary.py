"""
Админская сводка (ТЗ §9): GET /dashboard/admin-summary.

Проверяем: карточки сверху считаются правильно, фильтры (группа, участие,
должность, опоздания, нарушения) работают, supervisor не может выйти за
пределы своей группы даже передав чужой group_id явно, до/после apply
данные берутся из согласованного источника (как в preview/кабинете/экспорте).
"""
from __future__ import annotations

from datetime import date

from tests.conftest import make_operator_user
from tests.test_coin_rules_and_group_scope import (
    _login,
    _make_group,
    _make_operator_in_group,
    _make_role_user,
)
from tests.test_weekly_accrual_engine import _reset_coin_rules


def _add_weekly_row(db, operator, week_start, week_end, **kwargs):
    from app.models import entities as m

    defaults = {"final_score": 50, "contest_points": 50, "lateness_count": 0, "violation_count": 0}
    defaults.update(kwargs)
    row = m.WeeklyResult(operator_id=operator.id, week_start=week_start, week_end=week_end, **defaults)
    db.add(row)
    db.commit()
    return row


def test_admin_summary_top_cards(client, db_session):
    week_start, week_end = date(2026, 9, 7), date(2026, 9, 13)
    _reset_coin_rules(client)
    group = _make_group(db_session, "SummaryCards")
    op1 = _make_operator_in_group(db_session, group, full_name="СводкаКарт1")
    op2 = _make_operator_in_group(db_session, group, full_name="СводкаКарт2")
    _add_weekly_row(db_session, op1, week_start, week_end, final_score=100)
    _add_weekly_row(db_session, op2, week_start, week_end, final_score=50, lateness_count=1)

    from app.models import entities as m
    item = m.ShopItem(title="Товар сводки", price=5)
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)
    db_session.add(m.ShopPurchase(operator_id=op1.id, shop_item_id=item.id, price=5, status="new"))
    db_session.commit()

    r = client.get(f"/api/dashboard/admin-summary?period_start={week_start}&period_end={week_end}&group_id={group.id}")
    assert r.status_code == 200, r.text
    data = r.json()

    assert data["operators_total"] == 2
    assert data["active_competition_operators"] == 2
    assert data["new_shop_requests"] >= 1
    assert data["average_team_rank"] == 1.5  # ранги 1 и 2 внутри этой группы+периода
    assert data["total_coins_balance"] == (op1.current_balance or 0) + (op2.current_balance or 0)
    names = " ".join(o["full_name"] for o in data["operators"])
    assert "СводкаКарт1" in names and "СводкаКарт2" in names


def test_admin_summary_filters(client, db_session):
    week_start, week_end = date(2026, 9, 14), date(2026, 9, 20)
    group = _make_group(db_session, "SummaryFilters")
    op_late = _make_operator_in_group(db_session, group, full_name="ФильтрОпоздун")
    op_clean = _make_operator_in_group(db_session, group, full_name="ФильтрЧистый")
    _add_weekly_row(db_session, op_late, week_start, week_end, lateness_count=3)
    _add_weekly_row(db_session, op_clean, week_start, week_end, lateness_count=0)

    r_late = client.get(f"/api/dashboard/admin-summary?period_start={week_start}&period_end={week_end}&group_id={group.id}&has_lateness=true")
    names_late = [o["full_name"] for o in r_late.json()["operators"]]
    assert len(names_late) == 1 and names_late[0].startswith("ФильтрОпоздун")

    r_clean = client.get(f"/api/dashboard/admin-summary?period_start={week_start}&period_end={week_end}&group_id={group.id}&has_lateness=false")
    names_clean = [o["full_name"] for o in r_clean.json()["operators"]]
    assert len(names_clean) == 1 and names_clean[0].startswith("ФильтрЧистый")


def test_admin_summary_uses_final_data_after_apply(client, db_session):
    from app.models import entities as m

    week_start, week_end = date(2026, 9, 21), date(2026, 9, 27)
    _reset_coin_rules(client)
    _, user, pwd = make_operator_user(db_session)
    operator = db_session.get(m.Operator, user.operator_id)
    _add_weekly_row(db_session, operator, week_start, week_end, final_score=75)

    r_before = client.get(f"/api/dashboard/admin-summary?period_start={week_start}&period_end={week_end}")
    coins_before = r_before.json()["coins_accrued_this_week"]
    assert coins_before > 0

    r_apply = client.post("/api/weekly-results/apply", json={
        "period_start": str(week_start), "period_end": str(week_end), "mode": "manual",
    })
    assert r_apply.status_code == 200, r_apply.text

    r_after = client.get(f"/api/dashboard/admin-summary?period_start={week_start}&period_end={week_end}")
    assert r_after.json()["coins_accrued_this_week"] == coins_before, "до и после apply цифры должны совпадать"


def test_admin_summary_supervisor_cannot_widen_group_filter(db_session, make_client):
    week_start, week_end = date(2026, 9, 28), date(2026, 10, 4)
    group_a = _make_group(db_session, "SummarySupA")
    group_b = _make_group(db_session, "SummarySupB")
    op_a = _make_operator_in_group(db_session, group_a, full_name="СупервизорСвой")
    op_b = _make_operator_in_group(db_session, group_b, full_name="СупервизорЧужой")
    _add_weekly_row(db_session, op_a, week_start, week_end)
    _add_weekly_row(db_session, op_b, week_start, week_end)

    supervisor, pwd = _make_role_user(db_session, role="supervisor", group_id=group_a.id)
    sup_client = _login(make_client, supervisor.username, pwd)

    # Пытается явно запросить чужую группу — должен получить свою, а не 403/чужую
    r = sup_client.get(f"/api/dashboard/admin-summary?period_start={week_start}&period_end={week_end}&group_id={group_b.id}")
    assert r.status_code == 200, r.text
    names = [o["full_name"] for o in r.json()["operators"]]
    assert len(names) == 1 and names[0].startswith("СупервизорСвой")


def test_operator_cannot_see_admin_summary(make_client, db_session):
    _, user, pwd = make_operator_user(db_session)
    op_client = _login(make_client, user.username, pwd)
    r = op_client.get("/api/dashboard/admin-summary")
    assert r.status_code == 403
