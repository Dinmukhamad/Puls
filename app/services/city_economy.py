"""The city game's numbers, which the head and the admin set without a developer.

Until the first save the defaults of the code apply. Prices and the daily reward count for new
purchases and answers (a building keeps the price paid).
"""

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from app.core.errors import ConflictError
from app.models.city import CityEconomy
from app.services.rules import write_audit


def defaults():
    from app.services.city import BUILDINGS
    from app.services.city_estate import estate_defaults
    from app.services.city_quests import COINS

    return {
        "prices": {key: item["price"] for key, item in BUILDINGS.items()},
        "quest_coins": COINS,
        # Team districts (docs/CITY_ESTATES.md): coins per level of each building, a cell of land
        # in each band, a cell of each small thing, project estimates and HQ steps.
        **estate_defaults(),
    }


def same_shape(saved, default):
    """A saved list of level prices counts only while the catalogue has as many levels."""
    return {k: v for k, v in (saved or {}).items() if k in default and len(v) == len(default[k])}


async def economy(session):
    row = await session.get(CityEconomy, 1)
    values = defaults()
    if row:
        # Saved values over the defaults, so a building or kind of work added later has a value.
        values["prices"] |= {k: v for k, v in row.values["prices"].items() if k in values["prices"]}
        values["quest_coins"] = row.values["quest_coins"]
        for key in ("estate", "district"):
            values[key] |= same_shape(row.values.get(key), values[key])
        # Small things added later keep their default price until the head sets one.
        values["decor"] |= {
            k: v for k, v in (row.values.get("decor") or {}).items() if k in values["decor"]
        }
        if len(row.values.get("hq") or []) == len(values["hq"]):
            values["hq"] = row.values["hq"]
        land = row.values.get("land") or []
        if len(land) == len(values["land"]):
            # Land was priced per 3 × 3 plot until buildings took cells of their own size: such
            # a saved price becomes a ninth of itself per cell, so a house's land costs the same.
            per_cell = row.values.get("land_unit") == "cell"
            values["land"] = land if per_cell else [v and max(1, round(v / 9)) for v in land]
    return {"revision": row.revision if row else 0, **values}


async def save(session, actor, body):
    current = await economy(session)
    # A form of the earlier version sends no district prices: they stay as they are.
    values = {
        key: value if value is not None else current[key]
        for key, value in body.model_dump(exclude={"revision"}).items()
    }
    # The land prices saved from now on are per cell (see economy()); the mark stays in the row.
    stored = {**values, "land_unit": "cell"}
    revision = body.revision + 1
    if body.revision == 0:
        session.add(CityEconomy(id=1, revision=revision, values=stored, updated_by_id=actor.id))
    else:
        result = await session.execute(
            update(CityEconomy)
            .where(CityEconomy.id == 1, CityEconomy.revision == body.revision)
            .values(revision=revision, values=stored, updated_by_id=actor.id)
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
