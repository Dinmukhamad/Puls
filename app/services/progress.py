"""One progress scale: verified lifetime coin earnings, never the spendable balance."""

from sqlalchemy import select

from app.models.progress import ProgressLevel
from app.services.coins import earned_total, get_account

DEFAULT_LEVELS = (
    ("Новичок", 0),
    ("Первый результат", 100),
    ("Специалист", 500),
    ("Профессионал", 1500),
    ("Эксперт", 3000),
    ("Мастер", 5000),
    ("Легенда Puls", 10000),
)


async def seed_progress_levels(session):
    if await session.scalar(select(ProgressLevel.id).limit(1)) is None:
        session.add_all(
            [ProgressLevel(title=title, min_coins=value) for title, value in DEFAULT_LEVELS]
        )
        await session.flush()


async def reconcile_existing_progress(session):
    """Preserve earned facts on rollout without paying old work a second time."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert

    from app.models.progress import ProgressBaseline
    from app.models.user import User
    from app.services.badges import award_achievements, latest_result_week

    await seed_progress_levels(session)
    insert = sqlite_insert if session.get_bind().dialect.name == "sqlite" else pg_insert
    while True:
        ids = list(
            await session.scalars(
                select(User.id)
                .where(
                    ~select(ProgressBaseline.user_id)
                    .where(ProgressBaseline.user_id == User.id)
                    .exists()
                )
                .order_by(User.id)
                .limit(100)
            )
        )
        if not ids:
            break
        for user_id in ids:
            # Claim and reconcile within the same transaction, safe across worker restarts.
            claimed = await session.scalar(
                insert(ProgressBaseline)
                .values(user_id=user_id)
                .on_conflict_do_nothing()
                .returning(ProgressBaseline.user_id)
            )
            if claimed is not None:
                await award_achievements(
                    session, user_id, await latest_result_week(session, user_id), pay_bonus=False
                )
        await session.commit()


async def progress_summary(session, user_id):
    from app.services.badges import badge_output, user_badge_board

    total = await earned_total(session, user_id)
    account = await get_account(session, user_id)
    levels = list(
        await session.scalars(
            select(ProgressLevel)
            .where(ProgressLevel.is_active.is_(True))
            .order_by(ProgressLevel.min_coins)
        )
    )
    current = next((item for item in reversed(levels) if total >= item.min_coins), None)
    following = next((item for item in levels if item.min_coins > total), None)
    floor = current.min_coins if current else 0
    board = await user_badge_board(session, user_id, coin_total=total, levels=levels)
    return {
        "total": total,
        "available": account.available,
        "current": current,
        "next": following,
        "level_number": levels.index(current) + 1 if current else 0,
        "remaining": max(0, following.min_coins - total) if following else 0,
        "progress": (total - floor) / (following.min_coins - floor) if following else 1,
        "levels": levels,
        "achievements": [badge_output(progress, award) for progress, award in board],
    }
