import hmac
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Response

from app.core.deps import CurrentUser, SessionDep
from app.schemas.telegram import TelegramPassword, TelegramUpdate
from app.services import driver_support, telegram

router = APIRouter(prefix="/auth/telegram", tags=["Telegram"])


@router.get("")
async def status(session: SessionDep, user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await telegram.status(session, user.id)


@router.post("/link")
async def link(
    session: SessionDep, user: CurrentUser, payload: TelegramPassword, response: Response
):
    response.headers["Cache-Control"] = "no-store"
    return await telegram.create_link(session, user.id, payload.current_password)


@router.post("/disconnect")
async def disconnect(session: SessionDep, user: CurrentUser, payload: TelegramPassword):
    await telegram.disconnect(session, user.id, payload.current_password)
    return await telegram.status(session, user.id)


@router.post("/webhook")
async def webhook(
    session: SessionDep,
    payload: TelegramUpdate,
    secret: Annotated[
        str | None, Header(alias="X-Telegram-Bot-Api-Secret-Token", max_length=256)
    ] = None,
):
    if (
        not telegram.bot_ready()
        or not secret
        or not hmac.compare_digest(secret.encode(), telegram.webhook_secret().encode())
    ):
        raise HTTPException(status_code=403, detail="Webhook не авторизован")
    if payload.callback_query or (payload.message and " shift_" in (payload.message.text or "")):
        return await driver_support.receive(session, payload)
    return await telegram.receive_start(session, payload.message) if payload.message else {}
