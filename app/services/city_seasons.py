"""Seasons of the team districts (docs/CITY_SEASONS.md).

The districts cannot be built on forever, so the city starts again: on the date the schedule names,
or when a head or an administrator resets it, every building, small thing and shared project of
both cities' districts goes, and each district's main building is back at its first level. What
everyone saw of the two cities that day stays in the history with the season's totals: operators
see it for VISIBLE_DAYS after the reset, heads and administrators always. Training is not part of a
season: missions, their rewards, experience and coins stay; coins spent on the land are not
returned, contributions to shared projects not yet built are.

One schedule serves both cities: a period and the date of the next reset. The scheduler ends a
season that is due, and so does the first city request after that moment (`ensure`), so a city
that nobody opened is reset as soon as someone does, and nothing is ever built into a season over.
"""

import calendar
from collections import Counter
from datetime import UTC, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from fastapi.encoders import jsonable_encoder
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import defer

from app.core.config import settings
from app.core.errors import ConflictError, DomainError, NotFoundError
from app.db.base import utcnow
from app.models.city_estate import (
    CityCell,
    CityContribution,
    CityDistrictState,
    CityEvent,
    CityObject,
    CityProject,
)
from app.models.city_season import CitySeason
from app.models.enums import Role, TxType
from app.models.progress import Notification
from app.models.user import User
from app.services import city_land
from app.services.coins import post_transaction
from app.services.rules import write_audit

CITIES = ("support", "sales")
#: Days, months: a week is seven days, a month the same day of the next month.
PERIODS = {"week": (7, 0), "2weeks": (14, 0), "month": (0, 1), "2months": (0, 2), "3months": (0, 3)}
PERIOD_NAMES = {
    "week": "Неделя",
    "2weeks": "2 недели",
    "month": "Месяц",
    "2months": "2 месяца",
    "3months": "3 месяца",
}
#: Operators see a past city this many days after its reset; heads and administrators always.
VISIBLE_DAYS = 5
#: The city warns this many days before the schedule resets it.
WARN_DAYS = 3
#: Nobody in particular: the past city as anyone saw it, with no building of the viewer's own.
NOBODY = SimpleNamespace(id=0)
STAFF = (Role.HEAD, Role.ADMIN)


def aware(moment):
    return moment if moment is None or moment.tzinfo else moment.replace(tzinfo=UTC)


def after(moment, period):
    """The moment one period later on the office clock: same time of day, same day of the month."""
    local = aware(moment).astimezone(ZoneInfo(settings.TIMEZONE))
    days, months = PERIODS[period]
    if months:
        index = local.month - 1 + months
        year, month = local.year + index // 12, index % 12 + 1
        local = local.replace(
            year=year, month=month, day=min(local.day, calendar.monthrange(year, month)[1])
        )
    return (local + timedelta(days=days)).astimezone(UTC)


def due(season, now):
    return season.ends_at is not None and aware(season.ends_at) <= now


def staff(user):
    return user.role in STAFF


def visible(season, user, now):
    """A past city: always to heads and administrators, to everyone else for VISIBLE_DAYS."""
    if season.ended_at is None:
        return False
    return staff(user) or aware(season.ended_at) + timedelta(days=VISIBLE_DAYS) > now


# ---- the season going on -------------------------------------------------------------------------


async def current(session, *, lock=False):
    """The season going on; the first one begins with the first change of the real districts."""
    query = (
        select(CitySeason)
        .where(CitySeason.ended_at.is_(None))
        .execution_options(populate_existing=True)
    )
    season = await session.scalar(query.with_for_update() if lock else query)
    if season is not None:
        return season
    started = await session.scalar(
        select(func.min(CityEvent.created_at)).where(
            ~CityEvent.district_id.startswith(city_land.SANDBOX)
        )
    )
    insert = pg_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
    await session.execute(
        insert(CitySeason)
        .values(number=1, started_at=aware(started) or utcnow(), revision=1)
        .on_conflict_do_nothing(index_elements=["number"])
    )
    return await session.scalar(query.with_for_update() if lock else query)


async def ensure(session):
    """Ends a season the schedule has ended, before anything else reads or changes the land."""
    query = select(CitySeason.number, CitySeason.ends_at).where(CitySeason.ended_at.is_(None))
    row = (await session.execute(query)).first()
    if row is None:
        await current(session)
        await session.commit()
        return None
    number, ends_at = row
    if ends_at is None or aware(ends_at) > utcnow():
        return None
    season = await close(session, None, number, scheduled=True)
    await session.commit()
    return season


async def close_due(session):
    """The scheduler's check: ends the season if its date has come."""
    season = await current(session)
    if not due(season, utcnow()):
        await session.commit()
        return None
    closed = await close(session, None, season.number, scheduled=True)
    await session.commit()
    return closed


# ---- the reset -----------------------------------------------------------------------------------


async def close(session, actor, number, *, scheduled=False):
    """Ends season `number`: keeps both cities as they were, clears the land, opens the next one.

    The schedule (`actor` None) acts only when the season is due; a head or an administrator ends
    it at once. Another reset that got there first makes this one a conflict, never a second reset.
    """
    from app.services.city_estate import describe, event, lock_district, world_districts

    now = utcnow()
    season = await current(session, lock=True)
    # The schedule found the work done, or the date moved meanwhile: nothing more to do.
    if scheduled and (season.number != number or not due(season, now)):
        return None
    if season.number != number:
        raise ConflictError(
            f"Город уже обновился: идёт сезон {season.number}", code="season_changed"
        )
    districts = await world_districts(session)
    ids = sorted(districts)
    for key in ids:
        await lock_district(session, key)
    snapshot = {}
    for city in CITIES:
        own = {key: d for key, d in districts.items() if d["city"] == city}
        items = await describe(
            session,
            NOBODY,
            own,
            mine=lambda key: False,
            manages=lambda key: False,
            small=lambda key: True,
        )
        # Shared projects still collecting were never built: the past city shows what stood.
        snapshot[city] = {
            "city": city,
            "districts": [{**item, "projects": [], "managed": False} for item in items],
        }
    totals = await season_totals(session, districts, snapshot)
    refunds = await cancel_projects(session, ids, actor, number, event)
    for obj in await session.scalars(
        select(CityObject).where(CityObject.district_id.in_(ids), CityObject.state != "archived")
    ):
        obj.state, obj.module, obj.u, obj.v = "archived", None, None, None
        obj.version += 1
    await session.execute(delete(CityCell).where(CityCell.district_id.in_(ids)))
    for state in await session.scalars(
        select(CityDistrictState).where(CityDistrictState.district_id.in_(ids))
    ):
        state.hq_level, state.built_projects, state.landmark_peak_plots = 1, 0, 0
        state.open_band = city_land.open_band(state.district_id)
    for key in ids:
        event(session, key, "season", actor=actor, payload={"season": number})
    # The new season starts on the land as planned: a city may now have another number of districts.
    from app.services.city_world import apply_layouts

    layouts = await apply_layouts(session)
    season.ended_at, season.ended_by_id = now, actor.id if actor else None
    season.snapshot, season.totals = jsonable_encoder(snapshot), jsonable_encoder(totals)
    session.add(
        CitySeason(
            number=number + 1,
            started_at=now,
            period=season.period,
            ends_at=next_end(season, now, scheduled),
            revision=1,
            updated_by_id=season.updated_by_id,
        )
    )
    await notify(session, districts, number, now, refunds, layouts)
    await write_audit(
        session,
        actor_id=actor.id if actor else None,
        action="city.season.close",
        entity_type="city_season",
        entity_id=season.id,
        payload={
            "number": number,
            "scheduled": scheduled,
            "buildings": totals["buildings"],
            "small": totals["small"],
            "refunded": sum(refunds.values()),
            "layouts": {city: {"before": old, "after": new, "without_district": left}
                        for city, (old, new, left) in layouts.items()},
        },
    )
    await session.flush()
    return season


def next_end(season, now, scheduled):
    """The next reset keeps the schedule's rhythm; one set off by hand counts from that moment."""
    if not season.period:
        return None
    end = after(aware(season.ends_at) if scheduled and season.ends_at else now, season.period)
    # A server asleep for a whole period skips it instead of resetting twice in a row.
    while end <= now:
        end = after(end, season.period)
    return end


async def cancel_projects(session, ids, actor, number, event):
    """Shared projects still collecting are cancelled: their contributions go back, by person."""
    refunds = Counter()
    for project in await session.scalars(
        select(CityProject).where(CityProject.district_id.in_(ids), CityProject.status == "open")
    ):
        for item in await session.scalars(
            select(CityContribution).where(
                CityContribution.project_id == project.id,
                CityContribution.refund_transaction_id.is_(None),
            )
        ):
            # The key of a cancelled project's refund: a contribution comes back only once.
            tx = await post_transaction(
                session,
                user_id=item.user_id,
                amount=item.amount,
                tx_type=TxType.PURCHASE_REFUND,
                reason=f"Возврат взноса: сезон {number} города завершён",
                idempotency_key=f"city-refund:{item.id}",
                meta={"project": project.id, "season": number},
                evaluate_achievements=False,
            )
            item.refund_transaction_id = tx.id if tx else None
            refunds[item.user_id] += item.amount
            event(
                session,
                project.district_id,
                "refund",
                actor=actor,
                project=project,
                amount=item.amount,
                tx=tx,
                payload={"user": item.user_id, "season": number},
            )
        project.status, project.closed_at = "cancelled", utcnow()
        project.version += 1
    return refunds


async def notify(session, districts, number, now, refunds, layouts=None):
    """Every operator of the districts learns the city starts again, and what they keep."""
    layouts = layouts or {}
    groups = [g for d in districts.values() for g in d["group_ids"]]
    people = set(refunds)
    if groups:
        people |= set(
            await session.scalars(
                select(User.id).where(
                    User.group_id.in_(groups), User.role == Role.OPERATOR, User.is_active.is_(True)
                )
            )
        )
    until = (now + timedelta(days=VISIBLE_DAYS)).astimezone(ZoneInfo(settings.TIMEZONE))
    names = {"support": "Техподдержки", "sales": "ОП"}
    # An operator of a city cut anew learns how many districts it has now.
    city_of = {
        g: d["city"] for d in districts.values() for g in d["group_ids"] if d["city"] in layouts
    }
    homes = dict((await session.execute(
        select(User.id, User.group_id).where(User.group_id.in_(list(city_of)))
    )).all()) if city_of else {}
    for user_id in sorted(people):
        city = city_of.get(homes.get(user_id))
        layout = (
            f" В городе {names[city]} теперь {layouts[city][1]} района."
            if city and layouts[city][1] < 5 else
            f" В городе {names[city]} теперь {layouts[city][1]} районов." if city else ""
        )
        back = (
            f" Взносы в недостроенные проекты вернулись: {refunds[user_id]}."
            if refunds[user_id]
            else ""
        )
        session.add(
            Notification(
                user_id=user_id,
                title="Город начал новый сезон",
                kind="learning",
                link="/training/city",
                body=f"Сезон {number} завершён: районы снова свободны, стройте заново. Прошлый "
                f"город можно посмотреть в «Истории» до {until:%d.%m}. Обучение, опыт и коины "
                f"остались.{layout}{back}",
            )
        )


async def season_totals(session, districts, snapshot):
    """What the season built, by city and district, and who built most (by cells taken)."""
    ids = list(districts)
    people = {}

    def person(district_id, user_id):
        return people.setdefault((district_id, user_id), {"buildings": 0, "small": 0, "cells": 0})

    if ids:
        for district_id, user_id, count in await session.execute(
            select(CityObject.district_id, CityObject.owner_id, func.count())
            .where(
                CityObject.district_id.in_(ids),
                CityObject.state == "placed",
                CityObject.owner_id.is_not(None),
            )
            .group_by(CityObject.district_id, CityObject.owner_id)
        ):
            person(district_id, user_id)["buildings"] += count
        for district_id, user_id, count in await session.execute(
            select(CityCell.district_id, CityObject.owner_id, func.count())
            .join(CityObject, CityObject.id == CityCell.object_id)
            .where(CityCell.district_id.in_(ids), CityObject.owner_id.is_not(None))
            .group_by(CityCell.district_id, CityObject.owner_id)
        ):
            person(district_id, user_id)["cells"] += count
        for district_id, user_id, count in await session.execute(
            select(CityCell.district_id, CityCell.owner_id, func.count())
            .where(
                CityCell.district_id.in_(ids),
                CityCell.decor.is_not(None),
                CityCell.owner_id.is_not(None),
            )
            .group_by(CityCell.district_id, CityCell.owner_id)
        ):
            row = person(district_id, user_id)
            row["small"] += count
            row["cells"] += count
    owners = {user_id for _, user_id in people}
    names = (
        dict(
            (
                await session.execute(select(User.id, User.full_name).where(User.id.in_(owners)))
            ).all()
        )
        if owners
        else {}
    )
    rows, cities = [], {}
    for city in CITIES:
        sums = {"buildings": 0, "small": 0, "cells": 0, "builders": 0}
        for item in snapshot[city]["districts"]:
            key = item["id"]
            builders = sorted(
                (
                    (user_id, row)
                    for (district_id, user_id), row in people.items()
                    if district_id == key
                ),
                key=lambda pair: (-pair[1]["cells"], names.get(pair[0], "")),
            )
            small = sum(len(cells) for cells in item["decor"].values())
            row = {
                "id": key,
                "city": city,
                "name": item["name"],
                "number": item["number"],
                "buildings": len(item["objects"]),
                "families": dict(Counter(o["family"] for o in item["objects"])),
                "small": small,
                "decor": {family: len(cells) for family, cells in item["decor"].items()},
                "cells": item["land"]["taken"] if item["land"] else 0,
                "landmark_level": item["landmark"]["level"] if item["landmark"] else 1,
                "builders": len(builders),
                "top": [
                    {"name": names.get(user_id, "Оператор"), **row} for user_id, row in builders[:3]
                ],
            }
            rows.append(row)
            for name in ("buildings", "small", "cells", "builders"):
                sums[name] += row[name]
        cities[city] = sums
    mine = {}
    for (_, user_id), row in people.items():
        total = mine.setdefault(str(user_id), {"buildings": 0, "small": 0, "cells": 0})
        for name in total:
            total[name] += row[name]
    return {
        "buildings": sum(c["buildings"] for c in cities.values()),
        "small": sum(c["small"] for c in cities.values()),
        "builders": len(owners),
        "cities": cities,
        "districts": rows,
        # Each person's own part; a viewer is only ever shown theirs.
        "people": mine,
    }


# ---- what people see -----------------------------------------------------------------------------


def current_view(season, now):
    ends = aware(season.ends_at)
    return {
        "number": season.number,
        "started_at": aware(season.started_at),
        "period": season.period,
        "period_name": PERIOD_NAMES.get(season.period),
        "ends_at": ends,
        "warning": bool(ends and ends - now <= timedelta(days=WARN_DAYS)),
        "revision": season.revision,
    }


def past_view(season, user, now, names):
    started, ended = aware(season.started_at), aware(season.ended_at)
    totals = dict(season.totals or {})
    people = totals.pop("people", {})
    return {
        "id": season.id,
        "number": season.number,
        "started_at": started,
        "ended_at": ended,
        "days": max(1, round((ended - started).total_seconds() / 86400)),
        "period": season.period,
        "period_name": PERIOD_NAMES.get(season.period),
        "scheduled": season.ended_by_id is None,
        "ended_by": names.get(season.ended_by_id),
        "visible_until": None if staff(user) else ended + timedelta(days=VISIBLE_DAYS),
        "totals": {**totals, "mine": people.get(str(user.id))},
    }


async def overview(session, user):
    """The season going on and the past ones the viewer may see, newest first."""
    now = utcnow()
    season = await current(session)
    # The past cities themselves stay in the database: the list needs only their dates and totals.
    query = (
        select(CitySeason)
        .options(defer(CitySeason.snapshot))
        .where(CitySeason.ended_at.is_not(None))
        .order_by(CitySeason.number.desc())
    )
    if not staff(user):
        query = query.where(CitySeason.ended_at > now - timedelta(days=VISIBLE_DAYS))
    past = list(await session.scalars(query))
    resets = await session.scalar(
        select(func.count()).select_from(CitySeason).where(CitySeason.ended_at.is_not(None))
    )
    ids = {s.ended_by_id for s in past if s.ended_by_id}
    names = (
        dict((await session.execute(select(User.id, User.full_name).where(User.id.in_(ids)))).all())
        if ids
        else {}
    )
    return {
        "current": current_view(season, now),
        "history": [past_view(s, user, now, names) for s in past if visible(s, user, now)],
        "resets": resets,
        "can_manage": staff(user),
        "visible_days": VISIBLE_DAYS,
        "warn_days": WARN_DAYS,
        "periods": [{"id": key, "name": name} for key, name in PERIOD_NAMES.items()],
    }


async def past_city(session, user, season_id, city):
    """A past city's districts as everyone saw them on its last day, for the 3D view."""
    if city not in CITIES:
        raise NotFoundError("Город не найден")
    season = await session.get(CitySeason, season_id)
    if season is None or not visible(season, user, utcnow()):
        raise NotFoundError("Этого города уже нет в истории")
    data = (season.snapshot or {}).get(city) or {"city": city, "districts": []}
    return {
        **data,
        "history": {
            "season": season.id,
            "number": season.number,
            "started_at": aware(season.started_at),
            "ended_at": aware(season.ended_at),
        },
    }


# ---- what heads and administrators change --------------------------------------------------------


async def schedule(session, user, body):
    """The period and the next reset of both cities, or no schedule at all."""
    season = await current(session, lock=True)
    if body.revision != season.revision:
        raise ConflictError(
            "Расписание уже изменили. Обновите страницу и проверьте его.", code="revision_conflict"
        )
    now = utcnow()
    if body.period is None:
        season.period, season.ends_at = None, None
    else:
        ends = body.ends_at
        if ends.tzinfo is None:
            ends = ends.replace(tzinfo=ZoneInfo(settings.TIMEZONE))
        ends = ends.astimezone(UTC)
        if ends <= now + timedelta(minutes=1):
            raise DomainError("Дата сброса должна быть в будущем")
        if ends > now + timedelta(days=366):
            raise DomainError("Дата сброса — не позже чем через год")
        season.period, season.ends_at = body.period, ends
    season.revision += 1
    season.updated_by_id = user.id
    await write_audit(
        session,
        actor_id=user.id,
        action="city.season.schedule",
        entity_type="city_season",
        entity_id=season.id,
        payload={"period": season.period, "ends_at": season.ends_at and season.ends_at.isoformat()},
    )
    await session.commit()
    return await overview(session, user)


async def reset_now(session, user, body):
    """Ends the season going on at once, as the heads agreed."""
    await close(session, user, body.number)
    await session.commit()
    return await overview(session, user)
