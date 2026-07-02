"""Add missing indexes for foreign-key columns used in frequent WHERE/JOIN clauses.

Revision ID: 0012_missing_fk_indexes
Revises: 0011_operator_daily_metrics
Create Date: 2026-06-30
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0012_missing_fk_indexes"
down_revision = "0011_operator_daily_metrics"
branch_labels = None
depends_on = None


def _index_exists(table: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(idx["name"] == index_name for idx in inspector.get_indexes(table))


def upgrade() -> None:
    # users.operator_id — используется при каждом запросе кабинета оператора
    # (поиск аккаунта по operator_id), не имел индекса вообще.
    if not _index_exists("users", "ix_users_operator_id"):
        op.create_index("ix_users_operator_id", "users", ["operator_id"])

    # shop_purchases.shop_item_id — используется при подсчёте популярности
    # товаров и фильтрации покупок по конкретному товару.
    if not _index_exists("shop_purchases", "ix_shop_purchases_shop_item_id"):
        op.create_index("ix_shop_purchases_shop_item_id", "shop_purchases", ["shop_item_id"])

    # audit_logs.operator_id — legacy-поле, используется при просмотре
    # истории действий по конкретному оператору.
    if not _index_exists("audit_logs", "ix_audit_logs_operator_id"):
        op.create_index("ix_audit_logs_operator_id", "audit_logs", ["operator_id"])


def downgrade() -> None:
    for table, idx_name in [
        ("users", "ix_users_operator_id"),
        ("shop_purchases", "ix_shop_purchases_shop_item_id"),
        ("audit_logs", "ix_audit_logs_operator_id"),
    ]:
        if _index_exists(table, idx_name):
            op.drop_index(idx_name, table_name=table)
"""Add missing indexes for foreign-key columns used in frequent WHERE/JOIN clauses.

Revision ID: 0012_missing_fk_indexes
Revises: 0011_operator_daily_metrics
Create Date: 2026-06-30
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0012_missing_fk_indexes"
down_revision = "0011_operator_daily_metrics"
branch_labels = None
depends_on = None


def _index_exists(table: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(idx["name"] == index_name for idx in inspector.get_indexes(table))


def upgrade() -> None:
    # users.operator_id — используется при каждом запросе кабинета оператора
    # (поиск аккаунта по operator_id), не имел индекса вообще.
    if not _index_exists("users", "ix_users_operator_id"):
        op.create_index("ix_users_operator_id", "users", ["operator_id"])

    # shop_purchases.shop_item_id — используется при подсчёте популярности
    # товаров и фильтрации покупок по конкретному товару.
    if not _index_exists("shop_purchases", "ix_shop_purchases_shop_item_id"):
        op.create_index("ix_shop_purchases_shop_item_id", "shop_purchases", ["shop_item_id"])

    # audit_logs.operator_id — legacy-поле, используется при просмотре
    # истории действий по конкретному оператору.
    if not _index_exists("audit_logs", "ix_audit_logs_operator_id"):
        op.create_index("ix_audit_logs_operator_id", "audit_logs", ["operator_id"])


def downgrade() -> None:
    for table, idx_name in [
        ("users", "ix_users_operator_id"),
        ("shop_purchases", "ix_shop_purchases_shop_item_id"),
        ("audit_logs", "ix_audit_logs_operator_id"),
    ]:
        if _index_exists(table, idx_name):
            op.drop_index(idx_name, table_name=table)
