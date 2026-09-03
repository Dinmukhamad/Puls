"""Управление пользователями и группами."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.core.deps import (
    AdminUser,
    HeadUser,
    PaginationDep,
    SessionDep,
    StaffUser,
    visible_users_filter,
)
from app.core.errors import ConflictError, NotFoundError
from app.core.security import hash_password
from app.models.enums import Role
from app.models.user import Group, User
from app.schemas.common import Message, Page
from app.schemas.user import (
    GroupCreate,
    GroupOut,
    GroupUpdate,
    PasswordReset,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.services import coins as coins_service
from app.services.rules import write_audit

router = APIRouter(prefix="/admin", tags=["Пользователи и группы"])


@router.get("/users", response_model=Page[UserOut], summary="Список пользователей")
async def list_users(
    session: SessionDep,
    actor: StaffUser,
    pagination: PaginationDep,
    role: Role | None = None,
    group_id: int | None = None,
    search: Annotated[str | None, Query(description="Поиск по ФИО или логину")] = None,
    only_active: bool = False,
) -> Page[UserOut]:
    conditions = [await visible_users_filter(session, actor)]
    if role is not None:
        conditions.append(User.role == role)
    if group_id is not None:
        conditions.append(User.group_id == group_id)
    if only_active:
        conditions.append(User.is_active.is_(True))
    if search:
        pattern = f"%{search.strip()}%"
        conditions.append(User.full_name.ilike(pattern) | User.login.ilike(pattern))

    total = int(await session.scalar(select(func.count(User.id)).where(*conditions)) or 0)
    rows = await session.scalars(
        select(User)
        .options(selectinload(User.group))
        .where(*conditions)
        .order_by(User.full_name)
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    items = [UserOut.model_validate(row) for row in rows]
    return Page.build(items, total, pagination.page, pagination.size)


@router.post(
    "/users",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    summary="Создать пользователя",
)
async def create_user(
    session: SessionDep, actor: HeadUser, payload: UserCreate
) -> User:
    """Создаёт учётную запись и сразу открывает коин-счёт для операторов."""
    if payload.role == Role.ADMIN and actor.role != Role.ADMIN:
        raise ConflictError("Роль администратора назначает только администратор")

    user = User(
        login=payload.login,
        full_name=payload.full_name,
        email=payload.email,
        role=payload.role,
        group_id=payload.group_id,
        hired_on=payload.hired_on,
        hashed_password=hash_password(payload.password),
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError("Логин или email уже заняты") from exc

    if user.role == Role.OPERATOR:
        await coins_service.get_account(session, user.id)

    await write_audit(
        session,
        actor_id=actor.id,
        action="user.create",
        entity_type="user",
        entity_id=user.id,
        payload={"login": user.login, "role": str(user.role)},
    )
    await session.commit()
    return await session.scalar(
        select(User).options(selectinload(User.group)).where(User.id == user.id)
    )


@router.patch("/users/{user_id}", response_model=UserOut, summary="Изменить пользователя")
async def update_user(
    session: SessionDep, actor: HeadUser, user_id: int, payload: UserUpdate
) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFoundError(f"Пользователь id={user_id} не найден")

    changes = payload.model_dump(exclude_unset=True)
    if changes.get("role") == Role.ADMIN and actor.role != Role.ADMIN:
        raise ConflictError("Роль администратора назначает только администратор")
    if user.id == actor.id and changes.get("is_active") is False:
        raise ConflictError("Нельзя отключить собственную учётную запись")

    for field, value in changes.items():
        setattr(user, field, value)

    await write_audit(
        session,
        actor_id=actor.id,
        action="user.update",
        entity_type="user",
        entity_id=user.id,
        payload=changes,
    )
    await session.commit()
    return await session.scalar(
        select(User).options(selectinload(User.group)).where(User.id == user.id)
    )


@router.post(
    "/users/{user_id}/password", response_model=Message, summary="Сбросить пароль"
)
async def reset_password(
    session: SessionDep, actor: AdminUser, user_id: int, payload: PasswordReset
) -> Message:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFoundError(f"Пользователь id={user_id} не найден")
    user.hashed_password = hash_password(payload.password)
    await write_audit(
        session,
        actor_id=actor.id,
        action="user.password_reset",
        entity_type="user",
        entity_id=user.id,
    )
    await session.commit()
    return Message(detail=f"Пароль пользователя {user.full_name} обновлён")


@router.get("/groups", response_model=list[GroupOut], summary="Список групп")
async def list_groups(session: SessionDep, _: StaffUser) -> list[Group]:
    return list(
        await session.scalars(
            select(Group).options(selectinload(Group.supervisor)).order_by(Group.name)
        )
    )


@router.post(
    "/groups",
    response_model=GroupOut,
    status_code=status.HTTP_201_CREATED,
    summary="Создать группу",
)
async def create_group(
    session: SessionDep, actor: HeadUser, payload: GroupCreate
) -> Group:
    group = Group(**payload.model_dump())
    session.add(group)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError(f"Группа с кодом {payload.code} уже существует") from exc
    return await session.scalar(
        select(Group).options(selectinload(Group.supervisor)).where(Group.id == group.id)
    )


@router.patch("/groups/{group_id}", response_model=GroupOut, summary="Изменить группу")
async def update_group(
    session: SessionDep, actor: HeadUser, group_id: int, payload: GroupUpdate
) -> Group:
    group = await session.get(Group, group_id)
    if group is None:
        raise NotFoundError(f"Группа id={group_id} не найдена")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(group, field, value)
    await session.commit()
    return await session.scalar(
        select(Group).options(selectinload(Group.supervisor)).where(Group.id == group.id)
    )
