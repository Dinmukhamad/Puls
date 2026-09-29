"""The group city: quarters a supervisor's group builds together from its members' real work.

Nothing is stored: points are counted from the same evidence as the missions (and passed learning
materials), so they cannot be forged or double counted. Operators see only coarse stages of the
group's quarters and their own points, never another operator's; staff see the breakdown.
"""

from sqlalchemy import func, select

from app.models.city import CityAward, CityQuest
from app.models.enums import Role
from app.models.learning import LearningAward
from app.models.user import Group, User
from app.services.city import evidence

# Points for every piece of work, as the operator's guide explains them.
POINTS = {"missions": 20, "materials": 10, "quests": 5, "orders": 3, "appeals": 3, "closed": 5}
# The quarters, built one after another; `cost` is the points each one takes.
PROJECTS = [
    {"key": f"site-{i}", "name": name, "cost": cost}
    for i, (name, cost) in enumerate(
        [
            ("Квартал «Набережный»", 150),
            ("Квартал «Солнечный»", 300),
            ("Квартал «Парковый»", 500),
            ("Квартал «Деловой»", 800),
            ("Квартал «Центральный»", 1200),
            ("Квартал «Горизонт»", 1800),
        ]
    )
]
STAGES = ("planned", "foundation", "frame", "floors", "done")
# Below this many members a stage change would give away one person's work: only finished
# quarters are shown, the one being built stays at its foundation.
MIN_MEMBERS = 3


async def contributions(session, user_ids, weights=None):
    """Every operator's work by kind and points; `weights` are the points per kind (settings)."""
    weights = weights or POINTS
    ids = list(user_ids)
    facts = await evidence(session, ids)
    missions = dict(
        (
            await session.execute(
                select(CityAward.user_id, func.count())
                .where(CityAward.user_id.in_(ids))
                .group_by(CityAward.user_id)
            )
        ).all()
    )
    materials = dict(
        (
            await session.execute(
                select(LearningAward.user_id, func.count())
                .where(LearningAward.user_id.in_(ids))
                .group_by(LearningAward.user_id)
            )
        ).all()
    )
    quests = dict(
        (
            await session.execute(
                select(CityQuest.user_id, func.count())
                .where(CityQuest.user_id.in_(ids), CityQuest.correct.is_(True))
                .group_by(CityQuest.user_id)
            )
        ).all()
    )
    result = {}
    for uid in ids:
        parts = {
            "missions": missions.get(uid, 0),
            "materials": materials.get(uid, 0),
            "quests": quests.get(uid, 0),
            "orders": int(facts[uid]["orders"] or 0),
            "appeals": facts[uid]["appeals"],
            "closed": facts[uid]["closed"],
        }
        result[uid] = {**parts, "points": sum(weights[k] * v for k, v in parts.items())}
    return result


def project_rows(total, projects=PROJECTS, *, exact=False, small=False):
    """Every quarter's stage for `total` points; `exact` adds the points (staff only)."""
    rows, left, current = [], total, False
    for project in projects:
        cost = project["cost"]
        if left >= cost:
            stage, progress, left = "done", cost, left - cost
        elif not current:
            current, progress = True, left
            stage = "foundation" if small else STAGES[1 + min(2, left * 3 // cost)]
            left = 0
        else:
            stage, progress = "planned", 0
        row = {"key": project["key"], "name": project["name"], "stage": stage}
        if exact:
            row |= {"points": progress, "cost": cost}
        rows.append(row)
    return rows


async def economy(session):
    from app.services.city_economy import economy as load

    return await load(session)


async def members_of(session, group_id):
    return list(
        await session.scalars(
            select(User)
            .where(
                User.group_id == group_id,
                User.role == Role.OPERATOR,
                User.is_active.is_(True),
            )
            .order_by(User.full_name, User.id)
        )
    )


async def group_city(session, user):
    """What an operator (or staff inspecting one) sees of the operator's group."""
    if user.role != Role.OPERATOR or user.group_id is None:
        return None
    group = await session.get(Group, user.group_id)
    if not group or not group.is_active:
        return None
    config = await economy(session)
    members = await members_of(session, group.id)
    points = await contributions(session, [m.id for m in members] or [user.id], config["points"])
    total = sum(p["points"] for p in points.values())
    small = len(members) < MIN_MEMBERS
    mine = (
        points.get(user.id) or (await contributions(session, [user.id], config["points"]))[user.id]
    )
    return {
        "name": group.name,
        "small": small,
        "projects": project_rows(total, config["projects"], small=small),
        "mine": mine,
        "points": config["points"],
    }


async def groups_overview(session, actor):
    """Staff: every visible group's quarters with points, and each member's contribution."""
    query = select(Group).where(Group.is_active.is_(True)).order_by(Group.name, Group.id)
    if actor.role == Role.SUPERVISOR:
        query = query.where(Group.supervisor_id == actor.id)
    config = await economy(session)
    items = []
    for group in await session.scalars(query):
        members = await members_of(session, group.id)
        points = await contributions(session, [m.id for m in members], config["points"])
        total = sum(p["points"] for p in points.values())
        items.append(
            {
                "id": group.id,
                "name": group.name,
                "total": total,
                "projects": project_rows(total, config["projects"], exact=True),
                "members": [
                    {"user_id": m.id, "full_name": m.full_name, **points[m.id]} for m in members
                ],
            }
        )
    return {"items": items, "points": config["points"]}
