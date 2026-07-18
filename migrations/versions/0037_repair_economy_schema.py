"""Repair economy schema after a previously skipped or stamped migration.

Revision ID: 0037_repair_economy_schema
Revises: 0036_order_lifecycle_inventory
Create Date: 2026-07-18
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0037_repair_economy_schema"
down_revision = "0036_order_lifecycle_inventory"
branch_labels = None
depends_on = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _table_exists(table: str) -> bool:
    return _inspector().has_table(table)


def _column_exists(table: str, column: str) -> bool:
    if not _table_exists(table):
        return False
    return column in {item["name"] for item in _inspector().get_columns(table)}


def _index_exists(table: str, index: str) -> bool:
    if not _table_exists(table):
        return False
    return index in {item["name"] for item in _inspector().get_indexes(table)}


def _foreign_key_exists(
    table: str,
    constrained_columns: tuple[str, ...],
    referred_table: str,
) -> bool:
    if not _table_exists(table):
        return False
    return any(
        tuple(item.get("constrained_columns") or ()) == constrained_columns
        and item.get("referred_table") == referred_table
        for item in _inspector().get_foreign_keys(table)
    )


def _add_column_if_missing(table: str, column: sa.Column) -> None:
    if not _column_exists(table, column.name):
        op.add_column(table, column)


def _create_index_if_missing(
    name: str,
    table: str,
    columns: list[str],
    *,
    unique: bool = False,
) -> None:
    if not _index_exists(table, name):
        op.create_index(name, table, columns, unique=unique)


def _create_foreign_key_if_missing(
    name: str,
    source_table: str,
    target_table: str,
    source_columns: list[str],
    target_columns: list[str],
) -> None:
    # SQLite cannot add a foreign key with ALTER TABLE. Normal fresh upgrades
    # receive these constraints in 0035/0036; this repair path targets drifted
    # PostgreSQL production databases.
    if op.get_bind().dialect.name == "sqlite":
        return
    if not _foreign_key_exists(source_table, tuple(source_columns), target_table):
        op.create_foreign_key(
            name,
            source_table,
            target_table,
            source_columns,
            target_columns,
        )


def _ensure_economy_seasons() -> None:
    if not _table_exists("economy_seasons"):
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
    _create_index_if_missing("ix_economy_seasons_code", "economy_seasons", ["code"])
    _create_index_if_missing("ix_economy_seasons_status", "economy_seasons", ["status"])
    _create_index_if_missing("ix_economy_seasons_starts_at", "economy_seasons", ["starts_at"])
    _create_index_if_missing("ix_economy_seasons_ends_at", "economy_seasons", ["ends_at"])


def _ensure_reward_rules() -> None:
    if not _table_exists("reward_rules"):
        op.create_table(
            "reward_rules",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("season_id", sa.Integer(), sa.ForeignKey("economy_seasons.id"), nullable=True),
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
    _create_index_if_missing("ix_reward_rules_season_id", "reward_rules", ["season_id"])
    _create_index_if_missing("ix_reward_rules_active", "reward_rules", ["active"])
    _create_index_if_missing(
        "ix_reward_rules_lookup",
        "reward_rules",
        ["source_type", "source_code", "active"],
    )


def _ensure_shop_item_prices() -> None:
    if not _table_exists("shop_item_prices"):
        op.create_table(
            "shop_item_prices",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "shop_item_id",
                sa.Integer(),
                sa.ForeignKey("shop_items.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("season_id", sa.Integer(), sa.ForeignKey("economy_seasons.id"), nullable=False),
            sa.Column("coin_price", sa.Integer(), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint(
                "shop_item_id",
                "season_id",
                name="uq_shop_item_prices_item_season",
            ),
        )
    _create_index_if_missing(
        "ix_shop_item_prices_shop_item_id", "shop_item_prices", ["shop_item_id"]
    )
    _create_index_if_missing(
        "ix_shop_item_prices_season_id", "shop_item_prices", ["season_id"]
    )


def _ensure_shop_item_inventory() -> None:
    if not _table_exists("shop_item_inventory"):
        op.create_table(
            "shop_item_inventory",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "shop_item_id",
                sa.Integer(),
                sa.ForeignKey("shop_items.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("quantity_received", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("quantity_reserved", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("quantity_issued", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("quantity_returned", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("min_stock_alert", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("shop_item_id", name="uq_shop_item_inventory_item"),
        )
    _create_index_if_missing(
        "ix_shop_item_inventory_shop_item_id",
        "shop_item_inventory",
        ["shop_item_id"],
    )


def upgrade() -> None:
    _add_column_if_missing(
        "coin_transactions",
        sa.Column("idempotency_key", sa.String(length=200), nullable=True),
    )
    _create_index_if_missing(
        "uq_coin_transactions_idempotency_key",
        "coin_transactions",
        ["idempotency_key"],
        unique=True,
    )

    _ensure_economy_seasons()
    _ensure_reward_rules()
    _ensure_shop_item_prices()

    for column in (
        sa.Column("original_price", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("discount_percent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("discount_amount", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("discount_coupon_id", sa.Integer(), nullable=True),
        sa.Column("season_id", sa.Integer(), nullable=True),
        sa.Column("issued_by_user_id", sa.Integer(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=200), nullable=True),
    ):
        _add_column_if_missing("shop_purchases", column)

    _create_foreign_key_if_missing(
        "fk_shop_purchases_season_id_economy_seasons",
        "shop_purchases",
        "economy_seasons",
        ["season_id"],
        ["id"],
    )
    _create_foreign_key_if_missing(
        "fk_shop_purchases_issued_by_user_id_users",
        "shop_purchases",
        "users",
        ["issued_by_user_id"],
        ["id"],
    )
    _create_index_if_missing(
        "ix_shop_purchases_season_id", "shop_purchases", ["season_id"]
    )
    _create_index_if_missing(
        "ix_shop_purchases_expires_at", "shop_purchases", ["expires_at"]
    )
    _create_index_if_missing(
        "uq_shop_purchases_idempotency_key",
        "shop_purchases",
        ["idempotency_key"],
        unique=True,
    )
    _ensure_shop_item_inventory()


def downgrade() -> None:
    # This is a non-destructive repair migration. Removing repaired production
    # columns would recreate the outage and can destroy user data.
    pass
