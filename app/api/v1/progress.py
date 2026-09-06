from datetime import UTC, datetime

from fastapi import APIRouter
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.core.deps import (
    AdminUser,
    CurrentUser,
    HeadUser,
    PaginationDep,
    SessionDep,
    StaffUser,
    visible_users_filter,
)
from app.core.errors import ConflictError, DomainError, NotFoundError
from app.models.progress import Notification, XpEntry, XpLevel
from app.models.user import User
from app.schemas.common import Message, Page
from app.schemas.progress import (
    NotificationOut,
    XpEntryOut,
    XpGrant,
    XpLevelIn,
    XpLevelOut,
    XpSummary,
)
from app.services.progress import grant_xp, xp_summary
from app.services.rules import write_audit

router = APIRouter(tags=["Опыт и уведомления"])


@router.get("/me/xp", response_model=XpSummary)
async def my_progress(session: SessionDep, user: CurrentUser):
    return await xp_summary(session, user.id)


@router.get("/admin/xp/users/{user_id}", response_model=XpSummary)
async def user_progress(session: SessionDep, actor: StaffUser, user_id: int):
    visible = await visible_users_filter(session, actor)
    if await session.scalar(select(User.id).where(User.id == user_id, visible)) is None:
        raise NotFoundError("Сотрудник не найден")
    return await xp_summary(session, user_id)


async def _entries(session: SessionDep, conditions: list, pagination: PaginationDep):
    total = int(
        await session.scalar(
            select(func.count(XpEntry.id)).join(User, User.id == XpEntry.user_id).where(*conditions)
        )
        or 0
    )
    rows = await session.execute(
        select(XpEntry, User.full_name)
        .join(User, User.id == XpEntry.user_id)
        .where(*conditions)
        .order_by(XpEntry.id.desc())
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    items = []
    for entry, name in rows:
        item = XpEntryOut.model_validate(entry)
        item.full_name = name
        items.append(item)
    return Page.build(items, total, pagination.page, pagination.size)


@router.get("/me/xp/history", response_model=Page[XpEntryOut])
async def my_history(session: SessionDep, user: CurrentUser, pagination: PaginationDep):
    return await _entries(session, [XpEntry.user_id == user.id], pagination)


@router.get("/admin/xp", response_model=Page[XpEntryOut])
async def history(
    session: SessionDep, actor: StaffUser, pagination: PaginationDep, user_id: int | None = None
):
    conditions = [await visible_users_filter(session, actor)]
    if user_id is not None:
        conditions.append(XpEntry.user_id == user_id)
    return await _entries(session, conditions, pagination)


@router.post("/admin/xp/grant", response_model=Message)
async def grant(session: SessionDep, actor: HeadUser, payload: XpGrant):
    user = await session.get(User, payload.user_id)
    if user is None or not user.is_active:
        raise NotFoundError("Активный сотрудник не найден")
    entry = await grant_xp(
        session,
        user_id=user.id,
        amount=payload.amount,
        reason=payload.reason.strip(),
        source="manual",
        key=f"manual:{actor.id}:{payload.request_id}",
        author_id=actor.id,
    )
    if entry:
        await write_audit(
            session,
            actor_id=actor.id,
            action="xp.grant",
            entity_type="user",
            entity_id=user.id,
            payload={"amount": payload.amount, "reason": payload.reason},
        )
    await session.commit()
    return Message(detail="XP начислен" if entry else "Начисление уже выполнено")


@router.get("/admin/xp/levels", response_model=list[XpLevelOut])
async def levels(session: SessionDep, _: StaffUser):
    return list(await session.scalars(select(XpLevel).order_by(XpLevel.min_xp)))


async def _save_level(session, actor, payload, level=None):
    if level is not None and level.min_xp == 0 and (payload.min_xp != 0 or not payload.is_active):
        raise DomainError("Стартовый уровень с порогом 0 XP должен оставаться активным")
    if level is None:
        level = XpLevel()
        session.add(level)
    before = {key: getattr(level, key, None) for key in type(payload).model_fields}
    for key, value in payload.model_dump().items():
        setattr(level, key, value)
    try:
        await session.flush()
        await write_audit(
            session,
            actor_id=actor.id,
            action="xp.level_update",
            entity_type="xp_level",
            entity_id=level.id,
            payload={"before": before, "after": payload.model_dump()},
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError("Уровень с таким порогом XP уже существует") from exc
    return level


@router.post("/admin/xp/levels", response_model=XpLevelOut, status_code=201)
async def create_level(session: SessionDep, actor: AdminUser, payload: XpLevelIn):
    return await _save_level(session, actor, payload)


@router.put("/admin/xp/levels/{level_id}", response_model=XpLevelOut)
async def edit_level(session: SessionDep, actor: AdminUser, level_id: int, payload: XpLevelIn):
    level = await session.get(XpLevel, level_id)
    if level is None:
        raise NotFoundError("Уровень не найден")
    return await _save_level(session, actor, payload, level)


@router.get("/me/notifications", response_model=Page[NotificationOut])
async def notifications(
    session: SessionDep, user: CurrentUser, pagination: PaginationDep, unread: bool = False
):
    conditions = [Notification.user_id == user.id]
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
