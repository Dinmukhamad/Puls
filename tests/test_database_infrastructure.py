from __future__ import annotations

from app.database.db import normalize_database_url


def test_database_url_normalizes_provider_postgres_scheme():
    assert normalize_database_url("postgres://user:pass@db/puls") == (
        "postgresql+psycopg2://user:pass@db/puls"
    )


def test_database_url_adds_default_driver_to_postgresql():
    assert normalize_database_url("postgresql://user:pass@db/puls") == (
        "postgresql+psycopg2://user:pass@db/puls"
    )


def test_database_url_preserves_explicit_driver_and_sqlite():
    assert normalize_database_url("postgresql+psycopg://user:pass@db/puls") == (
        "postgresql+psycopg://user:pass@db/puls"
    )
    assert normalize_database_url("sqlite:///puls.db") == "sqlite:///puls.db"
