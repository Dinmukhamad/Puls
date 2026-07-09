"""
Автоматический еженедельный расчёт и бонусы (ТЗ §3):

  * preview — чистый расчёт, ничего не пишет в БД;
  * базовые коины по курсу из coin_rules, бонусы топ-1/2/3, без опозданий,
    без нарушений, номинации недели, благодарность водителя;
  * min_points_for_accrual отсекает низкие баллы;
  * apply — создаёт run + detail + транзакции, повторный apply за тот же
    период не задваивает начисление (защита от дублей, ТЗ 3.4);
  * доступ: preview — supervisor/manager/admin, apply — только manager/admin;
  * мост reports → weekly_results (реальные Excel-метрики без двойного ввода);
  * cron: previous_week_bounds() считает прошлую неделю пн-вс правильно.
"""
from __future__ import annotations

from datetime import date

from tests.conftest import make_operator

WEEK_START = date(2026, 6, 29)
WEEK_END = date(2026, 7, 5)


def _weekly_row(db, *, full_name="Оператор", final_score=0.0, quality_score=0.0,
                 efficiency_score=0.0, calls_per_hour_score=0.0, lateness_count=0,
                 violation_count=0, thanks_count=0, coins_earned=0,
                 week_start=WEEK_START, week_end=WEEK_END):
    from app.models import entities as m

    op = make_operator(db, full_name=full_name)
    row = m.WeeklyResult(
        operator_id=op.id,
        week_start=week_start,
        week_end=week_end,
        final_score=final_score,
        contest_points=final_score,
        quality_score=quality_score,
        efficiency_score=efficiency_score,
        calls_per_hour_score=calls_per_hour_score,
        lateness_count=lateness_count,
        violation_count=violation_count,
        thanks_count=thanks_count,
        coins_earned=coins_earned,
    )
    db.add(row)
    db.commit()
    db.refresh(op)
    db.refresh(row)
    return op, row


def _reset_coin_rules(client, **overrides):
    payload = {
        "points_per_coin": 5, "rounding_mode": "floor", "min_points_for_accrual": 0,
        "top_1_bonus": 15, "top_2_bonus": 10, "top_3_bonus": 7,
        "no_late_bonus": 5, "no_violation_bonus": 3, "nomination_bonus": 5,
        "driver_thanks_bonus": 3, "accrue_to_fired": False, "accrue_to_inactive": False,
    }
    payload.update(overrides)
    r = client.put("/api/settings/coin-rules", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


# ── Расчёт (preview) ─────────────────────────────────────────────────────────

def test_preview_is_read_only_and_computes_rank_bonuses(client, db_session):
    from app.models import entities as m

    week_start, week_end = date(2026, 3, 2), date(2026, 3, 8)
    _reset_coin_rules(client)
    _weekly_row(db_session, full_name="Первый", final_score=100, week_start=week_start, week_end=week_end)
    _weekly_row(db_session, full_name="Второй", final_score=80, week_start=week_start, week_end=week_end)
    _weekly_row(db_session, full_name="Третий", final_score=60, week_start=week_start, week_end=week_end)

    r = client.get(f"/api/weekly-results/preview?period_start={week_start}&period_end={week_end}")
    assert r.status_code == 200, r.text
    data = r.json()
    by_points = sorted(data["operators"], key=lambda o: -o["contest_points"])
    assert [o["rank_place"] for o in by_points] == [1, 2, 3]
    assert [o["base_coins"] for o in by_points] == [20, 16, 12]  # floor(100/5), floor(80/5), floor(60/5)
    assert [o["bonus_top_coins"] for o in by_points] == [15, 10, 7]
    # lateness_count/violation_count не заданы (дефолт 0 в хелпере) — оба бонуса тоже применяются
    assert by_points[0]["total_coins"] == 20 + 15 + 5 + 3

    # preview не пишет ничего в БД — именно за этот период, а не глобально
    # (другие тесты уже могли применить apply для других периодов)
    assert db_session.query(m.WeeklyAccrualRun).filter_by(period_start=week_start, period_end=week_end).count() == 0
    assert db_session.query(m.WeeklyAccrualDetail).filter_by(period_start=week_start, period_end=week_end).count() == 0


def test_no_late_and_no_violation_bonuses(client, db_session):
    week_start, week_end = date(2026, 3, 9), date(2026, 3, 15)
    _reset_coin_rules(client)
    _weekly_row(db_session, full_name="Чистый", final_score=50, lateness_count=0, violation_count=0, week_start=week_start, week_end=week_end)
    _weekly_row(db_session, full_name="Опоздун", final_score=50, lateness_count=2, violation_count=0, week_start=week_start, week_end=week_end)

    r = client.get(f"/api/weekly-results/preview?period_start={week_start}&period_end={week_end}")
    ops = {o["operator_name"].split(" ")[0]: o for o in r.json()["operators"]}
    assert ops["Чистый"]["bonus_no_late_coins"] == 5
    assert ops["Чистый"]["bonus_no_violation_coins"] == 3
    assert ops["Опоздун"]["bonus_no_late_coins"] == 0
    assert ops["Опоздун"]["bonus_no_violation_coins"] == 3


def test_nomination_winners_by_category(client, db_session):
    week_start, week_end = date(2026, 3, 16), date(2026, 3, 22)
    _reset_coin_rules(client)
    _weekly_row(db_session, full_name="ЗвонковыйЛидер", final_score=10, calls_per_hour_score=99, week_start=week_start, week_end=week_end)
    _weekly_row(db_session, full_name="КачествоЛидер", final_score=10, quality_score=99, week_start=week_start, week_end=week_end)
    _weekly_row(db_session, full_name="Обычный", final_score=10, week_start=week_start, week_end=week_end)

    r = client.get(f"/api/weekly-results/preview?period_start={week_start}&period_end={week_end}")
    ops = {o["operator_name"].split(" ")[0]: o for o in r.json()["operators"]}
    assert ops["ЗвонковыйЛидер"]["bonus_nomination_coins"] == 5
    assert ops["КачествоЛидер"]["bonus_nomination_coins"] == 5
    assert ops["Обычный"]["bonus_nomination_coins"] == 0


def test_min_points_for_accrual_excludes_low_scorers(client, db_session):
    week_start, week_end = date(2026, 3, 23), date(2026, 3, 29)
    _reset_coin_rules(client, min_points_for_accrual=40)
    _weekly_row(db_session, full_name="Низкий", final_score=30, lateness_count=0, violation_count=0, week_start=week_start, week_end=week_end)

    r = client.get(f"/api/weekly-results/preview?period_start={week_start}&period_end={week_end}")
    op = next(o for o in r.json()["operators"] if o["operator_name"].startswith("Низкий"))
    assert op["base_coins"] == 0
    assert op["bonus_no_late_coins"] == 0
    assert op["total_coins"] == 0
    _reset_coin_rules(client)  # не аукается другим тестам сессии


# ── Apply: начисление + защита от дублей ────────────────────────────────────

def test_apply_creates_transactions_and_is_idempotent(client, db_session):
    from app.models import entities as m

    week_start, week_end = date(2026, 3, 30), date(2026, 4, 5)
    _reset_coin_rules(client)
    op, row = _weekly_row(db_session, full_name="Начисляемый", final_score=100, lateness_count=0, violation_count=0, week_start=week_start, week_end=week_end)
    balance_before = op.current_balance

    r1 = client.post("/api/weekly-results/apply", json={
        "period_start": str(week_start), "period_end": str(week_end), "mode": "manual",
    })
    assert r1.status_code == 200, r1.text
    run1 = r1.json()
    assert run1["status"] == "success"
    assert run1["operators_count"] == 1
    assert run1["skipped_existing_count"] == 0

    db_session.refresh(op)
    detail = db_session.query(m.WeeklyAccrualDetail).filter_by(operator_id=op.id).one()
    assert detail.total_coins == 20 + 15 + 5 + 3  # база + топ-1 + без опозданий + без нарушений

    # rank #1 в единственной попытке этой недели — также закрывает достижение top_3_week (§7)
    achievement_reward = 10
    assert op.current_balance == balance_before + detail.total_coins + achievement_reward

    txs = db_session.query(m.CoinTransaction).filter_by(operator_id=op.id).all()
    tx_types = sorted(t.type for t in txs)
    assert tx_types == sorted(["weekly_accrual", "bonus_top", "bonus_no_late", "bonus_no_violation", "achievement_reward"])

    # повторный apply за тот же период — не задваивает
    r2 = client.post("/api/weekly-results/apply", json={
        "period_start": str(week_start), "period_end": str(week_end), "mode": "manual",
    })
    assert r2.status_code == 200, r2.text
    run2 = r2.json()
    assert run2["operators_count"] == 0
    assert run2["skipped_existing_count"] == 1

    db_session.refresh(op)
    assert op.current_balance == balance_before + detail.total_coins + achievement_reward, "повторный apply не должен менять баланс"
    assert db_session.query(m.CoinTransaction).filter_by(operator_id=op.id).count() == len(txs)


def test_apply_requires_manager_operator_and_supervisor_blocked(client, db_session, make_client):
    from tests.test_coin_rules_and_group_scope import _login, _make_role_user

    week_start, week_end = date(2026, 4, 6), date(2026, 4, 12)
    _weekly_row(db_session, full_name="РольТест", final_score=50, week_start=week_start, week_end=week_end)

    supervisor, pwd = _make_role_user(db_session, role="supervisor")
    sup_client = _login(make_client, supervisor.username, pwd)

    r_preview = sup_client.get(f"/api/weekly-results/preview?period_start={week_start}&period_end={week_end}")
    assert r_preview.status_code == 200, "supervisor может смотреть preview"

    r_apply = sup_client.post("/api/weekly-results/apply", json={
        "period_start": str(week_start), "period_end": str(week_end), "mode": "manual",
    })
    assert r_apply.status_code == 403, "supervisor не может применять начисление"

    from tests.conftest import make_operator_user
    _, operator_user, op_pwd = make_operator_user(db_session)
    op_client = _login(make_client, operator_user.username, op_pwd)
    r_op = op_client.get(f"/api/weekly-results/preview?period_start={week_start}&period_end={week_end}")
    assert r_op.status_code == 403


def test_runs_history_lists_applied_run(client, db_session):
    _reset_coin_rules(client)
    week_start, week_end = date(2026, 7, 6), date(2026, 7, 12)
    _weekly_row(db_session, full_name="История", final_score=50, week_start=week_start, week_end=week_end)

    r = client.post("/api/weekly-results/apply", json={
        "period_start": str(week_start), "period_end": str(week_end), "mode": "manual",
    })
    assert r.status_code == 200, r.text

    runs = client.get("/api/weekly-results/runs").json()
    assert any(
        run["period_start"] == str(week_start) and run["period_end"] == str(week_end) and run["status"] == "success"
        for run in runs
    )


# ── Мост reports → weekly_results ────────────────────────────────────────────

def test_sync_weekly_result_bridge_maps_metrics_and_preserves_discipline_fields(db_session):
    from types import SimpleNamespace

    from app.models import entities as m
    from app.modules.reports.service import _sync_weekly_result

    op = make_operator(db_session, full_name="МостОператор")
    pr = m.PeriodReport(operator_id=op.id, period_start=WEEK_START, period_end=WEEK_END, coins_awarded=17)
    metrics = SimpleNamespace(total_hours=39.5, quality_avg=94.0, efficiency_percent=88.0, kvz=7.2, final_points=123.0)

    _sync_weekly_result(db_session, op, metrics, pr, WEEK_START, WEEK_END)
    db_session.commit()

    row = db_session.query(m.WeeklyResult).filter_by(operator_id=op.id, week_start=WEEK_START, week_end=WEEK_END).one()
    assert row.hours_score == 39.5
    assert row.quality_score == 94.0
    assert row.efficiency_score == 88.0
    assert row.calls_per_hour_score == 7.2
    assert row.final_score == 123.0
    assert row.coins_earned == 17  # синхронизировано с pr.coins_awarded
    assert row.lateness_count == 0  # дефолт — Excel не даёт этих данных раздельно

    # Если lateness_count был выставлен вручную ранее — мост его не затирает
    row.lateness_count = 4
    db_session.commit()
    metrics2 = SimpleNamespace(total_hours=40.0, quality_avg=95.0, efficiency_percent=89.0, kvz=7.5, final_points=130.0)
    pr.coins_awarded = 20
    _sync_weekly_result(db_session, op, metrics2, pr, WEEK_START, WEEK_END)
    db_session.commit()
    db_session.refresh(row)
    assert row.lateness_count == 4, "ручные значения опозданий/нарушений мост не должен затирать"
    assert row.coins_earned == 20
    assert row.final_score == 130.0


# ── Cron: расчёт границ прошлой недели ───────────────────────────────────────

def test_previous_week_bounds_monday_to_sunday():
    from app.core.scheduler import previous_week_bounds

    # Понедельник 2026-07-13 09:00 — должна взяться неделя 06.07–12.07
    start, end = previous_week_bounds(today=date(2026, 7, 13))
    assert start == date(2026, 7, 6)
    assert end == date(2026, 7, 12)

    # Середина недели — тоже должна откатываться к последней ЗАВЕРШЁННОЙ неделе
    start2, end2 = previous_week_bounds(today=date(2026, 7, 15))
    assert start2 == date(2026, 7, 6)
    assert end2 == date(2026, 7, 12)


def test_run_weekly_accrual_job_applies_previous_week(client, db_session, monkeypatch):
    from app.core import scheduler as sched
    from app.models import entities as m

    _reset_coin_rules(client)
    fixed_monday = date(2026, 7, 20)
    expected_start, expected_end = sched.previous_week_bounds(today=fixed_monday)
    _weekly_row(db_session, full_name="КронОператор", final_score=45, week_start=expected_start, week_end=expected_end)

    monkeypatch.setattr(sched, "now_local", lambda: __import__("datetime").datetime.combine(fixed_monday, __import__("datetime").time(9, 0)))

    sched.run_weekly_accrual_job()

    run = (
        db_session.query(m.WeeklyAccrualRun)
        .filter_by(period_start=expected_start, period_end=expected_end, mode="auto")
        .order_by(m.WeeklyAccrualRun.id.desc())
        .first()
    )
    assert run is not None, "cron должен создать run за прошлую неделю"
    assert run.status == "success"
    assert run.created_by == "system"
