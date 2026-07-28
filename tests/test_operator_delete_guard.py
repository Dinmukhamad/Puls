from __future__ import annotations

from tests.conftest import make_operator

# Примечание: happy-path (оператор без истории удаляется, 200) не тестируется
# на SQLite, потому что сам эндпоинт пишет audit-запись через Postgres-only NOW().
# Этот путь проверяется на реальном PostgreSQL в рамках ручной верификации.


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
