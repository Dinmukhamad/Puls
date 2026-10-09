"""Supervisor accounts own teams; existing group IDs remain the membership authority."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.errors import ConflictError, DomainError, NotFoundError, PermissionDeniedError
from app.models.enums import Role
from app.models.user import Group, User
from app.schemas.user import GroupOut, SupervisorBrief, SupervisorTeamOut
from app.services import city_estate, city_world
from app.services.rules import write_audit


def require_team_manager(actor):
    if actor.role not in (Role.HEAD, Role.ADMIN):
        raise PermissionDeniedError("Операторов назначает только руководитель или администратор")


async def _supervisor(session, supervisor_id, *, active=True):
    user = await session.get(User, supervisor_id, populate_existing=True, with_for_update=True)
    if user is None or user.role != Role.SUPERVISOR:
        raise NotFoundError("Супервайзер не найден")
    if active and not user.is_active:
        raise ConflictError("Нельзя назначить операторов неактивному супервайзеру")
    return user


async def ensure_team(session, supervisor, *, preferred_group_id=None):
    """Caller holds the world lock and supervisor lock (or has just inserted the supervisor).

    Reuse an existing team. Never merge historical groups or reassign another supervisor's group.
    The supervisor owner lock serializes initial team creation even before a world row exists.
    """
    groups = list(
        await session.scalars(
            select(Group)
            .where(Group.supervisor_id == supervisor.id, Group.is_active.is_(True))
            .order_by(Group.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )
    if preferred_group_id is not None:
        group = await session.get(
            Group, preferred_group_id, populate_existing=True, with_for_update=True
        )
        if group is None or not group.is_active:
            raise ConflictError("Выберите действующую команду")
        if group.supervisor_id not in (None, supervisor.id):
            raise ConflictError("Эта команда уже принадлежит другому супервайзеру")
        if group.supervisor_id is None:
            group.supervisor_id = supervisor.id
            await session.flush()
            members = list(
                await session.scalars(
                    select(User.id).where(User.group_id == group.id, User.role == Role.OPERATOR)
                )
            )
            await city_estate.reconcile_many(
                session, members, await city_estate.world_districts(session)
            )
        return group
    if groups:
        return next((group for group in groups if group.id == supervisor.group_id), groups[0])
    base = f"sv-{supervisor.id}"
    code, suffix = base, 0
    while await session.scalar(select(Group.id).where(Group.code == code)) is not None:
        suffix += 1
        code = f"{base}-{suffix}"
    group = Group(
        code=code, name=f"Команда {supervisor.full_name}"[:255], supervisor_id=supervisor.id
    )
    session.add(group)
    await session.flush()
    return group


async def destination(session, supervisor_id, group_id=None):
    """Lock owner/groups before operators; require a destination for multiple legacy teams."""
    supervisor = await _supervisor(session, supervisor_id)
    groups = list(
        await session.scalars(
            select(Group)
            .where(Group.supervisor_id == supervisor.id, Group.is_active.is_(True))
            .order_by(Group.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )
    if group_id is not None:
        group = next((item for item in groups if item.id == group_id), None)
        if group is None:
            raise ConflictError("Выбранная команда не принадлежит этому супервайзеру")
        return group
    if len(groups) > 1:
        raise ConflictError(
            "У супервайзера несколько сохранённых групп. Выберите команду назначения"
        )
    return groups[0] if groups else await ensure_team(session, supervisor)


async def directory(session, actor, *, include_inactive=False):
    if actor.role not in (Role.SUPERVISOR, Role.HEAD, Role.ADMIN):
        raise PermissionDeniedError(
            "Команды доступны супервайзерам, руководителям и администраторам"
        )
    query = select(User).where(User.role == Role.SUPERVISOR).order_by(User.full_name, User.id)
    if actor.role == Role.SUPERVISOR:
        query = query.where(User.id == actor.id)
    if not include_inactive:
        query = query.where(User.is_active.is_(True))
    supervisors = list(await session.scalars(query))
    groups = list(
        await session.scalars(
            select(Group)
            .where(Group.supervisor_id.in_([item.id for item in supervisors]))
            .options(selectinload(Group.supervisor).selectinload(User.group))
            .order_by(Group.name, Group.id)
        )
    )
    counts = (
        await session.execute(
            select(User.group_id, User.role, func.count(User.id))
            .where(User.group_id.in_([item.id for item in groups]), User.is_active.is_(True))
            .group_by(User.group_id, User.role)
        )
    ).all()
    members, operators = {}, {}
    for group_id, role, count in counts:
        members[group_id] = members.get(group_id, 0) + count
        if role == Role.OPERATOR:
            operators[group_id] = count
    result = []
    for supervisor in supervisors:
        own = [group for group in groups if group.supervisor_id == supervisor.id]
        active = sorted((group for group in own if group.is_active), key=lambda group: group.id)
        primary = next(
            (group for group in active if group.id == supervisor.group_id),
            active[0] if active else None,
        )
        items = []
        for group in own:
            item = GroupOut.model_validate(group)
            item.member_count = members.get(group.id, 0)
            item.operator_count = operators.get(group.id, 0)
            items.append(item)
        result.append(
            SupervisorTeamOut(
                supervisor=SupervisorBrief.model_validate(supervisor),
                group_id=primary.id if primary else None,
                groups=items,
                operator_count=sum(operators.get(group.id, 0) for group in own),
            )
        )
    return result


async def assign(session, actor, supervisor_id, operator_ids, *, group_id=None, remove=False):
    require_team_manager(actor)
    await city_world.lock_settings(session)
    if remove:
        await _supervisor(session, supervisor_id, active=False)
        groups = list(
            await session.scalars(
                select(Group)
                .where(Group.supervisor_id == supervisor_id)
                .order_by(Group.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        own = {group.id for group in groups}
        target_group = None
    else:
        target_group = await destination(session, supervisor_id, group_id)
        own = set()
    # Validate the whole selection before membership writes; invalid selections roll back together.
    operators = list(
        await session.scalars(
            select(User)
            .where(User.id.in_(operator_ids))
            .order_by(User.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )
    if len(operators) != len(operator_ids) or any(user.role != Role.OPERATOR for user in operators):
        raise DomainError("Выберите только существующих операторов")
    if any(user.login == settings.DEVELOPER_LOGIN for user in operators):
        raise PermissionDeniedError("Учётную запись разработчика нельзя назначать в команду")
    if remove:
        if any(user.group_id not in own for user in operators):
            raise ConflictError("В выбранной команде нет одного из операторов. Обновите список")
    elif any(not user.is_active for user in operators):
        raise ConflictError("В команду можно назначить только активных операторов")
    previous = {user.id: user.group_id for user in operators}
    destination_id = target_group.id if target_group else None
    changed = [user for user in operators if user.group_id != destination_id]
    for user in changed:
        user.group_id = target_group.id if target_group else None
    await session.flush()
    districts = await city_estate.world_districts(session)
    for user in changed:
        await city_estate.reconcile(session, user, districts)
        await write_audit(
            session,
            actor_id=actor.id,
            action="user.update",
            entity_type="user",
            entity_id=user.id,
            payload={
                "before": {"group_id": previous[user.id]},
                "after": {"group_id": user.group_id},
            },
        )
    await write_audit(
        session,
        actor_id=actor.id,
        action="supervisor_team.remove" if remove else "supervisor_team.assign",
        entity_type="user",
        entity_id=supervisor_id,
        payload={
            "operator_ids": operator_ids,
            "group_id": target_group.id if target_group else None,
            "changed_count": len(changed),
        },
    )
    await session.commit()
    return {
        "supervisor_id": supervisor_id,
        "group_id": target_group.id if target_group else None,
        "removed_count" if remove else "assigned_count": len(changed),
        "operator_ids": operator_ids,
    }
