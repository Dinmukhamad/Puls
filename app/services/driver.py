from sqlalchemy import select

from app.core.errors import ConflictError, NotFoundError
from app.db.base import utcnow
from app.models.driver import DriverProfile, DriverSettings
from app.models.learning import LearningAttempt, LearningContent
from app.models.user import User
from app.services import driver_auth, driver_orders

# Начальные учебные варианты из предоставленного примера. После сохранения
# в студии используются настройки администратора, включая количество парков.
DEFAULT_PARKS = [
    {"id": "itaxi", "name": "iTaxi", "commission": 2},
    {"id": "jana-taxi", "name": "Jana Taxi", "commission": 2},
    {"id": "anytime", "name": "Anytime", "commission": 4.1},
]


async def parks(session):
    config = await session.get(DriverSettings, 1)
    return config.parks if config else DEFAULT_PARKS


def profile_data(profile):
    if profile is None:
        return None
    return {
        "stage": profile.stage,
        "service": profile.service,
        "park": profile.park,
        "created_at": profile.created_at,
        "last_login_at": profile.last_login_at,
    }


async def state(session, user_id, device_token=None):
    last = await session.scalar(
        select(LearningAttempt)
        .join(LearningContent, LearningContent.id == LearningAttempt.content_id)
        .where(
            LearningAttempt.user_id == user_id,
            LearningAttempt.state.in_(("passed", "failed")),
            LearningContent.kind == "simulator",
        )
        .order_by(LearningAttempt.finished_at.desc(), LearningAttempt.id.desc())
        .limit(1)
    )
    authentication = await driver_auth.device_state(session, user_id, device_token)
    profile = profile_data(await session.get(DriverProfile, user_id))
    if (
        profile
        and profile["stage"] in ("phone", "loading", "offline")
        and not authentication["verified"]
    ):
        profile["stage"] = "otp" if authentication["code_pending"] else "phone"
    elif profile and profile["stage"] == "phone" and authentication["verified"]:
        profile["stage"] = "loading"
    return {
        **await driver_orders.state(session, user_id),
        "profile": profile,
        "authentication": authentication,
        "parks": await parks(session),
        "last_result": {
            "attempt_id": last.id,
            "title": last.snapshot["title"],
            "state": last.state,
            "score": last.score,
        }
        if last
        else None,
    }


async def start(session, user_id):
    # Сериализация первого создания и повторных запусков одного аккаунта.
    await session.scalar(select(User.id).where(User.id == user_id).with_for_update())
    profile = await session.scalar(
        select(DriverProfile).where(DriverProfile.user_id == user_id).with_for_update()
    )
    if profile is None:
        profile = DriverProfile(user_id=user_id, stage="services")
        session.add(profile)
    else:
        if not await driver_orders.active_order(session, user_id):
            profile.stage = "services"
    await session.flush()
    return profile


async def act(session, user_id, payload, device_token=None):
    profile = await session.scalar(
        select(DriverProfile).where(DriverProfile.user_id == user_id).with_for_update()
    )
    if profile is None:
        raise NotFoundError("Сначала запустите Driver Simulator из обучения")
    if payload.action == "services":
        if await driver_orders.active_order(session, user_id):
            raise ConflictError("Сначала завершите или отмените текущий учебный заказ")
        profile.stage = "services"
    elif payload.action == "taxi":
        if profile.stage not in ("services", "cooperation"):
            raise ConflictError("Сначала откройте мои сервисы")
        profile.service = "taxi"
        profile.stage = "cooperation"
    elif payload.action == "park":
        if profile.stage != "cooperation":
            raise ConflictError("Сначала выберите сервис «Такси»")
        park = next((item for item in await parks(session) if item["id"] == payload.park_id), None)
        if park is None:
            raise ConflictError("Этот парк больше недоступен. Обновите список и выберите другой.")
        # Снимок сохраняет выбранные условия даже после редактирования справочника.
        profile.park = dict(park)
        verified = (await driver_auth.device_state(session, user_id, device_token))["verified"]
        profile.stage = "loading" if verified else "phone"
    elif payload.action == "enter":
        await driver_auth.require_verified(session, user_id, device_token)
        if profile.stage not in ("phone", "loading", "offline") or not profile.park:
            raise ConflictError("Сначала выберите вариант сотрудничества")
        if profile.stage in ("phone", "loading"):
            profile.last_login_at = utcnow()
            profile.stage = "offline"
    await session.flush()
    return profile
