"""Building in team districts (docs/CITY_ESTATES.md) with the existing Puls coins.

The land is a Monopoly board (app/services/city_land.py): each city is cut into three districts of
plots, and the operators of a district buy its plots one by one, each with what stands on it, a
square or a house, and develop them. A house goes up stage by stage from one storey; four squares
of one operator filling a square of plots become a park, six filling a rectangle a big park, at
once and for free. Bands of plots open outwards from the centre as the inner ones fill up. In the
centre of every district stand its headquarters and its public square, where staff open shared
projects and operators contribute to them.

Rules the server owns, whatever the client sends: who may build where (only operators, only in
their own district, only once its construction is opened for the pilot, only in an open band), the
price (the economy revision the client saw must still be current), which plots are free, and the
order of operations. Every change runs under an idempotency key: a repeated request returns the
stored result instead of paying twice, and the same key with a different request is refused. Coins
move only through the coin journal, in the same transaction as the building, its plots and the
history entry.

Buildings keep their place as (module, u, v): on plots module is the block, u the column and v the
row; module 0 is the public square of 12 × 12 cells (the client draws both, frontend/src/city3d).
"""

import hashlib
import json
from copy import deepcopy

from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, select, true
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError

from app.core.errors import ConflictError, NotFoundError, PermissionDeniedError
from app.db.base import utcnow
from app.models.city import CityBuild
from app.models.city_estate import (
    CityCell,
    CityContribution,
    CityDistrictState,
    CityEvent,
    CityObject,
    CityOperation,
    CityProject,
)
from app.models.coin import CoinTransaction
from app.models.enums import Role, TxType
from app.models.progress import Notification
from app.models.user import CoinAccount, Group, User
from app.services import city_land
from app.services.coins import get_account, post_transaction
from app.services.locking import lock_user
from app.services.rules import write_audit

#: The public square of a district: module 0, 12 × 12 cells (frontend world/estates.ts).
SQUARE, MODULE_CELLS = 0, 12
#: A district this small shows only whether a project is still collecting, not how far.
SMALL_TEAM = 3

#: What operators build on their plots. Size is in plots (columns × rows); a park is never bought,
#: it gathers itself from `squares` of the operator's own squares (a big park also from a park
#: and two squares).
PLOT_FAMILIES = {
    "square": {
        "name": "Сквер",
        "icon": "🌳",
        "size": (1, 1),
        "levels": [
            (
                "Сквер",
                "Газон, деревья, скамейка и клумба. Четыре своих сквера квадратом станут "
                "парком, шесть прямоугольником — большим парком.",
            )
        ],
    },
    "house": {
        "name": "Дом",
        "icon": "🏡",
        "size": (1, 1),
        "levels": [
            ("Одноэтажный дом", "Небольшой дом с крыльцом, дорожка и газон."),
            ("Двухэтажный дом", "Второй этаж, живая изгородь и дерево у дома."),
            ("Дом с террасой", "Пристройка с террасой, сад и клумбы во дворе."),
            ("Дом с гаражом", "Гараж, подъездная дорожка и новые посадки."),
            ("Особняк", "Третий этаж, фонтанчик у входа и вечерний свет."),
        ],
    },
    "park": {
        "name": "Парк",
        "icon": "🌲",
        "size": (2, 2),
        "squares": 4,
        "levels": [
            ("Парк", "Четыре сквера стали одним парком: аллеи, газоны, скамейки и деревья."),
            ("Парк с фонтаном", "Фонтан на площадке посередине и цветники вокруг."),
        ],
    },
    "bigpark": {
        "name": "Большой парк",
        "icon": "🏞️",
        "size": (3, 2),
        "squares": 6,
        "levels": [
            ("Большой парк", "Шесть скверов стали большим парком: аллея, газоны и деревья."),
            ("Парк отдыха", "Беседка, цветники и площадка отдыха."),
            ("Городской парк", "Фонтан, площадь и вечерняя подсветка."),
        ],
    },
}
#: Coins for every level of what stands on a plot (level 1 is the purchase; a park's is its merge).
PLOT_PRICES = {
    "square": [40],
    "house": [120, 180, 260, 360, 500],
    "park": [0, 120],
    "bigpark": [0, 150, 250],
}
#: Coins for a plot of each band, from the centre outwards; the land city has the first three.
LAND_PRICES = [60, 45, 30, 20, 10]

#: What a district builds together on its public square. Size is in cells of the square.
PROJECT_FAMILIES = {
    "square": {
        "name": "Сквер",
        "icon": "🌳",
        "size": (1, 1),
        "project": "small",
        "levels": [("Сквер", "Газон, деревья и скамейка.")],
    },
    "gazebo": {
        "name": "Беседка",
        "icon": "🌷",
        "size": (1, 1),
        "project": "small",
        "levels": [
            ("Беседка", "Беседка среди кустов."),
            ("Беседка в саду", "Мощёная площадка и клумбы вокруг."),
        ],
    },
    "fountain": {
        "name": "Площадь с фонтаном",
        "icon": "⛲",
        "size": (2, 2),
        "project": "main",
        "levels": [
            ("Малый фонтан", "Фонтан и скамейки на мощёной площадке."),
            ("Площадь с озеленением", "Цветники и деревья вокруг площади."),
        ],
    },
    "sports": {
        "name": "Спортивная площадка",
        "icon": "🏀",
        "size": (2, 2),
        "project": "main",
        "levels": [
            ("Площадка", "Покрытие и баскетбольные кольца."),
            ("Площадка с навесом", "Навес над скамейками болельщиков."),
            ("Спортивный двор", "Дополнительная зона и деревья по краю."),
        ],
    },
    "park": {
        "name": "Парк на площади",
        "icon": "🏞️",
        "size": (3, 2),
        "project": "main",
        "levels": [
            ("Парк на площади", "Аллея, газоны, скамейки и деревья."),
            ("Парк отдыха", "Беседка, цветники и площадка отдыха."),
            ("Городской парк", "Фонтан, площадь и вечерняя подсветка."),
        ],
    },
}
#: The estimate of a district project for every level of a public building.
PROJECT_COSTS = {
    "square": [120],
    "gazebo": [150, 120],
    "fountain": [300, 240],
    "sports": [250, 200, 300],
    "park": [900, 450, 700],
}
#: Built district projects the headquarters needs for its stages 2, 3, 4 and 5.
HQ_STEPS = [1, 3, 5, 8]
STAGE_NAMES = [
    "Офис команды",
    "Второй корпус",
    "Современный фасад",
    "Кампус с террасой",
    "Флагманский штаб",
]


def estate_defaults():
    return {
        "estate": deepcopy(PLOT_PRICES),
        "land": list(LAND_PRICES),
        "district": deepcopy(PROJECT_COSTS),
        "hq": list(HQ_STEPS),
    }


# ---- shapes --------------------------------------------------------------------------------------


def turned(size, rotation):
    w, h = size
    return (h, w) if rotation % 2 else (w, h)


def footprint(obj_or_family, rotation=0, *, public=False):
    """Columns × rows of plots (or cells of the public square) a building takes."""
    family = getattr(obj_or_family, "family", obj_or_family)
    if public or getattr(obj_or_family, "owner_id", 1) is None:
        return turned(PROJECT_FAMILIES[family]["size"], rotation)
    return turned(PLOT_FAMILIES[family]["size"], rotation)


def cells_of(u, v, w, h):
    return [(u + i, v + j) for i in range(w) for j in range(h)]


# ---- districts -----------------------------------------------------------------------------------


def district_index(config):
    """Every configured district by id: city, number, name, groups, whether construction is open."""
    return {
        d["id"]: {
            "id": d["id"],
            "city": c["id"],
            "number": int(d["id"].rsplit("-", 1)[1]),
            "name": d["name"],
            "group_ids": list(d["group_ids"]),
            "construction": bool(d.get("construction")),
        }
        for c in config["cities"]
        for d in c["districts"]
    }


def prepared(district_id):
    """Plots for sale in the district: the three districts of each city have land, others none."""
    return city_land.plot_count(district_id)


def home_district(districts, user):
    if user.role != Role.OPERATOR or not user.is_active or user.group_id is None:
        return None
    return next((d for d in districts.values() if user.group_id in d["group_ids"]), None)


async def world_districts(session):
    from app.services.city_world import settings

    return district_index(await settings(session))


async def managed(session, user, districts):
    """Districts where staff run projects: all for the head and the admin, a supervisor's own."""
    if user.role in (Role.HEAD, Role.ADMIN):
        return set(districts)
    if user.role != Role.SUPERVISOR:
        return set()
    own = set(await session.scalars(select(Group.id).where(Group.supervisor_id == user.id)))
    return {key for key, d in districts.items() if own & set(d["group_ids"])}


async def construction_open(session, user):
    """Is building open in the operator's district? Then new buildings go there, not to plots."""
    home = home_district(await world_districts(session), user)
    return bool(home and home["construction"] and city_land.has_land(home["id"]))


# ---- locks, idempotency and history --------------------------------------------------------------


async def lock_district(session, district_id):
    """The district's row, made on first use; it serialises its bands, projects and the HQ stage."""
    insert = pg_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
    await session.execute(
        insert(CityDistrictState)
        .values(district_id=district_id, hq_level=1, built_projects=0, open_band=1)
        .on_conflict_do_nothing(index_elements=["district_id"])
    )
    return await session.scalar(
        select(CityDistrictState)
        .where(CityDistrictState.district_id == district_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def fingerprint(kind, request):
    return hashlib.sha256(
        json.dumps({"kind": kind, **request}, sort_keys=True, default=str).encode()
    ).hexdigest()


async def stored_result(session, user_id, key, print_):
    row = await session.scalar(
        select(CityOperation)
        .where(CityOperation.user_id == user_id, CityOperation.key == key)
        .execution_options(populate_existing=True)
    )
    if row is None:
        return None
    if row.fingerprint != print_:
        raise ConflictError(
            "Этот ключ операции уже использован для другого действия", code="operation_key_reused"
        )
    return {**row.result, "replayed": True}


async def operation(session, user, key, kind, request, perform):
    """Runs `perform` once per key under the actor's lock: a repeat returns the first result."""
    print_ = fingerprint(kind, request)
    if (done := await stored_result(session, user.id, key, print_)) is not None:
        return done
    await lock_user(session, user.id)
    if (done := await stored_result(session, user.id, key, print_)) is not None:
        return done
    try:
        result = jsonable_encoder(await perform())
        session.add(
            CityOperation(user_id=user.id, key=key, kind=kind, fingerprint=print_, result=result)
        )
        await session.commit()
    except IntegrityError:
        # The database refused a plot, a cell or the key itself: another request got there first.
        await session.rollback()
        if (done := await stored_result(session, user.id, key, print_)) is not None:
            return done
        raise ConflictError("Участок уже заняли. Обновите город и выберите другой.") from None
    return {**result, "replayed": False}


async def operation_status(session, user, key):
    row = await session.scalar(
        select(CityOperation).where(CityOperation.user_id == user.id, CityOperation.key == key)
    )
    if row is None:
        return {"key": key, "status": "unknown"}
    return {"key": key, "status": "done", "kind": row.kind, "result": row.result}


def event(
    session,
    district_id,
    kind,
    *,
    actor=None,
    obj=None,
    project=None,
    amount=0,
    tx=None,
    payload=None,
):
    session.add(
        CityEvent(
            district_id=district_id,
            kind=kind,
            actor_id=actor.id if actor else None,
            object_id=obj.id if obj else None,
            project_id=project.id if project else None,
            level=obj.level if obj else project.level if project else None,
            amount=amount,
            transaction_id=tx.id if tx else None,
            payload=payload,
        )
    )


# ---- economy -------------------------------------------------------------------------------------


async def prices(session):
    from app.services.city_economy import economy

    return await economy(session)


def check_revision(seen, current):
    if seen != current:
        raise ConflictError(
            "Цены обновились. Проверьте новую стоимость и подтвердите ещё раз.",
            code="prices_changed",
        )


def hq_stage(built, steps):
    return 1 + sum(built >= need for need in steps)


# ---- views ---------------------------------------------------------------------------------------


def place_of(obj):
    w, h = footprint(obj, obj.rotation)
    return {"module": obj.module, "u": obj.u, "v": obj.v, "w": w, "h": h, "rotation": obj.rotation}


def public_object(obj, user):
    owner = (
        "district" if obj.owner_id is None else "mine" if obj.owner_id == user.id else "resident"
    )
    return {"id": obj.id, "family": obj.family, "level": obj.level, **place_of(obj), "owner": owner}


def squares_in(components):
    """How many squares went into a park: its squares, and those of a park it took in."""
    return sum(c.get("squares", 1) for c in components or [])


def own_object(obj):
    place = place_of(obj)
    if obj.state != "placed":
        place |= {"module": None, "u": None, "v": None}
    return {
        "id": obj.id,
        "family": obj.family,
        "level": obj.level,
        "state": obj.state,
        "district_id": obj.district_id,
        **place,
        "source": obj.source,
        "paid": obj.paid,
        "version": obj.version,
        "created_at": obj.created_at,
        "squares": squares_in(obj.components),
    }


def plot_catalogue(plot_prices):
    return [
        {
            "family": key,
            "name": item["name"],
            "icon": item["icon"],
            "size": list(item["size"]),
            "squares": item.get("squares"),
            "levels": [
                {"level": i + 1, "name": name, "about": about, "price": plot_prices[key][i]}
                for i, (name, about) in enumerate(item["levels"])
            ],
        }
        for key, item in PLOT_FAMILIES.items()
    ]


def project_catalogue(project_costs):
    return [
        {
            "family": key,
            "name": item["name"],
            "icon": item["icon"],
            "size": list(item["size"]),
            "project": item["project"],
            "levels": [
                {"level": i + 1, "name": name, "about": about, "cost": project_costs[key][i]}
                for i, (name, about) in enumerate(item["levels"])
            ],
        }
        for key, item in PROJECT_FAMILIES.items()
    ]


async def members(session, districts):
    """Active operators of every district."""
    groups = {g: key for key, d in districts.items() for g in d["group_ids"]}
    counts = dict.fromkeys(districts, 0)
    if groups:
        rows = await session.execute(
            select(User.group_id, func.count())
            .where(
                User.group_id.in_(list(groups)),
                User.role == Role.OPERATOR,
                User.is_active.is_(True),
            )
            .group_by(User.group_id)
        )
        for group_id, count in rows:
            counts[groups[group_id]] += count
    return counts


async def taken_plots(session, ids):
    """Taken plots by district and band."""
    out = {key: [0] * city_land.bands(city_land.split(key)[0]) for key in ids}
    if not ids:
        return out
    rows = await session.execute(
        select(CityCell.district_id, CityCell.module, func.count())
        .where(CityCell.district_id.in_(ids), CityCell.module != SQUARE)
        .group_by(CityCell.district_id, CityCell.module)
    )
    for district_id, block, count in rows:
        band = city_land.band_of(district_id, block)
        if band:
            out[district_id][band - 1] += count
    return out


def land_view(district_id, taken, state):
    totals = city_land.band_totals(district_id)
    if not any(totals):
        return None
    return {
        "plots": sum(totals),
        "taken": sum(taken),
        "open_band": state.open_band if state else 1,
        "bands": [
            {"band": i + 1, "plots": total, "taken": taken[i]} for i, total in enumerate(totals)
        ],
    }


async def city_state(session, user, city_id):
    """What anyone may see of a city's districts: buildings and goals, never prices or names."""
    if city_id not in ("support", "sales"):
        raise NotFoundError("Город не найден")
    all_districts = await world_districts(session)
    districts = {k: d for k, d in all_districts.items() if d["city"] == city_id}
    ids = list(districts)
    steps = (await prices(session))["hq"]

    async def listed(query):
        return list(await session.scalars(query)) if ids else []

    async def grouped(query):
        return dict((await session.execute(query)).all()) if ids else {}

    objects = await listed(
        select(CityObject)
        .where(CityObject.district_id.in_(ids), CityObject.state == "placed")
        .order_by(CityObject.id)
    )
    projects = await listed(
        select(CityProject)
        .where(CityProject.district_id.in_(ids), CityProject.status == "open")
        .order_by(CityProject.id)
    )
    states = {
        s.district_id: s
        for s in await listed(
            select(CityDistrictState).where(CityDistrictState.district_id.in_(ids))
        )
    }
    versions = await grouped(
        select(CityEvent.district_id, func.max(CityEvent.id))
        .where(CityEvent.district_id.in_(ids))
        .group_by(CityEvent.district_id)
    )
    mine = (
        dict(
            (
                await session.execute(
                    select(CityContribution.project_id, func.sum(CityContribution.amount))
                    .where(
                        CityContribution.user_id == user.id,
                        CityContribution.project_id.in_([p.id for p in projects]),
                    )
                    .group_by(CityContribution.project_id)
                )
            ).all()
        )
        if projects
        else {}
    )
    taken = await taken_plots(session, ids)
    team = await members(session, districts)
    staff = await managed(session, user, districts)
    home = home_district(all_districts, user)
    items = []
    for key, d in districts.items():
        state = states.get(key)
        level, built = (state.hq_level, state.built_projects) if state else (1, 0)
        nxt = next(((i + 2, need) for i, need in enumerate(steps) if i + 2 > level), None)
        small = team[key] < SMALL_TEAM
        items.append(
            {
                "id": key,
                "name": d["name"],
                "number": d["number"],
                "construction": d["construction"],
                "mine": bool(home and home["id"] == key),
                "managed": key in staff,
                "land": land_view(key, taken[key], state),
                "hq": {
                    "level": level,
                    "name": STAGE_NAMES[level - 1],
                    "built": built,
                    "next": {"level": nxt[0], "name": STAGE_NAMES[nxt[0] - 1], "need": nxt[1]}
                    if nxt
                    else None,
                },
                "objects": [public_object(o, user) for o in objects if o.district_id == key],
                "projects": [
                    project_view(p, mine.get(p.id, 0), small=small, exact=key in staff)
                    for p in projects
                    if p.district_id == key
                ],
                "version": versions.get(key, 0),
            }
        )
    return {"city": city_id, "districts": items}


def project_view(project, mine, *, small, exact):
    if project.target_id is None:
        w, h = footprint(project.family, project.rotation, public=True)
        place = {
            "module": project.module,
            "u": project.u,
            "v": project.v,
            "w": w,
            "h": h,
            "rotation": project.rotation,
        }
    else:
        place = {
            "module": None,
            "u": None,
            "v": None,
            "w": None,
            "h": None,
            "rotation": project.rotation,
        }
    share = project.funded * 100 // project.cost
    family = PROJECT_FAMILIES[project.family]
    view = {
        "id": project.id,
        "family": project.family,
        "name": family["name"],
        "level": project.level,
        "level_name": family["levels"][project.level - 1][0],
        "target_id": project.target_id,
        **place,
        "cost": project.cost,
        "status": project.status,
        "mine": int(mine or 0),
        "version": project.version,
        # Coarse quarters only; a small team sees nothing that would give away one person's sum.
        "progress": None if small else share // 25 * 25,
    }
    if exact:
        view["funded"] = project.funded
    return view


async def estate(session, user):
    """The operator's buildings and inventory, the catalogue and land prices of this revision."""
    districts = await world_districts(session)
    if await needs_reconcile(session, user, districts):
        await lock_user(session, user.id)
        if await reconcile(session, user, districts):
            await session.commit()
    values = await prices(session)
    home = home_district(districts, user)
    status, message = builder_status(user, home)
    objects = list(
        await session.scalars(
            select(CityObject)
            .where(CityObject.owner_id == user.id, CityObject.state.in_(["placed", "stored"]))
            .order_by(CityObject.id)
        )
    )
    account = (
        await session.scalar(select(CoinAccount).where(CoinAccount.user_id == user.id))
        if user.role == Role.OPERATOR
        else None
    )
    legacy = (
        await session.execute(
            select(func.count(), func.coalesce(func.sum(CityBuild.price), 0)).where(
                CityBuild.user_id == user.id
            )
        )
    ).one()
    return {
        "status": status,
        "message": message,
        "district": home and {"id": home["id"], "city": home["city"], "name": home["name"]},
        "objects": [own_object(o) for o in objects],
        "catalogue": plot_catalogue(values["estate"]),
        "projects": project_catalogue(values["district"]),
        "land_prices": values["land"],
        "economy_revision": values["revision"],
        "balance": account.balance if account else 0,
        "available": account.available if account else 0,
        "legacy": {"count": legacy[0], "paid": int(legacy[1])},
        "managed": sorted(await managed(session, user, districts)),
    }


def builder_status(user, home):
    if user.role != Role.OPERATOR:
        return (
            "staff",
            "Строят операторы в своих районах. "
            "Сотрудники открывают общие проекты и смотрят за развитием.",
        )
    if home is None:
        return "no_team", "Нужно назначение в команду: руководитель связывает группу с районом."
    if not city_land.has_land(home["id"]):
        return (
            "no_land",
            "У района пока нет земли: город делится на три района, участки есть у первых трёх.",
        )
    if not home["construction"]:
        return (
            "closed",
            "Стройка в районе откроется после пилотного запуска. "
            "Цены и участки уже можно посмотреть.",
        )
    return "ready", None


def require_builder(user, home):
    status, message = builder_status(user, home)
    if status == "staff":
        raise PermissionDeniedError(message)
    if status != "ready":
        raise ConflictError(message, code=f"construction_{status}")


# ---- transfers -----------------------------------------------------------------------------------


def elsewhere(user, home):
    """The operator's buildings standing outside their district (or anywhere, without one)."""
    query = select(CityObject).where(CityObject.owner_id == user.id, CityObject.state == "placed")
    return query.where(CityObject.district_id != home["id"]) if home else query


async def needs_reconcile(session, user, districts):
    home = home_district(districts, user)
    return (await session.scalar(elsewhere(user, home).limit(1))) is not None


async def reconcile(session, user, districts=None):
    """Personal land follows the operator: plots outside the current district are released.

    Buildings from them go to the inventory with their level and what was paid, and can be put on
    free plots of the new district for free; shared buildings and contributions stay in the district
    they were made for (TZ §18). Returns whether anything moved.
    """
    districts = districts if districts is not None else await world_districts(session)
    home = home_district(districts, user)
    moved = False
    for obj in list(await session.scalars(elsewhere(user, home))):
        await release_cells(session, obj)
        district_id = obj.district_id
        obj.state, obj.module, obj.u, obj.v = "stored", None, None, None
        obj.version += 1
        event(session, district_id, "transfer", obj=obj, payload={"user": user.id})
        moved = True
    if moved:
        await session.flush()
    return moved


async def reconcile_many(session, user_ids, districts):
    for user_id in sorted(set(user_ids)):
        await lock_user(session, user_id)
        user = await session.get(User, user_id, populate_existing=True)
        if user:
            await reconcile(session, user, districts)


# ---- plots and cells -----------------------------------------------------------------------------


async def release_cells(session, obj):
    for cell in list(await session.scalars(select(CityCell).where(CityCell.object_id == obj.id))):
        await session.delete(cell)
    await session.flush()


async def occupied(session, district_id, module, cells, *, ignore_object=None):
    rows = await session.scalars(
        select(CityCell).where(CityCell.district_id == district_id, CityCell.module == module)
    )
    wanted = set(cells)
    return [
        c
        for c in rows
        if (c.u, c.v) in wanted and (ignore_object is None or c.object_id != ignore_object)
    ]


def take_cells(session, district_id, module, cells, *, obj=None, project=None):
    for u, v in cells:
        session.add(
            CityCell(
                district_id=district_id,
                module=module,
                u=u,
                v=v,
                object_id=obj.id if obj else None,
                project_id=project.id if project else None,
            )
        )


async def free_plots(session, home, block, col, row, cols=1, rows=1):
    """The plots of the area if they are the district's, in an open band and free; else why not."""
    plots = city_land.area(home["id"], block, col, row, cols, rows)
    if plots is None:
        raise ConflictError(
            "Здесь нет участков твоего района на продажу"
            if cols * rows == 1
            else "Постройка должна целиком помещаться на участках одного квартала",
            code="wrong_plot",
        )
    state = await session.get(CityDistrictState, home["id"])
    band = city_land.band_of(home["id"], block)
    if band > (state.open_band if state else 1):
        raise ConflictError(
            "Этот пояс района ещё закрыт: он откроется, когда займут 70 % участков ближе к центру",
            code="band_closed",
        )
    if await occupied(session, home["id"], block, plots):
        raise ConflictError("Этот участок уже занят", code="plot_taken")
    return plots, band


async def widen(session, district_id, actor):
    """Opens the district's next bands as the inner ones fill up; they never close again."""
    state = await lock_district(session, district_id)
    taken = (await taken_plots(session, [district_id]))[district_id]
    band = city_land.open_band(city_land.band_totals(district_id), taken, state.open_band)
    if band > state.open_band:
        state.open_band = band
        event(session, district_id, "band", actor=actor, payload={"band": band})
    return state.open_band


# ---- parks gather themselves ---------------------------------------------------------------------

#: The shapes a park gathers in: (family, columns, rows, rotation), the big park first.
PARK_SHAPES = (("bigpark", 3, 2, 0), ("bigpark", 2, 3, 1), ("park", 2, 2, 0))


def park_group(objects):
    """The first park the operator's squares (and a park) on one block fill exactly, or None.

    A park is four squares in a square of plots; a big park is six squares in a 3 × 2 or 2 × 3
    rectangle, or a park and two squares filling one. Big parks go first, then by row and column.
    """
    at = {}
    for o in objects:
        w, h = footprint(o, o.rotation)
        for cell in cells_of(o.u, o.v, w, h):
            at[cell] = o
    anchors = sorted({(o.u, o.v) for o in objects}, key=lambda p: (p[1], p[0]))
    for family, w, h, rotation in PARK_SHAPES:
        starts = sorted(
            {(u - du, v - dv) for u, v in anchors for du in range(w) for dv in range(h)},
            key=lambda p: (p[1], p[0]),
        )
        for u0, v0 in starts:
            cells = cells_of(u0, v0, w, h)
            parts = {at.get(cell) for cell in cells}
            if None in parts:
                continue
            fits = all(
                o.u >= u0
                and o.v >= v0
                and o.u + footprint(o, o.rotation)[0] <= u0 + w
                and o.v + footprint(o, o.rotation)[1] <= v0 + h
                for o in parts
            )
            parks = [o for o in parts if o.family == "park"]
            if fits and (not parks or (family == "bigpark" and len(parks) == 1)):
                return family, u0, v0, rotation, sorted(parts, key=lambda o: o.id)
    return None


async def gather_parks(session, user, district_id, block):
    """Turns the operator's squares on a block into parks while a group fits; the last park made."""
    made = None
    for _ in range(8):
        objects = list(
            await session.scalars(
                select(CityObject)
                .where(
                    CityObject.owner_id == user.id,
                    CityObject.district_id == district_id,
                    CityObject.module == block,
                    CityObject.state == "placed",
                    CityObject.family.in_(["square", "park"]),
                )
                .execution_options(populate_existing=True)
            )
        )
        group = park_group(objects)
        if group is None:
            break
        made = await merge(session, user, district_id, block, *group)
    return made


async def merge(session, user, district_id, block, family, u0, v0, rotation, parts):
    """Parts into one park on their plots: they are consumed, the park keeps what they cost.

    A park that grows into a big park passes on its stage, so a fountain bought is not lost.
    """
    level = max([1] + [o.level for o in parts if o.family == "park"])
    park = CityObject(
        district_id=district_id,
        owner_id=user.id,
        family=family,
        level=min(level, len(PLOT_FAMILIES[family]["levels"])),
        state="placed",
        module=block,
        u=u0,
        v=v0,
        rotation=rotation,
        source="merge",
        paid=sum(o.paid for o in parts),
        components=[
            {"id": o.id, "family": o.family, "paid": o.paid, "squares": squares_in(o.components)}
            if o.family == "park"
            else {"id": o.id, "family": o.family, "paid": o.paid}
            for o in parts
        ],
    )
    session.add(park)
    await session.flush()
    for part in parts:
        await release_cells(session, part)
        part.state, part.consumed_by, part.module, part.u, part.v = (
            "consumed",
            park.id,
            None,
            None,
            None,
        )
        part.version += 1
        event(session, district_id, "consume", actor=user, obj=part, payload={"park": park.id})
    w, h = footprint(park, rotation)
    take_cells(session, district_id, block, cells_of(u0, v0, w, h), obj=park)
    event(
        session,
        district_id,
        "merge",
        actor=user,
        obj=park,
        payload={"parts": [o.id for o in parts]},
    )
    await write_audit(
        session,
        actor_id=user.id,
        action="city.estate.merge",
        entity_type="city_object",
        entity_id=park.id,
        payload={"family": family, "parts": [o.id for o in parts]},
    )
    await session.flush()
    return park


# ---- personal operations -------------------------------------------------------------------------


async def builder(session, user):
    districts = await world_districts(session)
    await reconcile(session, user, districts)
    home = home_district(districts, user)
    require_builder(user, home)
    return home


async def balance(session, user_id):
    account = await get_account(session, user_id)
    return {"balance": account.balance, "available": account.available}


async def pay(session, user, key, price, reason, meta):
    if not price:
        return None
    return await post_transaction(
        session,
        user_id=user.id,
        amount=-price,
        tx_type=TxType.CITY_BUILD,
        reason=reason,
        idempotency_key=f"city-op:{user.id}:{key}",
        meta=meta,
    )


async def own_object_row(session, user, object_id, version, *, states=("placed",)):
    obj = await session.get(CityObject, object_id, populate_existing=True)
    if obj is None or obj.owner_id != user.id or obj.state not in states:
        raise NotFoundError("Постройка не найдена")
    if obj.version != version:
        raise ConflictError("Постройка уже изменилась. Обновите город.", code="stale_object")
    return obj


async def purchase(session, user, body):
    """A free plot of the operator's district with a square or a house on it, land and all."""

    async def perform():
        home = await builder(session, user)
        family = PLOT_FAMILIES.get(body.family)
        if family is None:
            raise NotFoundError("Такой постройки нет в каталоге")
        if family.get("squares"):
            raise ConflictError(
                "Парк не покупают: его собирают свои скверы — четыре квадратом или шесть "
                "прямоугольником",
                code="recipe_only",
            )
        values = await prices(session)
        check_revision(body.economy_revision, values["revision"])
        plots, band = await free_plots(session, home, body.block, body.col, body.row)
        land, building = values["land"][band - 1], values["estate"][body.family][0]
        price = land + building
        tx = await pay(
            session,
            user,
            body.key,
            price,
            f"Мой район: участок и {family['levels'][0][0].lower()}",
            {"family": body.family, "level": 1, "band": band, "land": land},
        )
        obj = CityObject(
            district_id=home["id"],
            owner_id=user.id,
            family=body.family,
            level=1,
            state="placed",
            module=body.block,
            u=body.col,
            v=body.row,
            rotation=0,
            source="purchase",
            paid=price,
            economy_revision=values["revision"],
        )
        session.add(obj)
        await session.flush()
        take_cells(session, home["id"], body.block, plots, obj=obj)
        event(session, home["id"], "purchase", actor=user, obj=obj, amount=price, tx=tx)
        await write_audit(
            session,
            actor_id=user.id,
            action="city.estate.purchase",
            entity_type="city_object",
            entity_id=obj.id,
            payload={"family": body.family, "price": price, "land": land, "band": band},
        )
        await session.flush()
        park = (
            await gather_parks(session, user, home["id"], body.block)
            if body.family == "square"
            else None
        )
        await widen(session, home["id"], user)
        return {
            "object": own_object(park or obj),
            "merged": park is not None,
            "price": price,
            **await balance(session, user.id),
        }

    return await operation(
        session, user, body.key, "purchase", body.model_dump(exclude={"key"}), perform
    )


async def upgrade(session, user, object_id, body):
    async def perform():
        await builder(session, user)
        obj = await own_object_row(session, user, object_id, body.version)
        levels = PLOT_FAMILIES[obj.family]["levels"]
        if obj.level >= len(levels):
            raise ConflictError("Это уже последняя ступень", code="max_level")
        values = await prices(session)
        check_revision(body.economy_revision, values["revision"])
        price = values["estate"][obj.family][obj.level]
        tx = await pay(
            session,
            user,
            body.key,
            price,
            f"Мой район: {PLOT_FAMILIES[obj.family]['name']} — {levels[obj.level][0]}",
            {"family": obj.family, "level": obj.level + 1, "object": obj.id},
        )
        obj.level += 1
        obj.paid += price
        obj.version += 1
        event(session, obj.district_id, "upgrade", actor=user, obj=obj, amount=price, tx=tx)
        await write_audit(
            session,
            actor_id=user.id,
            action="city.estate.upgrade",
            entity_type="city_object",
            entity_id=obj.id,
            payload={"level": obj.level, "price": price},
        )
        await session.flush()
        return {"object": own_object(obj), "price": price, **await balance(session, user.id)}

    return await operation(
        session,
        user,
        body.key,
        "upgrade",
        {"id": object_id, **body.model_dump(exclude={"key"})},
        perform,
    )


async def place(session, user, object_id, body):
    """Puts a building from the inventory (after a transfer) on free plots of the district, free."""

    async def perform():
        home = await builder(session, user)
        obj = await own_object_row(session, user, object_id, body.version, states=("stored",))
        rotation = body.rotation % 2 if obj.family == "bigpark" else 0
        w, h = footprint(obj, rotation)
        plots, _band = await free_plots(session, home, body.block, body.col, body.row, w, h)
        obj.district_id, obj.module, obj.u, obj.v, obj.rotation, obj.state = (
            home["id"],
            body.block,
            body.col,
            body.row,
            rotation,
            "placed",
        )
        obj.version += 1
        take_cells(session, home["id"], body.block, plots, obj=obj)
        event(session, home["id"], "place", actor=user, obj=obj)
        await session.flush()
        gathers = obj.family in ("square", "park")
        park = await gather_parks(session, user, home["id"], body.block) if gathers else None
        await widen(session, home["id"], user)
        return {
            "object": own_object(park or obj),
            "merged": park is not None,
            **await balance(session, user.id),
        }

    return await operation(
        session,
        user,
        body.key,
        "place",
        {"id": object_id, **body.model_dump(exclude={"key"})},
        perform,
    )


# ---- district projects ---------------------------------------------------------------------------


async def open_project(session, user, body):
    async def perform():
        districts = await world_districts(session)
        district = districts.get(body.district_id)
        if district is None:
            raise NotFoundError("Район не найден")
        if body.district_id not in await managed(session, user, districts):
            raise PermissionDeniedError("Общие проекты открывают супервайзер района и руководитель")
        if not district["construction"] or not city_land.has_land(body.district_id):
            raise ConflictError("Стройка в районе ещё не открыта", code="construction_closed")
        await lock_district(session, body.district_id)
        values = await prices(session)
        check_revision(body.economy_revision, values["revision"])
        costs = values["district"]
        family = PROJECT_FAMILIES.get(body.family)
        if family is None or body.family not in costs:
            raise NotFoundError("Такого общего проекта нет в каталоге")
        target = None
        if body.target_id is not None:
            target = await session.get(CityObject, body.target_id, populate_existing=True)
            if (
                target is None
                or target.owner_id is not None
                or target.district_id != body.district_id
                or target.state != "placed"
                or target.family != body.family
            ):
                raise NotFoundError("Общественная постройка не найдена")
            if target.level >= len(family["levels"]):
                raise ConflictError("Это уже последняя ступень", code="max_level")
            if await session.scalar(
                select(CityProject.id).where(
                    CityProject.target_id == target.id, CityProject.status == "open"
                )
            ):
                raise ConflictError(
                    "Для этой постройки уже собирают средства", code="project_exists"
                )
            level = target.level + 1
        else:
            level = 1
            if body.module != SQUARE:
                raise ConflictError(
                    "Общие проекты строят на общественной площади района", code="wrong_zone"
                )
            w, h = footprint(body.family, body.rotation, public=True)
            cells = cells_of(body.u, body.v, w, h)
            if any(not (0 <= u < MODULE_CELLS and 0 <= v < MODULE_CELLS) for u, v in cells):
                raise ConflictError(
                    "Проект должен целиком помещаться на общественной площади", code="wrong_zone"
                )
            if await occupied(session, body.district_id, SQUARE, cells):
                raise ConflictError("Эти клетки уже заняты", code="cells_taken")
        size = family["project"]
        if await session.scalar(
            select(CityProject.id).where(
                CityProject.district_id == body.district_id,
                CityProject.status == "open",
                CityProject.size == size,
            )
        ):
            raise ConflictError(
                "В районе уже собирают на "
                + ("основной" if size == "main" else "малый")
                + " проект: сначала завершите его",
                code="project_limit",
            )
        project = CityProject(
            district_id=body.district_id,
            family=body.family,
            level=level,
            target_id=target.id if target else None,
            module=None if target else SQUARE,
            u=None if target else body.u,
            v=None if target else body.v,
            rotation=target.rotation if target else body.rotation,
            size=size,
            cost=costs[body.family][level - 1],
            status="open",
            economy_revision=values["revision"],
            created_by_id=user.id,
        )
        session.add(project)
        await session.flush()
        if target is None:
            take_cells(session, body.district_id, SQUARE, cells, project=project)
        event(
            session,
            body.district_id,
            "project_open",
            actor=user,
            project=project,
            payload={"cost": project.cost},
        )
        await write_audit(
            session,
            actor_id=user.id,
            action="city.project.open",
            entity_type="city_project",
            entity_id=project.id,
            payload={
                "district": body.district_id,
                "family": body.family,
                "level": level,
                "cost": project.cost,
            },
        )
        await session.flush()
        return {"project": project_view(project, 0, small=False, exact=True)}

    return await operation(
        session, user, body.key, "project", body.model_dump(exclude={"key"}), perform
    )


async def lock_project(session, project_id):
    project = await session.scalar(
        select(CityProject)
        .where(CityProject.id == project_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if project is None:
        raise NotFoundError("Проект не найден")
    return project


async def contribute(session, user, project_id, body):
    async def perform():
        home = await builder(session, user)
        project = await lock_project(session, project_id)
        if project.district_id != home["id"]:
            raise ConflictError(
                "Вносить можно только в проекты своего района", code="wrong_district"
            )
        if project.status != "open":
            raise ConflictError("Проект уже собран или отменён", code="project_closed")
        remaining = project.cost - project.funded
        amount = body.amount
        if amount > remaining:
            if not body.up_to:
                raise ConflictError(
                    "Осталось собрать меньше. "
                    "Выберите «внести не больше этой суммы», чтобы закрыть остаток.",
                    code="over_remaining",
                )
            amount = remaining
        name = PROJECT_FAMILIES[project.family]["name"]
        tx = await post_transaction(
            session,
            user_id=user.id,
            amount=-amount,
            tx_type=TxType.CITY_CONTRIBUTION,
            reason=f"Проект района: {name}",
            idempotency_key=f"city-op:{user.id}:{body.key}",
            meta={"project": project.id},
        )
        session.add(
            CityContribution(
                project_id=project.id, user_id=user.id, amount=amount, transaction_id=tx.id
            )
        )
        project.funded += amount
        project.version += 1
        event(
            session,
            project.district_id,
            "contribution",
            actor=user,
            project=project,
            amount=amount,
            tx=tx,
        )
        built = None
        if project.funded >= project.cost:
            built = await complete(session, project, user)
        await session.flush()
        mine = await session.scalar(
            select(func.sum(CityContribution.amount)).where(
                CityContribution.project_id == project.id, CityContribution.user_id == user.id
            )
        )
        return {
            "accepted": amount,
            "completed": built is not None,
            "object": built and public_object(built, user),
            "project": project_view(project, mine, small=True, exact=False),
            **await balance(session, user.id),
        }

    return await operation(
        session,
        user,
        body.key,
        "contribution",
        {"id": project_id, **body.model_dump(exclude={"key"})},
        perform,
    )


async def complete(session, project, actor):
    """The last contribution builds the project: a public building or its next stage, maybe HQ."""
    state = await lock_district(session, project.district_id)
    if project.target_id is None:
        obj = CityObject(
            district_id=project.district_id,
            owner_id=None,
            family=project.family,
            level=1,
            state="placed",
            module=project.module,
            u=project.u,
            v=project.v,
            rotation=project.rotation,
            source="project",
            paid=0,
            economy_revision=project.economy_revision,
        )
        session.add(obj)
        await session.flush()
        for cell in await session.scalars(
            select(CityCell).where(CityCell.project_id == project.id)
        ):
            cell.project_id, cell.object_id = None, obj.id
    else:
        obj = await session.get(CityObject, project.target_id, populate_existing=True)
        obj.level = project.level
        obj.version += 1
    project.status, project.object_id, project.closed_at = "built", obj.id, utcnow()
    state.built_projects += 1
    stage = hq_stage(state.built_projects, (await prices(session))["hq"])
    event(session, project.district_id, "project_built", actor=actor, obj=obj, project=project)
    if stage > state.hq_level:
        state.hq_level = stage
        event(session, project.district_id, "hq", payload={"level": stage})
    contributors = set(
        await session.scalars(
            select(CityContribution.user_id).where(CityContribution.project_id == project.id)
        )
    )
    family = PROJECT_FAMILIES[project.family]
    for user_id in contributors:
        session.add(
            Notification(
                user_id=user_id,
                title="Проект района построен",
                kind="learning",
                link="/training/city",
                body=f"{family['name']}: {family['levels'][project.level - 1][0]}",
            )
        )
    await write_audit(
        session,
        actor_id=actor.id,
        action="city.project.built",
        entity_type="city_project",
        entity_id=project.id,
        payload={"object": obj.id, "hq_level": state.hq_level},
    )
    return obj


async def cancel_project(session, user, project_id, body):
    async def perform():
        districts = await world_districts(session)
        project = await lock_project(session, project_id)
        if project.district_id not in await managed(session, user, districts):
            raise PermissionDeniedError("Отменить проект могут супервайзер района и руководитель")
        if project.status != "open":
            raise ConflictError(
                "Отменить можно только проект, который ещё собирают", code="project_closed"
            )
        name = PROJECT_FAMILIES[project.family]["name"]
        refunded = 0
        for item in list(
            await session.scalars(
                select(CityContribution).where(
                    CityContribution.project_id == project.id,
                    CityContribution.refund_transaction_id.is_(None),
                )
            )
        ):
            # Back to whoever gave it, wherever they work now.
            tx = await post_transaction(
                session,
                user_id=item.user_id,
                amount=item.amount,
                tx_type=TxType.PURCHASE_REFUND,
                reason=f"Возврат взноса: проект района «{name}» отменён",
                idempotency_key=f"city-refund:{item.id}",
                meta={"project": project.id},
                evaluate_achievements=False,
            )
            item.refund_transaction_id = tx.id
            refunded += item.amount
            event(
                session,
                project.district_id,
                "refund",
                actor=user,
                project=project,
                amount=item.amount,
                tx=tx,
                payload={"user": item.user_id},
            )
            session.add(
                Notification(
                    user_id=item.user_id,
                    title="Проект района отменён",
                    kind="learning",
                    link="/training/city",
                    body=f"{name}: взнос {item.amount} вернулся в кошелёк",
                )
            )
        for cell in list(
            await session.scalars(select(CityCell).where(CityCell.project_id == project.id))
        ):
            await session.delete(cell)
        project.status, project.closed_at = "cancelled", utcnow()
        project.version += 1
        event(
            session,
            project.district_id,
            "project_cancel",
            actor=user,
            project=project,
            amount=refunded,
        )
        await write_audit(
            session,
            actor_id=user.id,
            action="city.project.cancel",
            entity_type="city_project",
            entity_id=project.id,
            payload={"refunded": refunded},
        )
        await session.flush()
        return {"project": project_view(project, 0, small=False, exact=True), "refunded": refunded}

    return await operation(session, user, body.key, "cancel", {"id": project_id}, perform)


# ---- staff report --------------------------------------------------------------------------------


async def report(session):
    """For the admin tab: land, buildings and projects per district, what old plots still hold."""
    districts = await world_districts(session)
    team = await members(session, districts)

    async def grouped(query):
        return dict((await session.execute(query)).all())

    placed = await grouped(
        select(CityObject.district_id, func.count())
        .where(CityObject.state == "placed", CityObject.owner_id.is_not(None))
        .group_by(CityObject.district_id)
    )
    open_projects = await grouped(
        select(CityProject.district_id, func.count())
        .where(CityProject.status == "open")
        .group_by(CityProject.district_id)
    )
    owners = await grouped(
        select(CityObject.district_id, func.count(func.distinct(CityObject.owner_id)))
        .where(CityObject.state == "placed", CityObject.owner_id.is_not(None))
        .group_by(CityObject.district_id)
    )
    states = {s.district_id: s for s in await session.scalars(select(CityDistrictState))}
    taken = await taken_plots(session, [k for k in districts if city_land.has_land(k)])
    items = []
    for key, d in districts.items():
        state = states.get(key)
        land = land_view(key, taken[key], state) if key in taken else None
        items.append(
            {
                "id": key,
                "city": d["city"],
                "name": d["name"],
                "construction": d["construction"],
                "operators": team[key],
                "builders": owners.get(key, 0),
                "land": land and {k: land[k] for k in ("plots", "taken", "open_band")},
                "buildings": placed.get(key, 0),
                "open_projects": open_projects.get(key, 0),
                "hq_level": state.hq_level if state else 1,
                "built_projects": state.built_projects if state else 0,
            }
        )
    assigned = {g for d in districts.values() for g in d["group_ids"]}
    outside = User.group_id.is_(None) | User.group_id.not_in(assigned) if assigned else true()
    without = await session.scalar(
        select(func.count())
        .select_from(User)
        .where(User.role == Role.OPERATOR, User.is_active.is_(True), outside)
    )
    legacy = (
        await session.execute(
            select(
                func.count(),
                func.count(func.distinct(CityBuild.user_id)),
                func.coalesce(func.sum(CityBuild.price), 0),
            )
        )
    ).one()

    async def total(tx_type, key):
        return await session.scalar(
            select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
                CoinTransaction.tx_type == tx_type, CoinTransaction.idempotency_key.like(key)
            )
        )

    homeless = await session.scalar(
        select(func.count())
        .select_from(CityObject)
        .where(CityObject.state == "stored", CityObject.owner_id.is_not(None))
    )
    refunds = await total(TxType.PURCHASE_REFUND, "city-refund:%") + await total(
        TxType.PURCHASE_REFUND, "city-land-reset:%"
    )
    return {
        "districts": items,
        "operators_without_district": int(without or 0),
        "inventory": int(homeless or 0),
        "legacy": {"buildings": legacy[0], "operators": legacy[1], "paid": int(legacy[2])},
        "coins": {
            "buildings": -int(await total(TxType.CITY_BUILD, "city-op:%") or 0),
            "contributions": -int(await total(TxType.CITY_CONTRIBUTION, "city-op:%") or 0),
            "refunded": int(refunds or 0),
        },
    }
