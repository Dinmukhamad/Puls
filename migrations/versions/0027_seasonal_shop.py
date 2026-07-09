"""Сезонный магазин (ТЗ P2): окно доступности товара, лимит остатка,
лимит покупок на оператора.

0 в stock_limit / purchase_limit_per_operator означает «без лимита» —
тот же принцип, что уже используется для max_wins_total/max_wins_per_operator
в секторах Wheel of WOW (см. миграцию колеса), выбран для единообразия.

Revision ID: 0027_seasonal_shop
Revises: 0026_performance_indexes
Create Date: 2026-07-09
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0027_seasonal_shop"
down_revision = "0026_performance_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shop_items", sa.Column("starts_at", sa.DateTime(), nullable=True))
    op.add_column("shop_items", sa.Column("ends_at", sa.DateTime(), nullable=True))
    op.add_column("shop_items", sa.Column("stock_limit", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("shop_items", sa.Column("purchase_limit_per_operator", sa.Integer(), nullable=False, server_default="0"))
    op.create_index("ix_shop_items_starts_at", "shop_items", ["starts_at"])
    op.create_index("ix_shop_items_ends_at", "shop_items", ["ends_at"])


def downgrade() -> None:
    op.drop_index("ix_shop_items_ends_at", table_name="shop_items")
    op.drop_index("ix_shop_items_starts_at", table_name="shop_items")
    op.drop_column("shop_items", "purchase_limit_per_operator")
    op.drop_column("shop_items", "stock_limit")
    op.drop_column("shop_items", "ends_at")
    op.drop_column("shop_items", "starts_at")
