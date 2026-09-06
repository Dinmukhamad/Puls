from typing import Literal

from fastapi import APIRouter
from sqlalchemy import delete, func, select, update

from app.core.deps import AdminUser, CurrentUser, PaginationDep, SessionDep, visible_users_filter
from app.core.errors import ConflictError, DomainError, NotFoundError
from app.models.access import AccessPolicy, AccessRule
from app.models.enums import Role
from app.models.user import Group, User
from app.schemas.access import AccessUpdate
from app.schemas.common import Page
from app.services.access import SECTION_BY_CODE, catalog, effective_access
from app.services.rules import write_audit

router = APIRouter(tags=["Доступ к разделам"])


@router.get("/me/access")
async def mine(session: SessionDep, user: CurrentUser):
    scope_groups = (
        list(
            await session.scalars(
                select(Group.id).where(Group.supervisor_id == user.id).order_by(Group.id)
            )
        )
        if user.role == Role.SUPERVISOR
        else []
    )
    return {
        "role": user.role,
        "group_id": user.group_id,
        "scope_groups": scope_groups,
        **await effective_access(session, user),
    }


@router.get("/lookups/users")
async def user_options(
    session: SessionDep,
    actor: CurrentUser,
    pagination: PaginationDep,
    search: str = "",
    role: Role | None = None,
):
    conditions = [
        await visible_users_filter(session, actor),
        User.is_active.is_(True),
        User.full_name.ilike(f"%{search.strip()[:150]}%"),
    ]
    if role:
        conditions.append(User.role == role)
    total = await session.scalar(select(func.count(User.id)).where(*conditions)) or 0
    rows = await session.execute(
        select(User.id, User.full_name, User.role, Group.name)
        .outerjoin(Group, Group.id == User.group_id)
        .where(*conditions)
        .order_by(User.full_name, User.id)
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    return Page.build(
        [
            {
                "id": row.id,
                "user_id": row.id,
                "full_name": row.full_name,
                "role": row.role,
                "group_name": row.name,
            }
            for row in rows
        ],
        total,
        pagination.page,
        pagination.size,
    )


@router.get("/lookups/groups")
async def group_options(session: SessionDep, actor: CurrentUser):
    query = (
        select(Group.id, Group.name).where(Group.is_active.is_(True)).order_by(Group.name, Group.id)
    )
    if actor.role == Role.SUPERVISOR:
        query = query.where(Group.supervisor_id == actor.id)
    elif actor.role == Role.OPERATOR:
        query = query.where(Group.id == actor.group_id)
    return [{"id": row.id, "name": row.name} for row in await session.execute(query)]


@router.get("/admin/access")
async def policy(session: SessionDep, _: AdminUser):
    rules = await session.scalars(select(AccessRule).order_by(AccessRule.id))
    return {
        "revision": await session.scalar(select(AccessPolicy.revision).where(AccessPolicy.id == 1))
        or 0,
        "sections": catalog(),
        "rules": [
            {
                "target_type": row.target_type,
                "target_id": row.target_id,
                "section": row.section,
                "effect": row.effect,
            }
            for row in rules
        ],
    }


@router.get("/admin/access/subjects")
async def subjects(
    session: SessionDep,
    _: AdminUser,
    pagination: PaginationDep,
    kind: Literal["user", "group"] = "user",
    search: str = "",
):
    model = User if kind == "user" else Group
    name = User.full_name if kind == "user" else Group.name
    condition = name.ilike(f"%{search.strip()[:150]}%")
    total = await session.scalar(select(func.count(model.id)).where(condition)) or 0
    rows = await session.scalars(
        select(model)
        .where(condition)
        .order_by(name, model.id)
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    return Page.build(
        [
            {
                "id": str(row.id),
                "name": row.full_name if kind == "user" else row.name,
                "role": row.role if kind == "user" else None,
                "is_active": row.is_active,
            }
            for row in rows
        ],
        total,
        pagination.page,
        pagination.size,
    )


@router.get("/admin/access/users/{user_id}")
async def inspect_user(session: SessionDep, _: AdminUser, user_id: int):
    user = await session.get(User, user_id)
    if user is None:
        raise NotFoundError("Сотрудник не найден")
    return {
        "user_id": user.id,
        "full_name": user.full_name,
        "role": user.role,
        "group_id": user.group_id,
        **await effective_access(session, user),
    }


@router.put("/admin/access")
async def save(session: SessionDep, actor: AdminUser, payload: AccessUpdate):
    if any(change.section not in SECTION_BY_CODE for change in payload.changes):
        raise DomainError("Неизвестный раздел. Обновите справочник доступа.")
    if payload.target_type == "role" and not set(payload.target_ids) <= {
        str(role) for role in Role
    }:
        raise DomainError("Неизвестная роль")
    if payload.target_type in ("user", "group"):
        if any(
            not key.isascii()
            or not key.isdecimal()
            or str(int(key)) != key
            or not 0 < int(key) <= 2147483647
            for key in payload.target_ids
        ):
            raise DomainError("Некорректный получатель")
        model = User if payload.target_type == "user" else Group
        found = await session.scalar(
            select(func.count(model.id)).where(
                model.id.in_([int(key) for key in payload.target_ids])
            )
        )
        if found != len(payload.target_ids):
            raise NotFoundError("Один из выбранных получателей не найден")
    # The revision update serializes concurrent writers and prevents silent overwrites.
    if session.get_bind().dialect.name == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:
        from sqlalchemy.dialects.postgresql import insert
    await session.execute(
        insert(AccessPolicy).values(id=1, revision=0).on_conflict_do_nothing(index_elements=["id"])
    )
    claimed = await session.execute(
        update(AccessPolicy)
        .where(AccessPolicy.id == 1, AccessPolicy.revision == payload.revision)
        .values(revision=AccessPolicy.revision + 1)
    )
    if claimed.rowcount != 1:
        raise ConflictError(
            "Права уже изменены в другом окне. Обновите правила и проверьте изменения."
        )
    conditions = [
        AccessRule.target_type == payload.target_type,
        AccessRule.target_id.in_(payload.target_ids),
        AccessRule.section.in_([change.section for change in payload.changes]),
    ]
    previous = list(await session.scalars(select(AccessRule).where(*conditions)))
    before = [
        {"target_id": row.target_id, "section": row.section, "effect": row.effect}
        for row in previous
    ]
    await session.execute(delete(AccessRule).where(*conditions))
    for key in payload.target_ids:
        for change in payload.changes:
            if change.effect != "inherit":
                session.add(
                    AccessRule(
                        target_type=payload.target_type,
                        target_id=key,
                        section=change.section,
                        effect=change.effect,
                    )
                )
    await write_audit(
        session,
        actor_id=actor.id,
        action="access.update",
        entity_type="access_policy",
        entity_id=1,
        payload={
            "revision": payload.revision + 1,
            "target_type": payload.target_type,
            "target_ids": payload.target_ids,
            "before": before,
            "after": [change.model_dump() for change in payload.changes],
        },
    )
    await session.commit()
    return {"revision": payload.revision + 1, "detail": "Права доступа сохранены"}
