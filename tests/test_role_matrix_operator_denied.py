"""Матрица ролей: рядовой оператор не должен доставать административные API.

Скрытая на фронтенде кнопка защитой не является — запрет обязан выдавать
backend. Тест проходит по административным эндпоинтам широким фронтом и
проверяет, что оператору возвращается отказ (401/403/404), а не данные.

404 засчитывается как отказ там, где сам факт существования ресурса не
раскрывается; главное — оператор не получает 200 с чужими данными.
"""
from __future__ import annotations

import pytest

from tests.conftest import make_operator, make_operator_user

DENIED = {401, 403, 404}

# (метод, путь, тело) — административные операции, недоступные оператору.
ADMIN_ENDPOINTS = [
    ("GET", "/api/dashboard", None),
    ("GET", "/api/dashboard/operators", None),
    ("GET", "/api/dashboard/history", None),
    ("GET", "/api/dashboard/admin-summary", None),
    ("GET", "/api/analytics/summary?start_date=2026-06-01&end_date=2026-06-30", None),
    ("GET", "/api/analytics/dashboard?start_date=2026-06-01&end_date=2026-06-30", None),
    ("GET", "/api/analytics/operators?start_date=2026-06-01&end_date=2026-06-30", None),
    ("GET", "/api/analytics/glossary", None),
    ("GET", "/api/analytics/export.xlsx?start_date=2026-06-01&end_date=2026-06-30", None),
    ("GET", "/api/auth/users", None),
    ("GET", "/api/users", None),
    ("GET", "/api/work-norms", None),
    ("GET", "/api/settings/coin-rules", None),
    ("GET", "/api/admin/economy/rules", None),
    ("GET", "/api/sessions/admin/sessions", None),
    # Розыгрыши: оператору открыт сам раздел (он в них участвует), поэтому
    # особенно важно, что администрирование ему по-прежнему запрещено.
    ("GET", "/api/admin/raffles", None),
    ("POST", "/api/admin/raffles", {"title": "x", "prize": "y", "tickets_cost": 1}),
    ("POST", "/api/admin/raffles/1/draw", None),
    ("POST", "/api/admin/raffles/1/cancel", None),
    ("POST", "/api/reports/period-report/save",
     {"start_date": "2026-06-01", "end_date": "2026-06-30", "award_coins": False,
      "coins_per_points": 5}),
    ("GET", "/api/reports/period-report/status", None),
]


@pytest.mark.parametrize("method,path,body", ADMIN_ENDPOINTS,
                         ids=[f"{m} {p.split('?')[0]}" for m, p, _ in ADMIN_ENDPOINTS])
def test_operator_denied_on_admin_endpoints(operator_client, method, path, body):
    response = operator_client.request(method, path, json=body)
    assert response.status_code in DENIED, (
        f"{method} {path} вернул {response.status_code} рядовому оператору"
    )


def test_operator_cannot_read_another_operator_card(operator_client, db_session):
    other = make_operator(db_session, full_name="Чужой Для Карточки")
    response = operator_client.get(f"/api/operators/{other.id}")
    assert response.status_code in DENIED, response.text


def test_operator_cannot_edit_another_operator(operator_client, db_session):
    other = make_operator(db_session, full_name="Чужой Для Правки")
    response = operator_client.patch(
        f"/api/operators/{other.id}", json={"full_name": "Взломано"}
    )
    assert response.status_code in DENIED, response.text
    db_session.refresh(other)
    assert other.full_name != "Взломано"


def test_operator_cannot_reset_another_operators_password(operator_client, db_session):
    other = make_operator(db_session, full_name="Чужой Для Пароля")
    response = operator_client.post(f"/api/operators/{other.id}/reset-password", json={})
    assert response.status_code in DENIED, response.text


def test_operator_cannot_read_another_operators_history(operator_client, db_session):
    other = make_operator(db_session, full_name="Чужой Для Истории")
    response = operator_client.get(f"/api/operators/{other.id}/history")
    assert response.status_code in DENIED, response.text


def test_operator_cannot_change_roles(operator_client, client):
    """Повышение собственной роли — самый опасный сценарий."""
    me = operator_client.get("/api/auth/me").json()
    response = operator_client.post(
        f"/api/users/{me['id']}/change-role", json={"role": "admin", "reason": "test"}
    )
    assert response.status_code in DENIED, response.text
    after = operator_client.get("/api/auth/me")
    # Роль не изменилась (или сессия отклонена) — но админом оператор не стал.
    if after.status_code == 200:
        assert after.json()["role"] == "operator"


def test_operator_cannot_credit_coins_to_self(operator_client, db_session):
    """Начисление коинов себе — денежная операция, только для штата."""
    me = operator_client.get("/api/auth/me").json()
    operator_id = me.get("operator_id")
    response = operator_client.post(
        "/api/wallet/transactions",
        json={"operator_id": operator_id, "amount": 10000, "comment": "self credit"},
    )
    assert response.status_code in DENIED, response.text
