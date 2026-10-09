"""Управление пользователями и группами."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.deps import (
    DirectoryUser,
    HeadUser,
    PaginationDep,
    SessionDep,
    StaffUser,
    UserCreator,
    ensure_can_manage,
    ensure_can_manage_credentials,
    visible_users_filter,
)
from app.core.developer import protect_developer_account
from app.core.errors import ConflictError, DomainError, NotFoundError, PermissionDeniedError
from app.core.security import hash_password
from app.core.visibility import shop_request_output
from app.models.coin import CoinTransaction
from app.models.driver_auth import TelegramLink
from app.models.enums import USER_VISIBILITY, Role
from app.models.shop import ShopRequest
from app.models.user import Group, User
from app.schemas.cabinet import DashboardOut, TransactionOut
from app.schemas.common import Message, Page
from app.schemas.shop import ShopRequestOut
from app.schemas.user import (
    GroupCreate,
    GroupOut,
    GroupUpdate,
    LoginReset,
    PasswordReset,
    TelegramInvitation,
    TrainingUserCreatedOut,
    TrainingUserOut,
    UserCreate,
    UserCreatedOut,
    UserOut,
    UserUpdate,
    UserUpdatedOut,
)
from app.services import cabinet as cabinet_service
from app.services import city_estate, city_world, supervisor_teams, telegram
from app.services import coins as coins_service
from app.services import weekly as weekly_service
from app.services.rules import write_audit
from app.services.sessions import revoke_user_sessions
from app.services.telegram import revoke_devices

router = APIRouter(prefix="/admin", tags=["Пользователи и группы"])


def user_output(actor, user):
    return (TrainingUserOut if actor.role == Role.TRAINER else UserOut).model_validate(user)


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


@router.get(
    "/users", response_model=Page[UserOut | TrainingUserOut], summary="Список пользователей"
)
async def list_users(
    session: SessionDep,
    actor: DirectoryUser,
    pagination: PaginationDep,
    role: Role | None = None,
    group_id: int | None = None,
    supervisor_id: int | None = None,
    unassigned: bool = False,
    search: Annotated[str | None, Query(description="Поиск по ФИО или логину")] = None,
    only_active: bool = False,
    is_active: bool | None = None,
) -> Page[UserOut]:
    conditions = [await visible_users_filter(session, actor)]
    if role is not None:
        conditions.append(User.role == role)
    if group_id is not None:
        conditions.append(User.group_id == group_id)
    if supervisor_id is not None:
        conditions.append(User.group_id.in_(
            select(Group.id).where(Group.supervisor_id == supervisor_id)
        ))
    if unassigned:
        conditions.append(
            User.group_id.is_(None) | User.group_id.in_(
                select(Group.id).where(Group.supervisor_id.is_(None))
            )
        )
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
    items = [user_output(actor, row) for row in rows]
    return Page.build(items, total, pagination.page, pagination.size)


@router.get(
    "/users/{user_id}", response_model=UserOut | TrainingUserOut, summary="Карточка сотрудника"
)
async def get_user(session: SessionDep, actor: DirectoryUser, user_id: int):
    target = await _visible_user(session, actor, user_id)
    item = user_output(actor, target)
    if isinstance(item, UserOut):
        try:
            await ensure_can_manage_credentials(session, actor, target)
            item.can_manage_credentials = True
        except PermissionDeniedError:
            item.can_manage_credentials = False
    return item


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
    target = await _visible_user(session, actor, user_id)
    if target.role != Role.OPERATOR:
        raise PermissionDeniedError("История коинов доступна только для операторов")
    if actor.role != Role.OPERATOR:
        await ensure_can_manage(session, actor, target)
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
        item.author_name = (transaction.meta or {}).get("actor_name") or author
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
        [shop_request_output(row, actor) for row in rows],
        total,
        pagination.page,
        pagination.size,
    )


@router.post(
    "/users",
    response_model=UserCreatedOut | TrainingUserCreatedOut,
    response_model_exclude_unset=True,
    status_code=status.HTTP_201_CREATED,
    summary="Создать пользователя",
)
async def create_user(
    session: SessionDep, actor: UserCreator, payload: UserCreate, response: Response
):
    """Создаёт учётную запись и сразу открывает коин-счёт для операторов."""
    if payload.login == settings.DEVELOPER_LOGIN:
        raise PermissionDeniedError(
            "Аккаунт разработчика создаётся только при настройке сервера", code="developer_required"
        )
    if payload.role not in USER_VISIBILITY[Role(actor.role)]:
        raise PermissionDeniedError("Вы не можете создавать пользователей с этой ролью")
    if actor.role == Role.TRAINER and (
        payload.group_id is not None or payload.supervisor_id is not None
    ):
        raise PermissionDeniedError("Тренер не назначает группы")
    if payload.supervisor_id is not None and payload.role != Role.OPERATOR:
        raise DomainError("Супервайзеру можно назначить только оператора")
    if payload.role == Role.SUPERVISOR or (
        payload.role == Role.OPERATOR and
        (payload.group_id is not None or payload.supervisor_id is not None)
    ):
        # A new member must not appear after a district transfer captured its operators.
        await city_world.lock_settings(session)
    group_id = payload.group_id
    if payload.supervisor_id is not None:
        supervisor_teams.require_team_manager(actor)
        group_id = (await supervisor_teams.destination(
            session, payload.supervisor_id, payload.group_id
        )).id
    elif "supervisor_id" in payload.model_fields_set and group_id is not None:
        raise DomainError("Выберите супервайзера для команды")
    await _check_group(session, group_id)
    if payload.telegram_username:
        telegram.require_bot()

    user = User(
        login=payload.login,
        full_name=payload.full_name,
        email=payload.email,
        phone=payload.phone,
        role=payload.role,
        group_id=group_id,
        hired_on=payload.hired_on,
        gender=payload.gender,
        hashed_password=hash_password(payload.password),
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError("Логин, email или телефон уже заняты") from exc

    if user.role == Role.SUPERVISOR:
        await supervisor_teams.ensure_team(session, user, preferred_group_id=group_id)

    invitation = None
    if payload.telegram_username:
        invitation = await telegram.prepare_account_invitation(
            session, user.id, payload.telegram_username
        )

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
    created = await session.scalar(
        select(User).options(selectinload(User.group)).where(User.id == user.id)
    )
    output = (
        TrainingUserCreatedOut if actor.role == Role.TRAINER else UserCreatedOut
    ).model_validate(created)
    if invitation:
        response.headers["Cache-Control"] = "no-store"
        output.telegram_invitation = TelegramInvitation.model_validate(invitation)
    return output


@router.get("/users/{user_id}/telegram", summary="Telegram сотрудника")
async def user_telegram(session: SessionDep, actor: HeadUser, user_id: int, response: Response):
    if actor.role not in (Role.HEAD, Role.ADMIN):
        raise PermissionDeniedError("Недостаточно прав для этой операции", code="role_required")
    await _visible_user(session, actor, user_id)
    response.headers["Cache-Control"] = "no-store"
    return await telegram.status(session, user_id)


@router.patch(
    "/users/{user_id}",
    response_model=UserUpdatedOut,
    response_model_exclude_unset=True,
    summary="Изменить пользователя",
)
async def update_user(
    session: SessionDep, actor: HeadUser, user_id: int, payload: UserUpdate, response: Response
) -> UserUpdatedOut:
    if payload.model_fields_set & {"group_id", "supervisor_id", "role", "is_active"}:
        # Team membership and world assignments share the configuration-before-user lock order.
        await city_world.lock_settings(session)
    resolved_group = None
    supervisor_requested = "supervisor_id" in payload.model_fields_set
    if supervisor_requested:
        supervisor_teams.require_team_manager(actor)
        if payload.supervisor_id is not None:
            # Destination ownership is locked before the operator, matching bulk assignments.
            resolved_group = await supervisor_teams.destination(
                session, payload.supervisor_id, payload.group_id
            )
        elif payload.group_id is not None:
            raise DomainError("Выберите супервайзера для команды")
    if payload.role == Role.SUPERVISOR and payload.group_id is not None:
        # A promotion can adopt an unowned legacy group. Lock it before the operator,
        # matching coin operations that lock groups before their selected members.
        await session.get(Group, payload.group_id, populate_existing=True, with_for_update=True)
    user = await _visible_user(session, actor, user_id)
    # Та же блокировка пользователя, что при подтверждении и привязке Telegram.
    # Смена номера не должна оставлять доверие, записанное параллельным запросом.
    await session.refresh(user, with_for_update=True)
    protect_developer_account(actor, user)
    if user.role == Role.ADMIN and actor.role != Role.ADMIN:
        raise PermissionDeniedError("Учётную запись администратора изменяет только администратор")

    changes = payload.model_dump(exclude_unset=True)
    changes.pop("supervisor_id", None)
    if supervisor_requested:
        if payload.supervisor_id is not None and changes.get("role", user.role) != Role.OPERATOR:
            raise DomainError("Супервайзеру можно назначить только оператора")
        changes["group_id"] = resolved_group.id if resolved_group else None
    promoting = changes.get("role") == Role.SUPERVISOR and user.role != Role.SUPERVISOR
    if promoting and "group_id" not in changes:
        changes["group_id"] = None
    telegram_requested = "telegram_username" in changes
    telegram_username = changes.pop("telegram_username", None)
    if "role" in changes and changes["role"] not in USER_VISIBILITY[Role(actor.role)]:
        raise PermissionDeniedError("Вы не можете назначать эту роль")
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

    invitation = None
    before = {field: getattr(user, field) for field in changes}
    audit_changes = dict(changes)
    if telegram_requested:
        if user.id == actor.id:
            raise PermissionDeniedError(
                "Свой Telegram меняется в профиле, с подтверждением паролем",
                code="self_service_required",
            )
        await ensure_can_manage_credentials(session, actor, user)
        link = await session.get(TelegramLink, user.id)
        previous = (link.pending_username or link.username) if link else None
        changed = telegram_username != (previous.lower() if previous else None)
        # У личного чата может не быть username; явное очищение также отзывает ссылку.
        clearing = telegram_username is None and link and (link.chat_id or link.link_hash)
        if changed or clearing:
            if telegram_username:
                invitation = await telegram.prepare_account_invitation(
                    session, user.id, telegram_username
                )
            else:
                await telegram.clear_account_binding(session, user.id)
            before["telegram_username"] = previous
            audit_changes["telegram_username"] = telegram_username
    if "phone" in changes and changes["phone"] != user.phone:
        await revoke_devices(session, user.id)
    for field, value in changes.items():
        setattr(user, field, value)
    if promoting:
        await session.flush()
        await supervisor_teams.ensure_team(session, user,
                                           preferred_group_id=changes.get("group_id"))
    if changes.get("is_active") is False:
        await revoke_user_sessions(session, user.id)
    if changes.keys() & {"group_id", "is_active", "role"}:
        # A transfer or a deactivation is one operation: personal buildings leave the old district.
        await city_estate.reconcile(session, user)
    try:
        if user.role == Role.OPERATOR:
            await coins_service.get_account(session, user.id)
        await write_audit(
            session,
            actor_id=actor.id,
            action="user.update",
            entity_type="user",
            entity_id=user.id,
            payload=jsonable_encoder({"before": before, "after": audit_changes}),
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError("Этот email или телефон уже используется другим сотрудником") from exc
    updated = await session.scalar(
        select(User)
        .options(selectinload(User.group))
        .where(User.id == user.id)
        .execution_options(populate_existing=True)
    )
    output = UserUpdatedOut.model_validate(updated)
    if invitation:
        response.headers["Cache-Control"] = "no-store"
        output.telegram_invitation = TelegramInvitation.model_validate(invitation)
    return output


@router.post("/users/{user_id}/login", response_model=UserOut, summary="Сменить логин сотруднику")
async def reset_login(
    session: SessionDep, actor: StaffUser, user_id: int, payload: LoginReset
) -> User:
    """
    Меняет логин сотрудника.

    Права те же, что и у сброса пароля. Сеансы не завершаются: пароль и
    идентификатор пользователя не менялись, поэтому открытые входы остаются
    рабочими - сотрудник просто будет вводить новый логин в следующий раз.
    """
    user = await _visible_user(session, actor, user_id)
    protect_developer_account(actor, user)
    await ensure_can_manage_credentials(session, actor, user)

    previous = user.login
    if payload.login == previous:
        return await _visible_user(session, actor, user_id)

    # Вход чувствителен к регистру: пара «Ivan» и «ivan» ломала бы вход обоим.
    clash = await session.scalar(
        select(User.id).where(func.lower(User.login) == payload.login.lower(), User.id != user.id)
    )
    if clash is not None:
        raise ConflictError("Такой логин уже занят")

    user.login = payload.login
    await write_audit(
        session,
        actor_id=actor.id,
        action="user.login_reset",
        entity_type="user",
        entity_id=user.id,
        payload={"from": previous, "to": payload.login},
    )
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError("Такой логин уже занят") from exc

    return await _visible_user(session, actor, user_id)


@router.post("/users/{user_id}/password", response_model=Message, summary="Сбросить пароль")
async def reset_password(
    session: SessionDep, actor: StaffUser, user_id: int, payload: PasswordReset
) -> Message:
    """
    Задаёт сотруднику новый пароль.

    Кто кому: администратор - любому, руководитель - супервайзерам и
    операторам, супервайзер - операторам своих групп. Все сеансы сотрудника
    завершаются: прежний пароль больше не действует.
    """
    user = await _visible_user(session, actor, user_id)
    protect_developer_account(actor, user)
    await ensure_can_manage_credentials(session, actor, user)
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
    await city_world.lock_settings(session)
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
    membership_changed = payload.model_fields_set & {"supervisor_id", "is_active"}
    if membership_changed:
        # Match world saves: configuration before members, so assignments and transfers serialize.
        await city_world.lock_settings(session)
    group = await session.get(Group, group_id, populate_existing=True, with_for_update=True)
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
    if membership_changed:
        await session.flush()
        members = await session.scalars(
            select(User.id).where(User.group_id == group_id, User.role == Role.OPERATOR)
        )
        await city_estate.reconcile_many(
            session, members, await city_estate.world_districts(session)
        )
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
