"""Учебный вход в Driver Simulator и настраиваемые варианты сотрудничества."""

import sqlalchemy as sa

from alembic import op

revision = "20260907_driver"
down_revision = "20260906_access"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "driver_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("parks", sa.JSON(), nullable=False),
        sa.CheckConstraint("id = 1", name=op.f("ck_driver_settings_singleton")),
    )
    op.create_table(
        "driver_profiles",
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("stage", sa.String(20), nullable=False),
        sa.Column("service", sa.String(20), nullable=True),
        sa.Column("park", sa.JSON(), nullable=True),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "stage IN ('services', 'cooperation', 'loading', 'offline')",
            name=op.f("ck_driver_profiles_stage"),
        ),
    )
    op.create_index("ix_driver_profiles_created_at", "driver_profiles", ["created_at"])


def downgrade():
    op.drop_table("driver_profiles")
    op.drop_table("driver_settings")
