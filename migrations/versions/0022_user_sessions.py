"""User sessions: track login devices and allow admin revocation.

Revision ID: 0022_user_sessions
Revises: 0021_wheel_rules_engine
Create Date: 2026-07-07
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0022_user_sessions"
down_revision = "0021_wheel_rules_engine"
branch_labels = None
depends_on = None


def _table_exists(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def _index_exists(table: str, name: str) -> bool:
    if not _table_exists(table):
        return False
    return name in {ix["name"] for ix in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    if not _table_exists("user_sessions"):
        op.create_table(
            "user_sessions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("session_id", sa.String(64), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("ip_address", sa.String(64), nullable=True),
            sa.Column("user_agent", sa.Text(), nullable=True),
            sa.Column("device_label", sa.String(255), nullable=False, server_default=""),
            sa.Column("browser_label", sa.String(120), nullable=False, server_default=""),
            sa.Column("os_label", sa.String(120), nullable=False, server_default=""),
            sa.Column("status", sa.String(32), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("last_seen_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("expires_at", sa.DateTime(), nullable=True),
            sa.Column("revoked_at", sa.DateTime(), nullable=True),
            sa.Column("revoked_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("revoke_reason", sa.Text(), nullable=True),
        )

    indexes = (
        ("ix_user_sessions_session_id", ["session_id"], True),
        ("ix_user_sessions_user_id", ["user_id"], False),
        ("ix_user_sessions_ip_address", ["ip_address"], False),
        ("ix_user_sessions_status", ["status"], False),
        ("ix_user_sessions_created_at", ["created_at"], False),
        ("ix_user_sessions_last_seen_at", ["last_seen_at"], False),
        ("ix_user_sessions_expires_at", ["expires_at"], False),
    )
    for name, columns, unique in indexes:
        if not _index_exists("user_sessions", name):
            op.create_index(name, "user_sessions", columns, unique=unique)


def downgrade() -> None:
    if _table_exists("user_sessions"):
        op.drop_table("user_sessions")
