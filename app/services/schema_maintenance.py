from __future__ import annotations

import logging
from typing import Iterable

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.models.entities import AuditLog

logger = logging.getLogger(__name__)


def _column_names(inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _run_optional(conn, statements: Iterable[str]) -> None:
    for statement in statements:
        try:
            conn.execute(text(statement))
        except Exception as exc:
            logger.warning("[schema] Optional statement failed: %s; %s", statement, exc)


def ensure_operator_management_schema(engine: Engine) -> None:
    """
    Idempotent migration: adds missing columns to existing tables.
    Runs on every startup — safe to call multiple times.
    """
    with engine.begin() as conn:
        inspector = inspect(conn)
        tables = set(inspector.get_table_names())

        # ── users table ──────────────────────────────────────
        if "users" in tables:
            cols = _column_names(inspector, "users")
            if "can_manage_operators" not in cols:
                conn.execute(text(
                    "ALTER TABLE users ADD COLUMN can_manage_operators BOOLEAN NOT NULL DEFAULT false"
                ))
                logger.info("[schema] Added users.can_manage_operators")

        # ── operators table ───────────────────────────────────
        if "operators" in tables:
            cols = _column_names(inspector, "operators")

            # Map: column_name → SQL type definition
            needed = {
                "status":             "VARCHAR(32) NOT NULL DEFAULT 'active'",
                "position":           "VARCHAR(200)",
                "employee_id":        "VARCHAR(100)",
                "email":              "VARCHAR(200)",
                "start_date":         "DATE",
                "comment":            "TEXT",
                "created_by_user_id": "INTEGER",
            }
            for col, typedef in needed.items():
                if col not in cols:
                    conn.execute(text(f"ALTER TABLE operators ADD COLUMN {col} {typedef}"))
                    logger.info("[schema] Added operators.%s", col)

            # Indexes (best-effort)
            _run_optional(conn, [
                "CREATE INDEX IF NOT EXISTS ix_operators_status ON operators (status)",
            ])

        # ── audit_logs table ──────────────────────────────────
        AuditLog.__table__.create(bind=conn, checkfirst=True)
        logger.info("[schema] audit_logs table ensured")
