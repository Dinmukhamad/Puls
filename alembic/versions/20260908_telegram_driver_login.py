"""Телефон сотрудника, привязка Telegram и подтверждённые браузеры симулятора."""

import sqlalchemy as sa

from alembic import op

revision = "20260908_driver_auth"
down_revision = "20260907_driver"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("phone", sa.String(16), nullable=True))
        batch.create_unique_constraint("uq_users_phone", ["phone"])
    with op.batch_alter_table("driver_profiles") as batch:
        batch.drop_constraint(op.f("ck_driver_profiles_stage"), type_="check")
        batch.create_check_constraint(
            "stage", "stage IN ('services', 'cooperation', 'phone', 'loading', 'offline')"
        )
    op.create_table(
        "telegram_links",
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("chat_id", sa.BigInteger(), unique=True, nullable=True),
        sa.Column("username", sa.String(64), nullable=True),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("link_hash", sa.String(64), unique=True, nullable=True),
        sa.Column("link_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("link_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("send_window_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("send_count", sa.Integer(), nullable=False),
    )
    op.create_table(
        "driver_devices",
        sa.Column("secret_hash", sa.String(64), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("phone", sa.String(16), nullable=False),
        sa.Column("telegram_version", sa.Integer(), nullable=False),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("code_hash", sa.String(64), nullable=True),
        sa.Column("code_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_send_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_driver_devices_user_id", "driver_devices", ["user_id"])


def downgrade():
    op.drop_table("driver_devices")
    op.drop_table("telegram_links")
    op.execute("UPDATE driver_profiles SET stage = 'services' WHERE stage = 'phone'")
    with op.batch_alter_table("driver_profiles") as batch:
        batch.drop_constraint(op.f("ck_driver_profiles_stage"), type_="check")
        batch.create_check_constraint(
            "stage", "stage IN ('services', 'cooperation', 'loading', 'offline')"
        )
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("uq_users_phone", type_="unique")
        batch.drop_column("phone")
