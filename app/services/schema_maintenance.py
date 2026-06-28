from __future__ import annotations

import logging
from typing import Iterable

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.models.entities import AuditLog

logger = logging.getLogger(__name__)


def _column_names(inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _index_names(inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def _run_optional(conn, statements: Iterable[str]) -> None:
    for statement in statements:
        try:
            conn.execute(text(statement))
        except Exception as exc:
            logger.warning("[schema] Optional schema statement failed: %s; %s", statement, exc)


def _stamp_operator_management_revision(conn) -> None:
    conn.execute(text("CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL)"))
    current_revision = conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).scalar()
    if current_revision is None:
        conn.execute(text("INSERT INTO alembic_version (version_num) VALUES ('0002_operator_management')"))
        logger.info("[schema] Stamped Alembic revision 0002_operator_management")
    elif current_revision == "0001_initial":
        conn.execute(text(
            "UPDATE alembic_version SET version_num = '0002_operator_management' WHERE version_num = '0001_initial'"
        ))
        logger.info("[schema] Advanced Alembic revision to 0002_operator_management")


def ensure_operator_management_schema(engine: Engine) -> None:
    """Bring pre-migration databases up to the operator-management schema.

    Railway deployments historically relied on Base.metadata.create_all(), which
    creates missing tables but does not add columns to existing tables. This
    idempotent guard keeps old live databases working even before Alembic has
    been stamped or run manually.
    """
    with engine.begin() as conn:
        inspector = inspect(conn)
        tables = set(inspector.get_table_names())
        dialect = conn.dialect.name
        bool_default = "false" if dialect == "postgresql" else "0"
        date_type = "DATE"
        text_type = "TEXT"

        if "users" in tables:
            columns = _column_names(inspector, "users")
            if "can_manage_operators" not in columns:
                conn.execute(text(
                    f"ALTER TABLE users ADD COLUMN can_manage_operators BOOLEAN NOT NULL DEFAULT {bool_default}"
                ))
                logger.info("[schema] Added users.can_manage_operators")

        if "operators" in tables:
            columns = _column_names(inspector, "operators")
            additions = {
                "status": "VARCHAR(32) NOT NULL DEFAULT 'active'",
                "position": "VARCHAR(120)",
                "employee_id": "VARCHAR(120)",
                "email": "VARCHAR(255)",
                "participation_started_at": date_type,
                "admin_comment": text_type,
                "created_by_user_id": "INTEGER",
            }
            for column_name, column_type in additions.items():
                if column_name not in columns:
                    conn.execute(text(f"ALTER TABLE operators ADD COLUMN {column_name} {column_type}"))
                    logger.info("[schema] Added operators.%s", column_name)

            indexes = _index_names(inspector, "operators")
            optional_statements = []
            if "ix_operators_status" not in indexes:
                optional_statements.append("CREATE INDEX IF NOT EXISTS ix_operators_status ON operators (status)")
            if "uq_operators_employee_id" not in indexes:
                optional_statements.append(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_operators_employee_id ON operators (employee_id)"
                )
            if "uq_operators_email" not in indexes:
                optional_statements.append("CREATE UNIQUE INDEX IF NOT EXISTS uq_operators_email ON operators (email)")
            _run_optional(conn, optional_statements)

        AuditLog.__table__.create(bind=conn, checkfirst=True)
        _stamp_operator_management_revision(conn)
