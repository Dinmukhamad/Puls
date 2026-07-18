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


def test_ready_rejects_outdated_schema_without_exposing_details(client, monkeypatch):
    from app import main

    secret_error = "missing private_table.secret_column"

    def fail_schema_check(_connection):
        raise RuntimeError(secret_error)

    monkeypatch.setattr(main, "assert_database_schema_current", fail_schema_check)

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "not ready"}
    assert secret_error not in response.text
