"""The city game's numbers, which the head and the admin set without a developer.

Until the first save the defaults of the code apply. Prices and the daily reward count for new
purchases and answers (a building keeps the price paid); points and quarter costs are applied to
the group city at once, since its progress is always counted from the work itself.
"""

from copy import deepcopy

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from app.core.errors import ConflictError
from app.models.city import CityEconomy
from app.services.rules import write_audit


def defaults():
    from app.services.city import BUILDINGS
    from app.services.city_group import POINTS, PROJECTS
    from app.services.city_quests import COINS

    return {
        "prices": {key: item["price"] for key, item in BUILDINGS.items()},
        "points": dict(POINTS),
        "projects": deepcopy(PROJECTS),
        "quest_coins": COINS,
    }


async def economy(session):
    row = await session.get(CityEconomy, 1)
    values = defaults()
    if row:
        # Saved values over the defaults, so a building or kind of work added later has a value.
        values["prices"] |= {k: v for k, v in row.values["prices"].items() if k in values["prices"]}
        values["points"] |= {k: v for k, v in row.values["points"].items() if k in values["points"]}
        saved = {p["key"]: p for p in row.values["projects"]}
        values["projects"] = [saved.get(p["key"], p) for p in values["projects"]]
        values["quest_coins"] = row.values["quest_coins"]
    return {"revision": row.revision if row else 0, **values}


async def save(session, actor, body):
    values = body.model_dump(exclude={"revision"})
    revision = body.revision + 1
    if body.revision == 0:
        session.add(CityEconomy(id=1, revision=revision, values=values, updated_by_id=actor.id))
    else:
        result = await session.execute(
            update(CityEconomy)
            .where(CityEconomy.id == 1, CityEconomy.revision == body.revision)
            .values(revision=revision, values=values, updated_by_id=actor.id)
        )
        if result.rowcount != 1:
            raise ConflictError("Настройки уже изменили. Обновите страницу и повторите.")
    try:
        await write_audit(
            session,
            actor_id=actor.id,
            action="city.economy",
            entity_type="city_economy",
            entity_id="1",
            payload={"revision": revision, **values},
        )
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise ConflictError("Настройки уже изменили. Обновите страницу.") from None
    return {"revision": revision, **values}
