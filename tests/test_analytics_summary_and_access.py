from __future__ import annotations

from tests.test_coin_rules_and_group_scope import _login, _make_role_user


def test_summary_returns_coverage_and_empty_reason(client):
    """ТЗ: summary отдаёт покрытие данных и empty_reason (не молчит и не даёт 0)."""
    r = client.get("/api/analytics/summary", params={"start_date": "2026-07-01", "end_date": "2026-07-07"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "coverage" in body
    assert set(body["coverage"]) >= {"operators_total", "operators_with_data", "data_coverage_percent"}
    assert "empty_reason" in body  # None или причина, но ключ всегда есть


def test_summary_rejects_inverted_date_range(client):
    """ТЗ: некорректный диапазон дат отклоняется понятной ошибкой, без traceback."""
    r = client.get("/api/analytics/summary", params={"start_date": "2026-07-31", "end_date": "2026-07-01"})
    assert r.status_code == 400
    assert "позже" in r.json()["detail"]


def test_daily_dynamics_rejects_inverted_range(client):
    r = client.get(
        "/api/analytics/daily-dynamics",
        params={"start_date": "2026-07-31", "end_date": "2026-07-01", "metric": "quality"},
    )
    assert r.status_code == 400


def test_operator_is_denied_analytics_on_backend(db_session, make_client):
    """ТЗ: оператор не получает аналитику даже при прямом обращении к API
    (проверка на backend, не только скрытие пункта меню)."""
    _user, pwd = _make_role_user(db_session, role="operator")
    op_client = _login(make_client, _user.username, pwd)
    for ep, params in [
        ("/api/analytics/summary", {"start_date": "2026-07-01", "end_date": "2026-07-07"}),
        ("/api/analytics/daily-dynamics", {"start_date": "2026-07-01", "end_date": "2026-07-07", "metric": "calls"}),
        ("/api/analytics/operators", {"start_date": "2026-07-01", "end_date": "2026-07-07"}),
    ]:
        r = op_client.get(ep, params=params)
        assert r.status_code == 403, f"{ep} -> {r.status_code} (ожидали 403)"
