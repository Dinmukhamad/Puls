from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


async def lock_user(session: AsyncSession, user_id: int):
    """Сериализация операций сотрудника на PostgreSQL и SQLite."""
    if session.get_bind().dialect.name == "sqlite":
        await session.execute(text("UPDATE users SET id = id WHERE id = :id"), {"id": user_id})
    else:
        # Serialize changes without blocking FK references from coins/notifications of other users.
        # SQLAlchemy's key_share without read emits PostgreSQL FOR NO KEY UPDATE.
        await session.execute(
            select(User.id).where(User.id == user_id).with_for_update(key_share=True)
        )
