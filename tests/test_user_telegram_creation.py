"""Telegram onboarding through account creation preserves role and identity boundaries."""

import re
import secrets
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from pydantic import SecretStr
from sqlalchemy import func, select

from app.core.config import settings
from app.db.base import utcnow
from app.models.driver_auth import TelegramLink
from app.models.enums import Role
from app.models.settings import AuditLog
from app.models.user import CoinAccount, User
from app.services import telegram
from tests.conftest import auth, login, make_user
from tests.test_driver import BASE, act

USERS = "/api/v1/admin/users"
TG = "/api/v1/auth/telegram"
PASSWORD = "password123"
TRAINING_FIELDS = {"id", "login", "full_name", "role", "is_active", "created_at"}


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


@pytest.fixture
async def creator(client, session):
    user = await make_user(session, login="telegram-creator", role=Role.ADMIN)
    return auth(await login(client, user.login))


async def create(client, headers, login_name="created-with-telegram", **extra):
    return await client.post(
        USERS,
        headers=headers,
        json={
            "login": login_name,
            "full_name": "Созданный сотрудник",
            "password": PASSWORD,
            **extra,
        },
    )


def invitation_start(response):
    assert response.headers["cache-control"] == "no-store"
    invitation = response.json()["telegram_invitation"]
    assert set(invitation) == {"url", "expires_at"}
    assert invitation["url"].startswith("https://t.me/puls_i_bot?start=link_")
    return parse_qs(urlsplit(invitation["url"]).query)["start"][0]


async def webhook(client, start, chat_id=12345, username="employee_tg", **extra):
    return await client.post(
        TG + "/webhook",
        headers={"X-Telegram-Bot-Api-Secret-Token": telegram.webhook_secret()},
        json={
            "update_id": 1,
            "message": {
                "chat": {"id": chat_id, "type": "private"},
                "from": {"id": chat_id, "is_bot": False, "username": username},
                "text": "/start " + start,
                **extra,
            },
        },
    )


async def assert_no_created_account(session, login_name):
    assert await session.scalar(select(User.id).where(User.login == login_name)) is None


@pytest.mark.parametrize(
    "creator_role,allowed_roles",
    [
        (Role.TRAINER, (Role.OPERATOR,)),
        (Role.HEAD, (Role.OPERATOR, Role.TRAINER, Role.SUPERVISOR)),
        (Role.ADMIN, tuple(Role)),
    ],
)
async def test_every_account_creator_can_invite_all_roles_they_can_create(
    client, session, bot, creator_role, allowed_roles
):
    actor = await make_user(session, login=f"creator-{creator_role}", role=creator_role)
    headers = auth(await login(client, actor.login))
    for index, target_role in enumerate(Role):
        login_name = f"created-{creator_role}-{target_role}"
        username = f"tg_{creator_role}_{target_role}"
        response = await create(
            client,
            headers,
            login_name,
            role=target_role,
            telegram_username="@" + username,
        )
        if target_role not in allowed_roles:
            assert response.status_code == 403, response.text
            await assert_no_created_account(session, login_name)
            continue
        assert response.status_code == 201, response.text
        if creator_role == Role.TRAINER:
            assert set(response.json()) == TRAINING_FIELDS | {"telegram_invitation"}
        own = auth(await login(client, login_name))
        assert (await client.get(TG, headers=own)).json()["connected"] is False
        result = await webhook(
            client, invitation_start(response), chat_id=10000 + index, username=username.upper()
        )
        assert result.status_code == 200, result.text
        assert (await client.get(TG, headers=own)).json()["connected"] is True
        detail = await client.get(f"{USERS}/{response.json()['id']}", headers=headers)
        assert detail.status_code == 200, detail.text
        assert "telegram_invitation" not in detail.json()
        if creator_role == Role.TRAINER:
            assert set(detail.json()) == TRAINING_FIELDS
    listing = await client.get(USERS, headers=headers)
    assert listing.status_code == 200, listing.text
    assert all("telegram_invitation" not in row for row in listing.json()["items"])
    assert bot == []


@pytest.mark.parametrize("role", [Role.OPERATOR, Role.SUPERVISOR])
async def test_telegram_field_does_not_grant_account_creation_permission(
    client, session, bot, role
):
    actor = await make_user(session, login=f"not-creator-{role}", role=role)
    response = await create(
        client, auth(await login(client, actor.login)), telegram_username="employee_tg"
    )
    assert response.status_code == 403, response.text
    await assert_no_created_account(session, "created-with-telegram")
    assert await session.scalar(select(func.count()).select_from(TelegramLink)) == 0


async def test_optional_telegram_preserves_creation_and_minimal_trainer_response(
    client, session, monkeypatch
):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", SecretStr(""))
    trainer = await make_user(session, login="telegram-trainer", role=Role.TRAINER)
    headers = auth(await login(client, trainer.login))
    for index, extra in enumerate(
        ({}, {"telegram_username": None}, {"telegram_username": ""}, {"telegram_username": "   "})
    ):
        response = await create(client, headers, f"optional-telegram-{index}", **extra)
        assert response.status_code == 201, response.text
        assert set(response.json()) == TRAINING_FIELDS
        assert await session.get(TelegramLink, response.json()["id"]) is None


async def test_username_and_telegram_urls_are_normalized_and_invitation_is_hashed(
    client, session, creator, bot
):
    values = [
        ("AbCdE", "abcde"),
        (" @Mixed_Name ", "mixed_name"),
        ("t.me/Other_Name", "other_name"),
        ("https://t.me/Third_Name", "third_name"),
        (" http://t.me/Fourth_Name/ ", "fourth_name"),
        ("https://t.me/" + "A" * 32 + "/", "a" * 32),
    ]
    for index, (value, normalized) in enumerate(values):
        before = utcnow()
        response = await create(
            client, creator, f"normalized-telegram-{index}", telegram_username=value
        )
        assert response.status_code == 201, (value, response.text)
        start = invitation_start(response)
        link = await session.get(TelegramLink, response.json()["id"])
        assert link.pending_username == normalized
        assert link.chat_id is None and link.username is None
        assert link.link_hash == telegram.digest("telegram-link:" + start.removeprefix("link_"))
        assert start not in link.link_hash
        expires = datetime.fromisoformat(response.json()["telegram_invitation"]["expires_at"])
        assert expires.tzinfo is not None
        assert before + timedelta(days=7) <= expires <= utcnow() + timedelta(days=7)
        assert telegram.as_utc(link.link_expires_at) == expires
        audit = await session.scalar(
            select(AuditLog).where(
                AuditLog.action == "user.create", AuditLog.entity_id == str(link.user_id)
            )
        )
        assert start not in str(audit.payload)
        assert PASSWORD not in response.text and "hashed_password" not in response.text
    assert bot == []


async def test_invalid_telegram_values_are_rejected_without_creating_accounts(
    client, session, creator, bot
):
    invalid = [
        "@",
        "abcd",
        "A" * 33,
        "12345",
        "_abcdef",
        "name-with-dashes",
        "имя_тг",
        "hello name",
        "user.name",
        "@@valid_name",
        "https://example.com/valid_name",
        "https://t.me/valid_name/extra",
        "https://t.me/+invite",
        12345,
    ]
    for index, value in enumerate(invalid):
        login_name = f"invalid-telegram-{index}"
        response = await create(client, creator, login_name, telegram_username=value)
        assert response.status_code == 422, (value, response.text)
        await assert_no_created_account(session, login_name)
    assert await session.scalar(select(func.count()).select_from(TelegramLink)) == 0
    assert await session.scalar(select(func.count()).select_from(CoinAccount)) == 0
    assert (
        await session.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.action == "user.create")
        )
        == 0
    )


async def test_missing_bot_rejects_requested_invitation_without_partial_account(
    client, session, creator, monkeypatch
):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", SecretStr(""))
    response = await create(client, creator, telegram_username="employee_tg")
    assert response.status_code == 503, response.text
    await assert_no_created_account(session, "created-with-telegram")
    assert await session.scalar(select(func.count()).select_from(TelegramLink)) == 0
    assert await session.scalar(select(func.count()).select_from(CoinAccount)) == 0
    assert (
        await session.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.action == "user.create")
        )
        == 0
    )


@pytest.mark.parametrize("occupied", ["pending", "connected"])
async def test_username_collision_rolls_back_user_account_and_audit(
    client, session, creator, bot, occupied
):
    if occupied == "pending":
        first = await create(client, creator, "telegram-owner", telegram_username="Occupied_Tg")
        assert first.status_code == 201, first.text
        owner_id = first.json()["id"]
    else:
        owner = await make_user(session, login="telegram-owner")
        owner_id = owner.id
        session.add(TelegramLink(user_id=owner_id, chat_id=12345, username="OcCuPiEd_Tg"))
        await session.commit()
    audits_before = await session.scalar(
        select(func.count()).select_from(AuditLog).where(AuditLog.action == "user.create")
    )
    response = await create(
        client, creator, "telegram-collision", telegram_username="https://t.me/OCCUPIED_TG"
    )
    assert response.status_code == 409, response.text
    await assert_no_created_account(session, "telegram-collision")
    assert await session.scalar(select(func.count()).select_from(CoinAccount)) == 1
    assert await session.scalar(select(func.count()).select_from(TelegramLink)) == 1
    assert (
        await session.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.action == "user.create")
        )
        == audits_before
    )
    assert (await session.get(TelegramLink, owner_id)).user_id == owner_id


async def test_invitation_requires_expected_sender_and_consumes_token_once(
    client, session, creator, bot
):
    created = await create(client, creator, telegram_username="@Employee_Tg")
    assert created.status_code == 201, created.text
    start = invitation_start(created)
    link = await session.get(TelegramLink, created.json()["id"])
    original_hash = link.link_hash
    assert (await client.post(TG + "/webhook", json={"update_id": 1})).status_code == 403
    unauthorized = await client.post(
        TG + "/webhook",
        headers={"X-Telegram-Bot-Api-Secret-Token": "wrong-secret"},
        json={"update_id": 1},
    )
    assert unauthorized.status_code == 403
    invalid_messages = [
        {"username": "another_user"},
        {"username": None},
        {"chat": {"id": -12345, "type": "group"}},
        {"from": {"id": 555, "is_bot": False, "username": "employee_tg"}},
        {"from": {"id": 12345, "is_bot": True, "username": "employee_tg"}},
    ]
    for message in invalid_messages:
        result = await webhook(client, start, **message)
        assert result.status_code == 200, result.text
        await session.refresh(link)
        assert link.chat_id is None and link.pending_username == "employee_tg"
        assert link.link_hash == original_hash
    own = auth(await login(client, created.json()["login"]))
    assert (await client.get(TG, headers=own)).json()["connected"] is False
    result = await webhook(client, start, username="EmPlOyEe_Tg")
    assert result.status_code == 200, result.text
    status = (await client.get(TG, headers=own)).json()
    assert status["connected"] is True
    assert status["username"].lower() == "employee_tg"
    assert "chat_id" not in status and "link_hash" not in status
    await session.refresh(link)
    assert link.pending_username is None and link.link_hash is None
    assert link.chat_id == 12345 and link.link_expires_at is None
    await webhook(client, start, chat_id=98765, username="employee_tg")
    await session.refresh(link)
    assert link.chat_id == 12345
    audits = list(
        await session.scalars(select(AuditLog).where(AuditLog.action == "telegram.connect"))
    )
    assert len(audits) == 1 and start not in str(audits[0].payload)


@pytest.mark.parametrize("changed", ["expired", "inactive"])
async def test_expired_or_inactive_creator_invitation_cannot_activate(
    client, session, creator, bot, changed
):
    created = await create(client, creator, telegram_username="employee_tg")
    assert created.status_code == 201, created.text
    link = await session.get(TelegramLink, created.json()["id"])
    if changed == "expired":
        link.link_expires_at = utcnow() - timedelta(seconds=1)
    else:
        user = await session.get(User, link.user_id)
        user.is_active = False
    await session.commit()
    response = await webhook(client, invitation_start(created))
    assert response.status_code == 200, response.text
    await session.refresh(link)
    assert link.chat_id is None
    assert (
        await session.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.action == "telegram.connect")
        )
        == 0
    )


async def test_creator_invitation_activates_telegram_delivery_for_driver_login(
    client, creator, bot
):
    phone = "+77001234567"
    created = await create(client, creator, phone=phone, telegram_username="employee_tg")
    assert created.status_code == 201, created.text
    own = auth(await login(client, created.json()["login"]))
    own["X-Driver-Device"] = secrets.token_urlsafe(32)
    assert (await client.post(BASE + "/start", headers=own)).status_code == 200
    await act(client, own, "taxi")
    await act(client, own, "park", park_id="itaxi")
    unconnected = await client.post(BASE + "/code", headers=own, json={"phone": phone})
    assert unconnected.status_code == 409, unconnected.text
    assert bot == []
    await webhook(client, invitation_start(created))
    delivered = await client.post(BASE + "/code", headers=own, json={"phone": phone})
    assert delivered.status_code == 200, delivered.text
    method, payload = bot[-1]
    assert method == "sendMessage" and payload["chat_id"] == 12345
    assert payload["protect_content"] is True
    code = re.search(r"\b[0-9]{6}\b", payload["text"])[0]
    assert code not in delivered.text
    verified = await client.post(BASE + "/verify", headers=own, json={"code": code})
    assert verified.status_code == 200, verified.text
    assert verified.json()["authentication"]["verified"] is True


async def test_owner_can_replace_creator_invitation_using_current_password(
    client, session, creator, bot
):
    created = await create(client, creator, telegram_username="employee_tg")
    assert created.status_code == 201, created.text
    original_start = invitation_start(created)
    own = auth(await login(client, created.json()["login"]))
    link = await session.get(TelegramLink, created.json()["id"])
    wrong = await client.post(TG + "/link", headers=own, json={"current_password": "wrong"})
    assert wrong.status_code == 400
    await session.refresh(link)
    assert link.pending_username == "employee_tg"
    # Observe the existing link issuance cooldown without slowing the test suite.
    link.link_requested_at = utcnow() - timedelta(seconds=31)
    await session.commit()
    replacement = await client.post(TG + "/link", headers=own, json={"current_password": PASSWORD})
    assert replacement.status_code == 200, replacement.text
    assert replacement.headers["cache-control"] == "no-store"
    new_start = parse_qs(urlsplit(replacement.json()["url"]).query)["start"][0]
    assert new_start != original_start
    await session.refresh(link)
    assert link.pending_username is None
    await webhook(client, original_start)
    await session.refresh(link)
    assert link.chat_id is None
    await webhook(client, new_start, username="alternative_tg")
    await session.refresh(link)
    assert link.chat_id == 12345 and link.username == "alternative_tg"
    another = await create(client, creator, "new-telegram-owner", telegram_username="employee_tg")
    assert another.status_code == 201, another.text


async def test_disconnect_clears_pending_username_and_invalidates_creator_invitation(
    client, session, creator, bot
):
    created = await create(client, creator, telegram_username="employee_tg")
    assert created.status_code == 201, created.text
    own = auth(await login(client, created.json()["login"]))
    wrong = await client.post(TG + "/disconnect", headers=own, json={"current_password": "wrong"})
    assert wrong.status_code == 400
    response = await client.post(
        TG + "/disconnect", headers=own, json={"current_password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    assert response.json()["connected"] is False
    link = await session.get(TelegramLink, created.json()["id"])
    assert link.pending_username is None and link.link_hash is None
    await webhook(client, invitation_start(created))
    await session.refresh(link)
    assert link.chat_id is None
    another = await create(
        client, creator, "released-telegram-owner", telegram_username="employee_tg"
    )
    assert another.status_code == 201, another.text
