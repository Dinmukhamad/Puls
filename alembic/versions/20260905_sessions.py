"""Отзываемые пользовательские сессии."""
from alembic import op
import sqlalchemy as sa

revision = "20260905_sessions"
down_revision = "f7f90add2a25"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("audit_log", sa.Column("ip_address", sa.String(64), nullable=True))
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("refresh_hash", sa.String(64), nullable=False),
        sa.Column("device", sa.String(255), nullable=False),
        sa.Column("ip_address", sa.String(64), nullable=True),
        sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])
    op.create_index("ix_user_sessions_created_at", "user_sessions", ["created_at"])


def downgrade():
    op.drop_table("user_sessions")
    op.drop_column("audit_log", "ip_address")
