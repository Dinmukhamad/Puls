from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.models.entities import AuditLog, Group

logger = logging.getLogger(__name__)


def ensure_operator_management_schema(engine: Engine) -> None:
    """Add missing columns to existing tables. Safe to run multiple times."""
    with engine.begin() as conn:
        inspector = inspect(conn)
        tables = set(inspector.get_table_names())

        if "operators" in tables:
            existing = {col["name"] for col in inspector.get_columns("operators")}
            migrations = [
                ("group_id",           "INTEGER"),
                ("participation_status", "VARCHAR(32) NOT NULL DEFAULT 'participating'"),
                ("employment_status",  "VARCHAR(32) NOT NULL DEFAULT 'active'"),
                ("dismissed_at",       "TIMESTAMP"),
                ("status",             "VARCHAR(32) NOT NULL DEFAULT 'active'"),
                ("position",           "VARCHAR(200)"),
                ("employee_id",        "VARCHAR(100)"),
                ("email",              "VARCHAR(200)"),
                ("start_date",         "DATE"),
                ("comment",            "TEXT"),
                ("created_by_user_id", "INTEGER"),
                ("updated_at",         "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
            ]
            for col_name, col_type in migrations:
                if col_name not in existing:
                    conn.execute(text(
                        f"ALTER TABLE operators ADD COLUMN {col_name} {col_type}"
                    ))
                    logger.info("[schema] Added operators.%s", col_name)

        if "users" in tables:
            existing = {col["name"] for col in inspector.get_columns("users")}
            if "can_manage_operators" not in existing:
                conn.execute(text(
                    "ALTER TABLE users ADD COLUMN can_manage_operators "
                    "BOOLEAN NOT NULL DEFAULT false"
                ))
                logger.info("[schema] Added users.can_manage_operators")
            if "must_change_password" not in existing:
                conn.execute(text(
                    "ALTER TABLE users ADD COLUMN must_change_password "
                    "BOOLEAN NOT NULL DEFAULT false"
                ))
                logger.info("[schema] Added users.must_change_password")

        # Ensure audit_logs table exists
        Group.__table__.create(bind=conn, checkfirst=True)
        AuditLog.__table__.create(bind=conn, checkfirst=True)
        logger.info("[schema] groups table ensured")
        logger.info("[schema] audit_logs table ensured")
