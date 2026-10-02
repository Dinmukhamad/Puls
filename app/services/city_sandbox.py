"""The administrators' test city (docs/CITY_ESTATES.md, «Тестовый город»).

Every city has a copy of its three districts for administrators only: the same plots and bands, the
same houses and office towers, squares that gather into parks, the same shared projects on the
public square, kept apart from the real city under district ids with the prefix city_land.SANDBOX.
Nothing of it
reaches operators, the staff report, the coin journal or the real districts' history: the real
city's views ask only for configured districts, and the operators' own views skip the prefix.

There administrators build for free, set any building's stage up or down, take buildings away,
open and close bands, set the headquarters' stage, open shared projects and build or cancel them
at once, and clear a city's test land to start again. The rules of the land stay the real ones
(plots for sale, free plots, the open band, parks gathering from one owner's squares), so what
works here works in the city.
"""

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.core.errors import ConflictError, NotFoundError
from app.db.base import utcnow
from app.models.city_estate import CityCell, CityDistrictState, CityObject, CityProject
from app.services import city_land
from app.services.city_estate import (
    MODULE_CELLS,
    PLOT_FAMILIES,
    PROJECT_FAMILIES,
    SQUARE,
    STAGE_NAMES,
    cells_of,
    complete,
    describe,
    event,
    footprint,
    free_plots,
    gather_parks,
    lock_district,
    lock_project,
    occupied,
    prices,
    public_object,
    release_cells,
    take_cells,
    widen,
    world_districts,
)
from app.services.locking import lock_user

CITIES = ("support", "sales")


def test_id(district_id):
    """The test copy of a district: "test-support-team-1" for "support-team-1"."""
    city, number = city_land.split(district_id)
    if city not in CITIES or not city_land.has_land(district_id):
        raise NotFoundError("У этого района нет земли")
    return f"{city_land.SANDBOX}{city}-team-{number}"


def real_id(district_id):
    return district_id.removeprefix(city_land.SANDBOX)


def test_ids(city):
    return [f"{city_land.SANDBOX}{city}-team-{n}" for n in (1, 2, 3)]


async def state(session, user, city):
    """The test city as the city map shows a city: land by band, buildings, projects, headquarters.

    District ids are the real ones, so the map draws it on the same land and headquarters.
    """
    if city not in CITIES:
        raise NotFoundError("Город не найден")
    names = {key: d["name"] for key, d in (await world_districts(session)).items()}
    districts = {
        key: {
            "name": names.get(real_id(key), f"Район {n}"),
            "number": n,
            "construction": True,
        }
        for n, key in enumerate(test_ids(city), 1)
    }
    items = await describe(
        session,
        user,
        districts,
        mine=lambda key: False,
        manages=lambda key: True,
        small=lambda key: False,
    )
    for item in items:
        item["id"] = real_id(item["id"])
    return {"city": city, "sandbox": True, "districts": items}


async def commit(session):
    try:
        await session.commit()
    except IntegrityError:
        # Another administrator got to the plot first.
        await session.rollback()
        raise ConflictError("Это место уже заняли. Обновите город.") from None


async def test_object(session, object_id, *, states=("placed",)):
    obj = await session.get(CityObject, object_id, populate_existing=True)
    if obj is None or not obj.district_id.startswith(city_land.SANDBOX) or obj.state not in states:
        raise NotFoundError("Постройка тестового города не найдена")
    return obj


async def build(session, user, body):
    """A catalogue building on a free plot of a test district, free; parks gather as in the city."""
    district_id = test_id(body.district_id)
    family = PLOT_FAMILIES.get(body.family)
    if family is None:
        raise NotFoundError("Такой постройки нет в каталоге")
    if family.get("squares"):
        raise ConflictError(
            "Парк не строят: его собирают свои скверы — четыре квадратом или шесть прямоугольником",
            code="recipe_only",
        )
    await lock_user(session, user.id)
    plots, _band = await free_plots(session, {"id": district_id}, body.block, body.col, body.row)
    obj = CityObject(
        district_id=district_id,
        owner_id=user.id,
        family=body.family,
        level=1,
        state="placed",
        module=body.block,
        u=body.col,
        v=body.row,
        rotation=0,
        source="sandbox",
        paid=0,
    )
    session.add(obj)
    try:
        await session.flush()
        take_cells(session, district_id, body.block, plots, obj=obj)
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise ConflictError("Этот участок уже занят", code="plot_taken") from None
    event(session, district_id, "sandbox", actor=user, obj=obj, payload={"do": "build"})
    park = (
        await gather_parks(session, user, district_id, body.block)
        if body.family == "square"
        else None
    )
    await widen(session, district_id, user)
    result = park or obj
    await commit(session)
    return {"object": public_object(result, user), "merged": park is not None}


async def set_level(session, user, object_id, body):
    """Any stage of a test building, up or down."""
    obj = await test_object(session, object_id)
    family = (PROJECT_FAMILIES if obj.owner_id is None else PLOT_FAMILIES)[obj.family]
    if not 1 <= body.level <= len(family["levels"]):
        raise ConflictError(
            f"У постройки «{family['name']}» ступени от 1 до {len(family['levels'])}",
            code="bad_level",
        )
    obj.level = body.level
    obj.version += 1
    # A project for a stage that is no longer the next one ends with the change.
    await end_projects(session, obj, keep=obj.level + 1)
    event(session, obj.district_id, "sandbox", actor=user, obj=obj, payload={"do": "level"})
    await commit(session)
    return {"object": public_object(obj, user)}


async def end_projects(session, obj, *, keep=None):
    """Cancels the open projects to upgrade a building, but one for stage `keep`."""
    for project in await session.scalars(
        select(CityProject).where(CityProject.target_id == obj.id, CityProject.status == "open")
    ):
        if project.level != keep:
            project.status, project.closed_at = "cancelled", utcnow()
            project.version += 1


async def remove(session, user, object_id):
    """Takes a test building away and frees its plots (or cells); a project to upgrade it ends."""
    obj = await test_object(session, object_id)
    await release_cells(session, obj)
    obj.state, obj.module, obj.u, obj.v = "archived", None, None, None
    obj.version += 1
    await end_projects(session, obj)
    event(session, obj.district_id, "sandbox", actor=user, obj=obj, payload={"do": "remove"})
    await commit(session)
    return {"removed": object_id}


async def set_district(session, user, district_id, body):
    """Opens or closes the test district's bands, sets its headquarters' stage."""
    key = test_id(district_id)
    district = await lock_district(session, key)
    bands = len(city_land.band_totals(key))
    if body.open_band is not None:
        if not 1 <= body.open_band <= bands:
            raise ConflictError(f"Поясов в районе: {bands}", code="bad_band")
        district.open_band = body.open_band
    if body.hq_level is not None:
        if not 1 <= body.hq_level <= len(STAGE_NAMES):
            raise ConflictError(f"Ступеней штаба: {len(STAGE_NAMES)}", code="bad_level")
        district.hq_level = body.hq_level
    event(
        session,
        key,
        "sandbox",
        actor=user,
        payload={"do": "district", **body.model_dump(exclude_none=True)},
    )
    await commit(session)
    return {"open_band": district.open_band, "hq_level": district.hq_level}


async def open_project(session, user, body):
    """A shared project on the test district's square: a new building or a building's next stage."""
    key = test_id(body.district_id)
    family = PROJECT_FAMILIES.get(body.family)
    if family is None:
        raise NotFoundError("Такого общего проекта нет в каталоге")
    await lock_district(session, key)
    costs = (await prices(session))["district"]
    target, cells = None, []
    if body.target_id is not None:
        target = await test_object(session, body.target_id)
        if target.owner_id is not None or target.district_id != key or target.family != body.family:
            raise NotFoundError("Общественная постройка не найдена")
        if target.level >= len(family["levels"]):
            raise ConflictError("Это уже последняя ступень", code="max_level")
        level = target.level + 1
    else:
        level = 1
        w, h = footprint(body.family, body.rotation, public=True)
        cells = cells_of(body.u, body.v, w, h)
        if any(not (0 <= u < MODULE_CELLS and 0 <= v < MODULE_CELLS) for u, v in cells):
            raise ConflictError(
                "Проект должен целиком помещаться на общественной площади", code="wrong_zone"
            )
        if await occupied(session, key, SQUARE, cells):
            raise ConflictError("Эти клетки уже заняты", code="cells_taken")
    if await session.scalar(
        select(CityProject.id).where(
            CityProject.district_id == key,
            CityProject.status == "open",
            CityProject.size == family["project"],
        )
    ):
        raise ConflictError(
            "В районе уже собирают на такой проект: постройте или отмените его",
            code="project_limit",
        )
    project = CityProject(
        district_id=key,
        family=body.family,
        level=level,
        target_id=target.id if target else None,
        module=None if target else SQUARE,
        u=None if target else body.u,
        v=None if target else body.v,
        rotation=target.rotation if target else body.rotation,
        size=family["project"],
        cost=costs[body.family][level - 1],
        status="open",
        created_by_id=user.id,
    )
    session.add(project)
    await session.flush()
    take_cells(session, key, SQUARE, cells, project=project)
    event(session, key, "sandbox", actor=user, project=project, payload={"do": "project"})
    await commit(session)
    return {"project": project.id}


async def test_project(session, project_id):
    project = await lock_project(session, project_id)
    if not project.district_id.startswith(city_land.SANDBOX) or project.status != "open":
        raise NotFoundError("Открытый проект тестового города не найден")
    return project


async def complete_project(session, user, project_id):
    """Builds a test project at once, as the last contribution would: the headquarters may grow."""
    project = await test_project(session, project_id)
    project.funded = project.cost
    obj = await complete(session, project, user)
    await commit(session)
    return {"object": public_object(obj, user)}


async def cancel_project(session, user, project_id):
    project = await test_project(session, project_id)
    for cell in list(
        await session.scalars(select(CityCell).where(CityCell.project_id == project.id))
    ):
        await session.delete(cell)
    project.status, project.closed_at = "cancelled", utcnow()
    project.version += 1
    event(
        session,
        project.district_id,
        "sandbox",
        actor=user,
        project=project,
        payload={"do": "cancel"},
    )
    await commit(session)
    return {"cancelled": project_id}


async def reset(session, user, city):
    """Clears a city's test land: no buildings, no projects, the first band, the first stage."""
    if city not in CITIES:
        raise NotFoundError("Город не найден")
    keys = test_ids(city)
    await session.execute(delete(CityCell).where(CityCell.district_id.in_(keys)))
    for obj in await session.scalars(
        select(CityObject).where(CityObject.district_id.in_(keys), CityObject.state != "archived")
    ):
        obj.state, obj.module, obj.u, obj.v = "archived", None, None, None
        obj.version += 1
    for project in await session.scalars(
        select(CityProject).where(CityProject.district_id.in_(keys), CityProject.status == "open")
    ):
        project.status, project.closed_at = "cancelled", utcnow()
        project.version += 1
    for district in await session.scalars(
        select(CityDistrictState).where(CityDistrictState.district_id.in_(keys))
    ):
        district.hq_level, district.built_projects, district.open_band = 1, 0, 1
    for key in keys:
        event(session, key, "sandbox", actor=user, payload={"do": "reset"})
    await commit(session)
    return {"city": city, "reset": True}
