from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


async def lock_user(session: AsyncSession, user_id: int):
    """Сериализация операций сотрудника на PostgreSQL и SQLite."""
    if session.get_bind().dialect.name == "sqlite":
        await session.execute(text("UPDATE users SET id = id WHERE id = :id"), {"id": user_id})
    else:
        await session.execute(select(User.id).where(User.id == user_id).with_for_update())
