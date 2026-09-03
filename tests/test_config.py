"""
Разбор переменных окружения.

Значения приходят от хостинга строками, и ошибка здесь роняет приложение на
старте — до того, как хоть один тест API успеет выполниться.
"""
from __future__ import annotations

import pytest

from app.core.config import Settings


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("*", ["*"]),
        ("https://app.example.com", ["https://app.example.com"]),
        ("https://a.com,https://b.com", ["https://a.com", "https://b.com"]),
        ("  https://a.com ,  https://b.com  ", ["https://a.com", "https://b.com"]),
        ('["https://a.com","https://b.com"]', ["https://a.com", "https://b.com"]),
    ],
)
def test_cors_origins_parsed_from_environment(
    monkeypatch: pytest.MonkeyPatch, raw: str, expected: list[str]
) -> None:
    """Список источников задаётся строкой через запятую, звёздочкой или JSON."""
    monkeypatch.setenv("CORS_ORIGINS", raw)
    parsed = Settings(_env_file=None).CORS_ORIGINS
    assert parsed == expected


def test_cors_origins_default_allows_everything(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    assert Settings(_env_file=None).CORS_ORIGINS == ["*"]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # Render и Heroku отдают URL без драйвера.
        ("postgres://u:p@host/db", "postgresql+asyncpg://u:p@host/db"),
        ("postgresql://u:p@host:5432/db", "postgresql+asyncpg://u:p@host:5432/db"),
        # sslmode понимает psycopg, но не asyncpg.
        (
            "postgresql://u:p@host/db?sslmode=require",
            "postgresql+asyncpg://u:p@host/db?ssl=require",
        ),
        # Уже готовые строки не трогаем.
        ("postgresql+asyncpg://u:p@host/db", "postgresql+asyncpg://u:p@host/db"),
        ("sqlite+aiosqlite:///./local.db", "sqlite+aiosqlite:///./local.db"),
    ],
)
def test_database_url_normalized_for_async_driver(
    monkeypatch: pytest.MonkeyPatch, raw: str, expected: str
) -> None:
    monkeypatch.setenv("DATABASE_URL", raw)
    normalized = Settings(_env_file=None).DATABASE_URL
    assert normalized == expected


def test_is_sqlite_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@host/db")
    assert Settings(_env_file=None).is_sqlite is False
