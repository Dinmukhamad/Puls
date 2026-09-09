import re
import secrets
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import select

from app.core.config import settings
from app.db.base import utcnow
from app.models.driver_auth import DriverDevice, TelegramLink
from app.models.settings import AuditLog
from app.services import driver_auth, telegram
from tests.conftest import auth, login, make_user
from tests.test_driver import BASE, act

TG = "/api/v1/auth/telegram"
PHONE = "+77001234567"


@pytest.fixture
def bot(monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", SecretStr("123:fake-test-token"))
    monkeypatch.setattr(settings, "TELEGRAM_BOT_USERNAME", "puls_i_bot")
    monkeypatch.setattr(settings, "TELEGRAM_WEBHOOK_URL", "https://example.test" + TG + "/webhook")
    deliveries = []

    async def send(method, payload):
        deliveries.append((method, payload))
        return {"username": "puls_i_bot"} if method == "getMe" else True

    monkeypatch.setattr(telegram, "bot_call", send)
    return deliveries


async def invitation(client, headers):
    response = await client.post(
        TG + "/link", headers=headers, json={"current_password": "password123"}
    )
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["url"].startswith("https://t.me/puls_i_bot?start=link_")
    return parse_qs(urlsplit(response.json()["url"]).query)["start"][0]


async def webhook(client, start, chat_id=12345, **kwargs):
    message = {
        "chat": {"id": chat_id, "type": "private"},
        "from": {"id": chat_id, "is_bot": False, "username": "employee"},
        "text": "/start " + start,
        **kwargs,
    }
    return await client.post(
        TG + "/webhook",
        headers={"X-Telegram-Bot-Api-Secret-Token": telegram.webhook_secret()},
        json={"update_id": 1, "message": message},
    )


@pytest.fixture
async def account(client, session, operator, bot):
    operator.phone = PHONE
    await session.commit()
    headers = auth(await login(client, operator.login))
    headers["X-Driver-Device"] = secrets.token_urlsafe(32)
    result = await webhook(client, await invitation(client, headers))
    assert result.status_code == 200
    assert "подключён" in result.json()["text"]
    await client.post(BASE + "/start", headers=headers)
    await act(client, headers, "taxi")
    result = await act(client, headers, "park", park_id="itaxi")
    assert result.json()["profile"]["stage"] == "phone"
    return headers


async def send_code(client, headers):
    return await client.post(BASE + "/code", headers=headers, json={"phone": PHONE})


def delivered_code(bot):
    method, payload = bot[-1]
    assert method == "sendMessage"
    assert payload["chat_id"] == 12345
    assert payload["protect_content"] is True
    return re.search(r"\b[0-9]{6}\b", payload["text"])[0]


async def verify(client, headers, code):
    return await client.post(BASE + "/verify", headers=headers, json={"code": code})


async def test_full_login_remembers_only_confirmed_browser(client, session, operator, account, bot):
    assert (await act(client, account, "enter")).status_code == 403
    response = await send_code(client, account)
    assert response.status_code == 200, response.text
    assert response.json()["profile"]["stage"] == "otp"
    for field in ("code_expires_at", "next_send_at"):
        assert response.json()["authentication"][field].endswith("+00:00")
    code = delivered_code(bot)
    assert code not in response.text
    assert account["X-Driver-Device"] not in response.text
    record = await session.get(
        DriverDevice, driver_auth.device_hash(operator.id, account["X-Driver-Device"])
    )
    assert record.code_hash != code and record.secret_hash != account["X-Driver-Device"]
    other_browser = {**account, "X-Driver-Device": secrets.token_urlsafe(32)}
    assert (await verify(client, other_browser, code)).status_code == 400
    response = await verify(client, account, code)
    assert response.status_code == 200, response.text
    state = response.json()
    assert state["authentication"]["verified"] is True
    assert state["authentication"]["valid_until"].endswith("+00:00")
    assert state["profile"]["stage"] == "loading"
    await session.refresh(record)
    assert 29 < (telegram.as_utc(record.valid_until) - utcnow()).total_seconds() / 86400 <= 30
    assert record.code_hash is None
    assert (await act(client, account, "enter")).json()["profile"]["stage"] == "offline"
    assert (await verify(client, account, code)).status_code == 400
    # Глобальный этап профиля и прямая ссылка не заменяют доказательство браузера.
    assert (await client.get(BASE, headers=other_browser)).json()["profile"]["stage"] == "phone"
    assert (await act(client, other_browser, "enter")).status_code == 403
    assert (
        await client.get(BASE, headers={"X-Driver-Device": account["X-Driver-Device"]})
    ).status_code == 401
    await client.post(BASE + "/start", headers=account)
    await act(client, account, "taxi")
    response = await act(client, account, "park", park_id="itaxi")
    assert response.json()["profile"]["stage"] == "loading"
    assert len(bot) == 1
    assert (await client.get(BASE, headers=account)).headers["cache-control"] == "no-store"


async def test_binding_uses_password_single_use_link_and_immutable_chat(
    client, session, operator, bot
):
    headers = auth(await login(client, operator.login))
    wrong = await client.post(TG + "/link", headers=headers, json={"current_password": "wrong"})
    assert wrong.status_code == 400
    start = await invitation(client, headers)
    unauthenticated = await client.post(TG + "/webhook", json={"update_id": 1})
    assert unauthenticated.status_code == 403
    forged = await webhook(client, start, **{"from": {"id": 555, "is_bot": False}})
    assert forged.json() == {}
    group = await webhook(client, start, chat={"id": -12345, "type": "group"})
    assert group.json() == {}
    assert (await client.get(TG, headers=headers)).json()["connected"] is False
    assert (await webhook(client, start)).status_code == 200
    status = (await client.get(TG, headers=headers)).json()
    assert status["connected"] is True
    assert status["username"] == "employee"
    assert "chat_id" not in status and "link_hash" not in status
    await webhook(client, start, chat_id=98765)
    record = await session.get(TelegramLink, operator.id)
    assert record.chat_id == 12345 and record.link_hash is None
    audits = list(
        await session.scalars(select(AuditLog).where(AuditLog.action == "telegram.connect"))
    )
    assert len(audits) == 1
    assert start not in str(audits[0].payload)
    other = await make_user(session, login="other-telegram")
    other_headers = auth(await login(client, other.login))
    response = await webhook(client, await invitation(client, other_headers))
    assert "другому аккаунту" in response.json()["text"]
    assert (await client.get(TG, headers=other_headers)).json()["connected"] is False


@pytest.mark.parametrize("changed", ["expired", "inactive"])
async def test_invalid_invitation_cannot_link(client, session, operator, bot, changed):
    headers = auth(await login(client, operator.login))
    start = await invitation(client, headers)
    link = await session.get(TelegramLink, operator.id)
    if changed == "expired":
        link.link_expires_at = utcnow() - timedelta(seconds=1)
    else:
        operator.is_active = False
    await session.commit()
    await webhook(client, start)
    await session.refresh(link)
    assert link.chat_id is None


async def test_code_requires_matching_profile_phone_and_own_account(client, session, account, bot):
    wrong = await client.post(BASE + "/code", headers=account, json={"phone": "+77001234568"})
    assert wrong.status_code == 400
    for phone in ("not a phone", "        ", None):
        assert (
            await client.post(BASE + "/code", headers=account, json={"phone": phone})
        ).status_code == 422
    assert (
        await client.post(BASE + "/code", headers=account, json={"phone": PHONE, "user_id": 555})
    ).status_code == 422
    assert bot == []
    response = await client.post(
        BASE + "/code", headers=account, json={"phone": "+7 (700) 123-45-67"}
    )
    assert response.status_code == 200
    other = await make_user(session, login="other-phone")
    other_headers = {
        **auth(await login(client, other.login)),
        "X-Driver-Device": account["X-Driver-Device"],
    }
    await client.post(BASE + "/start", headers=other_headers)
    await act(client, other_headers, "taxi")
    await act(client, other_headers, "park", park_id="itaxi")
    assert (await verify(client, other_headers, delivered_code(bot))).status_code == 400
    assert (await send_code(client, other_headers)).status_code == 409


async def test_five_wrong_attempts_are_persisted_and_lock_out_code(
    client, session, operator, account, bot
):
    await send_code(client, account)
    code = delivered_code(bot)
    wrong = "111111" if code != "111111" else "222222"
    for _ in range(5):
        assert (await verify(client, account, wrong)).status_code == 400
    assert (await verify(client, account, code)).status_code == 400
    record = await session.get(
        DriverDevice, driver_auth.device_hash(operator.id, account["X-Driver-Device"])
    )
    assert record.attempts == 5 and record.code_hash is None
    assert (await client.get(BASE, headers=account)).json()["profile"]["stage"] == "phone"


async def test_resend_cooldown_expiry_and_old_code_invalidation(
    client, session, operator, account, bot, monkeypatch
):
    monkeypatch.setattr(driver_auth.secrets, "randbelow", lambda _: 123456)
    await send_code(client, account)
    assert (await send_code(client, account)).status_code == 429
    record = await session.get(
        DriverDevice, driver_auth.device_hash(operator.id, account["X-Driver-Device"])
    )
    record.code_expires_at = utcnow() - timedelta(seconds=1)
    record.next_send_at = utcnow() - timedelta(seconds=1)
    await session.commit()
    assert (await verify(client, account, "123456")).status_code == 400
    monkeypatch.setattr(driver_auth.secrets, "randbelow", lambda _: 654321)
    assert (await send_code(client, account)).status_code == 200
    assert (await verify(client, account, "123456")).status_code == 400
    assert (await verify(client, account, "654321")).status_code == 200


async def test_changing_browser_does_not_bypass_hourly_delivery_limit(client, account, bot):
    for _ in range(5):
        headers = {**account, "X-Driver-Device": secrets.token_urlsafe(32)}
        assert (await send_code(client, headers)).status_code == 200
    assert (await send_code(client, account)).status_code == 429
    assert len(bot) == 5


async def test_failed_delivery_clears_code_but_keeps_rate_limit(client, account, monkeypatch):
    async def fail(*_):
        raise telegram.TelegramUnavailable("provider unavailable")

    monkeypatch.setattr(telegram, "bot_call", fail)
    assert (await send_code(client, account)).status_code == 503
    state = (await client.get(BASE, headers=account)).json()
    assert state["profile"]["stage"] == "phone"
    assert state["authentication"]["code_pending"] is False
    assert (await send_code(client, account)).status_code == 429


@pytest.mark.parametrize(
    "change", ["phone", "disconnect", "rebind", "password", "expired", "forget"]
)
async def test_account_changes_revoke_browser_confirmation(
    client, session, operator, head, account, bot, change
):
    await send_code(client, account)
    await verify(client, account, delivered_code(bot))
    await act(client, account, "enter")
    if change == "phone":
        staff = auth(await login(client, head.login))
        for phone in ("+77001234568", PHONE):
            response = await client.patch(
                f"/api/v1/admin/users/{operator.id}", headers=staff, json={"phone": phone}
            )
            assert response.status_code == 200, response.text
    elif change == "disconnect":
        response = await client.post(
            TG + "/disconnect", headers=account, json={"current_password": "password123"}
        )
        assert response.status_code == 200
    elif change == "rebind":
        link = await session.get(TelegramLink, operator.id)
        link.link_requested_at = utcnow() - timedelta(minutes=1)
        await session.commit()
        await webhook(client, await invitation(client, account), chat_id=67890)
    elif change == "password":
        staff = auth(await login(client, head.login))
        response = await client.post(
            f"/api/v1/admin/users/{operator.id}/password",
            headers=staff,
            json={"password": "new-password123"},
        )
        assert response.status_code == 200
        account["Authorization"] = "Bearer " + await login(
            client, operator.login, "new-password123"
        )
    elif change == "expired":
        record = await session.get(
            DriverDevice, driver_auth.device_hash(operator.id, account["X-Driver-Device"])
        )
        record.valid_until = utcnow() - timedelta(seconds=1)
        await session.commit()
    else:
        assert (await client.delete(BASE + "/device", headers=account)).status_code == 200
    state = (await client.get(BASE, headers=account)).json()
    assert state["authentication"]["verified"] is False
    assert state["profile"]["stage"] == "phone"
    assert (await act(client, account, "enter")).status_code == 403


async def test_phone_management_normalizes_unique_numbers_and_limits_editing(
    client, session, operator, head
):
    headers = auth(await login(client, head.login))
    payload = {
        "login": "new-phone",
        "full_name": "Phone Test",
        "password": "password123",
        "phone": "7 (700) 123-45-67",
    }
    response = await client.post("/api/v1/admin/users", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    assert response.json()["phone"] == PHONE
    payload["login"] = "duplicate-phone"
    payload["phone"] = PHONE
    assert (
        await client.post("/api/v1/admin/users", headers=headers, json=payload)
    ).status_code == 409
    assert (
        await client.patch(
            f"/api/v1/admin/users/{operator.id}", headers=headers, json={"phone": PHONE}
        )
    ).status_code == 409
    own = auth(await login(client, operator.login))
    assert (
        await client.patch(
            f"/api/v1/admin/users/{operator.id}", headers=own, json={"phone": "+77001234568"}
        )
    ).status_code == 403
    assert (await client.get("/api/v1/auth/me", headers=own)).status_code == 200


async def test_missing_configuration_fails_closed_without_breaking_puls(
    client, operator, monkeypatch
):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", SecretStr(""))
    headers = auth(await login(client, operator.login))
    assert (await client.get(TG, headers=headers)).json()["configured"] is False
    assert (
        await client.post(TG + "/link", headers=headers, json={"current_password": "password123"})
    ).status_code == 503
    assert (await send_code(client, headers)).status_code == 503
    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 200


async def test_webhook_setup_verifies_bot_and_uses_secret_header(bot):
    await telegram.configure_webhook()
    assert bot[0] == ("getMe", {})
    method, payload = bot[1]
    assert method == "setWebhook" and payload["url"] == settings.TELEGRAM_WEBHOOK_URL
    assert payload["secret_token"] == telegram.webhook_secret()
    assert payload["allowed_updates"] == ["message", "callback_query"]


async def test_provider_transport_error_does_not_expose_bot_token(monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", SecretStr("123:secret-token"))
    monkeypatch.setattr(settings, "TELEGRAM_BOT_USERNAME", "puls_i_bot")
    monkeypatch.setattr(settings, "TELEGRAM_WEBHOOK_URL", "https://example.test/webhook")

    async def fail(*args, **kwargs):
        raise httpx.ConnectError("https://api.telegram.org/bot123:secret-token/sendMessage")

    monkeypatch.setattr(httpx.AsyncClient, "post", fail)
    with pytest.raises(telegram.TelegramUnavailable) as result:
        await telegram.bot_call("sendMessage", {})
    assert "secret-token" not in str(result.value)
    assert result.value.__suppress_context__ is True
