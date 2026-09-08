from typing import Annotated

from fastapi import APIRouter, Header, Response
from sqlalchemy import select

from app.core.deps import CurrentUser, HeadUser, SessionDep, StaffUser
from app.models.driver import DriverSettings
from app.models.driver_auth import DriverDevice
from app.models.user import User
from app.schemas.driver import DriverAction, DriverParksInput
from app.schemas.telegram import DriverCode, DriverPhone
from app.services import driver, driver_auth, telegram
from app.services.rules import write_audit

router = APIRouter(tags=["Driver Simulator"])
DeviceToken = Annotated[str | None, Header(alias="X-Driver-Device", max_length=100)]


@router.get("/learning/driver")
async def state(
    session: SessionDep, user: CurrentUser, response: Response, device: DeviceToken = None
):
    response.headers["Cache-Control"] = "no-store"
    return await driver.state(session, user.id, device)


@router.post("/learning/driver/start")
async def start(session: SessionDep, user: CurrentUser, device: DeviceToken = None):
    await driver.start(session, user.id)
    await session.commit()
    return await driver.state(session, user.id, device)


@router.put("/learning/driver/action")
async def action(
    session: SessionDep, user: CurrentUser, payload: DriverAction, device: DeviceToken = None
):
    await driver.act(session, user.id, payload, device)
    await session.commit()
    return await driver.state(session, user.id, device)


@router.post("/learning/driver/code")
async def send_code(
    session: SessionDep, user: CurrentUser, payload: DriverPhone, device: DeviceToken = None
):
    await driver_auth.issue_code(session, user.id, device, payload.phone)
    return await driver.state(session, user.id, device)


@router.post("/learning/driver/verify")
async def verify_code(
    session: SessionDep, user: CurrentUser, payload: DriverCode, device: DeviceToken = None
):
    await driver_auth.verify_code(session, user.id, device, payload.code)
    return await driver.state(session, user.id, device)


@router.delete("/learning/driver/device")
async def forget_device(session: SessionDep, user: CurrentUser, device: DeviceToken = None):
    await telegram.lock_user(session, user.id)
    hashed = driver_auth.device_hash(user.id, device)
    record = await session.get(DriverDevice, hashed) if hashed else None
    if record:
        await session.delete(record)
        await session.commit()
    return await driver.state(session, user.id, device)


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
