"""City ownership and supervisor districts, with groups derived from the staff directory."""

from collections import defaultdict
from copy import deepcopy

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.core.errors import ConflictError, DomainError, PermissionDeniedError
from app.models.city import CityWorld
from app.models.enums import Role
from app.models.user import Group, User
from app.services import city_estate
from app.services.city_estate import district_index, prepared
from app.services.city_land import has_land
from app.services.rules import write_audit


def district_of_group(cities):
    return {g: d["id"] for c in cities for d in c["districts"] for g in d["group_ids"]}


def defaults():
    return [
        {"id": key, "name": name, "head_id": None, "districts": [
            {"id": f"{key}-team-{i}", "name": f"Район {i}", "supervisor_id": None,
             "group_ids": [], "construction": False}
            for i in range(1, 4)
        ]}
        for key, name in [("support", "Техподдержка"), ("sales", "ОП")]
    ]


async def lock_settings(session):
    """Lock existing settings before directory changes; use world -> operator lock order.

    A first save still uses the singleton insert constraint to arbitrate revision zero. Readers
    never acquire this lock, so purchases can finish with the old committed map and be reconciled
    by a settings writer before its transaction commits.
    """
    return await session.scalar(
        select(CityWorld).where(CityWorld.id == 1).with_for_update()
        .execution_options(populate_existing=True)
    )


async def _raw_settings(session):
    row = await session.scalar(
        select(CityWorld).where(CityWorld.id == 1)
        .execution_options(populate_existing=True)
    )
    return {"revision": row.revision if row else 0,
            "cities": deepcopy(row.cities) if row else defaults()}


async def directory(session):
    """The legacy group directory remains available for older editors."""
    rows = (await session.execute(
        select(Group, User.full_name)
        .outerjoin(User, User.id == Group.supervisor_id)
        .where(Group.is_active.is_(True)).order_by(Group.name, Group.id)
        .execution_options(populate_existing=True)
    )).all()
    return [{"id": g.id, "name": g.name, "supervisor_id": g.supervisor_id,
             "supervisor_name": name} for g, name in rows]


async def _assignment_directory(session):
    groups = await directory(session)
    supervisors = (await session.execute(
        select(User.id, User.full_name)
        .where(User.role == Role.SUPERVISOR, User.is_active.is_(True))
        .order_by(User.full_name, User.id)
    )).all()
    return groups, [{"id": user_id, "name": name} for user_id, name in supervisors]


def _groups_by_supervisor(groups, supervisors):
    active = {s["id"] for s in supervisors}
    grouped = defaultdict(list)
    for group in groups:
        if group["supervisor_id"] in active:
            grouped[group["supervisor_id"]].append(group["id"])
    return grouped


def _resolve_cities(raw, groups, supervisors):
    """Expand unambiguous legacy assignments without choosing between conflicting districts.

    Old saves could put the same supervisor in both cities, or contain stale/mixed groups. Those
    districts keep their stored teams until an editor deliberately supplies a valid assignment.
    Inferring only a globally unique claim also prevents newly created groups from overlapping a
    second legacy district.
    """
    cities = deepcopy(raw)
    group_map = {g["id"]: g for g in groups}
    active = {s["id"] for s in supervisors}
    grouped = _groups_by_supervisor(groups, supervisors)
    claims = defaultdict(set)
    candidates = {}
    canonical_groups = set()
    for city in cities:
        city.setdefault("head_id", None)
        for district in city["districts"]:
            district.setdefault("construction", False)
            district.setdefault("group_ids", [])
            if "supervisor_id" in district:
                supervisor = district["supervisor_id"]
                if supervisor in active:
                    claims[supervisor].add(district["id"])
                    canonical_groups.update(grouped[supervisor])
                continue
            assigned = district["group_ids"]
            owners = {group_map[g]["supervisor_id"] for g in assigned if g in group_map}
            for supervisor in owners & active:
                claims[supervisor].add(district["id"])
            if (assigned and all(g in group_map for g in assigned)
                    and len(owners) == 1 and owners <= active):
                candidates[district["id"]] = next(iter(owners))
    for city in cities:
        for district in city["districts"]:
            if "supervisor_id" in district:
                district["group_ids"] = list(grouped.get(district["supervisor_id"], []))
            else:
                supervisor = candidates.get(district["id"])
                if supervisor is not None and claims[supervisor] == {district["id"]}:
                    district["supervisor_id"] = supervisor
                    district["group_ids"] = list(grouped[supervisor])
                else:
                    district["supervisor_id"] = None
                    if district["group_ids"]:
                        district["legacy_assignment"] = True
                    # A later group reassignment to a canonical supervisor follows that district.
                    # Retain raw assignments; archived groups have no access and routing is unique.
                    district["group_ids"] = [
                        g for g in district["group_ids"]
                        if g in group_map and g not in canonical_groups
                    ]
    return cities


async def settings(session):
    config = await _raw_settings(session)
    groups, supervisors = await _assignment_directory(session)
    return {**config, "cities": _resolve_cities(config["cities"], groups, supervisors)}


def _editable(config, actor):
    if not actor.is_active:
        return set()
    if actor.role == Role.ADMIN:
        return {c["id"] for c in config["cities"]}
    if actor.role == Role.HEAD:
        return {c["id"] for c in config["cities"] if c.get("head_id") == actor.id}
    return set()


async def editable_city_ids(session, actor):
    """The same ownership boundary is used by map edits and district project management."""
    return _editable(await _raw_settings(session), actor)


async def editor_data(session, actor):
    config = await _raw_settings(session)
    groups, supervisors = await _assignment_directory(session)
    config["cities"] = _resolve_cities(config["cities"], groups, supervisors)
    heads = (await session.execute(
        select(User.id, User.full_name)
        .where(User.role == Role.HEAD, User.is_active.is_(True))
        .order_by(User.full_name, User.id)
    )).all()
    counts = dict((await session.execute(
        select(User.group_id, func.count(User.id))
        .where(User.role == Role.OPERATOR, User.is_active.is_(True),
               User.group_id.in_([g["id"] for g in groups]))
        .group_by(User.group_id)
    )).all())
    for supervisor in supervisors:
        teams = [g for g in groups if g["supervisor_id"] == supervisor["id"]]
        supervisor.update(group_ids=[g["id"] for g in teams],
                          group_names=[g["name"] for g in teams],
                          operator_count=sum(counts.get(g["id"], 0) for g in teams))
    editable = _editable(config, actor)
    return {**config, "groups": groups,
            "heads": [{"id": user_id, "name": name} for user_id, name in heads],
            "supervisors": supervisors, "can_edit": bool(editable),
            "can_manage_heads": actor.is_active and actor.role == Role.ADMIN,
            "editable_city_ids": [c["id"] for c in config["cities"] if c["id"] in editable]}


async def world(session, actor):
    config = await _raw_settings(session)
    groups, supervisors = await _assignment_directory(session)
    config["cities"] = _resolve_cities(config["cities"], groups, supervisors)
    group_map = {g["id"]: g for g in groups}
    supervisor_names = {s["id"]: s["name"] for s in supervisors}
    cities, home_city, home_district = [], None, None
    for city in config["cities"]:
        districts = []
        for district in city["districts"]:
            own = (actor.is_active and actor.role == Role.OPERATOR
                   and actor.group_id in district["group_ids"])
            if own:
                home_city, home_district = city["id"], district["id"]
            names = {group_map[g]["supervisor_name"] for g in district["group_ids"]
                     if g in group_map}
            names.discard(None)
            supervisor = supervisor_names.get(district["supervisor_id"])
            districts.append({"id": district["id"], "name": district["name"], "mine": own,
                              "assigned": supervisor is not None or bool(names),
                              "supervisor": supervisor or " · ".join(sorted(names)) or None,
                              "construction": district["construction"],
                              "prepared": prepared(district["id"])})
        cities.append({"id": city["id"], "name": city["name"], "districts": districts})
    return {"revision": config["revision"], "cities": cities,
            "home_city": home_city, "home_district": home_district,
            "currency": "coins", "can_edit": bool(_editable(config, actor))}


def _unchanged_city(city, previous, raw_previous):
    """Compare full payloads without interpreting a foreign city's legacy null as clear."""
    if city.name != previous["name"]:
        return False
    if "head_id" in city.model_fields_set and city.head_id != previous["head_id"]:
        return False
    if [d.id for d in city.districts] != [d["id"] for d in previous["districts"]]:
        return False
    raw_districts = {d["id"]: d for d in raw_previous["districts"]}
    for district, old in zip(city.districts, previous["districts"], strict=True):
        if district.name != old["name"]:
            return False
        if district.construction is not None and district.construction != old["construction"]:
            return False
        if "supervisor_id" in district.model_fields_set:
            if district.supervisor_id != old["supervisor_id"]:
                return False
        elif ("group_ids" in district.model_fields_set and district.group_ids not in (
                old["group_ids"], raw_districts[district.id].get("group_ids", [])
        )):
            return False
    return True


def _infer_supervisor(assigned, groups, active):
    if not assigned:
        return None
    if any(g not in groups for g in assigned):
        raise DomainError("Выбрана несуществующая или неактивная группа")
    owners = {groups[g]["supervisor_id"] for g in assigned}
    if len(owners) != 1 or not owners <= active:
        raise DomainError("В одном районе должны быть группы одного активного супервайзера")
    return next(iter(owners))


def _compile_city(city, previous, raw_previous, groups, supervisors):
    active = {s["id"] for s in supervisors}
    grouped = _groups_by_supervisor(list(groups.values()), supervisors)
    old_districts = {d["id"]: d for d in previous["districts"]}
    raw_districts = {d["id"]: d for d in raw_previous["districts"]}
    districts = []
    for district in city.districts:
        old = old_districts.get(district.id, {})
        raw = raw_districts.get(district.id, {})
        preserve_legacy = (
            "supervisor_id" not in district.model_fields_set and "supervisor_id" not in raw
            and old.get("supervisor_id") is None and bool(raw.get("group_ids"))
            and ("group_ids" not in district.model_fields_set
                 or district.group_ids in (raw["group_ids"], old.get("group_ids", [])))
        )
        if preserve_legacy:
            supervisor = None
        elif "supervisor_id" in district.model_fields_set:
            supervisor = district.supervisor_id
            if (supervisor is not None and supervisor not in active
                    and supervisor != raw.get("supervisor_id")):
                raise DomainError("Выберите активного пользователя с ролью супервайзера")
        elif "group_ids" in district.model_fields_set:
            supervisor = _infer_supervisor(district.group_ids, groups, active)
        elif "supervisor_id" in raw:
            supervisor = raw["supervisor_id"]
        else:
            supervisor = _infer_supervisor(raw.get("group_ids", []), groups, active)
        construction = (district.construction if district.construction is not None
                        else old.get("construction", False))
        if construction and not has_land(district.id):
            raise DomainError(
                "У этого района нет земли: город делится на три района, стройку открыть нельзя"
            )
        result = {"id": district.id, "name": district.name,
                  "group_ids": (list(raw["group_ids"]) if preserve_legacy
                                else list(grouped.get(supervisor, []))),
                  "construction": construction}
        if not preserve_legacy:
            result["supervisor_id"] = supervisor
        districts.append(result)
    return {"id": city.id, "name": city.name,
            "head_id": (city.head_id if "head_id" in city.model_fields_set
                        else previous["head_id"]), "districts": districts}


def _assignment_claims(cities, groups, active):
    claimed, assigned = defaultdict(set), defaultdict(set)
    for city in cities:
        for district in city["districts"]:
            supervisor = district.get("supervisor_id")
            owners = {supervisor} if supervisor in active else set()
            owners |= {groups[g]["supervisor_id"] for g in district["group_ids"]
                       if g in groups and groups[g]["supervisor_id"] in active}
            for supervisor in owners:
                claimed[supervisor].add(district["id"])
            for group in district["group_ids"]:
                assigned[group].add(district["id"])
    return claimed, assigned


def _validation_cities(cities, raw_cities):
    """Validate legacy claims before canonical routing filters them from the effective map."""
    legacy = {d["id"]: d for c in raw_cities for d in c["districts"]
              if "supervisor_id" not in d}
    result = deepcopy(cities)
    for city in result:
        for district in city["districts"]:
            if district["id"] in legacy:
                district["group_ids"] = list(legacy[district["id"]]["group_ids"])
    return result


def _validate_assignments(cities, raw_cities, previous, raw_previous, groups, supervisors):
    active = {s["id"] for s in supervisors}
    claimed, assigned = _assignment_claims(_validation_cities(cities, raw_cities), groups, active)
    old_claimed, old_assigned = _assignment_claims(
        _validation_cities(previous, raw_previous), groups, active
    )
    legacy = {d["id"] for c in raw_cities for d in c["districts"]
              if "supervisor_id" not in d}
    old = {d["id"]: d for c in raw_previous for d in c["districts"]}
    unchanged = set()
    for city in raw_cities:
        for district in city["districts"]:
            before = old.get(district["id"], {})
            if "supervisor_id" in district and "supervisor_id" in before:
                if district["supervisor_id"] == before["supervisor_id"]:
                    unchanged.add(district["id"])
            elif ("supervisor_id" not in district and "supervisor_id" not in before
                  and district["group_ids"] == before.get("group_ids")):
                unchanged.add(district["id"])
    # Grandfather unchanged legacy conflicts, including a later group reassignment whose canonical
    # district now wins effective routing. A new assignment must never steal an unresolved team.
    for supervisor, districts in claimed.items():
        if len(districts) > 1 and not (
            districts == old_claimed.get(supervisor)
            and districts <= unchanged and districts & legacy
        ):
            raise DomainError("Супервайзер может быть назначен только в один район обоих городов")
    for group, districts in assigned.items():
        if len(districts) > 1 and not (
            districts == old_assigned.get(group)
            and districts <= unchanged and districts & legacy
        ):
            raise DomainError("Каждая группа может принадлежать только одному району")


async def save(session, actor, body):
    if not actor.is_active or actor.role not in (Role.HEAD, Role.ADMIN):
        raise PermissionDeniedError("Недостаточно прав для изменения городов")
    await lock_settings(session)
    await session.refresh(actor, attribute_names=["role", "is_active"])
    if not actor.is_active or actor.role not in (Role.HEAD, Role.ADMIN):
        raise PermissionDeniedError("Недостаточно прав для изменения городов")
    raw_old = await _raw_settings(session)
    if raw_old["revision"] != body.revision:
        raise ConflictError("Карту уже изменили. Обновите настройки и повторите.")
    groups, supervisors = await _assignment_directory(session)
    group_map = {g["id"]: g for g in groups}
    old = {**raw_old, "cities": _resolve_cities(raw_old["cities"], groups, supervisors)}
    editable = _editable(old, actor)
    if not editable:
        raise PermissionDeniedError("Администратор должен назначить вас руководителем города")
    old_cities = {c["id"]: c for c in old["cities"]}
    raw_cities = {c["id"]: c for c in raw_old["cities"]}
    if actor.role != Role.ADMIN and [c.id for c in body.cities] != list(old_cities):
        raise PermissionDeniedError("Нельзя менять порядок чужих городов")
    heads = set(await session.scalars(select(User.id).where(
        User.role == Role.HEAD, User.is_active.is_(True)
    )))
    cities = []
    for city in body.cities:
        previous = old_cities[city.id]
        if (actor.role != Role.ADMIN and "head_id" in city.model_fields_set
                and city.head_id != previous["head_id"]):
            raise PermissionDeniedError(
                "Только администратор может назначать руководителей городов"
            )
        if city.id not in editable:
            if not _unchanged_city(city, previous, raw_cities[city.id]):
                raise PermissionDeniedError("Можно изменять только свой город")
            cities.append(deepcopy(raw_cities[city.id]))
            continue
        if ("head_id" in city.model_fields_set and city.head_id is not None
                and city.head_id not in heads and city.head_id != previous["head_id"]):
            raise DomainError("Выберите активного пользователя с ролью руководителя")
        cities.append(_compile_city(city, previous, raw_cities[city.id], group_map, supervisors))
    old_ids = {d["id"] for c in old["cities"] for d in c["districts"]}
    new_ids = {d["id"] for c in cities for d in c["districts"]}
    if not old_ids <= new_ids:
        raise DomainError("Существующие районы нельзя удалять или менять их идентификатор")
    effective = _resolve_cities(cities, groups, supervisors)
    _validate_assignments(
        effective, cities, old["cities"], raw_old["cities"], group_map, supervisors
    )
    revision = body.revision + 1
    try:
        if body.revision == 0:
            session.add(CityWorld(id=1, revision=revision, cities=cities, updated_by_id=actor.id))
            await session.flush()
        else:
            result = await session.execute(update(CityWorld).where(
                CityWorld.id == 1, CityWorld.revision == body.revision
            ).values(revision=revision, cities=cities, updated_by_id=actor.id))
            if result.rowcount != 1:
                raise ConflictError("Настройки уже изменили. Обновите страницу.")
        # Publish inside this transaction before locking operators. A purchase holding an
        # operator lock finishes against the old committed map, then we reconcile its buildings.
        before, after = district_of_group(old["cities"]), district_of_group(effective)
        moved = [g for g in before.keys() | after.keys() if before.get(g) != after.get(g)]
        if moved:
            await city_estate.reconcile_many(session, await session.scalars(
                select(User.id).where(User.group_id.in_(moved), User.role == Role.OPERATOR)
            ), district_index({"cities": effective}))
        await write_audit(session, actor_id=actor.id, action="city.world", entity_type="city_world",
                          entity_id="1", payload={"before": old, "revision": revision,
                                                  "cities": effective})
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise ConflictError("Настройки уже изменили. Обновите страницу.") from None
    return await editor_data(session, actor)
