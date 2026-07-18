"""
check_production_safety: приложение не должно стартовать в production
с дефолтными/примерными секретами и опасными настройками.

Плейсхолдер JWT из .env.example длиннее 32 символов, поэтому проверка длины
его не ловит — он должен явно отклоняться по блоклисту.
"""
from __future__ import annotations

import pytest

from app.core.config import Settings


def _prod_settings(**overrides) -> Settings:
    """Безопасная production-конфигурация; поля переопределяются в тестах.

    Все поля, которые смотрит check_production_safety, задаём явно через
    init-kwargs — они имеют приоритет над env-переменными conftest.
    """
    base = dict(
        app_env="production",
        database_url="postgresql://user:pass@db.example.com:5432/puls",
        jwt_secret_key="k" * 40,
        cors_origins="https://puls.example.com",
        auth_cookie_secure=True,
        auto_create_tables=False,
        enable_demo_data=False,
    )
    base.update(overrides)
    return Settings(**base)


def test_safe_production_config_passes():
    _prod_settings().check_production_safety()  # не должно бросать


def test_env_example_jwt_placeholder_rejected():
    settings = _prod_settings(
        jwt_secret_key="dev-secret-key-change-in-production-at-least-32-chars"
    )
    with pytest.raises(RuntimeError, match="JWT_SECRET_KEY"):
        settings.check_production_safety()


def test_short_jwt_secret_rejected():
    with pytest.raises(RuntimeError, match="JWT_SECRET_KEY"):
        _prod_settings(jwt_secret_key="short").check_production_safety()


def test_sqlite_rejected_in_production():
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        _prod_settings(database_url="sqlite:///./pulse.db").check_production_safety()
