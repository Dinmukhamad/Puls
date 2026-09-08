import hmac
import re
import secrets
from datetime import timedelta

from sqlalchemy import update

from app.core.config import settings
from app.core.errors import ConflictError, DomainError, PermissionDeniedError
from app.db.base import utcnow
from app.models.driver import DriverProfile
from app.models.driver_auth import DriverDevice, TelegramLink
from app.models.user import User
from app.services import telegram


def device_hash(user_id, token):
    if not token or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        return None
    return telegram.digest(f"driver-device:{user_id}:{token}")


async def device_state(session, user_id, token):
    user = await session.get(User, user_id)
    link = await session.get(TelegramLink, user_id)
    hashed = device_hash(user_id, token)
    device = await session.get(DriverDevice, hashed) if hashed else None
    matches = bool(
        user.phone
        and link
        and link.chat_id
        and device
        and device.phone == user.phone
        and device.telegram_version == link.version
    )
    verified = bool(matches and telegram.future(device.valid_until))
    pending = bool(
        matches
        and device.code_hash
        and telegram.future(device.code_expires_at)
        and device.attempts < 5
    )
    return {
        "verified": verified,
        "valid_until": telegram.as_utc(device.valid_until) if verified else None,
        "phone_set": bool(user.phone),
        "telegram_connected": bool(link and link.chat_id),
        "telegram_configured": telegram.bot_ready(),
        "code_pending": pending,
        "code_expires_at": telegram.as_utc(device.code_expires_at) if pending else None,
        "next_send_at": telegram.as_utc(device.next_send_at)
        if device and device.next_send_at
        else None,
        "remember_days": settings.DRIVER_DEVICE_DAYS,
    }


async def require_verified(session, user_id, token):
    if not (await device_state(session, user_id, token))["verified"]:
        raise PermissionDeniedError(
            "Подтвердите вход кодом из Telegram", code="driver_verification_required"
        )


async def issue_code(session, user_id, token, phone):
    telegram.require_bot()
    user = await telegram.lock_user(session, user_id)
    profile = await session.get(DriverProfile, user_id)
    if not profile or not profile.park or profile.stage not in ("phone", "loading", "offline"):
        raise ConflictError("Сначала выберите таксопарк")
    if not user.phone:
        raise ConflictError("В вашем профиле не указан телефон. Обратитесь к руководителю.")
    if phone != user.phone:
        raise DomainError("Номер не совпадает с номером в вашем профиле Puls")
    link = await session.get(TelegramLink, user_id)
    if not link or not link.chat_id:
        raise ConflictError("Сначала подключите Telegram в своём профиле Puls")
    hashed = device_hash(user_id, token)
    if not hashed:
        raise DomainError("Не удалось определить браузер. Разрешите сохранение данных сайта.")
    now = utcnow()
    device = await session.get(DriverDevice, hashed)
    if device and telegram.future(device.next_send_at):
        raise telegram.RateLimit("Повторный код можно запросить через минуту")
    if not link.send_window_at or telegram.as_utc(link.send_window_at) + timedelta(hours=1) <= now:
        link.send_window_at = now
        link.send_count = 0
    if link.send_count >= 5:
        raise telegram.RateLimit("За час можно запросить не более пяти кодов. Попробуйте позже.")
    if device is None:
        device = DriverDevice(secret_hash=hashed, user_id=user_id)
        session.add(device)
    code = f"{secrets.randbelow(1000000):06d}"
    code_hash = telegram.digest(f"driver-code:{hashed}:{code}")
    device.phone = user.phone
    device.telegram_version = link.version
    device.valid_until = None
    device.code_hash = code_hash
    device.code_expires_at = now + timedelta(minutes=5)
    device.attempts = 0
    device.next_send_at = now + timedelta(seconds=60)
    link.send_count += 1
    # Лимиты переживают сбой Telegram. Ни код, ни секрет браузера не хранятся открыто.
    chat_id = link.chat_id
    await session.commit()
    try:
        await telegram.bot_call(
            "sendMessage",
            {
                "chat_id": chat_id,
                "text": (
                    f"Код для входа в Driver Simulator: {code}\n"
                    "Действует 5 минут. Никому не сообщайте код."
                ),
                "protect_content": True,
            },
        )
    except telegram.TelegramUnavailable:
        await session.execute(
            update(DriverDevice)
            .where(
                DriverDevice.secret_hash == hashed,
                DriverDevice.code_hash == code_hash,
            )
            .values(code_hash=None, code_expires_at=None)
        )
        await session.commit()
        raise


async def verify_code(session, user_id, token, code):
    user = await telegram.lock_user(session, user_id)
    hashed = device_hash(user_id, token)
    device = await session.get(DriverDevice, hashed) if hashed else None
    link = await session.get(TelegramLink, user_id)
    profile = await session.get(DriverProfile, user_id)
    if not profile or not profile.park or profile.stage not in ("phone", "loading", "offline"):
        raise ConflictError("Сначала выберите таксопарк")
    if (
        not device
        or not device.code_hash
        or not telegram.future(device.code_expires_at)
        or device.attempts >= 5
    ):
        raise DomainError("Код истёк или уже использован. Запросите новый.")
    if (
        not link
        or not link.chat_id
        or device.telegram_version != link.version
        or device.phone != user.phone
    ):
        raise DomainError("Данные аккаунта изменились. Запросите новый код.")
    if not hmac.compare_digest(device.code_hash, telegram.digest(f"driver-code:{hashed}:{code}")):
        device.attempts += 1
        if device.attempts >= 5:
            device.code_hash = None
        await session.commit()  # Неверные попытки нельзя откатывать вместе с HTTP-ошибкой.
        raise DomainError(
            "Неверный код"
            if device.attempts < 5
            else "Лимит попыток исчерпан. Запросите новый код."
        )
    device.code_hash = None
    device.code_expires_at = None
    device.valid_until = utcnow() + timedelta(days=settings.DRIVER_DEVICE_DAYS)
    profile.stage = "loading"
    await session.commit()
