from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.engine import Connection

_PROJECT_ROOT = Path(__file__).resolve().parents[2]


@lru_cache
def expected_schema_heads() -> frozenset[str]:
    config = Config()
    config.set_main_option("script_location", str(_PROJECT_ROOT / "migrations"))
    return frozenset(ScriptDirectory.from_config(config).get_heads())


def assert_database_schema_current(connection: Connection) -> None:
    current_heads = frozenset(
        connection.execute(text("SELECT version_num FROM alembic_version")).scalars()
    )
    expected_heads = expected_schema_heads()
    if current_heads != expected_heads:
        raise RuntimeError(
            "database schema is not current: "
            f"current={sorted(current_heads)!r}, expected={sorted(expected_heads)!r}"
        )
