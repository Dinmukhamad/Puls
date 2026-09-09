"""Учебная поддержка: одноразовая ссылка и ответы только владельца смены."""

import re
import secrets
from contextlib import suppress
from copy import deepcopy
from datetime import timedelta
from uuid import uuid4

from sqlalchemy import select

from app.core.config import settings
from app.core.errors import ConflictError
from app.db.base import utcnow
from app.models.driver import DriverOrder, DriverProfile
from app.models.driver_auth import TelegramLink
from app.models.driver_shift import DriverShift, DriverSupportCase
from app.services import driver_shifts, telegram


def public(case):
    return {
        "id": case.id,
        "topic": case.topic,
        "status": case.status,
        "step": case.step,
        "total": len(case.config["steps"]),
        "order_id": case.order_id,
        "created_at": case.created_at,
        "finished_at": case.finished_at,
    }


async def create(session, user_id, shift_id, payload, device):
    telegram.require_bot()
    await telegram.lock_user(session, user_id)
    shift = await driver_shifts.require_shift(session, user_id, shift_id, device)
    if shift.finished_at:
        raise ConflictError("Начните новую учебную смену")
    link = await session.get(TelegramLink, user_id)
    if not link or not link.chat_id:
        raise ConflictError("Сначала подключите Telegram в профиле Puls")
    case = await session.get(DriverSupportCase, str(payload.id))
    if case and (
        case.user_id != user_id or case.shift_id != shift.id or case.topic != payload.topic
    ):
        raise ConflictError("Запрос уже использован")
    if case is None:
        case = await session.scalar(
            select(DriverSupportCase)
            .where(
                DriverSupportCase.shift_id == shift.id,
                DriverSupportCase.status.in_(("pending", "active")),
            )
            .with_for_update()
        )
    if case is None:
        order = await session.scalar(
            select(DriverOrder)
            .where(DriverOrder.shift_id == shift.id)
            .order_by(DriverOrder.created_at.desc())
            .limit(1)
        )
        case = DriverSupportCase(
            id=str(payload.id),
            shift_id=shift.id,
            user_id=user_id,
            order_id=order.id if order else None,
            topic=payload.topic,
            telegram_version=link.version,
            config={
                "steps": deepcopy(shift.config["support_steps"]),
                "checked_wallet": shift.data.get("problem_inspected", False),
                "assigned": shift.data["payout_problem"],
            },
            status="pending",
            step=0,
            answers=[],
        )
        session.add(case)
        data = deepcopy(shift.data)
        data["messages"].append(
            {
                "id": case.id,
                "channel": "support",
                "title": "Учебное обращение открыто",
                "text": "Продолжите диалог в своём Telegram.",
                "at": utcnow().isoformat(),
            }
        )
        await driver_shifts.save(
            session,
            shift,
            data,
            "support_open",
            uuid4(),
            {"case_id": case.id, "checked_wallet": case.config["checked_wallet"]},
        )
    if case.status == "complete":
        return {"case": public(case), "url": None}
    token = secrets.token_urlsafe(24)
    case.token_hash = telegram.digest("support:" + token)
    case.expires_at = utcnow() + timedelta(minutes=15)
    case.telegram_version = link.version
    await session.flush()
    return {
        "case": public(case),
        "url": f"https://t.me/{settings.TELEGRAM_BOT_USERNAME}?start=shift_{token}",
    }


def message(case, prefix=""):
    if case.status == "complete":
        return {
            "text": prefix
            + "\nУчебное обращение завершено. Вернитесь в Puls и проверьте статус операции.",
            "reply_markup": {
                "inline_keyboard": [
                    [
                        {
                            "text": "Вернуться в смену",
                            "url": settings.DRIVER_APP_URL + "?section=money",
                        }
                    ]
                ]
            },
        }
    step = case.config["steps"][case.step]
    return {
        "text": (
            f"{prefix}\nУчебная поддержка Puls · {case.step + 1}/"
            f"{len(case.config['steps'])}\n{step['question']}"
        ).strip(),
        "reply_markup": {
            "inline_keyboard": [
                [{"text": option, "callback_data": f"ds:{case.id}:{case.step}:{index}"}]
                for index, option in enumerate(step["options"])
            ]
        },
    }


async def receive(session, update):
    callback = update.callback_query
    incoming = callback.message if callback else update.message
    sender = callback.sender if callback else incoming.sender if incoming else None
    if (
        not incoming
        or not sender
        or sender.is_bot
        or incoming.chat.type != "private"
        or incoming.chat.id != sender.id
    ):
        return {}
    link = await session.scalar(select(TelegramLink).where(TelegramLink.chat_id == sender.id))
    if not link:
        return {
            "method": "sendMessage",
            "chat_id": sender.id,
            "text": "Подключите этот Telegram в профиле Puls.",
        }
    # Одинаковый порядок блокировок с HTTP-командами: пользователь → профиль → смена → обращение.
    await telegram.lock_user(session, link.user_id)
    await session.refresh(link)
    if link.chat_id != sender.id:
        return {}
    await session.scalar(
        select(DriverProfile).where(DriverProfile.user_id == link.user_id).with_for_update()
    )
    if callback:
        match = re.fullmatch(r"ds:([a-f0-9-]{36}):(\d{1,2}):([0-3])", callback.data or "")
        case = await session.get(DriverSupportCase, match[1]) if match else None
    else:
        match = re.fullmatch(r"/start(?:@\w+)? shift_([A-Za-z0-9_-]{32})", incoming.text or "")
        case = (
            await session.scalar(
                select(DriverSupportCase).where(
                    DriverSupportCase.token_hash == telegram.digest("support:" + match[1])
                )
            )
            if match
            else None
        )
    if not case or case.user_id != link.user_id or case.telegram_version != link.version:
        return {
            "method": "sendMessage",
            "chat_id": sender.id,
            "text": "Ссылка недействительна. Откройте поддержку из своей смены Puls.",
        }
    shift = await session.scalar(
        select(DriverShift).where(DriverShift.id == case.shift_id).with_for_update()
    )
    await session.refresh(case, with_for_update=True)
    if shift.finished_at:
        return {
            "method": "sendMessage",
            "chat_id": sender.id,
            "text": "Эта учебная смена уже завершена.",
        }
    prefix = ""
    if not callback:
        if not case.token_hash or not telegram.future(case.expires_at):
            return {
                "method": "sendMessage",
                "chat_id": sender.id,
                "text": "Срок ссылки истёк. Получите новую в Puls.",
            }
        case.token_hash = None
        case.expires_at = None
        case.status = "active"
    elif case.status == "pending":
        return {}
    elif case.status == "active" and int(match[2]) == case.step:
        step, choice = case.config["steps"][case.step], int(match[3])
        if choice >= len(step["options"]):
            return {}
        correct = choice == step["correct"]
        case.answers = [
            *case.answers,
            {"step": case.step, "choice": choice, "correct": correct, "at": utcnow().isoformat()},
        ]
        case.step += 1
        prefix = ("Верно. " if correct else "Разбор: ") + step["explanation"]
        data = deepcopy(shift.data)
        data["support_errors"] += int(not correct)
        if case.step == len(case.config["steps"]):
            case.status = "complete"
            case.finished_at = utcnow()
            data["support_completed"] += 1
            if case.config["assigned"]:
                data["support_checked_wallet"] = case.config["checked_wallet"]
                data["payout_problem"] = False
                for entry in data["ledger"]:
                    if entry["kind"] == "withdraw" and entry["status"] == "pending":
                        entry["status"] = "complete"
                        entry["note"] = "Учебная выплата проведена после разбора обращения"
            data["messages"].append(
                {
                    "id": str(uuid4()),
                    "channel": "answers",
                    "title": "Ответ поддержки",
                    "text": "Учебный разбор завершён. Проверьте операции и продолжите смену.",
                    "at": utcnow().isoformat(),
                }
            )
        await driver_shifts.save(
            session,
            shift,
            data,
            "support_answer",
            uuid4(),
            {"case_id": case.id, "step": case.step - 1, "correct": correct},
        )
    await session.commit()
    response = {"method": "sendMessage", "chat_id": sender.id, **message(case, prefix)}
    if callback and incoming.message_id:
        response.update(method="editMessageText", message_id=incoming.message_id)
        # Результат уже сохранён; повтор webhook не начисляет его ещё раз.
        with suppress(telegram.TelegramUnavailable):
            await telegram.bot_call("answerCallbackQuery", {"callback_query_id": callback.id})
    return response
