import sys
from logging.config import fileConfig
from pathlib import Path

# ``alembic`` is commonly launched through its installed console script. In
# that case Python puts the script directory (rather than this repository) on
# ``sys.path``, so application imports would depend on an external PYTHONPATH.
project_root = Path(__file__).resolve().parents[1]
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from alembic import context  # noqa: E402
from sqlalchemy import engine_from_config, pool  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.database.db import Base, normalize_database_url  # noqa: E402
from app.models import entities  # noqa: E402, F401

config = context.config
# Keep Alembic on exactly the same normalized URL as the application. Render,
# Railway and Heroku-style providers may expose ``postgres://`` URLs, which
# SQLAlchemy 2 no longer accepts. ConfigParser also treats ``%`` in escaped
# passwords as interpolation syntax, so it must be doubled when stored here.
database_url = normalize_database_url(get_settings().database_url).replace("%", "%%")
config.set_main_option("sqlalchemy.url", database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"})

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
