from __future__ import annotations

from tests.conftest import make_operator

# Примечание: happy-path (оператор без истории удаляется, 200) теперь
# переносим на SQLite — audit-запись пишется через bound-параметр, а не NOW().


def test_delete_operator_without_history_succeeds(db_session, client):
    """Оператора без истории можно удалить полностью (200, happy-path)."""
    from app.models import entities as m

    op = make_operator(db_session)
    op_id = op.id

    response = client.delete(f"/api/operators/{op_id}")
    assert response.status_code == 200, response.text

    db_session.expire_all()
    assert db_session.get(m.Operator, op_id) is None


def test_delete_operator_with_history_returns_409_and_keeps_data(db_session, client):
    """Оператора с историей нельзя удалить полностью: 409 + предложение «Уволить».

    Раньше это давало 500 (необработанный FK при неполном списке чистки).
    Теперь история (начисления, миссии, результаты) сохраняется, а админ
    получает понятное сообщение. Проверяем на записи в coin_transactions —
    любой ссылающейся на оператора таблицы достаточно.
    """
    from app.models import entities as m

    op = make_operator(db_session, balance=100)
    op_id = op.id
    db_session.add(
        m.CoinTransaction(
            operator_id=op_id,
            amount=100,
            type="manual_accrual",
            category="manual_accrual",
            comment="тестовая история",
        )
    )
    db_session.commit()

    response = client.delete(f"/api/operators/{op_id}")
    assert response.status_code == 409, response.text
    assert "Уволить" in response.json()["detail"]

    db_session.expire_all()
    assert db_session.get(m.Operator, op_id) is not None
    assert (
        db_session.query(m.CoinTransaction).filter_by(operator_id=op_id).count() == 1
    )
