"""Сохраняемые учебные заказы Driver Simulator."""

import sqlalchemy as sa

from alembic import op

revision = "20260909_driver_orders"
down_revision = "20260908_driver_auth"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "driver_orders",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("active_slot", sa.Integer(), nullable=True),
        sa.Column("stage", sa.String(20), nullable=False),
        sa.Column("origin", sa.String(160), nullable=False),
        sa.Column("destination", sa.String(160), nullable=False),
        sa.Column("payment", sa.String(10), nullable=False),
        sa.Column("fare", sa.Integer(), nullable=False),
        sa.Column("commission", sa.Integer(), nullable=False),
        sa.Column("park", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("events", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stage_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "active_slot"),
        sa.CheckConstraint("active_slot IS NULL OR active_slot = 1", name="active_slot"),
        sa.CheckConstraint(
            "stage IN ('searching','offer','pickup','waiting',"
            "'trip','payment','complete','cancelled')",
            name="stage",
        ),
        sa.CheckConstraint("payment IN ('cash','card')", name="payment"),
    )
    op.create_index("ix_driver_orders_user_id", "driver_orders", ["user_id"])


def downgrade():
    op.drop_table("driver_orders")
