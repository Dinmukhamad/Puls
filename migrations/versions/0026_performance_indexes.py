"""Нагрузочная оптимизация (ТЗ §11): индексы под запросы, которые появились
в этой сессии (движок еженедельного расчёта, фильтры истории коинов).

Композитные уникальные ограничения (operator_id, period_start, period_end) уже
существуют на weekly_results и weekly_accrual_details, но по правилу
leftmost-prefix они не помогают запросам, где фильтр идёт ТОЛЬКО по периоду
без operator_id — а именно так эти таблицы читаются в accrual_service,
dashboard/admin-summary, exports и cabinet. Без отдельного индекса на
(period_start, period_end) это full table scan на каждый такой запрос.

Revision ID: 0026_performance_indexes
Revises: 0025_achievements
Create Date: 2026-07-09
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0026_performance_indexes"
down_revision = "0025_achievements"
branch_labels = None
depends_on = None


def _index_exists(table: str, index_name: str) -> bool:
    return any(ix["name"] == index_name for ix in sa.inspect(op.get_bind()).get_indexes(table))


def _create_index_if_missing(index_name: str, table: str, columns: list[str]) -> None:
    if not _index_exists(table, index_name):
        op.create_index(index_name, table, columns)


def upgrade() -> None:
    _create_index_if_missing("ix_weekly_results_period", "weekly_results", ["week_start", "week_end"])
    _create_index_if_missing("ix_weekly_accrual_details_period_only", "weekly_accrual_details", ["period_start", "period_end"])
    _create_index_if_missing("ix_coin_transactions_created_at", "coin_transactions", ["created_at"])
    _create_index_if_missing("ix_coin_transactions_source_type", "coin_transactions", ["source_type"])
    _create_index_if_missing("ix_coin_transactions_created_by_user_id", "coin_transactions", ["created_by_user_id"])
    _create_index_if_missing("ix_shop_purchases_created_at", "shop_purchases", ["created_at"])


def downgrade() -> None:
    for index_name, table in [
        ("ix_weekly_results_period", "weekly_results"),
        ("ix_weekly_accrual_details_period_only", "weekly_accrual_details"),
        ("ix_coin_transactions_created_at", "coin_transactions"),
        ("ix_coin_transactions_source_type", "coin_transactions"),
        ("ix_coin_transactions_created_by_user_id", "coin_transactions"),
        ("ix_shop_purchases_created_at", "shop_purchases"),
    ]:
        if _index_exists(table, index_name):
            op.drop_index(index_name, table_name=table)
