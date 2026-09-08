from fastapi import APIRouter
from sqlalchemy import select

from app.core.deps import CurrentUser, HeadUser, SessionDep, StaffUser
from app.models.driver import DriverSettings
from app.models.user import User
from app.schemas.driver import DriverAction, DriverParksInput
from app.services import driver
from app.services.rules import write_audit

router = APIRouter(tags=["Driver Simulator"])


@router.get("/learning/driver")
async def state(session: SessionDep, user: CurrentUser):
    return await driver.state(session, user.id)


@router.post("/learning/driver/start")
async def start(session: SessionDep, user: CurrentUser):
    await driver.start(session, user.id)
    await session.commit()
    return await driver.state(session, user.id)


@router.put("/learning/driver/action")
async def action(session: SessionDep, user: CurrentUser, payload: DriverAction):
    await driver.act(session, user.id, payload)
    await session.commit()
    return await driver.state(session, user.id)


@router.get("/admin/learning/driver-parks")
async def parks(session: SessionDep, _: StaffUser):
    return {"parks": await driver.parks(session)}


@router.put("/admin/learning/driver-parks")
async def save_parks(session: SessionDep, actor: HeadUser, payload: DriverParksInput):
    # Блокировка стабильной строки предотвращает гонку первого создания настроек.
    await session.scalar(select(User.id).order_by(User.id).limit(1).with_for_update())
    config = await session.get(DriverSettings, 1)
    before = await driver.parks(session)
    if config is None:
        config = DriverSettings(id=1)
        session.add(config)
    config.parks = payload.model_dump()["parks"]
    await write_audit(
        session,
        actor_id=actor.id,
        action="driver.parks.save",
        entity_type="driver_settings",
        entity_id=1,
        payload={"before": before, "after": config.parks},
    )
    await session.commit()
    return {"parks": config.parks}
