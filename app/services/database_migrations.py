from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.database.db import engine

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_POSTGRES_MIGRATION_LOCK = 7_013_385_609


def _alembic_config() -> Config:
    config = Config(str(_PROJECT_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(_PROJECT_ROOT / "migrations"))
    return config


def upgrade_database_schema() -> None:
    """Apply pending migrations even when the host bypasses ``start.sh``.

    The Docker/Procfile path already migrates before Uvicorn starts. Some hosts
    allow a custom start command, though, so the application repeats the same
    idempotent check during lifespan startup. PostgreSQL advisory locking keeps
    simultaneous instances from running DDL concurrently.
    """
    if engine.dialect.name == "sqlite":
        return

    config = _alembic_config()
    if engine.dialect.name != "postgresql":
        command.upgrade(config, "head")
        return

    with engine.connect() as lock_connection:
        lock_connection.execute(
            text("SELECT pg_advisory_lock(:lock_key)"),
            {"lock_key": _POSTGRES_MIGRATION_LOCK},
        )
        try:
            command.upgrade(config, "head")
        finally:
            lock_connection.execute(
                text("SELECT pg_advisory_unlock(:lock_key)"),
                {"lock_key": _POSTGRES_MIGRATION_LOCK},
            )
    logger.info("[startup] Database schema is at Alembic head")
