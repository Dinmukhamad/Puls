"""Независимый опыт, уровни XP и уведомления."""

from alembic import op
import sqlalchemy as sa

revision = "20260905_progress"
down_revision = "20260905_sessions"
branch_labels = None
depends_on = None


def timestamps():
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade():
    op.create_table(
        "xp_accounts",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.CheckConstraint("total >= 0", name="ck_xp_accounts_xp_non_negative"),
    )
    op.create_table(
        "xp_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("total_after", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("source", sa.String(64), nullable=False),
        sa.Column("idempotency_key", sa.String(180), nullable=False, unique=True),
        sa.Column("author_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        *timestamps(),
        sa.CheckConstraint("amount > 0", name="ck_xp_entries_xp_positive"),
    )
    op.create_index("ix_xp_entries_user_id", "xp_entries", ["user_id"])
    op.create_index("ix_xp_entries_created_at", "xp_entries", ["created_at"])
    op.create_table(
        "xp_levels",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("min_xp", sa.Integer(), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        *timestamps(),
        sa.CheckConstraint("min_xp >= 0", name="ck_xp_levels_xp_threshold_non_negative"),
    )
    op.create_index("ix_xp_levels_created_at", "xp_levels", ["created_at"])
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("link", sa.String(255), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_created_at", "notifications", ["created_at"])
    from app.db.progress_guards import progress_guard_statements

    for statement in progress_guard_statements(op.get_bind().dialect.name):
        op.execute(sa.text(statement))


def downgrade():
    op.drop_table("notifications")
    op.drop_table("xp_levels")
    op.drop_table("xp_entries")
    op.drop_table("xp_accounts")
