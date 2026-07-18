"""Coin economy catalog metadata and opening ledger balances.

Revision ID: 0038_coin_economy_blueprint
Revises: 0037_repair_economy_schema
Create Date: 2026-07-18
"""
from __future__ import annotations

import json
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "0038_coin_economy_blueprint"
down_revision = "0037_repair_economy_schema"
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


def _add_column(table: str, column: sa.Column) -> None:
    if _table_exists(table) and not _column_exists(table, column.name):
        op.add_column(table, column)


def upgrade() -> None:
    _add_column("shop_items", sa.Column("code", sa.String(length=100), nullable=True))
    _add_column(
        "shop_items",
        sa.Column("prize_type", sa.String(length=24), nullable=False, server_default="physical"),
    )
    _add_column("shop_items", sa.Column("image_url", sa.String(length=500), nullable=True))
    _add_column(
        "shop_items",
        sa.Column("issue_policy", sa.Text(), nullable=False, server_default=""),
    )
    _add_column(
        "shop_items",
        sa.Column("issue_days", sa.Integer(), nullable=False, server_default="14"),
    )
    if not _index_exists("shop_items", "ix_shop_items_code"):
        op.create_index("ix_shop_items_code", "shop_items", ["code"], unique=True)
    if not _index_exists("shop_items", "ix_shop_items_prize_type"):
        op.create_index("ix_shop_items_prize_type", "shop_items", ["prize_type"])

    bind = op.get_bind()
    bind.execute(
        sa.text(
            "UPDATE shop_items SET code = 'legacy-' || id WHERE code IS NULL"
        )
    )
    if _column_exists("shop_items", "category"):
        bind.execute(
            sa.text(
                "UPDATE shop_items SET prize_type = 'privilege' "
                "WHERE category IN ('quick', 'workday', 'recognition')"
            )
        )

    _add_column(
        "coin_transactions",
        sa.Column("reason_code", sa.String(length=80), nullable=True),
    )
    if not _index_exists("coin_transactions", "ix_coin_transactions_reason_code"):
        op.create_index(
            "ix_coin_transactions_reason_code",
            "coin_transactions",
            ["reason_code"],
        )
    if _column_exists("coin_transactions", "type") and _column_exists(
        "coin_transactions", "source_type"
    ):
        bind.execute(
            sa.text(
                "UPDATE coin_transactions SET reason_code = CASE "
                "WHEN type = 'wheel_of_wow' THEN 'wheel_reward' "
                "ELSE COALESCE(source_type, type) END "
                "WHERE reason_code IS NULL"
            )
        )

    # ТЗ §18: существующий фактический баланс не меняется. Если ledger не
    # объясняет его полностью, добавляем ровно одну входную проводку на
    # разницу. Повторный запуск защищён idempotency_key.
    required_operator_columns = {"id", "current_balance"}
    required_transaction_columns = {
        "operator_id",
        "amount",
        "type",
        "comment",
        "source_type",
        "source_id",
        "idempotency_key",
        "reason_code",
        "metadata",
        "created_at",
    }
    if not _table_exists("operators") or not required_operator_columns.issubset(
        {item["name"] for item in _inspector().get_columns("operators")}
    ):
        return
    if not required_transaction_columns.issubset(
        {item["name"] for item in _inspector().get_columns("coin_transactions")}
    ):
        return

    rows = bind.execute(
        sa.text(
            "SELECT o.id AS operator_id, o.current_balance AS balance, "
            "COALESCE(SUM(t.amount), 0) AS ledger_total "
            "FROM operators o LEFT JOIN coin_transactions t ON t.operator_id = o.id "
            "GROUP BY o.id, o.current_balance"
        )
    ).mappings()
    for row in rows:
        difference = int(row["balance"] or 0) - int(row["ledger_total"] or 0)
        if difference == 0:
            continue
        operator_id = int(row["operator_id"])
        key = f"opening_balance:operator:{operator_id}"
        exists = bind.execute(
            sa.text(
                "SELECT 1 FROM coin_transactions WHERE idempotency_key = :key"
            ),
            {"key": key},
        ).first()
        if exists:
            continue
        bind.execute(
            sa.text(
                "INSERT INTO coin_transactions "
                "(operator_id, amount, type, comment, source_type, source_id, "
                "idempotency_key, reason_code, metadata, created_at) "
                "VALUES (:operator_id, :amount, 'opening_balance', :comment, "
                "'migration', :operator_id, :key, 'opening_balance', :metadata, :created_at)"
            ),
            {
                "operator_id": operator_id,
                "amount": difference,
                "comment": "Входной баланс при миграции экономики",
                "key": key,
                "metadata": json.dumps({"ledger_total_before": int(row["ledger_total"] or 0)}),
                "created_at": datetime.now(UTC).replace(tzinfo=None),
            },
        )


def downgrade() -> None:
    # Миграция намеренно не удаляет проводки opening_balance и метаданные
    # каталога: это бизнес-история, потеря которой опаснее несовместимости.
    pass
