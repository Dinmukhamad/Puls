"""Привязка личного чата Telegram и доставка кодов."""

import hashlib
import hmac
import logging
import re
import secrets
from datetime import UTC, timedelta

import httpx
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.errors import ConflictError, DomainError
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
        "pending_username": link.pending_username if link and not link.chat_id else None,
        "linked_at": as_utc(link.linked_at) if link and link.chat_id and link.linked_at else None,
        "bot_username": settings.TELEGRAM_BOT_USERNAME if bot_ready() else None,
    }


def issue_invitation(link, *, validity=timedelta(minutes=10)):
    token = secrets.token_urlsafe(24)
    link.link_hash = digest("telegram-link:" + token)
    link.link_expires_at = utcnow() + validity
    link.link_requested_at = utcnow()
    return {
        "url": f"https://t.me/{settings.TELEGRAM_BOT_USERNAME}?start=link_{token}",
        "expires_at": as_utc(link.link_expires_at),
    }


async def prepare_account_invitation(session, user_id, username):
    """Prepare a new binding within the caller's account transaction and user lock."""
    require_bot()
    occupied = await session.scalar(
        select(TelegramLink.user_id).where(
            TelegramLink.user_id != user_id,
            or_(
                TelegramLink.pending_username == username,
                (func.lower(TelegramLink.username) == username)
                & TelegramLink.chat_id.is_not(None),
            )
        )
    )
    if occupied is not None:
        await session.rollback()
        raise ConflictError("Этот Telegram уже указан для другого аккаунта Puls")
    link = await session.get(TelegramLink, user_id)
    if link is None:
        link = TelegramLink(user_id=user_id, version=1, send_count=0)
        session.add(link)
    else:
        clear_binding(link)
        await revoke_devices(session, user_id)
    link.pending_username = username
    invitation = issue_invitation(link, validity=timedelta(days=7))
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError("Этот Telegram уже указан для другого аккаунта Puls") from exc
    return invitation


def clear_binding(link):
    link.chat_id = None
    link.username = None
    link.pending_username = None
    link.linked_at = None
    link.link_hash = None
    link.link_expires_at = None
    link.link_requested_at = None
    link.version += 1


async def clear_account_binding(session, user_id):
    link = await session.get(TelegramLink, user_id)
    if link:
        clear_binding(link)
    await revoke_devices(session, user_id)


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
    # Подтверждённый пароль позволяет владельцу выбрать другой Telegram.
    link.pending_username = None
    invitation = issue_invitation(link)
    await session.commit()
    return invitation


async def disconnect(session, user_id, password):
    user = await lock_user(session, user_id)
    if not verify_password(password, user.hashed_password):
        raise DomainError("Неверный текущий пароль Puls")
    await clear_account_binding(session, user_id)
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
                if link.pending_username and (
                    sender.username or ""
                ).lower() != link.pending_username:
                    reply = (
                        "Этот Telegram не совпадает с указанным для аккаунта Puls. "
                        "Откройте ссылку из нужного аккаунта Telegram."
                    )
                elif occupied is not None:
                    reply = (
                        "Этот Telegram уже подключён к другому аккаунту Puls. "
                        "Сначала отключите прежнюю привязку в Puls."
                    )
                else:
                    link.chat_id = chat.id
                    link.username = sender.username
                    link.pending_username = None
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
                            "Коды для входа будут приходить сюда."
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
            "Для подключения откройте персональную ссылку от создателя аккаунта "
            "или получите новую в профиле Puls. "
            "Обращение — Смена → Чаты → Поддержка."
        )
    elif not text.startswith("/start"):
        return {}
    # Ответ Bot API внутри webhook: токен не попадает в ответ и не требуется
    # отдельный исходящий запрос для подтверждения привязки.
    return {"method": "sendMessage", "chat_id": chat.id, "text": reply}
