"""Привязка личного чата Telegram и доставка кодов."""

import hashlib
import hmac
import logging
import re
import secrets
from datetime import UTC, timedelta

import httpx
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.errors import DomainError
from app.core.security import verify_password
from app.db.base import utcnow
from app.models.driver_auth import DriverDevice, TelegramLink
from app.models.user import User
from app.services.rules import write_audit

# URL Bot API содержит токен. Ни HTTP-логи, ни исключения провайдера не должны
# попадать в журнал приложения с этим URL.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


class TelegramUnavailable(DomainError):
    status_code = 503


class RateLimit(DomainError):
    status_code = 429


def digest(value):
    return hmac.new(settings.SECRET_KEY.encode(), value.encode(), hashlib.sha256).hexdigest()


def as_utc(value):
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def future(value):
    return value is not None and as_utc(value) > utcnow()


def bot_ready():
    return bool(
        settings.TELEGRAM_BOT_TOKEN.get_secret_value()
        and re.fullmatch(r"[A-Za-z0-9_]{5,32}", settings.TELEGRAM_BOT_USERNAME)
        and settings.TELEGRAM_WEBHOOK_URL.startswith("https://")
    )


def require_bot():
    if not bot_ready():
        raise TelegramUnavailable("Telegram-бот ещё не подключён администратором")


def webhook_secret():
    return digest("telegram-webhook:" + settings.TELEGRAM_BOT_TOKEN.get_secret_value())


async def bot_call(method, payload):
    require_bot()
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(
                f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN.get_secret_value()}/{method}",
                json=payload,
            )
        if response.status_code != 200 or not response.json().get("ok"):
            raise TelegramUnavailable(
                "Telegram не принял сообщение. Проверьте, что бот запущен и не заблокирован."
            )
        return response.json().get("result")
    except (httpx.HTTPError, ValueError):
        raise TelegramUnavailable("Не удалось связаться с Telegram. Повторите позже.") from None


async def configure_webhook():
    if not bot_ready():
        return
    me = await bot_call("getMe", {})
    if me.get("username", "").lower() != settings.TELEGRAM_BOT_USERNAME.lower():
        raise TelegramUnavailable("Имя Telegram-бота не соответствует настроенному токену")
    await bot_call(
        "setWebhook",
        {
            "url": settings.TELEGRAM_WEBHOOK_URL,
            "secret_token": webhook_secret(),
            "allowed_updates": ["message", "callback_query"],
            "max_connections": 5,
        },
    )


async def lock_user(session, user_id):
    return await session.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def revoke_devices(session, user_id):
    await session.execute(delete(DriverDevice).where(DriverDevice.user_id == user_id))


async def status(session, user_id):
    link = await session.get(TelegramLink, user_id)
    return {
        "configured": bot_ready(),
        "connected": bool(link and link.chat_id),
        "username": link.username if link and link.chat_id else None,
        "linked_at": as_utc(link.linked_at) if link and link.chat_id and link.linked_at else None,
        "bot_username": settings.TELEGRAM_BOT_USERNAME if bot_ready() else None,
    }


async def create_link(session, user_id, password):
    require_bot()
    user = await lock_user(session, user_id)
    if not verify_password(password, user.hashed_password):
        raise DomainError("Неверный текущий пароль Puls")
    link = await session.get(TelegramLink, user_id)
    if link is None:
        link = TelegramLink(user_id=user_id, version=1, send_count=0)
        session.add(link)
    if link.link_requested_at and as_utc(link.link_requested_at) + timedelta(seconds=30) > utcnow():
        raise RateLimit("Новую ссылку можно получить через 30 секунд")
    token = secrets.token_urlsafe(24)
    link.link_hash = digest("telegram-link:" + token)
    link.link_expires_at = utcnow() + timedelta(minutes=10)
    link.link_requested_at = utcnow()
    await session.commit()
    return {
        "url": f"https://t.me/{settings.TELEGRAM_BOT_USERNAME}?start=link_{token}",
        "expires_at": as_utc(link.link_expires_at),
    }


async def disconnect(session, user_id, password):
    user = await lock_user(session, user_id)
    if not verify_password(password, user.hashed_password):
        raise DomainError("Неверный текущий пароль Puls")
    link = await session.get(TelegramLink, user_id)
    if link:
        link.chat_id = None
        link.username = None
        link.linked_at = None
        link.link_hash = None
        link.link_expires_at = None
        link.version += 1
    await revoke_devices(session, user_id)
    await write_audit(
        session,
        actor_id=user_id,
        action="telegram.disconnect",
        entity_type="user",
        entity_id=user_id,
    )
    await session.commit()


async def receive_start(session, message):
    chat, sender = message.chat, message.sender
    if chat.type != "private" or sender is None or sender.is_bot or sender.id != chat.id:
        return {}
    text = message.text or ""
    reply = "Для подключения откройте свой профиль в Puls и нажмите «Подключить Telegram»."
    match = re.fullmatch(r"/start(?:@[A-Za-z0-9_]+)? link_([A-Za-z0-9_-]{32})", text)
    if match:
        hashed = digest("telegram-link:" + match.group(1))
        owner_id = await session.scalar(
            select(TelegramLink.user_id).where(TelegramLink.link_hash == hashed)
        )
        if owner_id is not None:
            user = await lock_user(session, owner_id)
            link = await session.scalar(
                select(TelegramLink)
                .where(TelegramLink.user_id == owner_id)
                .execution_options(populate_existing=True)
            )
            if user.is_active and link.link_hash == hashed and future(link.link_expires_at):
                occupied = await session.scalar(
                    select(TelegramLink.user_id).where(
                        TelegramLink.chat_id == chat.id, TelegramLink.user_id != owner_id
                    )
                )
                if occupied is not None:
                    reply = (
                        "Этот Telegram уже подключён к другому аккаунту Puls. "
                        "Сначала отключите прежнюю привязку в Puls."
                    )
                else:
                    link.chat_id = chat.id
                    link.username = sender.username
                    link.linked_at = utcnow()
                    link.link_hash = None
                    link.link_expires_at = None
                    link.version += 1
                    try:
                        await session.flush()
                        await revoke_devices(session, owner_id)
                        await write_audit(
                            session,
                            actor_id=owner_id,
                            action="telegram.connect",
                            entity_type="user",
                            entity_id=owner_id,
                        )
                        await session.commit()
                        reply = (
                            "Telegram подключён к вашему аккаунту Puls. "
                            "Вернитесь в Driver Simulator: коды для входа будут приходить сюда."
                        )
                    except IntegrityError:
                        await session.rollback()
                        reply = "Этот Telegram уже подключён. Проверьте привязку в профиле Puls."
            else:
                reply = "Ссылка истекла или уже использована. Получите новую в профиле Puls."
        else:
            reply = "Ссылка истекла или уже использована. Получите новую в профиле Puls."
    elif text.startswith("/help"):
        reply = (
            "Бот присылает коды входа и проводит учебный разбор обращения. "
            "Подключение — в профиле Puls; обращение — Смена → Чаты → Поддержка."
        )
    elif not text.startswith("/start"):
        return {}
    # Ответ Bot API внутри webhook: токен не попадает в ответ и не требуется
    # отдельный исходящий запрос для подтверждения привязки.
    return {"method": "sendMessage", "chat_id": chat.id, "text": reply}
