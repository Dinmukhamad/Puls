from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


def _fix_database_url(url: str) -> str:
    """
    Railway даёт DATABASE_URL в формате postgres:// или postgresql://
    SQLAlchemy 2.x требует postgresql+psycopg2:// для psycopg2
    или postgresql+psycopg:// для psycopg3.
    Нормализуем автоматически.
    """
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    # Если нет явного драйвера — добавляем psycopg2 (стабильнее на Railway)
    if url.startswith("postgresql://") and "+psycopg" not in url:
        url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return url


settings = get_settings()

_db_url = _fix_database_url(settings.database_url)
_is_sqlite = _db_url.startswith("sqlite")
_connect_args = {"check_same_thread": False} if _is_sqlite else {}

engine = create_engine(
    _db_url,
    pool_pre_ping=True,
    connect_args=_connect_args,
    # Для PostgreSQL — пул соединений
    **({"pool_size": 5, "max_overflow": 10} if not _is_sqlite else {}),
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
