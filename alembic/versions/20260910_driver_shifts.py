"""Единая смена, конфигурация сценария и учебная поддержка Telegram."""

import sqlalchemy as sa

from alembic import op

revision = "20260910_driver_shifts"
down_revision = "20260909_driver_orders"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("driver_settings") as batch:
        batch.add_column(sa.Column("scenario", sa.JSON(), nullable=True))
    op.create_table(
        "driver_shifts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("active_slot", sa.Integer(), nullable=True),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("events", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "active_slot"),
        sa.CheckConstraint("mode IN ('free','assessment')", name="mode"),
        sa.CheckConstraint("active_slot IS NULL OR active_slot = 1", name="active_slot"),
    )
    op.create_index("ix_driver_shifts_user_id", "driver_shifts", ["user_id"])
    with op.batch_alter_table("driver_orders") as batch:
        batch.add_column(sa.Column("shift_id", sa.String(36), nullable=True))
        batch.add_column(sa.Column("details", sa.JSON(), nullable=True))
        batch.create_foreign_key(
            "fk_driver_orders_shift_id_driver_shifts",
            "driver_shifts",
            ["shift_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_index("ix_driver_orders_shift_id", ["shift_id"])
    op.create_table(
        "driver_support_cases",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "shift_id",
            sa.String(36),
            sa.ForeignKey("driver_shifts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("order_id", sa.String(36), nullable=True),
        sa.Column("topic", sa.String(40), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=True, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("telegram_version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("step", sa.Integer(), nullable=False),
        sa.Column("answers", sa.JSON(), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_driver_support_cases_shift_id", "driver_support_cases", ["shift_id"])
    op.create_index("ix_driver_support_cases_user_id", "driver_support_cases", ["user_id"])


def downgrade():
    op.drop_table("driver_support_cases")
    with op.batch_alter_table("driver_orders") as batch:
        batch.drop_index("ix_driver_orders_shift_id")
        batch.drop_constraint("fk_driver_orders_shift_id_driver_shifts", type_="foreignkey")
        batch.drop_column("details")
        batch.drop_column("shift_id")
    op.drop_table("driver_shifts")
    with op.batch_alter_table("driver_settings") as batch:
        batch.drop_column("scenario")
