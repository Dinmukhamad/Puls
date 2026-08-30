"""RBAC для расчёта нормы часов конкретного оператора.

GET /api/work-norms/operators/{id}/work-norm отдаёт ставку, индивидуальную
норму, фактически отработанные часы и процент её выполнения. Это персональные
данные сотрудника, поэтому эндпоинт не должен отвечать любому авторизованному
пользователю: оператор мог перебором operator_id прочитать показатели коллег.
"""
from __future__ import annotations

from tests.conftest import make_operator, make_operator_user

PERIOD = {"start_date": "2026-06-01", "end_date": "2026-06-30"}


def _url(operator_id: int) -> str:
    return f"/api/work-norms/operators/{operator_id}/work-norm"


def test_operator_cannot_read_another_operators_norm(client, make_client, db_session):
    _op_self, user, password = make_operator_user(db_session)
    other = make_operator(db_session, full_name="Чужой Оператор")

    operator_client = make_client()
    login = operator_client.post(
        "/api/auth/login", json={"username": user.username, "password": password}
    )
    assert login.status_code == 200, login.text

    response = operator_client.get(_url(other.id), params=PERIOD)
    assert response.status_code == 403, (
        f"оператор получил доступ к норме чужого оператора: {response.status_code}"
    )


def test_operator_can_read_own_norm(client, make_client, db_session):
    op_self, user, password = make_operator_user(db_session)

    operator_client = make_client()
    login = operator_client.post(
        "/api/auth/login", json={"username": user.username, "password": password}
    )
    assert login.status_code == 200, login.text

    response = operator_client.get(_url(op_self.id), params=PERIOD)
    assert response.status_code == 200, response.text
    assert response.json()["operator_id"] == op_self.id


def test_admin_can_read_any_operator_norm(client, db_session):
    other = make_operator(db_session, full_name="Оператор Для Админа")
    response = client.get(_url(other.id), params=PERIOD)
    assert response.status_code == 200, response.text


def test_unknown_operator_still_404_for_staff(client):
    response = client.get(_url(99999999), params=PERIOD)
    assert response.status_code == 404
