"""Add learning worlds and versioned mission settings.

Revision ID: 0034_learning_worlds_sapar
Revises: 0033_photo_control_mission
Create Date: 2026-07-16
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0034_learning_worlds_sapar"
down_revision = "0033_photo_control_mission"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "learning_worlds",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("icon", sa.String(length=80), nullable=False, server_default="map"),
        sa.Column("illustration_key", sa.String(length=80), nullable=False, server_default="city"),
        sa.Column("accent_color", sa.String(length=16), nullable=False, server_default="#4F46E5"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("availability", sa.String(length=32), nullable=False, server_default="available"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("code", name="uq_learning_worlds_code"),
    )
    op.create_index("ix_learning_worlds_code", "learning_worlds", ["code"], unique=True)
    op.create_index("ix_learning_worlds_sort_order", "learning_worlds", ["sort_order"])
    op.create_index("ix_learning_worlds_is_active", "learning_worlds", ["is_active"])
    op.create_index("ix_learning_worlds_availability", "learning_worlds", ["availability"])

    with op.batch_alter_table("missions") as batch:
        batch.add_column(sa.Column("world_id", sa.Integer(), nullable=True))
        batch.add_column(
            sa.Column("world_sort_order", sa.Integer(), nullable=False, server_default="0")
        )
        batch.create_foreign_key(
            "fk_missions_world_id_learning_worlds", "learning_worlds", ["world_id"], ["id"]
        )
    op.create_index("ix_missions_world_id", "missions", ["world_id"])
    op.create_index("ix_missions_world_sort_order", "missions", ["world_sort_order"])

    op.create_table(
        "mission_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "mission_id",
            sa.Integer(),
            sa.ForeignKey("missions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("value_json", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("effective_from", sa.DateTime(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("mission_id", "key", "version", name="uq_mission_setting_version"),
    )
    op.create_index("ix_mission_settings_mission_id", "mission_settings", ["mission_id"])
    op.create_index("ix_mission_settings_key", "mission_settings", ["key"])
    op.create_index("ix_mission_settings_is_active", "mission_settings", ["is_active"])


def downgrade() -> None:
    op.drop_index("ix_mission_settings_is_active", table_name="mission_settings")
    op.drop_index("ix_mission_settings_key", table_name="mission_settings")
    op.drop_index("ix_mission_settings_mission_id", table_name="mission_settings")
    op.drop_table("mission_settings")
    op.drop_index("ix_missions_world_sort_order", table_name="missions")
    op.drop_index("ix_missions_world_id", table_name="missions")
    with op.batch_alter_table("missions") as batch:
        batch.drop_constraint("fk_missions_world_id_learning_worlds", type_="foreignkey")
        batch.drop_column("world_sort_order")
        batch.drop_column("world_id")
    op.drop_index("ix_learning_worlds_availability", table_name="learning_worlds")
    op.drop_index("ix_learning_worlds_is_active", table_name="learning_worlds")
    op.drop_index("ix_learning_worlds_sort_order", table_name="learning_worlds")
    op.drop_index("ix_learning_worlds_code", table_name="learning_worlds")
    op.drop_table("learning_worlds")
