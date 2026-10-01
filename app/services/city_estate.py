"""Building in team districts (docs/CITY_ESTATES.md) with the existing Puls coins.

Rules the server owns, whatever the client sends: who may build where (only operators, only in their
own district, only once its construction is opened for the pilot), the price (the economy revision
the client saw must still be current), which cells are free, and the order of operations. Every
change runs under an idempotency key: a repeated request returns the stored result instead of paying
twice, and the same key with a different request is refused. Coins move only through the coin
journal, in the same transaction as the building, its cells and the history entry.

The grid is logical and shared with the client (frontend/src/city3d/world/estates.ts): a district
has prepared modules of 12 × 12 cells (slot 0 public, 1 business, the rest residential), residential
modules hold nine 4 × 4 estates and the business module nine 4 × 4 tower lots. In an estate the
house keeps the back half (two rows), the garden is the front half.
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
    CityLot,
    CityObject,
    CityOperation,
    CityProject,
)
from app.models.coin import CoinTransaction
from app.models.enums import Role, TxType
from app.models.progress import Notification
from app.models.user import CoinAccount, Group, User
from app.services.coins import get_account, post_transaction
from app.services.locking import lock_user
from app.services.rules import write_audit

MODULE_CELLS, LOT_CELLS, HOUSE_ROWS = 12, 4, 2
#: Prepared modules of district number n (index n - 1); the client lays out the same
#: (world/estates.ts PREPARED).
PREPARED = (10, 10, 10, 6, 6, 6, 0, 0, 0, 0, 0, 0)
#: The first estate given away is the front middle one, then along the front row, then further back.
ESTATE_ORDER = (7, 6, 8, 4, 3, 5, 1, 0, 2)
#: A district this small shows only whether a project is still collecting, not how far.
SMALL_TEAM = 3

FAMILIES = {
    "square": {
        "name": "Сквер",
        "icon": "🌳",
        "size": (1, 1),
        "zone": "garden",
        "project": "small",
        "levels": [
            (
                "Сквер",
                "Газон, деревья и скамейка. "
                "Шесть скверов прямоугольником 3 × 2 станут большим парком.",
            )
        ],
    },
    "gazebo": {
        "name": "Беседка",
        "icon": "🌷",
        "size": (1, 1),
        "zone": "garden",
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
        "zone": "garden",
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
        "zone": "garden",
        "project": "main",
        "levels": [
            ("Площадка", "Покрытие и баскетбольные кольца."),
            ("Площадка с навесом", "Навес над скамейками болельщиков."),
            ("Спортивный двор", "Дополнительная зона и деревья по краю."),
        ],
    },
    "park": {
        "name": "Большой парк",
        "icon": "🏞️",
        "size": (3, 2),
        "zone": "garden",
        "project": "main",
        "recipe": True,
        "levels": [
            ("Большой парк", "Аллея, газоны, скамейки и деревья."),
            ("Парк отдыха", "Беседка, цветники и площадка отдыха."),
            ("Городской парк", "Фонтан, площадь и вечерняя подсветка."),
        ],
    },
    "house": {
        "name": "Личный дом",
        "icon": "🏡",
        "size": (4, 2),
        "zone": "house",
        "levels": [
            ("Первый дом", "Небольшой кирпичный дом с крыльцом, дорожка и газон."),
            ("Просторный дом", "Второй этаж, входная группа, ограда и дерево."),
            ("Дом с двором", "Выразительный фасад, терраса и обустроенный двор с садом."),
            ("Дом с гаражом", "Гараж, подъездная дорожка и новые посадки."),
            ("Усадьба", "Большой дом, фонтанчик у входа и вечерний свет."),
        ],
    },
    "tower": {
        "name": "Небоскрёб",
        "icon": "🏙️",
        "size": (4, 4),
        "zone": "lot",
        "levels": [
            ("50 этажей", "Стройная башня на подиуме с завершённой крышей."),
            ("100 этажей", "Новые секции и расширенная входная зона."),
            ("150 этажей", "Уступы с террасами."),
            ("200 этажей", "Флагманский силуэт со шпилем и площадь у основания."),
        ],
    },
}
#: Coins for every level of a personal building (level 1 is the purchase; the park's is the merge).
ESTATE_PRICES = {
    "square": [40],
    "gazebo": [50, 40],
    "fountain": [90, 80],
    "sports": [70, 60, 90],
    "park": [0, 150, 250],
    "house": [120, 180, 260, 360, 500],
    "tower": [350, 600, 900, 1300],
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
        "estate": deepcopy(ESTATE_PRICES),
        "district": deepcopy(PROJECT_COSTS),
        "hq": list(HQ_STEPS),
    }


# ---- the district grid ---------------------------------------------------------------------------


def prepared(number):
    return PREPARED[number - 1] if 1 <= number <= len(PREPARED) else 0


def module_kind(slot):
    return "public" if slot == 0 else "business" if slot == 1 else "residential"


def lot_origin(index):
    return (index % 3) * LOT_CELLS, (index // 3) * LOT_CELLS


def footprint(family, rotation):
    w, h = FAMILIES[family]["size"]
    return (h, w) if rotation % 2 else (w, h)


def cells_of(u, v, w, h):
    return [(u + i, v + j) for i in range(w) for j in range(h)]


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
    return bool(home and home["construction"] and prepared(home["number"]))


# ---- locks, idempotency and history --------------------------------------------------------------


async def lock_district(session, district_id):
    """The district's row, made on first use; it serialises lots, projects and the HQ stage."""
    insert = pg_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
    await session.execute(
        insert(CityDistrictState)
        .values(district_id=district_id, hq_level=1, built_projects=0)
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
        # The database refused a cell, a lot or the key itself: another request got there first.
        await session.rollback()
        if (done := await stored_result(session, user.id, key, print_)) is not None:
            return done
        raise ConflictError("Участок уже изменили. Обновите город и повторите.") from None
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

    values = await economy(session)
    return values["revision"], values["estate"], values["district"], values["hq"]


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
    w, h = footprint(obj.family, obj.rotation)
    return {"module": obj.module, "u": obj.u, "v": obj.v, "w": w, "h": h, "rotation": obj.rotation}


def public_object(obj, user):
    owner = (
        "district" if obj.owner_id is None else "mine" if obj.owner_id == user.id else "resident"
    )
    return {"id": obj.id, "family": obj.family, "level": obj.level, **place_of(obj), "owner": owner}


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
        "components": len(obj.components or []),
    }


def catalogue(estate_prices, project_costs):
    return [
        {
            "family": key,
            "name": item["name"],
            "icon": item["icon"],
            "size": list(item["size"]),
            "zone": item["zone"],
            "project": item.get("project"),
            "recipe": bool(item.get("recipe")),
            "levels": [
                {
                    "level": i + 1,
                    "name": name,
                    "about": about,
                    "price": estate_prices[key][i],
                    "project_cost": project_costs[key][i] if key in project_costs else None,
                }
                for i, (name, about) in enumerate(item["levels"])
            ],
        }
        for key, item in FAMILIES.items()
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


async def city_state(session, user, city_id):
    """What anyone may see of a city's districts: buildings and goals, never prices or names."""
    if city_id not in ("support", "sales"):
        raise NotFoundError("Город не найден")
    from app.services.city_economy import economy

    all_districts = await world_districts(session)
    districts = {k: d for k, d in all_districts.items() if d["city"] == city_id}
    ids = list(districts)
    steps = (await economy(session))["hq"]
    objects = (
        list(
            await session.scalars(
                select(CityObject)
                .where(CityObject.district_id.in_(ids), CityObject.state == "placed")
                .order_by(CityObject.id)
            )
        )
        if ids
        else []
    )
    projects = (
        list(
            await session.scalars(
                select(CityProject)
                .where(CityProject.district_id.in_(ids), CityProject.status == "open")
                .order_by(CityProject.id)
            )
        )
        if ids
        else []
    )
    states = (
        {
            s.district_id: s
            for s in await session.scalars(
                select(CityDistrictState).where(CityDistrictState.district_id.in_(ids))
            )
        }
        if ids
        else {}
    )
    versions = (
        dict(
            (
                await session.execute(
                    select(CityEvent.district_id, func.max(CityEvent.id))
                    .where(CityEvent.district_id.in_(ids))
                    .group_by(CityEvent.district_id)
                )
            ).all()
        )
        if ids
        else {}
    )
    taken = (
        dict(
            (
                await session.execute(
                    select(CityLot.district_id, func.count())
                    .where(CityLot.district_id.in_(ids), CityLot.kind == "estate")
                    .group_by(CityLot.district_id)
                )
            ).all()
        )
        if ids
        else {}
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
    team = await members(session, districts)
    staff = await managed(session, user, districts)
    home = home_district(all_districts, user)
    items = []
    for key, d in districts.items():
        state = states.get(key)
        level, built = (state.hq_level, state.built_projects) if state else (1, 0)
        modules = prepared(d["number"])
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
                "modules": [{"slot": s, "kind": module_kind(s)} for s in range(modules)],
                "estates": {"total": max(0, modules - 2) * 9, "taken": taken.get(key, 0)},
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
        w, h = footprint(project.family, project.rotation)
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
    view = {
        "id": project.id,
        "family": project.family,
        "name": FAMILIES[project.family]["name"],
        "level": project.level,
        "level_name": FAMILIES[project.family]["levels"][project.level - 1][0],
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
    """The operator's land, buildings, inventory and what can be built, at current prices."""
    districts = await world_districts(session)
    if await needs_reconcile(session, user, districts):
        await lock_user(session, user.id)
        if await reconcile(session, user, districts):
            await session.commit()
    revision, estate_prices, project_costs, _steps = await prices(session)
    home = home_district(districts, user)
    status, message = builder_status(user, home)
    lots = {
        lot.kind: lot
        for lot in await session.scalars(select(CityLot).where(CityLot.user_id == user.id))
    }
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
        "estate": lot_view(lots.get("estate")),
        "tower_lot": lot_view(lots.get("tower")),
        "objects": [own_object(o) for o in objects],
        "catalogue": catalogue(estate_prices, project_costs),
        "economy_revision": revision,
        "balance": account.balance if account else 0,
        "available": account.available if account else 0,
        "legacy": {"count": legacy[0], "paid": int(legacy[1])},
        "managed": sorted(await managed(session, user, districts)),
    }


def lot_view(lot):
    if lot is None:
        return None
    u0, v0 = lot_origin(lot.index)
    return {
        "district_id": lot.district_id,
        "module": lot.module,
        "index": lot.index,
        "u": u0,
        "v": v0,
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
    if not prepared(home["number"]):
        return (
            "no_land",
            "Территория района ещё готовится. Постройки появятся после расширения города.",
        )
    if not home["construction"]:
        return (
            "closed",
            "Стройка в районе откроется после пилотного запуска. "
            "Цены и постройки уже можно посмотреть.",
        )
    return "ready", None


def require_builder(user, home):
    status, message = builder_status(user, home)
    if status == "staff":
        raise PermissionDeniedError(message)
    if status != "ready":
        raise ConflictError(message, code=f"construction_{status}")


# ---- transfers -----------------------------------------------------------------------------------


async def needs_reconcile(session, user, districts):
    home = home_district(districts, user)
    lots = list(
        await session.scalars(select(CityLot.district_id).where(CityLot.user_id == user.id))
    )
    return any(not home or district != home["id"] for district in lots)


async def reconcile(session, user, districts=None):
    """Personal land follows the operator: lots outside the current district are released.

    Buildings from them go to the inventory; shared buildings and contributions stay in the district
    they were made for (TZ §18). Returns whether anything moved.
    """
    districts = districts if districts is not None else await world_districts(session)
    home = home_district(districts, user)
    moved = False
    for lot in list(await session.scalars(select(CityLot).where(CityLot.user_id == user.id))):
        if home and lot.district_id == home["id"]:
            continue
        objects = await session.scalars(
            select(CityObject).where(
                CityObject.owner_id == user.id,
                CityObject.district_id == lot.district_id,
                CityObject.state == "placed",
            )
        )
        for obj in list(objects):
            await release_cells(session, obj)
            obj.state, obj.module, obj.u, obj.v = "stored", None, None, None
            obj.version += 1
            event(session, lot.district_id, "transfer", obj=obj, payload={"user": user.id})
        await session.delete(lot)
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


# ---- cells ---------------------------------------------------------------------------------------


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


def estate_zone(lot, zone):
    """The cells of an estate's zone: the house keeps the back two rows, the garden the front."""
    u0, v0 = lot_origin(lot.index)
    rows = range(v0, v0 + HOUSE_ROWS) if zone == "house" else range(v0 + HOUSE_ROWS, v0 + LOT_CELLS)
    return {(u, v) for u in range(u0, u0 + LOT_CELLS) for v in rows}


ZONE_RULES = {
    "public": "Общие проекты строят на общественной земле района",
    "business": "Небоскрёбы строят в деловом квартале района",
}


def check_module(district, module, kind):
    if not 0 <= module < prepared(district["number"]):
        raise ConflictError("Этого квартала в районе нет", code="wrong_zone")
    if module_kind(module) != kind:
        raise ConflictError(ZONE_RULES[kind], code="wrong_zone")


async def personal_cells(session, user, home, family, module, u, v, rotation, *, moving=None):
    """Where a personal building may stand: in its zone of the operator's land, on free cells."""
    zone = FAMILIES[family]["zone"]
    w, h = footprint(family, rotation)
    cells = cells_of(u, v, w, h)
    if zone == "lot":
        check_module(home, module, "business")
        if u % LOT_CELLS or v % LOT_CELLS or not (0 <= u < MODULE_CELLS and 0 <= v < MODULE_CELLS):
            raise ConflictError("Небоскрёб занимает целый деловой участок 4 × 4", code="wrong_zone")
        return cells
    lot = await session.scalar(
        select(CityLot).where(CityLot.user_id == user.id, CityLot.kind == "estate")
    )
    if lot is None or lot.district_id != home["id"]:
        raise ConflictError("Сначала получи свою усадьбу в районе", code="no_estate")
    if module != lot.module:
        raise ConflictError(
            "Это общественная земля района"
            if module == 0
            else "Строить можно только на своей усадьбе",
            code="wrong_zone",
        )
    area = estate_zone(lot, zone)
    if not set(cells) <= area:
        raise ConflictError(
            "Дом стоит в задней части усадьбы"
            if zone == "house"
            else "Постройка должна целиком помещаться в саду усадьбы",
            code="wrong_zone",
        )
    if await occupied(session, home["id"], module, cells, ignore_object=moving):
        raise ConflictError("Эти клетки уже заняты", code="cells_taken")
    return cells


async def claim_lot(session, user, home, module, u, v):
    """A free tower lot of the business quarter for the operator; one per operator."""
    index = (v // LOT_CELLS) * 3 + u // LOT_CELLS
    await lock_district(session, home["id"])
    held = await session.scalar(
        select(CityLot).where(CityLot.user_id == user.id, CityLot.kind == "tower")
    )
    if held is not None and (held.district_id, held.module, held.index) == (
        home["id"],
        module,
        index,
    ):
        return held
    if await session.get(CityLot, (home["id"], module, index), populate_existing=True):
        raise ConflictError("Этот деловой участок уже занят", code="cells_taken")
    if held is not None:
        await session.delete(held)
        await session.flush()
    lot = CityLot(district_id=home["id"], module=module, index=index, kind="tower", user_id=user.id)
    session.add(lot)
    await session.flush()
    return lot


async def claim_estate(session, user):
    """The operator's estate in their district: given once, free, the first left in stable order."""
    districts = await world_districts(session)
    await lock_user(session, user.id)
    await reconcile(session, user, districts)
    home = home_district(districts, user)
    require_builder(user, home)
    lot = await session.scalar(
        select(CityLot).where(CityLot.user_id == user.id, CityLot.kind == "estate")
    )
    if lot is None:
        await lock_district(session, home["id"])
        taken = set(
            (
                await session.execute(
                    select(CityLot.module, CityLot.index).where(
                        CityLot.district_id == home["id"], CityLot.kind == "estate"
                    )
                )
            ).all()
        )
        free = next(
            (
                (m, i)
                for m in range(2, prepared(home["number"]))
                for i in ESTATE_ORDER
                if (m, i) not in taken
            ),
            None,
        )
        if free is None:
            raise ConflictError(
                "В районе закончились свободные усадьбы. Руководитель получит задачу расширения.",
                code="no_free_estate",
            )
        lot = CityLot(
            district_id=home["id"], module=free[0], index=free[1], kind="estate", user_id=user.id
        )
        session.add(lot)
        await session.flush()
        event(
            session,
            home["id"],
            "estate",
            actor=user,
            payload={"module": lot.module, "index": lot.index},
        )
        # A house kept in the inventory after a transfer moves into the new estate at once.
        house = await session.scalar(
            select(CityObject).where(
                CityObject.owner_id == user.id,
                CityObject.family == "house",
                CityObject.state == "stored",
            )
        )
        if house is not None:
            u0, v0 = lot_origin(lot.index)
            house.district_id, house.module, house.u, house.v, house.rotation, house.state = (
                home["id"],
                lot.module,
                u0,
                v0,
                0,
                "placed",
            )
            house.version += 1
            take_cells(
                session, home["id"], lot.module, cells_of(u0, v0, *footprint("house", 0)), obj=house
            )
            event(session, home["id"], "place", actor=user, obj=house)
        await write_audit(
            session,
            actor_id=user.id,
            action="city.estate.claim",
            entity_type="city_lot",
            entity_id=f"{home['id']}:{lot.module}:{lot.index}",
        )
        await session.commit()
    return lot_view(lot)


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


async def own_placed(session, user, object_id, version, *, states=("placed",)):
    obj = await session.get(CityObject, object_id, populate_existing=True)
    if obj is None or obj.owner_id != user.id or obj.state not in states:
        raise NotFoundError("Постройка не найдена")
    if obj.version != version:
        raise ConflictError("Постройка уже изменилась. Обновите город.", code="stale_object")
    return obj


async def purchase(session, user, body):
    async def perform():
        home = await builder(session, user)
        family = FAMILIES.get(body.family)
        if family is None:
            raise NotFoundError("Такой постройки нет в каталоге")
        if family.get("recipe"):
            raise ConflictError(
                "Большой парк собирается из шести скверов прямоугольником 3 × 2", code="recipe_only"
            )
        revision, estate_prices, _costs, _steps = await prices(session)
        check_revision(body.economy_revision, revision)
        rotation = 0 if family["zone"] == "house" else body.rotation
        if family["zone"] == "house" and await session.scalar(
            select(CityObject.id).where(
                CityObject.owner_id == user.id,
                CityObject.family == "house",
                CityObject.state.in_(["placed", "stored"]),
            )
        ):
            raise ConflictError("Дом у тебя уже есть: его можно улучшать", code="house_exists")
        if family["zone"] == "lot" and await session.scalar(
            select(CityObject.id).where(
                CityObject.owner_id == user.id,
                CityObject.family == "tower",
                CityObject.state.in_(["placed", "stored"]),
            )
        ):
            raise ConflictError(
                "Небоскрёб у тебя уже есть: на первом запуске — одна башня на оператора",
                code="tower_exists",
            )
        cells = await personal_cells(
            session, user, home, body.family, body.module, body.u, body.v, rotation
        )
        if family["zone"] == "lot":
            await claim_lot(session, user, home, body.module, body.u, body.v)
        price = estate_prices[body.family][0]
        tx = await pay(
            session,
            user,
            body.key,
            price,
            f"Мой район: {family['name']}",
            {"family": body.family, "level": 1},
        )
        obj = CityObject(
            district_id=home["id"],
            owner_id=user.id,
            family=body.family,
            level=1,
            state="placed",
            module=body.module,
            u=body.u,
            v=body.v,
            rotation=rotation,
            source="purchase",
            paid=price,
            economy_revision=revision,
        )
        session.add(obj)
        await session.flush()
        take_cells(session, home["id"], body.module, cells, obj=obj)
        event(session, home["id"], "purchase", actor=user, obj=obj, amount=price, tx=tx)
        await write_audit(
            session,
            actor_id=user.id,
            action="city.estate.purchase",
            entity_type="city_object",
            entity_id=obj.id,
            payload={"family": body.family, "price": price},
        )
        await session.flush()
        return {"object": own_object(obj), "price": price, **await balance(session, user.id)}

    return await operation(
        session, user, body.key, "purchase", body.model_dump(exclude={"key"}), perform
    )


async def upgrade(session, user, object_id, body):
    async def perform():
        await builder(session, user)
        obj = await own_placed(session, user, object_id, body.version)
        levels = FAMILIES[obj.family]["levels"]
        if obj.level >= len(levels):
            raise ConflictError("Это уже последняя ступень", code="max_level")
        revision, estate_prices, _costs, _steps = await prices(session)
        check_revision(body.economy_revision, revision)
        price = estate_prices[obj.family][obj.level]
        tx = await pay(
            session,
            user,
            body.key,
            price,
            f"Мой район: {FAMILIES[obj.family]['name']} — {levels[obj.level][0]}",
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


async def move(session, user, object_id, body):
    """Moves a building within the operator's land or places it from the inventory, for free."""

    async def perform():
        home = await builder(session, user)
        obj = await own_placed(session, user, object_id, body.version, states=("placed", "stored"))
        zone = FAMILIES[obj.family]["zone"]
        if zone == "house" and obj.state == "placed":
            raise ConflictError("Дом стоит на своём месте в усадьбе", code="house_fixed")
        rotation = 0 if zone == "house" else body.rotation
        if (
            obj.state == "placed"
            and obj.district_id == home["id"]
            and (obj.module, obj.u, obj.v, obj.rotation) == (body.module, body.u, body.v, rotation)
        ):
            raise ConflictError("Постройка уже стоит здесь", code="same_place")
        cells = await personal_cells(
            session, user, home, obj.family, body.module, body.u, body.v, rotation, moving=obj.id
        )
        if zone == "lot":
            await claim_lot(session, user, home, body.module, body.u, body.v)
        kind = "move" if obj.state == "placed" else "place"
        await release_cells(session, obj)
        obj.district_id, obj.module, obj.u, obj.v, obj.rotation, obj.state = (
            home["id"],
            body.module,
            body.u,
            body.v,
            rotation,
            "placed",
        )
        obj.version += 1
        take_cells(session, home["id"], body.module, cells, obj=obj)
        event(session, home["id"], kind, actor=user, obj=obj)
        await session.flush()
        return {"object": own_object(obj), **await balance(session, user.id)}

    return await operation(
        session,
        user,
        body.key,
        "move",
        {"id": object_id, **body.model_dump(exclude={"key"})},
        perform,
    )


async def store(session, user, object_id, body):
    async def perform():
        await builder(session, user)
        obj = await own_placed(session, user, object_id, body.version)
        if FAMILIES[obj.family]["zone"] == "house":
            raise ConflictError(
                "Дом нельзя убрать: усадьба держит для него место", code="house_fixed"
            )
        await release_cells(session, obj)
        if obj.family == "tower":
            lot = await session.scalar(
                select(CityLot).where(CityLot.user_id == user.id, CityLot.kind == "tower")
            )
            if lot:
                await session.delete(lot)
        obj.state, obj.module, obj.u, obj.v = "stored", None, None, None
        obj.version += 1
        event(session, obj.district_id, "store", actor=user, obj=obj)
        await session.flush()
        return {"object": own_object(obj), **await balance(session, user.id)}

    return await operation(
        session,
        user,
        body.key,
        "store",
        {"id": object_id, **body.model_dump(exclude={"key"})},
        perform,
    )


def rectangle(squares):
    """The 3 × 2 or 2 × 3 rectangle six squares of one module fill exactly, or None."""
    if len({o.module for o in squares}) != 1:
        return None
    us, vs = [o.u for o in squares], [o.v for o in squares]
    u0, v0, w, h = min(us), min(vs), max(us) - min(us) + 1, max(vs) - min(vs) + 1
    if (w, h) not in ((3, 2), (2, 3)) or {(o.u, o.v) for o in squares} != set(
        cells_of(u0, v0, w, h)
    ):
        return None
    return squares[0].module, u0, v0, w, h


async def merge_squares(session, actor, squares, district_id, *, owner, key, fee):
    """Six squares into one park on their cells: squares are consumed, the park keeps their cost."""
    place = rectangle(squares)
    if place is None:
        raise ConflictError(
            "Нужны шесть соседних скверов прямоугольником 3 × 2 или 2 × 3", code="bad_recipe"
        )
    module, u0, v0, w, h = place
    tx = (
        await pay(
            session, actor, key, fee, "Мой район: объединение скверов в парк", {"family": "park"}
        )
        if owner
        else None
    )
    park = CityObject(
        district_id=district_id,
        owner_id=owner.id if owner else None,
        family="park",
        level=1,
        state="placed",
        module=module,
        u=u0,
        v=v0,
        rotation=0 if w > h else 1,
        source="merge",
        paid=sum(o.paid for o in squares) + (fee if owner else 0),
        components=[{"id": o.id, "paid": o.paid} for o in squares],
    )
    session.add(park)
    await session.flush()
    for square in squares:
        await release_cells(session, square)
        square.state, square.consumed_by, square.module, square.u, square.v = (
            "consumed",
            park.id,
            None,
            None,
            None,
        )
        square.version += 1
        event(session, district_id, "consume", actor=actor, obj=square, payload={"park": park.id})
    take_cells(session, district_id, module, cells_of(u0, v0, w, h), obj=park)
    event(
        session,
        district_id,
        "merge",
        actor=actor,
        obj=park,
        amount=fee if owner else 0,
        tx=tx,
        payload={"squares": [o.id for o in squares]},
    )
    await write_audit(
        session,
        actor_id=actor.id,
        action="city.estate.merge",
        entity_type="city_object",
        entity_id=park.id,
        payload={"squares": [o.id for o in squares], "owner": owner.id if owner else None},
    )
    await session.flush()
    return park


async def recipe(session, ids, *, owner_id, district_id):
    objects = [await session.get(CityObject, i, populate_existing=True) for i in ids]
    if any(o is None or o.family != "square" or o.state != "placed" for o in objects):
        raise ConflictError("Объединить можно только шесть построенных скверов", code="bad_recipe")
    if any(o.owner_id != owner_id or o.district_id != district_id for o in objects):
        raise ConflictError(
            "Личные и общественные скверы смешивать нельзя: нужны шесть скверов одного владельца",
            code="bad_recipe",
        )
    return objects


async def merge(session, user, body):
    async def perform():
        first = await session.get(CityObject, body.ids[0])
        if first is not None and first.owner_id is None:
            # Public squares: the district's supervisor or the head merges them, district locked.
            districts = await world_districts(session)
            if first.district_id not in await managed(session, user, districts):
                raise PermissionDeniedError(
                    "Общественные скверы объединяют супервайзер района и руководитель"
                )
            await lock_district(session, first.district_id)
            objects = await recipe(session, body.ids, owner_id=None, district_id=first.district_id)
            park = await merge_squares(
                session, user, objects, first.district_id, owner=None, key=body.key, fee=0
            )
            return {"object": public_object(park, user)}
        home = await builder(session, user)
        objects = await recipe(session, body.ids, owner_id=user.id, district_id=home["id"])
        revision, estate_prices, _costs, _steps = await prices(session)
        check_revision(body.economy_revision, revision)
        park = await merge_squares(
            session,
            user,
            objects,
            home["id"],
            owner=user,
            key=body.key,
            fee=estate_prices["park"][0],
        )
        return {"object": own_object(park), **await balance(session, user.id)}

    return await operation(
        session, user, body.key, "merge", body.model_dump(exclude={"key"}), perform
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
        if not district["construction"] or not prepared(district["number"]):
            raise ConflictError("Стройка в районе ещё не открыта", code="construction_closed")
        await lock_district(session, body.district_id)
        revision, _prices, costs, _steps = await prices(session)
        check_revision(body.economy_revision, revision)
        family = FAMILIES.get(body.family)
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
            check_module(district, body.module, "public")
            w, h = footprint(body.family, body.rotation)
            cells = cells_of(body.u, body.v, w, h)
            if any(not (0 <= u < MODULE_CELLS and 0 <= v < MODULE_CELLS) for u, v in cells):
                raise ConflictError(
                    "Проект должен целиком помещаться на общественной земле", code="wrong_zone"
                )
            if await occupied(session, body.district_id, body.module, cells):
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
            module=None if target else body.module,
            u=None if target else body.u,
            v=None if target else body.v,
            rotation=target.rotation if target else body.rotation,
            size=size,
            cost=costs[body.family][level - 1],
            status="open",
            economy_revision=revision,
            created_by_id=user.id,
        )
        session.add(project)
        await session.flush()
        if target is None:
            take_cells(session, body.district_id, body.module, cells, project=project)
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
        name = FAMILIES[project.family]["name"]
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
    from app.services.city_economy import economy

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
    stage = hq_stage(state.built_projects, (await economy(session))["hq"])
    event(session, project.district_id, "project_built", actor=actor, obj=obj, project=project)
    if stage > state.hq_level:
        state.hq_level = stage
        event(session, project.district_id, "hq", payload={"level": stage})
    contributors = set(
        await session.scalars(
            select(CityContribution.user_id).where(CityContribution.project_id == project.id)
        )
    )
    family = FAMILIES[project.family]
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
        name = FAMILIES[project.family]["name"]
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

    estates = await grouped(
        select(CityLot.district_id, func.count())
        .where(CityLot.kind == "estate")
        .group_by(CityLot.district_id)
    )
    placed = await grouped(
        select(CityObject.district_id, func.count())
        .where(CityObject.state == "placed")
        .group_by(CityObject.district_id)
    )
    stored = await grouped(
        select(CityObject.district_id, func.count())
        .where(CityObject.state == "stored")
        .group_by(CityObject.district_id)
    )
    open_projects = await grouped(
        select(CityProject.district_id, func.count())
        .where(CityProject.status == "open")
        .group_by(CityProject.district_id)
    )
    states = {s.district_id: s for s in await session.scalars(select(CityDistrictState))}
    items = []
    for key, d in districts.items():
        modules = prepared(d["number"])
        total = max(0, modules - 2) * 9
        state = states.get(key)
        items.append(
            {
                "id": key,
                "city": d["city"],
                "name": d["name"],
                "construction": d["construction"],
                "modules": modules,
                "operators": team[key],
                "estates": {"total": total, "taken": estates.get(key, 0)},
                # The capacity rule of the TZ (§10.2): ceil(operators / 9) + 1 residential modules.
                "needs_expansion": team[key] > 0
                and (-(-team[key] // 9) + 1 > modules - 2 or estates.get(key, 0) >= total),
                "buildings": placed.get(key, 0),
                "inventory": stored.get(key, 0),
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
    spent = await session.scalar(
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.tx_type == TxType.CITY_BUILD
        )
    )
    contributed = await session.scalar(
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.tx_type == TxType.CITY_CONTRIBUTION
        )
    )
    homeless = await session.scalar(
        select(func.count())
        .select_from(CityObject)
        .where(CityObject.state == "stored", CityObject.owner_id.is_not(None))
    )
    return {
        "districts": items,
        "operators_without_district": int(without or 0),
        "inventory": int(homeless or 0),
        "legacy": {"buildings": legacy[0], "operators": legacy[1], "paid": int(legacy[2])},
        "coins": {"buildings": -int(spent or 0), "contributions": -int(contributed or 0)},
    }
