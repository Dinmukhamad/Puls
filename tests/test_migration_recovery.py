from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _alembic(database_path: Path, *arguments: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{database_path.as_posix()}"
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *arguments],
        cwd=PROJECT_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_repair_migration_restores_stamped_economy_schema(tmp_path: Path):
    database_path = tmp_path / "schema-drift.db"
    with sqlite3.connect(database_path) as connection:
        connection.executescript(
            """
            CREATE TABLE users (id INTEGER PRIMARY KEY);
            CREATE TABLE shop_items (id INTEGER PRIMARY KEY);
            CREATE TABLE coin_transactions (id INTEGER PRIMARY KEY);
            CREATE TABLE shop_purchases (
                id INTEGER PRIMARY KEY,
                operator_id INTEGER NOT NULL,
                shop_item_id INTEGER NOT NULL,
                price INTEGER NOT NULL,
                status VARCHAR(32) NOT NULL,
                created_at TIMESTAMP NOT NULL
            );
            CREATE TABLE alembic_version (
                version_num VARCHAR(64) NOT NULL PRIMARY KEY
            );
            INSERT INTO alembic_version (version_num)
            VALUES ('0036_order_lifecycle_inventory');
            """
        )
        connection.execute(
            "INSERT INTO shop_purchases "
            "(id, operator_id, shop_item_id, price, status, created_at) "
            "VALUES (999, 999, 999, 50, 'pending', '2026-01-01 00:00:00')"
        )
        connection.commit()

    # Alembic reports 0036, while the economy columns and tables are absent.
    _alembic(database_path, "upgrade", "head")

    with sqlite3.connect(database_path) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        transaction_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(coin_transactions)")
        }
        purchase_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(shop_purchases)")
        }
        version = connection.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchone()[0]
        preserved_purchase = connection.execute(
            "SELECT price, status FROM shop_purchases WHERE id = 999"
        ).fetchone()

    assert {
        "economy_seasons",
        "reward_rules",
        "shop_item_prices",
        "shop_item_inventory",
    } <= tables
    assert "idempotency_key" in transaction_columns
    assert {
        "original_price",
        "discount_percent",
        "discount_amount",
        "discount_coupon_id",
        "season_id",
        "issued_by_user_id",
        "expires_at",
        "idempotency_key",
    } <= purchase_columns
    assert version == "0037_repair_economy_schema"
    assert preserved_purchase == (50, "pending")
