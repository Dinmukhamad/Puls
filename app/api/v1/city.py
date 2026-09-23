from fastapi import APIRouter, Query, Response
from sqlalchemy import func, or_, select

from app.core.deps import CurrentUser, LearningEditor, LearningReader, SessionDep
from app.core.errors import NotFoundError
from app.models.city import CityAward
from app.models.enums import Role
from app.models.user import User
from app.schemas.city import ClaimInput, SettingsInput
from app.services import city

router = APIRouter(tags=["Мой город"])


@router.get("/learning/city")
async def own_city(session: SessionDep, user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    return await city.dashboard(session, user)


@router.post("/learning/city/missions/{key}/claim")
async def claim(key: str, body: ClaimInput, session: SessionDep, user: CurrentUser):
    return await city.claim(session, user, key, body.revision)


@router.get("/admin/learning/city/settings")
async def settings(session: SessionDep, user: LearningReader):
    return await city.settings(session)


@router.put("/admin/learning/city/settings")
async def configure(body: SettingsInput, session: SessionDep, user: LearningEditor):
    return await city.save_settings(session, user, body)


@router.get("/admin/learning/city/operators/{user_id}")
async def operator_city(user_id: int, session: SessionDep, user: LearningReader):
    operator = await session.scalar(
        select(User).where(User.id == user_id, User.role == Role.OPERATOR)
    )
    if not operator:
        raise NotFoundError("Оператор не найден")
    return await city.dashboard(session, operator, inspecting=True)


@router.get("/admin/learning/city/participants")
async def participants(
    session: SessionDep,
    user: LearningReader,
    q: str = Query("", max_length=100),
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=50),
):
    conditions = [User.role == Role.OPERATOR, User.is_active.is_(True)]
    if q.strip():
        term = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append(
            or_(
                User.full_name.ilike(f"%{term}%", escape="\\"),
                User.login.ilike(f"%{term}%", escape="\\"),
            )
        )
    total = await session.scalar(select(func.count()).select_from(User).where(*conditions))
    users = list(
        await session.scalars(
            select(User)
            .where(*conditions)
            .order_by(User.full_name, User.id)
            .offset((page - 1) * size)
            .limit(size)
        )
    )
    ids = [u.id for u in users]
    facts = await city.evidence(session, ids)
    awards = {}
    for row in await session.scalars(select(CityAward).where(CityAward.user_id.in_(ids))):
        awards.setdefault(row.user_id, {})[row.mission_key] = row
    config = await city.settings(session)
    items = []
    for operator in users:
        claimed = awards.get(operator.id, {})
        missions = city.mission_rows(config, facts[operator.id], claimed)
        xp = sum(a.xp for a in claimed.values())
        items.append(
            {
                "user_id": operator.id,
                "full_name": operator.full_name,
                "login": operator.login,
                "completed": len(claimed),
                "total": sum(m["enabled"] or m["state"] == "completed" for m in missions),
                "ready": sum(m["state"] == "ready" for m in missions),
                "xp": xp,
                "level": xp // 300 + 1,
                "orders": facts[operator.id]["orders"],
                "appeals": facts[operator.id]["appeals"],
                "missions": [
                    {
                        "key": m["key"],
                        "title": m["title"],
                        "state": m["state"],
                        "current": m["current"],
                        "target": m["target"],
                    }
                    for m in missions
                ],
            }
        )
    return {"items": items, "total": total, "page": page, "size": size}
