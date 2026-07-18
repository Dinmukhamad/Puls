from __future__ import annotations


def test_ready_does_not_expose_database_error(client, monkeypatch):
    from app import main

    secret_error = "postgresql://db.internal:5432/puls password=secret"

    def fail_to_connect():
        raise RuntimeError(secret_error)

    monkeypatch.setattr(main.engine, "connect", fail_to_connect)

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "not ready"}
    assert secret_error not in response.text
