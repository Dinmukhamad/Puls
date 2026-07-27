from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


def normalize_database_url(url: str) -> str:
    """
    Railway даёт DATABASE_URL в формате postgres:// или postgresql://
    Production uses the single supported PostgreSQL driver: psycopg 3.
    Нормализуем автоматически.
    """
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    # Keep one PostgreSQL driver in every environment.
    if url.startswith("postgresql://") and "+psycopg" not in url:
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


settings = get_settings()

_db_url = normalize_database_url(settings.database_url)
_is_sqlite = _db_url.startswith("sqlite")
_connect_args = {"check_same_thread": False} if _is_sqlite else {}

engine = create_engine(
    _db_url,
    pool_pre_ping=True,
    connect_args=_connect_args,
    # Для PostgreSQL — оптимизированный пул соединений
    **({
        "pool_size": 10,          # базовый размер пула (было 5)
        "max_overflow": 20,       # до 30 одновременных соединений (было 10)
        "pool_recycle": 1800,     # пересоздавать соединения каждые 30 мин
        "pool_timeout": 10,       # не ждать соединение дольше 10с
    } if not _is_sqlite else {}),
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
