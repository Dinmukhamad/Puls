"""Department world foundation. Read-only for coins, purchases and mission progress."""

from copy import deepcopy

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.core.errors import ConflictError, DomainError
from app.models.city import CityWorld
from app.models.enums import Role
from app.models.user import Group, User
from app.services import city_estate
from app.services.city_estate import district_index, prepared
from app.services.rules import write_audit


def district_of_group(cities):
    return {g: d["id"] for c in cities for d in c["districts"] for g in d["group_ids"]}


def defaults():
    return [
        {"id": key, "name": name, "districts": [
            {"id": f"{key}-team-{i}", "name": f"Район {i}", "group_ids": [], "construction": False}
            for i in range(1, 4)
        ]}
        for key, name in [("support", "Техподдержка"), ("sales", "ОП")]
    ]


async def settings(session):
    row = await session.get(CityWorld, 1)
    cities = deepcopy(row.cities) if row else defaults()
    # Saved before the pilot switch existed: construction stays closed.
    for city in cities:
        for district in city["districts"]:
            district.setdefault("construction", False)
    return {"revision": row.revision if row else 0, "cities": cities}


async def directory(session):
    rows = (await session.execute(
        select(Group, User.full_name)
        .outerjoin(User, User.id == Group.supervisor_id)
        .where(Group.is_active.is_(True)).order_by(Group.name, Group.id)
    )).all()
    return [{"id": g.id, "name": g.name, "supervisor_id": g.supervisor_id,
             "supervisor_name": name} for g, name in rows]


async def world(session, actor):
    config = await settings(session)
    groups = {g["id"]: g for g in await directory(session)}
    cities, home_city, home_district = [], None, None
    for city in config["cities"]:
        districts = []
        for d in city["districts"]:
            own = actor.role == Role.OPERATOR and actor.group_id in d["group_ids"]
            if own:
                home_city, home_district = city["id"], d["id"]
            supervisors = {groups[g]["supervisor_name"] for g in d["group_ids"] if g in groups}
            supervisors.discard(None)
            districts.append({"id": d["id"], "name": d["name"], "mine": own,
                              "assigned": any(g in groups for g in d["group_ids"]),
                              "supervisor": " · ".join(sorted(supervisors)) or None,
                              "construction": d["construction"],
                              "prepared": prepared(int(d["id"].rsplit("-", 1)[1]))})
        cities.append({"id": city["id"], "name": city["name"], "districts": districts})
    return {"revision": config["revision"], "cities": cities,
            "home_city": home_city, "home_district": home_district,
            "currency": "coins", "can_edit": actor.role in (Role.HEAD, Role.ADMIN)}


async def save(session, actor, body):
    old = await settings(session)
    if old["revision"] != body.revision:
        raise ConflictError("Карту уже изменили. Обновите настройки и повторите.")
    cities = [c.model_dump() for c in body.cities]
    previous = {d["id"]: d["construction"] for c in old["cities"] for d in c["districts"]}
    for city in cities:
        for district in city["districts"]:
            if district["construction"] is None:
                district["construction"] = previous.get(district["id"], False)
    old_ids = {d["id"] for c in old["cities"] for d in c["districts"]}
    new_ids = {d["id"] for c in cities for d in c["districts"]}
    if not old_ids <= new_ids:
        raise DomainError("Существующие районы нельзя удалять или менять их идентификатор")
    groups = {g["id"]: g for g in await directory(session)}
    for city in cities:
        assigned_supervisors = set()
        for district in city["districts"]:
            if district["construction"] and not prepared(int(district["id"].rsplit("-", 1)[1])):
                raise DomainError(
                    "Для этого района ещё не подготовлена территория: стройку открыть нельзя"
                )
            if any(g not in groups for g in district["group_ids"]):
                raise DomainError("Выбрана несуществующая или неактивная группа")
            supervisors = {groups[g]["supervisor_id"] for g in district["group_ids"]}
            if len(supervisors) > 1 or None in supervisors:
                raise DomainError("В одном районе должны быть группы одного назначенного супервайзера")
            if supervisors & assigned_supervisors:
                raise DomainError("Группы одного супервайзера в городе должны находиться в одном районе")
            assigned_supervisors |= supervisors
    revision = body.revision + 1
    if body.revision == 0:
        session.add(CityWorld(id=1, revision=revision, cities=cities, updated_by_id=actor.id))
    else:
        result = await session.execute(update(CityWorld).where(
            CityWorld.id == 1, CityWorld.revision == body.revision
        ).values(revision=revision, cities=cities, updated_by_id=actor.id))
        if result.rowcount != 1:
            raise ConflictError("Настройки уже изменили. Обновите страницу.")
    # Operators whose group moved to another district (or out of all of them) take their buildings.
    before, after = district_of_group(old["cities"]), district_of_group(cities)
    moved = [g for g in before.keys() | after.keys() if before.get(g) != after.get(g)]
    if moved:
        await city_estate.reconcile_many(session, await session.scalars(
            select(User.id).where(User.group_id.in_(moved), User.role == Role.OPERATOR)
        ), district_index({"cities": cities}))
    try:
        await write_audit(session, actor_id=actor.id, action="city.world", entity_type="city_world",
                          entity_id="1", payload={"before": old, "revision": revision, "cities": cities})
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise ConflictError("Настройки уже изменили. Обновите страницу.") from None
    return {"revision": revision, "cities": cities}
