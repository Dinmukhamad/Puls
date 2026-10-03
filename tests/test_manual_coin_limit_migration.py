"""Roll out the new default without overwriting customized coin rules."""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa

from alembic.migration import MigrationContext
from alembic.operations import Operations


@pytest.mark.parametrize(
    "old_limit,expected_limit", [(100, 9999), (250, 250), (9999, 9999), (None, None)]
)
def test_manual_coin_limit_migration_preserves_custom_rules(
    tmp_path, monkeypatch, old_limit, expected_limit
):
    path = (
        Path(__file__).resolve().parent.parent
        / "alembic/versions/20261003_manual_coin_limit.py"
    )
    spec = importlib.util.spec_from_file_location("manual_coin_limit", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    database = sa.create_engine(f"sqlite:///{tmp_path / 'manual-limit.sqlite3'}")
    try:
        with database.begin() as connection:
            connection.exec_driver_sql("""
                CREATE TABLE gamification_settings (
                    id INTEGER PRIMARY KEY,
                    manual_max_abs_amount INTEGER NOT NULL,
                    points_per_coin FLOAT NOT NULL,
                    manual_reason_min_length INTEGER NOT NULL
                )
            """)
            if old_limit is not None:
                connection.execute(
                    sa.text("INSERT INTO gamification_settings VALUES (1, :limit, 7.0, 8)"),
                    {"limit": old_limit},
                )
            monkeypatch.setattr(
                migration, "op", Operations(MigrationContext.configure(connection))
            )
            migration.upgrade()
            migration.upgrade()
            migration.downgrade()
            actual = list(
                connection.execute(sa.text("SELECT * FROM gamification_settings"))
            )
            expected = [] if expected_limit is None else [(1, expected_limit, 7.0, 8)]
            assert actual == expected
    finally:
        database.dispose()
