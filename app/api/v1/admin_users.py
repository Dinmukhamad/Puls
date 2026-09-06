"""Управление пользователями и группами."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.deps import (
    AdminUser,
    HeadUser,
    PaginationDep,
    SessionDep,
    StaffUser,
    visible_users_filter,
)
from app.core.developer import protect_developer_account
from app.core.errors import ConflictError, DomainError, NotFoundError, PermissionDeniedError
from app.core.security import hash_password
from app.models.coin import CoinTransaction
from app.models.enums import Role
from app.models.shop import ShopRequest
from app.models.user import Group, User
from app.schemas.cabinet import DashboardOut, TransactionOut
from app.schemas.common import Message, Page
from app.schemas.shop import ShopRequestOut
from app.schemas.user import (
    GroupCreate,
    GroupOut,
    GroupUpdate,
    PasswordReset,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.services import cabinet as cabinet_service
from app.services import coins as coins_service
from app.services import weekly as weekly_service
from app.services.rules import write_audit
from app.services.sessions import revoke_user_sessions

router = APIRouter(prefix="/admin", tags=["Пользователи и группы"])


async def _visible_user(session: SessionDep, actor: User, user_id: int) -> User:
    user = await session.scalar(
        select(User)
        .options(selectinload(User.group))
        .where(User.id == user_id, await visible_users_filter(session, actor))
    )
    if user is None:
        raise NotFoundError("Сотрудник не найден или недоступен")
    return user


async def _check_group(session: SessionDep, group_id: int | None) -> None:
    if group_id is None:
        return
    group = await session.get(Group, group_id)
    if group is None:
        raise DomainError("Выбранная группа не найдена")
    if not group.is_active:
        raise ConflictError("Нельзя назначить сотрудника в архивную группу")


async def _check_supervisor(session: SessionDep, supervisor_id: int | None) -> None:
    if supervisor_id is None:
        return
    user = await session.get(User, supervisor_id)
    if user is None or not user.is_active or user.role != Role.SUPERVISOR:
        raise DomainError("Назначьте активного сотрудника с ролью «Супервайзер»")


async def _group_out(session: SessionDep, group_id: int) -> GroupOut:
    group = await session.scalar(
        select(Group)
        .options(selectinload(Group.supervisor).selectinload(User.group))
        .where(Group.id == group_id)
        .execution_options(populate_existing=True)
    )
    item = GroupOut.model_validate(group)
    item.member_count = int(
        await session.scalar(
            select(func.count(User.id)).where(User.group_id == group_id, User.is_active.is_(True))
        )
        or 0
    )
    item.operator_count = int(
        await session.scalar(
            select(func.count(User.id)).where(
                User.group_id == group_id, User.is_active.is_(True), User.role == Role.OPERATOR
            )
        )
        or 0
    )
    return item


@router.get("/users", response_model=Page[UserOut], summary="Список пользователей")
async def list_users(
    session: SessionDep,
    actor: StaffUser,
    pagination: PaginationDep,
    role: Role | None = None,
    group_id: int | None = None,
    search: Annotated[str | None, Query(description="Поиск по ФИО или логину")] = None,
    only_active: bool = False,
    is_active: bool | None = None,
) -> Page[UserOut]:
    conditions = [await visible_users_filter(session, actor)]
    if role is not None:
        conditions.append(User.role == role)
    if group_id is not None:
        conditions.append(User.group_id == group_id)
    if only_active:
        conditions.append(User.is_active.is_(True))
    if is_active is not None:
        conditions.append(User.is_active == is_active)
    if search:
        pattern = f"%{search.strip()}%"
        conditions.append(User.full_name.ilike(pattern) | User.login.ilike(pattern))

    total = int(await session.scalar(select(func.count(User.id)).where(*conditions)) or 0)
    rows = await session.scalars(
        select(User)
        .options(selectinload(User.group))
        .where(*conditions)
        .order_by(User.full_name, User.id)
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    items = [UserOut.model_validate(row) for row in rows]
    return Page.build(items, total, pagination.page, pagination.size)


@router.get("/users/{user_id}", response_model=UserOut, summary="Карточка сотрудника")
async def get_user(session: SessionDep, actor: StaffUser, user_id: int) -> User:
    return await _visible_user(session, actor, user_id)


@router.get(
    "/users/{user_id}/dashboard", response_model=DashboardOut, summary="Результаты сотрудника"
)
async def user_dashboard(
    session: SessionDep, actor: StaffUser, user_id: int, week_id: int | None = None
) -> DashboardOut:
    user = await _visible_user(session, actor, user_id)
    week = (
        await weekly_service.get_week(session, week_id)
        if week_id is not None
        else await cabinet_service.current_week(session)
    )
    unlocked, total = await cabinet_service.badge_counters(session, user.id)
    return DashboardOut(
        user_id=user.id,
        full_name=user.full_name,
        group_name=user.group.name if user.group else None,
        balance=await cabinet_service.balance_block(session, user=user, week=week),
        week=await cabinet_service.week_block(session, user_id=user.id, week=week),
        badges_unlocked=unlocked,
        badges_total=total,
        my_nominations=await cabinet_service.my_nominations(session, user_id=user.id, week=week),
        pending_shop_requests=await cabinet_service.pending_requests_count(session, user.id),
    )


@router.get(
    "/users/{user_id}/transactions",
    response_model=Page[TransactionOut],
    summary="История коинов сотрудника",
)
async def user_transactions(
    session: SessionDep, actor: StaffUser, user_id: int, pagination: PaginationDep
) -> Page[TransactionOut]:
    await _visible_user(session, actor, user_id)
    condition = CoinTransaction.user_id == user_id
    total = int(await session.scalar(select(func.count(CoinTransaction.id)).where(condition)) or 0)
    rows = await session.execute(
        select(CoinTransaction, User.full_name)
        .outerjoin(User, User.id == CoinTransaction.created_by_id)
        .where(condition)
        .order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc())
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    items = []
    for transaction, author in rows:
        item = TransactionOut.model_validate(transaction)
        item.author_name = author
        items.append(item)
    return Page.build(items, total, pagination.page, pagination.size)


@router.get(
    "/users/{user_id}/purchases",
    response_model=Page[ShopRequestOut],
    summary="Заявки сотрудника в магазине",
)
async def user_purchases(
    session: SessionDep, actor: StaffUser, user_id: int, pagination: PaginationDep
) -> Page[ShopRequestOut]:
    await _visible_user(session, actor, user_id)
    condition = ShopRequest.user_id == user_id
    total = int(await session.scalar(select(func.count(ShopRequest.id)).where(condition)) or 0)
    rows = await session.scalars(
        select(ShopRequest)
        .options(
            selectinload(ShopRequest.item),
            selectinload(ShopRequest.user).selectinload(User.group),
            selectinload(ShopRequest.decided_by).selectinload(User.group),
        )
        .where(condition)
        .order_by(ShopRequest.created_at.desc(), ShopRequest.id.desc())
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    return Page.build(
        [ShopRequestOut.model_validate(row) for row in rows],
        total,
        pagination.page,
        pagination.size,
    )


@router.post(
    "/users",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    summary="Создать пользователя",
)
async def create_user(session: SessionDep, actor: HeadUser, payload: UserCreate) -> User:
    """Создаёт учётную запись и сразу открывает коин-счёт для операторов."""
    if payload.login == settings.DEVELOPER_LOGIN:
        raise PermissionDeniedError(
            "Аккаунт разработчика создаётся только при настройке сервера", code="developer_required"
        )
    if payload.role == Role.ADMIN and actor.role != Role.ADMIN:
        raise ConflictError("Роль администратора назначает только администратор")
    await _check_group(session, payload.group_id)

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
    user = await _visible_user(session, actor, user_id)
    protect_developer_account(actor, user)
    if user.role == Role.ADMIN and actor.role != Role.ADMIN:
        raise PermissionDeniedError("Учётную запись администратора изменяет только администратор")

    changes = payload.model_dump(exclude_unset=True)
    if changes.get("role") == Role.ADMIN and actor.role != Role.ADMIN:
        raise ConflictError("Роль администратора назначает только администратор")
    if user.id == actor.id and changes.get("is_active") is False:
        raise ConflictError("Нельзя отключить собственную учётную запись")
    if user.id == actor.id and "role" in changes and changes["role"] != actor.role:
        raise ConflictError("Нельзя изменять собственную роль")
    if "group_id" in changes and changes["group_id"] != user.group_id:
        await _check_group(session, changes["group_id"])
    if ("role" in changes and changes["role"] != Role.SUPERVISOR) or changes.get(
        "is_active"
    ) is False:
        supervised = await session.scalar(select(Group.id).where(Group.supervisor_id == user.id))
        if supervised is not None:
            raise ConflictError("Сначала переназначьте группы этого супервайзера")

    before = {field: getattr(user, field) for field in changes}
    for field, value in changes.items():
        setattr(user, field, value)
    if changes.get("is_active") is False:
        await revoke_user_sessions(session, user.id)
    try:
        if user.role == Role.OPERATOR:
            await coins_service.get_account(session, user.id)
        await write_audit(
            session,
            actor_id=actor.id,
            action="user.update",
            entity_type="user",
            entity_id=user.id,
            payload=jsonable_encoder({"before": before, "after": changes}),
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError("Этот email уже используется другим сотрудником") from exc
    return await session.scalar(
        select(User)
        .options(selectinload(User.group))
        .where(User.id == user.id)
        .execution_options(populate_existing=True)
    )


@router.post("/users/{user_id}/password", response_model=Message, summary="Сбросить пароль")
async def reset_password(
    session: SessionDep, actor: AdminUser, user_id: int, payload: PasswordReset
) -> Message:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFoundError(f"Пользователь id={user_id} не найден")
    protect_developer_account(actor, user)
    user.hashed_password = hash_password(payload.password)
    await revoke_user_sessions(session, user.id)
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
async def list_groups(session: SessionDep, actor: StaffUser) -> list[GroupOut]:
    query = (
        select(Group)
        .options(selectinload(Group.supervisor).selectinload(User.group))
        .order_by(Group.name, Group.id)
    )
    if actor.role == Role.SUPERVISOR:
        query = query.where(Group.supervisor_id == actor.id)
    elif actor.role == Role.OPERATOR:
        query = query.where(Group.id == actor.group_id)
    groups = list(await session.scalars(query))
    group_ids = [group.id for group in groups]
    counts = await session.execute(
        select(User.group_id, User.role, func.count(User.id))
        .where(User.group_id.in_(group_ids), User.is_active.is_(True))
        .group_by(User.group_id, User.role)
    )
    members: dict[int, int] = {}
    operators: dict[int, int] = {}
    for group_id, role, count in counts:
        members[group_id] = members.get(group_id, 0) + count
        if role == Role.OPERATOR:
            operators[group_id] = count
    items = []
    for group in groups:
        item = GroupOut.model_validate(group)
        item.member_count = members.get(group.id, 0)
        item.operator_count = operators.get(group.id, 0)
        items.append(item)
    return items


@router.post(
    "/groups",
    response_model=GroupOut,
    status_code=status.HTTP_201_CREATED,
    summary="Создать группу",
)
async def create_group(session: SessionDep, actor: HeadUser, payload: GroupCreate) -> GroupOut:
    await _check_supervisor(session, payload.supervisor_id)
    group = Group(**payload.model_dump())
    session.add(group)
    try:
        await session.flush()
        await write_audit(
            session,
            actor_id=actor.id,
            action="group.create",
            entity_type="group",
            entity_id=group.id,
            payload=payload.model_dump(mode="json"),
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError(f"Группа с кодом {payload.code} уже существует") from exc
    return await _group_out(session, group.id)


@router.patch("/groups/{group_id}", response_model=GroupOut, summary="Изменить группу")
async def update_group(
    session: SessionDep, actor: HeadUser, group_id: int, payload: GroupUpdate
) -> GroupOut:
    group = await session.get(Group, group_id)
    if group is None:
        raise NotFoundError(f"Группа id={group_id} не найдена")
    changes = payload.model_dump(exclude_unset=True)
    if "supervisor_id" in changes:
        await _check_supervisor(session, changes["supervisor_id"])
    if changes.get("is_active") is False:
        active_member = await session.scalar(
            select(User.id).where(User.group_id == group_id, User.is_active.is_(True)).limit(1)
        )
        if active_member is not None:
            raise ConflictError("Сначала переведите активных сотрудников в другую группу")
    before = {field: getattr(group, field) for field in changes}
    for field, value in changes.items():
        setattr(group, field, value)
    await write_audit(
        session,
        actor_id=actor.id,
        action="group.update",
        entity_type="group",
        entity_id=group.id,
        payload=jsonable_encoder({"before": before, "after": changes}),
    )
    await session.commit()
    return await _group_out(session, group.id)
