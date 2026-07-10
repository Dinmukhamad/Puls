"""
Wheel of WOW — автотесты движка правил (ТЗ 8.3, 8.4, 8.7, 9, 10, 11).

Покрываем:
  * выдача токена за успешно пройденный тест (test_score >= порога);
  * запись в журнал проверок при выдаче и при отказе;
  * дедуп по уникальному индексу источника (ТЗ п.9) — повторная проверка той
    же попытки не создаёт второй токен;
  * лимит max_tokens_per_period (второй разный тест в тот же день не даёт токен);
  * правило по качеству из PeriodReport (ТЗ 11.2);
  * тумблер wheel_enabled=false блокирует выдачу.
"""
from __future__ import annotations

from datetime import date, timedelta

from tests.conftest import make_operator


def _make_finished_attempt(db, op, *, score: float, passing: float = 70.0):
    from app.core.datetime_utils import now_utc
    from app.models import entities as m
    test = m.Test(title="Тест дня", status="published", passing_percent=passing,
                  reward_min_percent=passing)
    db.add(test)
    db.flush()
    attempt = m.TestAttempt(
        test_id=test.id, operator_id=op.id, status="finished",
        expires_at=now_utc() + timedelta(hours=1),
        score_percent=score, questions_count=10, correct_count=int(score / 10),
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return test, attempt


def _active_tokens(db, op_id):
    from app.models.entities import WheelTicket
    return db.query(WheelTicket).filter_by(operator_id=op_id).all()


def test_token_issued_for_passed_test(client, db_session):
    from app.services.wheel_eligibility import evaluate_after_test_attempt
    from app.services.wheel_seed import ensure_default_wheel

    ensure_default_wheel(db_session)
    db_session.commit()
    op = make_operator(db_session)
    _, attempt = _make_finished_attempt(db_session, op, score=92)

    issued = evaluate_after_test_attempt(db_session, attempt.id)
    db_session.commit()

    assert len(issued) == 1, "за тест дня на 92% должен быть выдан 1 токен"
    tok = issued[0]
    assert tok.source_module == "tests"
    assert tok.source_entity_id == attempt.id
    assert tok.rule_id is not None
    assert tok.status == "available"


def test_evaluation_log_written_on_success_and_failure(client, db_session):
    from app.models.entities import WheelRuleEvaluationLog
    from app.services.wheel_eligibility import evaluate_after_test_attempt
    from app.services.wheel_seed import ensure_default_wheel

    ensure_default_wheel(db_session)
    db_session.commit()

    # успех
    op1 = make_operator(db_session)
    _, a1 = _make_finished_attempt(db_session, op1, score=90)
    evaluate_after_test_attempt(db_session, a1.id)
    db_session.commit()
    logs1 = db_session.query(WheelRuleEvaluationLog).filter_by(operator_id=op1.id).all()
    assert any(log.is_eligible for log in logs1), "должен быть лог с is_eligible=true"

    # провал (ниже порога)
    op2 = make_operator(db_session)
    _, a2 = _make_finished_attempt(db_session, op2, score=50)
    evaluate_after_test_attempt(db_session, a2.id)
    db_session.commit()
    logs2 = db_session.query(WheelRuleEvaluationLog).filter_by(operator_id=op2.id).all()
    assert logs2, "лог проверки должен писаться даже при отказе"
    assert all(not log.is_eligible for log in logs2 if log.source_module == "tests" and log.metric_value == 50)


def test_no_duplicate_token_for_same_attempt(client, db_session):
    """ТЗ п.9: повторная проверка той же попытки не создаёт второй токен."""
    from app.models.entities import WheelEligibilityRule
    from app.services.wheel_eligibility import evaluate_after_test_attempt
    from app.services.wheel_seed import ensure_default_wheel

    campaign = ensure_default_wheel(db_session)
    # поднимаем лимит за период, чтобы изолировать именно уникальный индекс
    rule = db_session.query(WheelEligibilityRule).filter_by(
        campaign_id=campaign.id, code="test_score_80").one()
    rule.max_tokens_per_period = 10
    db_session.commit()

    op = make_operator(db_session)
    _, attempt = _make_finished_attempt(db_session, op, score=88)

    first = evaluate_after_test_attempt(db_session, attempt.id)
    db_session.commit()
    second = evaluate_after_test_attempt(db_session, attempt.id)
    db_session.commit()

    assert len(first) == 1
    assert len(second) == 0, "дубль за ту же попытку должен быть отсечён уникальным индексом"
    assert len(_active_tokens(db_session, op.id)) == 1


def test_period_cap_blocks_second_token_same_day(client, db_session):
    """max_tokens_per_period=1 (daily): второй разный тест в тот же день — без токена."""
    from app.models.entities import WheelEligibilityRule
    from app.services.wheel_eligibility import evaluate_after_test_attempt
    from app.services.wheel_seed import ensure_default_wheel

    campaign = ensure_default_wheel(db_session)
    # Тесты в файле делят одну БД — фиксируем нужный лимит явно (другой тест мог
    # его поменять), чтобы кейс был детерминированным.
    rule = db_session.query(WheelEligibilityRule).filter_by(
        campaign_id=campaign.id, code="test_score_80").one()
    rule.max_tokens_per_period = 1
    rule.period_type = "daily"
    db_session.commit()
    op = make_operator(db_session)

    _, a1 = _make_finished_attempt(db_session, op, score=95)
    _, a2 = _make_finished_attempt(db_session, op, score=91)

    first = evaluate_after_test_attempt(db_session, a1.id)
    db_session.commit()
    second = evaluate_after_test_attempt(db_session, a2.id)
    db_session.commit()

    assert len(first) == 1
    assert len(second) == 0, "дневной лимит правила должен блокировать второй токен"


def test_quality_rule_from_period_report(client, db_session):
    """ТЗ 11.2: качество 90+ из PeriodReport выдаёт токен."""
    from app.models import entities as m
    from app.services.wheel_eligibility import evaluate_after_period_report
    from app.services.wheel_seed import ensure_default_wheel

    ensure_default_wheel(db_session)
    db_session.commit()
    op = make_operator(db_session)
    report = m.PeriodReport(
        operator_id=op.id, period_start=date.today() - timedelta(days=7),
        period_end=date.today(), quality_avg=95, penalty_minutes=0,
    )
    db_session.add(report)
    db_session.commit()

    issued = evaluate_after_period_report(db_session, report.id)
    db_session.commit()

    # quality_90 (95>=90) и no_late_day (penalty_minutes==0) — оба выполнены
    codes = {t.reason_type for t in issued}
    assert len(issued) >= 1
    assert "quality_score" in codes


def test_wheel_disabled_blocks_issue(client, db_session):
    from app.models.entities import WheelSetting
    from app.services.wheel_eligibility import evaluate_after_test_attempt
    from app.services.wheel_seed import ensure_default_wheel

    ensure_default_wheel(db_session)
    setting = db_session.query(WheelSetting).filter_by(key="wheel_enabled").one()
    setting.value = "false"
    db_session.commit()

    op = make_operator(db_session)
    _, attempt = _make_finished_attempt(db_session, op, score=99)
    issued = evaluate_after_test_attempt(db_session, attempt.id)
    db_session.commit()

    assert issued == [], "при wheel_enabled=false токены не выдаются"
