"""Economy phase 3: order lifecycle, purchase idempotency, prize inventory.

ТЗ «Экономика коинов, магазин призов и стартовый сезон Puls» v1.0:
- §12.1 prize_orders: issued_by, expires_at, статусы refunded/expired
  (значения статусов — данные, схему меняют только новые колонки);
- §14 Idempotency-Key на создании заказа: shop_purchases.idempotency_key UNIQUE;
- §12.1 prize_inventory: складской учёт счётчиками приход/резерв/выдача/возврат.

Revision ID: 0036_order_lifecycle_inventory
Revises: 0035_economy_seasons_rules
Create Date: 2026-07-18
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0036_order_lifecycle_inventory"
down_revision = "0035_economy_seasons_rules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # recreate="always": совместимость с SQLite (ALTER ADD CONSTRAINT не
    # поддерживается — batch-режим пересоздаёт таблицу copy-and-move).
    with op.batch_alter_table("shop_purchases", recreate="always") as batch:
        batch.add_column(sa.Column("issued_by_user_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("expires_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("idempotency_key", sa.String(length=200), nullable=True))
        batch.create_foreign_key(
            "fk_shop_purchases_issued_by_user_id_users",
            "users",
            ["issued_by_user_id"],
            ["id"],
        )
    op.create_index("ix_shop_purchases_expires_at", "shop_purchases", ["expires_at"])
    op.create_index(
        "uq_shop_purchases_idempotency_key",
        "shop_purchases",
        ["idempotency_key"],
        unique=True,
    )

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
    op.create_index(
        "ix_shop_item_inventory_shop_item_id", "shop_item_inventory", ["shop_item_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_shop_item_inventory_shop_item_id", table_name="shop_item_inventory")
    op.drop_table("shop_item_inventory")

    op.drop_index("uq_shop_purchases_idempotency_key", table_name="shop_purchases")
    op.drop_index("ix_shop_purchases_expires_at", table_name="shop_purchases")
    with op.batch_alter_table("shop_purchases", recreate="always") as batch:
        batch.drop_constraint("fk_shop_purchases_issued_by_user_id_users", type_="foreignkey")
        batch.drop_column("idempotency_key")
        batch.drop_column("expires_at")
        batch.drop_column("issued_by_user_id")
