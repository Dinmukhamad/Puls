from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.deps import (
    CurrentUser,
    HeadUser,
    PaginationDep,
    SessionDep,
    StaffUser,
    visible_users_filter,
)
from app.models.driver import DriverSettings
from app.models.driver_auth import DriverDevice
from app.models.driver_shift import DriverShift
from app.models.user import User
from app.schemas.driver import DriverAction, DriverOrderAction, DriverOrderCreate, DriverParksInput
from app.schemas.driver_shift import DriverScenario, ShiftAction, ShiftStart, SupportCreate
from app.schemas.telegram import DriverCode, DriverPhone
from app.services import driver, driver_auth, driver_orders, driver_shifts, driver_support, telegram
from app.services.rules import write_audit

router = APIRouter(tags=["Driver Simulator"])
DeviceToken = Annotated[str | None, Header(alias="X-Driver-Device", max_length=100)]


@router.post("/learning/driver/shifts")
async def start_shift(
    session: SessionDep, user: CurrentUser, payload: ShiftStart, device: DeviceToken = None
):
    user_id = user.id
    for attempt in range(2):
        try:
            await telegram.lock_user(session, user_id)
            existing = await session.get(
                DriverShift, str(payload.id)
            ) or await driver_shifts.active(session, user_id)
            await driver_shifts.start(session, user_id, payload)
            if not existing:
                await driver.start(session, user_id)
            await session.commit()
            break
        except IntegrityError:
            await session.rollback()
            if attempt:
                raise
    return await driver.state(session, user_id, device)


@router.get("/admin/learning/driver-results")
async def shift_results(session: SessionDep, actor: StaffUser, pagination: PaginationDep):
    conditions = [await visible_users_filter(session, actor)]
    total = await session.scalar(select(func.count(DriverShift.id)).join(User).where(*conditions))
    rows = await session.execute(
        select(DriverShift, User.full_name)
        .join(User)
        .where(*conditions)
        .order_by(DriverShift.created_at.desc())
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    return {
        "total": total,
        "items": [
            {
                "id": s.id,
                "user_id": s.user_id,
                "full_name": name,
                "mode": s.mode,
                "title": s.config["title"],
                "created_at": s.created_at,
                "finished_at": s.finished_at,
                "completed": s.data["completed"],
                "result": s.result,
            }
            for s, name in rows
        ],
    }


@router.put("/learning/driver/shifts/{shift_id}/action")
async def shift_action(
    shift_id: UUID,
    session: SessionDep,
    user: CurrentUser,
    payload: ShiftAction,
    device: DeviceToken = None,
):
    await driver_shifts.act(session, user.id, shift_id, payload, device)
    await session.commit()
    return await driver.state(session, user.id, device)


@router.post("/learning/driver/shifts/{shift_id}/support")
async def shift_support(
    shift_id: UUID,
    session: SessionDep,
    user: CurrentUser,
    payload: SupportCreate,
    response: Response,
    device: DeviceToken = None,
):
    response.headers["Cache-Control"] = "no-store"
    result = await driver_support.create(session, user.id, shift_id, payload, device)
    await session.commit()
    return result


@router.get("/admin/learning/driver-scenario")
async def scenario(session: SessionDep, _: StaffUser):
    return await driver_shifts.configuration(session)


@router.put("/admin/learning/driver-scenario")
async def save_scenario(session: SessionDep, actor: HeadUser, payload: DriverScenario):
    from app.core.errors import DomainError

    if payload.required_park not in {p["id"] for p in await driver.parks(session)}:
        raise DomainError("Выберите существующий парк задания")
    await session.scalar(select(User.id).order_by(User.id).limit(1).with_for_update())
    config = await session.get(DriverSettings, 1)
    before = await driver_shifts.configuration(session)
    if config is None:
        config = DriverSettings(id=1, parks=driver.DEFAULT_PARKS)
        session.add(config)
    config.scenario = payload.model_dump()
    await write_audit(
        session,
        actor_id=actor.id,
        action="driver.scenario.save",
        entity_type="driver_settings",
        entity_id=1,
        payload={"before": before, "after": config.scenario},
    )
    await session.commit()
    return config.scenario


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


@router.post("/learning/driver/orders")
async def create_order(
    session: SessionDep, user: CurrentUser, payload: DriverOrderCreate, device: DeviceToken = None
):
    user_id = user.id
    try:
        await driver_orders.create(session, user_id, payload, device)
    except IntegrityError:
        # После гонки SQLite читаем победивший запрос или возвращаем 409.
        await session.rollback()
        await driver_orders.create(session, user_id, payload, device)
    await session.commit()
    return await driver.state(session, user_id, device)


@router.put("/learning/driver/orders/{order_id}/action")
async def order_action(
    order_id: UUID,
    session: SessionDep,
    user: CurrentUser,
    payload: DriverOrderAction,
    device: DeviceToken = None,
):
    await driver_orders.act(session, user.id, order_id, payload, device)
    await session.commit()
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
