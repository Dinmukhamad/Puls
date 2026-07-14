"""
P0.2: завершение теста — успешный сценарий и безопасный 500 без traceback.

Критерии из ТЗ:
  * при ошибке клиент НЕ получает traceback/пути сервера/имя исключения;
  * в логах сервера traceback сохраняется (logger.exception);
  * пользователь видит нормальное сообщение;
  * успешное завершение по-прежнему работает и считает баллы.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from tests.conftest import make_operator_user

GENERIC_MSG = "Не удалось завершить тест. Попробуйте позже или обратитесь к администратору."


def _make_attempt(db, operator, attempt_number: int = 1, **test_overrides):
    """Тест с одним вопросом + попытка in_progress напрямую в БД."""
    from app.core.datetime_utils import now_utc
    from app.models import entities as m

    test_data = {"title": "Тест по регламенту", "status": "open", "time_limit_minutes": 30}
    test_data.update(test_overrides)
    test = m.Test(**test_data)
    db.add(test)
    db.flush()

    question = m.TestQuestion(
        test_id=test.id, question_text="2 + 2 = ?", question_type="single_choice", points=1.0
    )
    db.add(question)
    db.flush()

    correct = m.TestAnswerOption(question_id=question.id, answer_text="4", is_correct=True)
    wrong = m.TestAnswerOption(question_id=question.id, answer_text="5", is_correct=False)
    db.add_all([correct, wrong])
    db.flush()

    attempt = m.TestAttempt(
        test_id=test.id,
        operator_id=operator.id,
        status="in_progress",
        expires_at=now_utc() + timedelta(minutes=30),
        max_points=1.0,
        questions_count=1,
        attempt_number=attempt_number,
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return test, question, correct, attempt


def _login_operator(make_client, user, password):
    c = make_client()
    r = c.post("/api/auth/login", json={"username": user.username, "password": password})
    assert r.status_code == 200, r.text
    return c


def test_finish_happy_path(make_client, db_session):
    op, user, password = make_operator_user(db_session)
    _test, question, correct, attempt = _make_attempt(db_session, op)
    c = _login_operator(make_client, user, password)

    r = c.post(
        f"/api/tests/attempts/{attempt.id}/save-answer",
        json={"question_id": question.id, "selected_answer_ids": [correct.id]},
    )
    assert r.status_code == 200, r.text

    r = c.post(f"/api/tests/attempts/{attempt.id}/finish")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "finished"
    assert data["correct_count"] == 1
    assert data["score_percent"] == 100.0


def test_finish_awards_coins_once(make_client, db_session):
    from app.models import entities as m

    op, user, password = make_operator_user(db_session)
    initial_balance = op.current_balance
    _test, question, correct, attempt = _make_attempt(
        db_session,
        op,
        reward_type="coins",
        reward_coins=10,
        reward_min_percent=70,
        reward_mode="fixed",
    )
    c = _login_operator(make_client, user, password)

    saved = c.post(
        f"/api/tests/attempts/{attempt.id}/save-answer",
        json={"question_id": question.id, "selected_answer_ids": [correct.id]},
    )
    assert saved.status_code == 200, saved.text

    first = c.post(f"/api/tests/attempts/{attempt.id}/finish")
    assert first.status_code == 200, first.text
    assert first.json()["reward_coins"] == 10

    db_session.expire_all()
    fresh_operator = db_session.get(m.Operator, op.id)
    fresh_attempt = db_session.get(m.TestAttempt, attempt.id)
    assert fresh_attempt.reward_transaction_id is not None
    transactions = db_session.query(m.CoinTransaction).filter_by(operator_id=op.id).all()
    assert fresh_operator.current_balance == initial_balance + sum(item.amount for item in transactions)
    transaction = db_session.query(m.CoinTransaction).filter_by(
        operator_id=op.id, type="test_reward"
    ).one()
    assert transaction.amount == 10
    assert transaction.source_type == "test_attempt"
    assert transaction.source_id == attempt.id
    balance_after_first_finish = fresh_operator.current_balance

    second = c.post(f"/api/tests/attempts/{attempt.id}/finish")
    assert second.status_code == 200, second.text
    assert second.json()["reward_coins"] == 10

    db_session.expire_all()
    assert db_session.get(m.Operator, op.id).current_balance == balance_after_first_finish
    assert db_session.query(m.CoinTransaction).filter_by(
        operator_id=op.id, type="test_reward"
    ).count() == 1


def test_admin_detail_returns_builder_configuration(client, db_session):
    from app.models import entities as m

    test = m.Test(
        title="Детальный тест",
        description="Описание",
        instruction="Инструкция",
        status="draft",
        reward_type="coins",
        reward_coins=12,
    )
    db_session.add(test)
    db_session.flush()
    question = m.TestQuestion(
        test_id=test.id,
        question_text="Выберите верный ответ",
        question_type="single_choice",
        points=2,
    )
    db_session.add(question)
    db_session.flush()
    db_session.add_all([
        m.TestAnswerOption(question_id=question.id, answer_text="Верно", is_correct=True),
        m.TestAnswerOption(question_id=question.id, answer_text="Неверно", is_correct=False),
        m.TestAssignment(test_id=test.id, target_type="all", target_id=None),
    ])
    db_session.commit()

    response = client.get(f"/api/admin/tests/{test.id}")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["description"] == "Описание"
    assert data["instruction"] == "Инструкция"
    assert data["reward_type"] == "coins"
    assert data["reward_coins"] == 12
    assert any(answer["is_correct"] for answer in data["questions"][0]["answers"])
    assert data["assignments"] == [{"target_type": "all", "target_id": None}]


def test_finish_error_does_not_leak_traceback(make_client, db_session, monkeypatch, caplog):
    op, user, password = make_operator_user(db_session)
    _test, _question, _correct, attempt = _make_attempt(db_session, op)
    c = _login_operator(make_client, user, password)

    import app.modules.tests.router as tests_router

    def boom(db, attempt, reviewer=None):
        raise RuntimeError("boom at /app/app/routers/tests.py line 999")

    monkeypatch.setattr(tests_router, "finish_attempt", boom)

    with caplog.at_level(logging.ERROR):
        r = c.post(f"/api/tests/attempts/{attempt.id}/finish")

    assert r.status_code == 500
    assert r.json()["detail"] == GENERIC_MSG

    # Никаких внутренностей в ответе
    body = r.text
    for leak in ("Traceback", ".py", "RuntimeError", "boom", "line 999", "/app/"):
        assert leak not in body, f"в ответе утекло: {leak!r}"

    # А в логах сервера — полный traceback с контекстом
    assert "Не удалось завершить попытку теста" in caplog.text
    assert "RuntimeError" in caplog.text
    assert "boom at /app/app/routers/tests.py" in caplog.text

    # Транзакция откатилась — попытка не «зависла» в finished
    db_session.expire_all()
    from app.models import entities as m
    fresh = db_session.get(m.TestAttempt, attempt.id)
    assert fresh.status == "in_progress"
