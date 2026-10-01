"""Telegram changes in employee cards preserve account and browser security boundaries."""

from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from pydantic import SecretStr
from sqlalchemy import func, select

from app.core.config import settings
from app.db.base import utcnow
from app.models.driver_auth import DriverDevice, TelegramLink
from app.models.enums import Role
from app.models.settings import AuditLog
from app.services import telegram
from tests.conftest import auth, login, make_user
from tests.test_access import change
from tests.test_user_telegram_creation import (
    TG,
    USERS,
    invitation_start,
    webhook,
)

STATUS_FIELDS = {
    "configured",
    "connected",
    "username",
    "pending_username",
    "linked_at",
    "bot_username",
}


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
async def manager(client, session):
    user = await make_user(session, login="telegram-manager", role=Role.ADMIN)
    return auth(await login(client, user.login))


async def patch(client, headers, user, **changes):
    return await client.patch(f"{USERS}/{user.id}", headers=headers, json=changes)


async def read(client, headers, user):
    return await client.get(f"{USERS}/{user.id}/telegram", headers=headers)


def snapshot(record):
    return {
        column.name: telegram.as_utc(value) if isinstance(value, datetime) else value
        for column in record.__table__.columns
        if (value := getattr(record, column.name)) is not None
    }


async def existing_binding(session, user, state="connected", username="employee_tg"):
    link = TelegramLink(user_id=user.id, version=5, send_count=3, send_window_at=utcnow())
    if state == "pending":
        link.pending_username = username.lower()
    else:
        link.chat_id = 12345
        link.username = username
        link.linked_at = utcnow()
    invitation = telegram.issue_invitation(link, validity=timedelta(days=7))
    session.add(link)
    device = DriverDevice(
        secret_hash=telegram.digest(f"test-device:{user.id}"),
        user_id=user.id,
        phone="+77001234567",
        telegram_version=link.version,
        valid_until=utcnow() + timedelta(days=30),
        code_hash=telegram.digest("existing-code"),
        code_expires_at=utcnow() + timedelta(minutes=10),
        attempts=1,
    )
    session.add(device)
    await session.commit()
    await session.refresh(link)
    await session.refresh(device)
    start = parse_qs(urlsplit(invitation["url"]).query)["start"][0]
    return link, device, start


@pytest.mark.parametrize("state", ["missing", "pending", "connected"])
async def test_employee_telegram_status_shows_current_state_without_secrets(
    client, session, manager, operator, bot, state
):
    if state != "missing":
        link, device, start = await existing_binding(session, operator, state)
    response = await read(client, manager, operator)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    status = response.json()
    assert set(status) == STATUS_FIELDS
    assert status["configured"] is True and status["bot_username"] == "puls_i_bot"
    assert status["connected"] is (state == "connected")
    assert status["username"] == ("employee_tg" if state == "connected" else None)
    assert status["pending_username"] == ("employee_tg" if state == "pending" else None)
    assert (status["linked_at"] is not None) is (state == "connected")
    if state != "missing":
        assert str(link.chat_id) not in response.text
        assert link.link_hash not in response.text and start not in response.text
        assert device.secret_hash not in response.text and device.code_hash not in response.text
    own = auth(await login(client, operator.login))
    assert status == (await client.get(TG, headers=own)).json()


@pytest.mark.parametrize(
    "actor_role,target_roles",
    [
        (Role.HEAD, (Role.OPERATOR, Role.TRAINER, Role.SUPERVISOR)),
        (Role.ADMIN, tuple(Role)),
    ],
)
async def test_telegram_can_be_added_to_existing_accounts_of_every_managed_role(
    client, session, bot, actor_role, target_roles
):
    actor = await make_user(session, login=f"manager-{actor_role}", role=actor_role)
    headers = auth(await login(client, actor.login))
    for role in target_roles:
        user = await make_user(session, login=f"edited-{role}", role=role)
        before = utcnow()
        response = await patch(
            client, headers, user, telegram_username=f" https://t.me/Employee_{role}/ "
        )
        assert response.status_code == 200, response.text
        start = invitation_start(response)
        link = await session.get(TelegramLink, user.id)
        assert link.pending_username == f"employee_{role}"
        assert link.chat_id is None and link.username is None
        assert link.link_hash == telegram.digest("telegram-link:" + start.removeprefix("link_"))
        expires = datetime.fromisoformat(response.json()["telegram_invitation"]["expires_at"])
        assert before + timedelta(days=7) <= expires <= utcnow() + timedelta(days=7)
        status = await read(client, headers, user)
        assert status.status_code == 200 and status.json()["pending_username"] == f"employee_{role}"
    assert bot == []


@pytest.mark.parametrize("state", ["pending", "connected"])
async def test_omitted_telegram_preserves_binding_invitation_and_browser_trust(
    client, session, manager, operator, bot, monkeypatch, state
):
    link, device, _ = await existing_binding(session, operator, state)
    original_link, original_device = snapshot(link), snapshot(device)
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", SecretStr(""))
    response = await patch(client, manager, operator, full_name="Обновлённое имя")
    assert response.status_code == 200, response.text
    assert "telegram_invitation" not in response.json()
    assert response.json()["full_name"] == "Обновлённое имя"
    await session.refresh(link)
    await session.refresh(device)
    assert snapshot(link) == original_link and snapshot(device) == original_device


@pytest.mark.parametrize("state", ["pending", "connected"])
async def test_same_normalized_telegram_is_noop_even_when_bot_is_unconfigured(
    client, session, manager, operator, bot, monkeypatch, state
):
    link, device, _ = await existing_binding(session, operator, state, username="EmPlOyEe_Tg")
    original_link, original_device = snapshot(link), snapshot(device)
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", SecretStr(""))
    response = await patch(
        client, manager, operator, telegram_username=" https://t.me/EMPLOYEE_TG/ "
    )
    assert response.status_code == 200, response.text
    assert "telegram_invitation" not in response.json()
    await session.refresh(link)
    await session.refresh(device)
    assert snapshot(link) == original_link and snapshot(device) == original_device


@pytest.mark.parametrize("state", ["pending", "connected"])
@pytest.mark.parametrize("value", [None, "", "   "])
async def test_clearing_telegram_invalidates_old_invitation_and_driver_trust_without_bot(
    client, session, manager, operator, bot, monkeypatch, state, value
):
    link, device, start = await existing_binding(session, operator, state)
    original_version = link.version
    device_hash = device.secret_hash
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", SecretStr(""))
    response = await patch(client, manager, operator, telegram_username=value)
    assert response.status_code == 200, response.text
    assert "telegram_invitation" not in response.json()
    await session.refresh(link)
    for field in (
        "chat_id",
        "username",
        "pending_username",
        "linked_at",
        "link_hash",
        "link_expires_at",
    ):
        assert getattr(link, field) is None, field
    assert link.version > original_version
    session.expunge(device)
    assert await session.get(DriverDevice, device_hash) is None
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", SecretStr("123:fake-test-token"))
    await webhook(client, start)
    await session.refresh(link)
    assert link.chat_id is None and link.pending_username is None


@pytest.mark.parametrize("state", ["pending", "connected"])
async def test_explicit_clear_revokes_a_password_issued_link_or_anonymous_connected_chat(
    client, session, manager, operator, bot, state
):
    link, device, start = await existing_binding(session, operator, state)
    link.username = link.pending_username = None
    await session.commit()
    original_version, device_hash = link.version, device.secret_hash
    response = await patch(client, manager, operator, telegram_username=None)
    assert response.status_code == 200, response.text
    assert "telegram_invitation" not in response.json()
    await session.refresh(link)
    assert link.chat_id is None and link.link_hash is None
    assert link.version > original_version
    session.expunge(device)
    assert await session.get(DriverDevice, device_hash) is None
    await webhook(client, start)
    await session.refresh(link)
    assert link.chat_id is None


@pytest.mark.parametrize("state", ["pending", "connected"])
async def test_changed_telegram_revokes_binding_and_old_token_then_only_expected_user_can_start(
    client, session, manager, operator, bot, state
):
    link, device, old_start = await existing_binding(session, operator, state)
    previous_version, device_hash = link.version, device.secret_hash
    response = await patch(
        client, manager, operator, full_name="Имя и Telegram", telegram_username="@Replacement_Tg"
    )
    assert response.status_code == 200, response.text
    assert response.json()["full_name"] == "Имя и Telegram"
    new_start = invitation_start(response)
    assert new_start != old_start
    await session.refresh(link)
    assert link.chat_id is None and link.username is None and link.linked_at is None
    assert link.pending_username == "replacement_tg" and link.version > previous_version
    new_hash = link.link_hash
    session.expunge(device)
    assert await session.get(DriverDevice, device_hash) is None
    await webhook(client, old_start)
    await webhook(client, new_start, username="employee_tg")
    await session.refresh(link)
    assert link.link_hash == new_hash and link.chat_id is None
    await webhook(client, new_start, chat_id=67890, username="RePlAcEmEnT_Tg")
    await session.refresh(link)
    assert link.chat_id == 67890 and link.username.lower() == "replacement_tg"
    assert link.pending_username is None and link.link_hash is None
    await webhook(client, new_start, chat_id=98765, username="replacement_tg")
    await session.refresh(link)
    assert link.chat_id == 67890
    audits = await session.scalars(select(AuditLog).where(AuditLog.entity_id == str(operator.id)))
    assert all(
        old_start not in str(row.payload) and new_start not in str(row.payload) for row in audits
    )


@pytest.mark.parametrize("occupied", ["pending", "connected"])
async def test_collision_rolls_back_other_fields_binding_and_driver_trust(
    client, session, manager, operator, bot, occupied
):
    owner = await make_user(session, login="occupied-telegram-owner")
    link, device, _ = await existing_binding(session, operator)
    owner_link = TelegramLink(user_id=owner.id)
    if occupied == "pending":
        owner_link.pending_username = "occupied_tg"
    else:
        owner_link.chat_id, owner_link.username = 67890, "OcCuPiEd_Tg"
    session.add(owner_link)
    await session.commit()
    original_name = operator.full_name
    original_link, original_device = snapshot(link), snapshot(device)
    audits_before = await session.scalar(
        select(func.count()).select_from(AuditLog).where(AuditLog.action == "user.update")
    )
    response = await patch(
        client,
        manager,
        operator,
        full_name="Не должно сохраниться",
        telegram_username="@OCCUPIED_TG",
    )
    assert response.status_code == 409, response.text
    await session.refresh(operator)
    await session.refresh(link)
    await session.refresh(device)
    assert operator.full_name == original_name
    assert snapshot(link) == original_link and snapshot(device) == original_device
    assert (
        await session.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.action == "user.update")
        )
        == audits_before
    )


async def test_missing_bot_rolls_back_full_name_and_existing_telegram(
    client, session, manager, operator, bot, monkeypatch
):
    link, device, _ = await existing_binding(session, operator)
    original_name = operator.full_name
    original_link, original_device = snapshot(link), snapshot(device)
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", SecretStr(""))
    response = await patch(
        client,
        manager,
        operator,
        full_name="Не должно сохраниться",
        telegram_username="new_employee_tg",
    )
    assert response.status_code == 503, response.text
    await session.refresh(operator)
    await session.refresh(link)
    await session.refresh(device)
    assert operator.full_name == original_name
    assert snapshot(link) == original_link and snapshot(device) == original_device


async def test_unique_email_failure_rolls_back_telegram_invitation_and_trust_revocation(
    client, session, manager, operator, bot
):
    owner = await make_user(session, login="occupied-email-owner")
    owner.email = "occupied@example.com"
    await session.commit()
    link, device, _ = await existing_binding(session, operator)
    original_name = operator.full_name
    original_link, original_device = snapshot(link), snapshot(device)
    response = await patch(
        client,
        manager,
        operator,
        full_name="Не должно сохраниться",
        email=owner.email,
        telegram_username="new_employee_tg",
    )
    assert response.status_code == 409, response.text
    await session.refresh(operator)
    await session.refresh(link)
    await session.refresh(device)
    assert operator.full_name == original_name and operator.email is None
    assert snapshot(link) == original_link and snapshot(device) == original_device
    assert (
        await session.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.action == "user.update")
        )
        == 0
    )


async def test_edit_reuses_creation_username_validation_without_partial_update(
    client, session, manager, operator, bot
):
    invalid_values = [
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
    original_name = operator.full_name
    for value in invalid_values:
        response = await patch(
            client, manager, operator, full_name="Не должно сохраниться", telegram_username=value
        )
        assert response.status_code == 422, (value, response.text)
    await session.refresh(operator)
    assert operator.full_name == original_name
    assert await session.get(TelegramLink, operator.id) is None


@pytest.mark.parametrize("role", [Role.OPERATOR, Role.TRAINER, Role.SUPERVISOR])
async def test_read_and_update_telegram_require_management_role_even_with_team_grant(
    client, session, manager, operator, bot, role
):
    actor = await make_user(session, login=f"forbidden-telegram-manager-{role}", role=role)
    granted = await change(
        client,
        manager,
        kind="user",
        ids=[str(actor.id)],
        changes=[{"section": "team", "effect": "allow"}],
    )
    assert granted.status_code == 200, granted.text
    headers = auth(await login(client, actor.login))
    assert (await read(client, headers, operator)).status_code == 403
    for value in ("employee_tg", None):
        response = await patch(client, headers, operator, telegram_username=value)
        assert response.status_code == 403, response.text
    assert await session.get(TelegramLink, operator.id) is None


@pytest.mark.parametrize("target_role", [Role.HEAD, Role.ADMIN])
async def test_head_cannot_read_or_change_telegram_of_higher_or_equal_role(
    client, session, head, bot, target_role
):
    target = await make_user(session, login=f"protected-telegram-{target_role}", role=target_role)
    headers = auth(await login(client, head.login))
    assert (await read(client, headers, target)).status_code == 404
    response = await patch(client, headers, target, telegram_username="employee_tg")
    assert response.status_code == 404, response.text
    assert await session.get(TelegramLink, target.id) is None


async def test_admin_can_read_own_status_but_must_change_personal_telegram_in_profile(
    client, session, bot
):
    actor = await make_user(session, login="self-telegram-admin", role=Role.ADMIN)
    headers = auth(await login(client, actor.login))
    link, device, _ = await existing_binding(session, actor)
    original_link, original_device = snapshot(link), snapshot(device)
    assert (await read(client, headers, actor)).status_code == 200
    for value in ("replacement_tg", None, "employee_tg"):
        response = await patch(client, headers, actor, telegram_username=value)
        assert response.status_code == 403, response.text
        assert response.json()["code"] == "self_service_required"
    await session.refresh(link)
    await session.refresh(device)
    assert snapshot(link) == original_link and snapshot(device) == original_device


async def test_developer_telegram_cannot_be_replaced_by_regular_admin(
    client, session, manager, developer, bot
):
    for value in ("employee_tg", None):
        response = await patch(client, manager, developer, telegram_username=value)
        assert response.status_code == 403, response.text
        assert response.json()["code"] == "developer_required"
    assert await session.get(TelegramLink, developer.id) is None
