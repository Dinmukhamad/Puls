"""
P1.3: SPA fallback — фронтенд-маршруты получают index.html,
опечатки в /api/... получают честный JSON 404, а не HTML с кодом 200.
"""
from __future__ import annotations


def test_unknown_page_serves_index_html(client):
    r = client.get("/unknown-page")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    assert 'js/app.js' in r.text  # это действительно index.html


def test_deep_frontend_route_serves_index_html(client):
    r = client.get("/coins")  # navigateTo пишет /coins?tab=... как path
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")


def test_unknown_api_endpoint_returns_json_404(client):
    r = client.get("/api/rating/nominationz")  # опечатка из ТЗ
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")
    assert r.json() == {"detail": "API endpoint not found"}


def test_bare_api_root_returns_json_404(client):
    r = client.get("/api")
    assert r.status_code == 404
    assert r.json()["detail"] == "API endpoint not found"


def test_existing_api_routes_untouched(client):
    assert client.get("/api/auth/me").status_code == 200
    assert client.get("/health").status_code == 200
