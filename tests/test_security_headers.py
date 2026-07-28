from __future__ import annotations


def test_content_security_policy_supports_existing_ui_handlers(client):
    response = client.get("/")

    assert response.status_code == 200
    policy = response.headers["Content-Security-Policy"]
    assert "script-src 'self' 'unsafe-inline'" in policy
    assert "connect-src 'self'" in policy
    assert "frame-ancestors 'none'" in policy
