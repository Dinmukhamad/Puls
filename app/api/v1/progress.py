from datetime import UTC, datetime

from fastapi import APIRouter
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.core.deps import (
    AdminUser,
    CurrentUser,
    PaginationDep,
    SessionDep,
    StaffUser,
    visible_users_filter,
)
from app.core.errors import ConflictError, DomainError, NotFoundError
from app.models.progress import Notification, ProgressLevel
from app.models.user import User
from app.schemas.common import Message, Page
from app.schemas.progress import (
    NotificationOut,
    ProgressLevelIn,
    ProgressLevelOut,
    ProgressSummary,
)
from app.services.progress import progress_summary
from app.services.rules import write_audit

router = APIRouter(tags=["Прогресс и уведомления"])


@router.get("/me/progress", response_model=ProgressSummary)
async def my_progress(session: SessionDep, user: CurrentUser):
    return await progress_summary(session, user.id)


@router.get("/admin/progress/users/{user_id}", response_model=ProgressSummary)
async def user_progress(session: SessionDep, actor: StaffUser, user_id: int):
    visible = await visible_users_filter(session, actor)
    if await session.scalar(select(User.id).where(User.id == user_id, visible)) is None:
        raise NotFoundError("Сотрудник не найден")
    return await progress_summary(session, user_id)


@router.get("/admin/progress/levels", response_model=list[ProgressLevelOut])
async def levels(session: SessionDep, _: StaffUser):
    return list(await session.scalars(select(ProgressLevel).order_by(ProgressLevel.min_coins)))


async def _save_level(session, actor, payload, level=None):
    if (
        level is not None
        and level.min_coins == 0
        and (payload.min_coins != 0 or not payload.is_active)
    ):
        raise DomainError("Стартовый уровень с порогом 0 коинов должен оставаться активным")
    if level is None:
        level = ProgressLevel()
        session.add(level)
    before = {key: getattr(level, key, None) for key in type(payload).model_fields}
    for key, value in payload.model_dump().items():
        setattr(level, key, value)
    try:
        await session.flush()
        await write_audit(
            session,
            actor_id=actor.id,
            action="progress.level_update",
            entity_type="progress_level",
            entity_id=level.id,
            payload={"before": before, "after": payload.model_dump()},
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError("Уровень с таким порогом коинов уже существует") from exc
    return level


@router.post("/admin/progress/levels", response_model=ProgressLevelOut, status_code=201)
async def create_level(session: SessionDep, actor: AdminUser, payload: ProgressLevelIn):
    return await _save_level(session, actor, payload)


@router.put("/admin/progress/levels/{level_id}", response_model=ProgressLevelOut)
async def edit_level(
    session: SessionDep, actor: AdminUser, level_id: int, payload: ProgressLevelIn
):
    level = await session.get(ProgressLevel, level_id)
    if level is None:
        raise NotFoundError("Уровень не найден")
    return await _save_level(session, actor, payload, level)


@router.get("/me/notifications", response_model=Page[NotificationOut])
async def notifications(
    session: SessionDep, user: CurrentUser, pagination: PaginationDep, unread: bool = False
):
    conditions = [Notification.user_id == user.id, Notification.kind != "xp"]
    if unread:
        conditions.append(Notification.read_at.is_(None))
    total = int(await session.scalar(select(func.count(Notification.id)).where(*conditions)) or 0)
    rows = await session.scalars(
        select(Notification)
        .where(*conditions)
        .order_by(Notification.id.desc())
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    return Page.build(
        [NotificationOut.model_validate(row) for row in rows],
        total,
        pagination.page,
        pagination.size,
    )


@router.post("/me/notifications/read", response_model=Message)
async def read_all(session: SessionDep, user: CurrentUser):
    await session.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    await session.commit()
    return Message(detail="Уведомления прочитаны")


@router.post("/me/notifications/{notification_id}/read", response_model=Message)
async def read_one(session: SessionDep, user: CurrentUser, notification_id: int):
    item = await session.get(Notification, notification_id)
    if item is None or item.user_id != user.id:
        raise NotFoundError("Уведомление не найдено")
    item.read_at = datetime.now(UTC)
    await session.commit()
    return Message(detail="Уведомление прочитано")
