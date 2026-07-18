"""Economy: seasons, reward rules, seasonal prices, ledger idempotency.

ТЗ «Экономика коинов, магазин призов и стартовый сезон Puls» (v1.0):
- §12.1 UNIQUE coin_transactions.idempotency_key;
- §7 economy_seasons (стартовый/обычный сезон, уведомление о переходе);
- §4/§11 reward_rules — управляемые правила начисления;
- §8/§12 shop_item_prices — сезонные цены (базовая цена остаётся в shop_items.price);
- §12 shop_purchases.season_id — снапшот сезона на момент покупки.

Revision ID: 0035_economy_seasons_rules
Revises: 0034_learning_worlds_sapar
Create Date: 2026-07-17
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0035_economy_seasons_rules"
down_revision = "0034_learning_worlds_sapar"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- ledger hardening -------------------------------------------------
    with op.batch_alter_table("coin_transactions") as batch:
        batch.add_column(sa.Column("idempotency_key", sa.String(length=200), nullable=True))
    op.create_index(
        "uq_coin_transactions_idempotency_key",
        "coin_transactions",
        ["idempotency_key"],
        unique=True,
    )

    # --- economy_seasons --------------------------------------------------
    op.create_table(
        "economy_seasons",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("notification_at", sa.DateTime(), nullable=True),
        sa.Column("config_json", sa.JSON(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.UniqueConstraint("code", name="uq_economy_seasons_code"),
    )
    op.create_index("ix_economy_seasons_code", "economy_seasons", ["code"])
    op.create_index("ix_economy_seasons_status", "economy_seasons", ["status"])
    op.create_index("ix_economy_seasons_starts_at", "economy_seasons", ["starts_at"])
    op.create_index("ix_economy_seasons_ends_at", "economy_seasons", ["ends_at"])

    # --- reward_rules -----------------------------------------------------
    op.create_table(
        "reward_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "season_id", sa.Integer(), sa.ForeignKey("economy_seasons.id"), nullable=True
        ),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("source_code", sa.String(length=120), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("threshold", sa.Float(), nullable=True),
        sa.Column("period", sa.String(length=20), nullable=False, server_default="all_time"),
        sa.Column("period_limit", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("valid_from", sa.DateTime(), nullable=True),
        sa.Column("valid_to", sa.DateTime(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_reward_rules_season_id", "reward_rules", ["season_id"])
    op.create_index("ix_reward_rules_active", "reward_rules", ["active"])
    op.create_index(
        "ix_reward_rules_lookup", "reward_rules", ["source_type", "source_code", "active"]
    )

    # --- shop_item_prices ---------------------------------------------------
    op.create_table(
        "shop_item_prices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "shop_item_id",
            sa.Integer(),
            sa.ForeignKey("shop_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "season_id", sa.Integer(), sa.ForeignKey("economy_seasons.id"), nullable=False
        ),
        sa.Column("coin_price", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("shop_item_id", "season_id", name="uq_shop_item_prices_item_season"),
    )
    op.create_index("ix_shop_item_prices_shop_item_id", "shop_item_prices", ["shop_item_id"])
    op.create_index("ix_shop_item_prices_season_id", "shop_item_prices", ["season_id"])

    # --- shop_purchases.season_id ------------------------------------------
    # recreate="always": SQLite не умеет ALTER ... ADD CONSTRAINT — batch-режим
    # пересоздаёт таблицу copy-and-move. На PostgreSQL выполняется обычный ALTER.
    # Recreate only when Alembic needs it on SQLite. PostgreSQL must alter the
    # existing table in place because other tables already reference it.
    with op.batch_alter_table("shop_purchases") as batch:
        batch.add_column(sa.Column("season_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_shop_purchases_season_id_economy_seasons",
            "economy_seasons",
            ["season_id"],
            ["id"],
        )
    op.create_index("ix_shop_purchases_season_id", "shop_purchases", ["season_id"])


def downgrade() -> None:
    op.drop_index("ix_shop_purchases_season_id", table_name="shop_purchases")
    with op.batch_alter_table("shop_purchases") as batch:
        batch.drop_constraint("fk_shop_purchases_season_id_economy_seasons", type_="foreignkey")
        batch.drop_column("season_id")

    op.drop_index("ix_shop_item_prices_season_id", table_name="shop_item_prices")
    op.drop_index("ix_shop_item_prices_shop_item_id", table_name="shop_item_prices")
    op.drop_table("shop_item_prices")

    op.drop_index("ix_reward_rules_lookup", table_name="reward_rules")
    op.drop_index("ix_reward_rules_active", table_name="reward_rules")
    op.drop_index("ix_reward_rules_season_id", table_name="reward_rules")
    op.drop_table("reward_rules")

    op.drop_index("ix_economy_seasons_ends_at", table_name="economy_seasons")
    op.drop_index("ix_economy_seasons_starts_at", table_name="economy_seasons")
    op.drop_index("ix_economy_seasons_status", table_name="economy_seasons")
    op.drop_index("ix_economy_seasons_code", table_name="economy_seasons")
    op.drop_table("economy_seasons")

    op.drop_index("uq_coin_transactions_idempotency_key", table_name="coin_transactions")
    with op.batch_alter_table("coin_transactions") as batch:
        batch.drop_column("idempotency_key")
