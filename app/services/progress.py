"""Начисление опыта; общий журнал наград с идемпотентностью."""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, DomainError, NotFoundError
from app.models.progress import Notification, XpAccount, XpEntry, XpLevel
from app.models.user import User

DEFAULT_XP_LEVELS = (("Новичок", 0), ("Специалист", 500), ("Профессионал", 1500), ("Эксперт", 3000))


async def seed_xp_levels(session: AsyncSession):
    # Заполняется только совершенно новый справочник. Изменённые администратором
    # названия/пороги не восстанавливаются при перезапуске приложения.
    if await session.scalar(select(XpLevel.id).limit(1)) is None:
        session.add_all([XpLevel(title=title, min_xp=value) for title, value in DEFAULT_XP_LEVELS])
        await session.flush()


async def grant_xp(
    session: AsyncSession,
    *,
    user_id: int,
    amount: int,
    reason: str,
    source: str,
    key: str,
    author_id: int | None = None,
) -> XpEntry | None:
    if amount <= 0:
        raise DomainError("Количество XP должно быть положительным")
    if await session.get(User, user_id) is None:
        raise NotFoundError("Сотрудник не найден")
    dialect = session.get_bind().dialect.name
    insert = sqlite_insert if dialect == "sqlite" else pg_insert
    await session.execute(
        insert(XpAccount)
        .values(user_id=user_id, total=0)
        .on_conflict_do_nothing(index_elements=["user_id"])
    )
    account = await session.scalar(
        select(XpAccount)
        .where(XpAccount.user_id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    assert account is not None
    previous = await session.scalar(select(XpEntry).where(XpEntry.idempotency_key == key))
    if previous is not None:
        if (previous.user_id, previous.amount, previous.reason, previous.source) != (
            user_id,
            amount,
            reason,
            source,
        ):
            raise ConflictError("Этот ключ запроса уже использован для другого начисления")
        return None
    account.total += amount
    entry = XpEntry(
        user_id=user_id,
        amount=amount,
        total_after=account.total,
        reason=reason,
        source=source,
        idempotency_key=key,
        author_id=author_id,
    )
    session.add(entry)
    session.add(
        Notification(
            user_id=user_id, title=f"Получено {amount} XP", body=reason, kind="xp", link="/progress"
        )
    )
    await session.flush()
    return entry


async def xp_summary(session: AsyncSession, user_id: int) -> dict:
    total = await session.scalar(select(XpAccount.total).where(XpAccount.user_id == user_id)) or 0
    levels = list(
        await session.scalars(
            select(XpLevel).where(XpLevel.is_active.is_(True)).order_by(XpLevel.min_xp)
        )
    )
    current = next((item for item in reversed(levels) if total >= item.min_xp), None)
    following = next((item for item in levels if item.min_xp > total), None)
    floor = current.min_xp if current else 0
    return {
        "total": total,
        "current": current,
        "next": following,
        "remaining": max(0, following.min_xp - total) if following else 0,
        "progress": (total - floor) / (following.min_xp - floor) if following else 1,
        "levels": levels,
    }
