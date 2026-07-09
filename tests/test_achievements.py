"""
Бейджи и достижения (ТЗ §7):

  * дефолтные 8 достижений сидируются автоматически;
  * top_3_week / quality_star / calls_master / efficiency_top — начисляются
    из недельного движка (accrual_service), повторяемые;
  * no_late_3_weeks — считает подряд идущие недели без опозданий, разовое;
  * legend_team — по общему балансу за всё время, разовое;
  * test_master — начисляется из tests/finish_attempt при результате 90%+;
  * ручная выдача (`helper`) — supervisor только в своей группе;
  * админ может выключить достижение — выключенное не начисляется;
  * оператор видит только свои достижения, супервайзер — только свою группу.
"""
from __future__ import annotations

from datetime import date, timedelta

from tests.conftest import make_operator, make_operator_user
from tests.test_coin_rules_and_group_scope import (
    _login,
    _make_group,
    _make_operator_in_group,
    _make_role_user,
)
from tests.test_weekly_accrual_engine import _reset_coin_rules, _weekly_row


def _apply(client, week_start, week_end):
    r = client.post("/api/weekly-results/apply", json={
        "period_start": str(week_start), "period_end": str(week_end), "mode": "manual",
    })
    assert r.status_code == 200, r.text
    return r.json()


def _achievement_by_code(db, code):
    from app.models import entities as m
    return db.query(m.Achievement).filter_by(code=code).one()


# ── Каталог ──────────────────────────────────────────────────────────────────

def test_default_achievements_seeded(client):
    r = client.get("/api/achievements")
    assert r.status_code == 200, r.text
    codes = {a["code"] for a in r.json()}
    assert codes == {
        "top_3_week", "no_late_3_weeks", "quality_star", "calls_master",
        "efficiency_top", "legend_team", "helper", "test_master",
    }


# ── Из недельного движка ─────────────────────────────────────────────────────

def test_top_3_week_awarded_and_repeatable(client, db_session):
    week1 = (date(2026, 1, 5), date(2026, 1, 11))
    week2 = (date(2026, 1, 12), date(2026, 1, 18))
    _reset_coin_rules(client)
    op, _ = _weekly_row(db_session, full_name="ТопНедели", final_score=100, week_start=week1[0], week_end=week1[1])

    _apply(client, *week1)

    r = client.get(f"/api/achievements/operator/{op.id}")
    assert r.status_code == 200, r.text
    completed = {c["achievement"]["code"]: c for c in r.json()["completed"]}
    assert "top_3_week" in completed
    assert completed["top_3_week"]["times_awarded"] == 1

    # вторая неделя — тот же оператор снова единственный участник периода (rank=1) —
    # повторяемое достижение должно начислиться second раз
    from app.models import entities as m
    row2 = m.WeeklyResult(operator_id=op.id, week_start=week2[0], week_end=week2[1], final_score=90, contest_points=90)
    db_session.add(row2)
    db_session.commit()

    _apply(client, *week2)
    r2 = client.get(f"/api/achievements/operator/{op.id}")
    completed2 = {c["achievement"]["code"]: c for c in r2.json()["completed"]}
    assert completed2["top_3_week"]["times_awarded"] == 2, "top_3_week повторяемое — должно начислиться снова"


def test_quality_star_threshold(client, db_session):
    week = (date(2026, 1, 19), date(2026, 1, 25))
    _reset_coin_rules(client)
    op, _ = _weekly_row(db_session, full_name="Качество", final_score=10, quality_score=97, week_start=week[0], week_end=week[1])
    _apply(client, *week)

    r = client.get(f"/api/achievements/operator/{op.id}")
    completed = {c["achievement"]["code"] for c in r.json()["completed"]}
    assert "quality_star" in completed


def test_no_late_3_weeks_streak(client, db_session):
    from app.models import entities as m

    _reset_coin_rules(client)
    op = make_operator(db_session, full_name="БезОпозданий")
    weeks = [(date(2026, 2, 2) + timedelta(days=7 * i), date(2026, 2, 8) + timedelta(days=7 * i)) for i in range(3)]
    for ws, we in weeks:
        db_session.add(m.WeeklyResult(
            operator_id=op.id, week_start=ws, week_end=we, final_score=5, contest_points=5, lateness_count=0,
        ))
    db_session.commit()

    for ws, we in weeks:
        _apply(client, ws, we)

    r = client.get(f"/api/achievements/operator/{op.id}")
    completed = {c["achievement"]["code"]: c for c in r.json()["completed"]}
    assert "no_late_3_weeks" in completed
    assert completed["no_late_3_weeks"]["times_awarded"] == 1


def test_legend_team_lifetime_total(client, db_session):
    week = (date(2026, 2, 23), date(2026, 3, 1))
    _reset_coin_rules(client)
    op, _ = _weekly_row(db_session, full_name="Легенда", final_score=25, week_start=week[0], week_end=week[1])
    op.total_earned = 995
    db_session.commit()

    _apply(client, *week)

    r = client.get(f"/api/achievements/operator/{op.id}")
    completed = {c["achievement"]["code"] for c in r.json()["completed"]}
    assert "legend_team" in completed


def test_disabled_achievement_is_not_awarded(client, db_session):

    a = _achievement_by_code(db_session, "top_3_week")
    r_off = client.patch(f"/api/achievements/{a.id}", json={"is_active": False})
    assert r_off.status_code == 200, r_off.text

    week = (date(2026, 5, 4), date(2026, 5, 10))
    op, _ = _weekly_row(db_session, full_name="БезБейджа", final_score=100, week_start=week[0], week_end=week[1])
    _apply(client, *week)

    r = client.get(f"/api/achievements/operator/{op.id}")
    completed = {c["achievement"]["code"] for c in r.json()["completed"]}
    assert "top_3_week" not in completed

    # возвращаем на дефолт, чтобы не влиять на другие тесты
    client.patch(f"/api/achievements/{a.id}", json={"is_active": True})


# ── Тесты (test_master) ──────────────────────────────────────────────────────

def test_test_master_awarded_on_high_score(make_client, db_session):
    from tests.test_tests_finish import _login_operator, _make_attempt

    op, user, password = make_operator_user(db_session)
    _test, question, correct, attempt = _make_attempt(db_session, op)
    c = _login_operator(make_client, user, password)

    c.post(f"/api/tests/attempts/{attempt.id}/save-answer", json={
        "question_id": question.id, "selected_answer_ids": [correct.id],
    })
    r = c.post(f"/api/tests/attempts/{attempt.id}/finish")
    assert r.status_code == 200, r.text
    assert r.json()["score_percent"] == 100.0

    r_ach = c.get("/api/achievements/me")
    assert r_ach.status_code == 200, r_ach.text
    completed = {a["achievement"]["code"] for a in r_ach.json()["completed"]}
    assert "test_master" in completed


# ── Ручная выдача и доступ ────────────────────────────────────────────────────

def test_manual_grant_helper_scoped_to_group(db_session, make_client):
    a = _achievement_by_code(db_session, "helper")
    group_a = _make_group(db_session, "HelperA")
    group_b = _make_group(db_session, "HelperB")
    op_own = _make_operator_in_group(db_session, group_a, full_name="СвойПомощник")
    op_other = _make_operator_in_group(db_session, group_b, full_name="ЧужойПомощник")

    supervisor, pwd = _make_role_user(db_session, role="supervisor", group_id=group_a.id)
    sup_client = _login(make_client, supervisor.username, pwd)

    r_other = sup_client.post(f"/api/achievements/{a.id}/grant", json={"operator_id": op_other.id})
    assert r_other.status_code == 403, r_other.text

    r_own = sup_client.post(f"/api/achievements/{a.id}/grant", json={"operator_id": op_own.id, "comment": "помог новичку"})
    assert r_own.status_code == 200, r_own.text
    assert r_own.json()["is_completed"] is True

    r_own_again = sup_client.post(f"/api/achievements/{a.id}/grant", json={"operator_id": op_own.id})
    assert r_own_again.status_code == 200
    assert r_own_again.json()["times_awarded"] == 2, "helper повторяемое"


def test_operator_sees_only_own_achievements(db_session, make_client):
    op, user, pwd = make_operator_user(db_session)
    op_client = _login(make_client, user.username, pwd)

    r = op_client.get("/api/achievements/me")
    assert r.status_code == 200, r.text
    assert "completed" in r.json() and "in_progress" in r.json()

    other = make_operator(db_session, full_name="Другой")
    r_other = op_client.get(f"/api/achievements/operator/{other.id}")
    assert r_other.status_code == 403, "оператор не может смотреть чужие достижения через операторский эндпоинт"
