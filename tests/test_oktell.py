"""Oktell actions are isolated, validated and safe to retry; rewards are server facts."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.access import AccessRule
from app.models.enums import Role
from app.models.oktell import OktellEvent
from app.services.oktell import apply, build, initial, mission_facts
from tests.conftest import auth, login, login_with_work_sites, make_user

pytestmark = pytest.mark.asyncio
BASE = "/api/v1/learning/oktell"


async def act(client, headers, action, request_id=None, **fields):
    return await client.post(
        BASE + "/actions",
        headers=headers,
        json={
            "request_id": request_id or str(uuid4()),
            "action": action,
            **fields,
        },
    )


async def accepted(client, headers, action, **fields):
    response = await act(client, headers, action, **fields)
    assert response.status_code == 200, response.text
    return response.json()


async def prepare(client, headers):
    await accepted(client, headers, "login", login="6600", password="training")
    await accepted(client, headers, "join")
    return await accepted(client, headers, "phone_settings", web_phone=True, auto_answer=False)


async def test_access_qr_is_required_and_permissions_are_not_bypassed(client, operator, session):
    headers = auth(await login(client, operator.login))
    for method, path, data in [
        ("get", BASE, None),
        ("post", BASE + "/actions", {"request_id": str(uuid4()), "action": "reset"}),
    ]:
        response = await client.request(method, path, headers=headers, json=data)
        assert response.status_code == 403
        assert response.json()["code"] == "work_sites_qr_required"
    assert (await client.get(BASE)).status_code == 401
    allowed = auth(await login_with_work_sites(client, operator.login))
    assert (await client.get(BASE, headers=allowed)).status_code == 200
    session.add(
        AccessRule(
            target_type="user", target_id=str(operator.id), section="training", effect="deny"
        )
    )
    await session.commit()
    response = await client.get(BASE, headers=allowed)
    assert response.status_code == 403 and response.json()["code"] == "section_denied"


@pytest.mark.parametrize("role", [Role.TRAINER, Role.SUPERVISOR, Role.HEAD, Role.ADMIN])
async def test_staff_practise_in_own_workspace_under_learning_permission(client, session, role):
    user = await make_user(session, login="staff-oktell", role=role)
    headers = auth(await login(client, user.login))
    assert (await client.get(BASE, headers=headers)).status_code == 200
    ready = await prepare(client, headers)
    assert ready["completed"] == ["oktell_ready"]
    session.add(
        AccessRule(
            target_type="user", target_id=str(user.id), section="learning_admin", effect="deny"
        )
    )
    await session.commit()
    assert (await client.get(BASE, headers=headers)).status_code == 403
    assert (await act(client, headers, "reset")).status_code == 403


async def test_startup_and_active_call_transitions_are_enforced(client, operator):
    headers = auth(await login_with_work_sites(client, operator.login))
    for action, fields in [("join", {}), ("message", {"contact_id": "supervisor", "text": "ДД"})]:
        assert (await act(client, headers, action, **fields)).status_code == 400
    assert (
        await act(client, headers, "login", login="6600", password="actual-password")
    ).status_code == 400
    await accepted(client, headers, "login", login="6600", password="training")
    assert (await act(client, headers, "call_start", contact_id="operator-01")).status_code == 400
    await accepted(client, headers, "join")
    assert (await act(client, headers, "join")).status_code == 400
    assert (await act(client, headers, "call_start", contact_id="operator-01")).status_code == 400
    await accepted(client, headers, "phone_settings", web_phone=True, auto_answer=False)
    await accepted(client, headers, "office_status", status="dnd")
    assert (await act(client, headers, "call_start", contact_id="operator-01")).status_code == 400
    await accepted(client, headers, "office_status", status="available")
    await accepted(client, headers, "pause", reason="training")
    assert (await act(client, headers, "call_start", contact_id="operator-01")).status_code == 400
    assert (await act(client, headers, "pause", reason="break")).status_code == 400
    await accepted(client, headers, "resume")
    assert (await act(client, headers, "resume")).status_code == 400
    assert (await act(client, headers, "call_start", contact_id="operator-02")).status_code == 400
    active = await accepted(client, headers, "call_start", contact_id="operator-01")
    assert active["active_call"]["number"] == "6602"
    for action, fields in [
        ("leave", {}),
        ("logout", {}),
        ("pause", {"reason": "break"}),
        ("phone_settings", {"web_phone": False, "auto_answer": False}),
        ("call_start", {"contact_id": "supervisor"}),
    ]:
        assert (await act(client, headers, action, **fields)).status_code == 400
    finished = await accepted(client, headers, "call_end")
    assert finished["active_call"] is None
    assert finished["calls"][0]["status"] == "completed"
    assert "oktell_call" not in finished["completed"]
    assert (await act(client, headers, "call_end")).status_code == 400


async def test_retries_do_not_duplicate_calls_messages_or_change_request_meaning(
    client, operator, session
):
    headers = auth(await login_with_work_sites(client, operator.login))
    await prepare(client, headers)
    request_id = str(uuid4())
    for _ in range(2):
        await accepted(
            client, headers, "call_start", request_id=request_id, contact_id="supervisor"
        )
    conflict = await act(
        client, headers, "call_start", request_id=request_id, contact_id="operator-01"
    )
    assert conflict.status_code == 409
    assert (await act(client, headers, "reset", request_id=request_id)).status_code == 409
    await accepted(client, headers, "call_end")
    # A late replay returns the current state and never restarts the completed call.
    replay = await accepted(
        client, headers, "call_start", request_id=request_id, contact_id="supervisor"
    )
    assert replay["active_call"] is None and len(replay["calls"]) == 1
    message_id = str(uuid4())
    for _ in range(2):
        result = await accepted(
            client,
            headers,
            "message",
            request_id=message_id,
            contact_id="supervisor",
            text="Готов к учебной смене",
        )
    assert len(result["messages"]) == 1
    assert (
        await act(
            client,
            headers,
            "message",
            request_id=message_id,
            contact_id="supervisor",
            text="Другой текст",
        )
    ).status_code == 409
    events = list(
        await session.scalars(select(OktellEvent).where(OktellEvent.user_id == operator.id))
    )
    assert len([event for event in events if event.kind == "call_start"]) == 1
    assert all("password" not in event.payload for event in events)


async def test_all_exercises_are_server_verified_and_survive_reset_and_logout(
    client, operator, session
):
    headers = auth(await login_with_work_sites(client, operator.login))
    ready = await prepare(client, headers)
    assert ready["completed"] == ["oktell_ready"]
    active = await accepted(client, headers, "call_start", contact_id="operator-01")
    call_id = active["active_call"]["id"]
    await accepted(client, headers, "call_end")
    commented = await accepted(
        client,
        headers,
        "call_comment",
        call_id=call_id,
        comment="Учебный вопрос решён",
        tags=["обучение", "обучение"],
    )
    assert commented["calls"][0]["tags"] == ["обучение"]
    assert "oktell_call" in commented["completed"]
    to_operator = await accepted(
        client, headers, "message", contact_id="operator-01", text="Привет"
    )
    assert "oktell_message" not in to_operator["completed"]
    await accepted(client, headers, "message", contact_id="supervisor", text="Готов к работе")
    await accepted(client, headers, "pause", reason="break")
    await accepted(client, headers, "resume")
    completed = await accepted(client, headers, "leave")
    expected = {"oktell_ready", "oktell_call", "oktell_message", "oktell_shift"}
    assert set(completed["completed"]) == expected
    assert all(exercise["done"] for exercise in completed["exercises"])
    logged_out = await accepted(client, headers, "logout")
    assert not logged_out["logged_in"] and set(logged_out["completed"]) == expected
    reset = await accepted(client, headers, "reset")
    assert not reset["logged_in"] and not reset["web_phone"]
    assert reset["calls"] == [] and reset["messages"] == []
    assert set(reset["completed"]) == expected
    assert await mission_facts(session, [operator.id, -1]) == {
        operator.id: dict.fromkeys(expected, 1),
        -1: dict.fromkeys(expected, 0),
    }


async def test_shift_requires_return_from_break_in_same_joined_session(client, operator):
    headers = auth(await login_with_work_sites(client, operator.login))
    await prepare(client, headers)
    await accepted(client, headers, "pause", reason="break")
    left = await accepted(client, headers, "leave")
    assert "oktell_shift" not in left["completed"]
    await accepted(client, headers, "join")
    await accepted(client, headers, "pause", reason="technical")
    await accepted(client, headers, "resume")
    left = await accepted(client, headers, "leave")
    assert "oktell_shift" not in left["completed"]
    await accepted(client, headers, "join")
    await accepted(client, headers, "pause", reason="break")
    await accepted(client, headers, "resume")
    await accepted(client, headers, "logout")
    await accepted(client, headers, "login", login="6600", password="training")
    await accepted(client, headers, "join")
    assert "oktell_shift" not in (await accepted(client, headers, "leave"))["completed"]


async def test_operator_and_staff_copies_are_isolated_even_for_same_request_id(
    client, operator, head, session
):
    operator_headers = auth(await login_with_work_sites(client, operator.login))
    staff_headers = auth(await login(client, head.login))
    request_id = str(uuid4())
    for headers in (operator_headers, staff_headers):
        await accepted(
            client, headers, "login", request_id=request_id, login="6600", password="training"
        )
    await accepted(client, operator_headers, "join")
    await accepted(
        client, operator_headers, "message", contact_id="supervisor", text="Учебный диалог"
    )
    staff = (await client.get(BASE, headers=staff_headers)).json()
    assert staff["logged_in"] and not staff["center_joined"]
    assert staff["messages"] == [] and staff["completed"] == []
    assert (
        await act(
            client, staff_headers, "call_comment", call_id=str(uuid4()), comment="Чужая запись"
        )
    ).status_code == 404
    facts = await mission_facts(session, [operator.id, head.id])
    assert facts[operator.id]["oktell_message"] == 1 and facts[head.id]["oktell_message"] == 0


@pytest.mark.parametrize(
    "fields",
    [
        {"action": "login", "login": "6600"},
        {"action": "phone_settings", "web_phone": "true", "auto_answer": False},
        {"action": "message", "contact_id": "supervisor", "text": "   "},
        {"action": "message", "contact_id": "supervisor", "text": "x" * 2001},
        {"action": "office_status", "status": "forward"},
        {"action": "office_status", "status": "available", "number": "6601"},
        {"action": "pause", "reason": "invented"},
        {"action": "call_comment", "call_id": "invented", "comment": "Описание"},
        {"action": "reset", "completed": ["oktell_ready"]},
        {"action": "invented"},
    ],
)
async def test_malformed_inputs_cannot_be_accepted(client, operator, fields):
    headers = auth(await login_with_work_sites(client, operator.login))
    response = await client.post(
        BASE + "/actions", headers=headers, json={"request_id": str(uuid4()), **fields}
    )
    assert response.status_code == 422


async def test_unknown_contacts_and_non_training_forward_numbers_are_rejected(client, operator):
    headers = auth(await login_with_work_sites(client, operator.login))
    await prepare(client, headers)
    for action, fields in [
        ("message", {"contact_id": "real-user", "text": "Привет"}),
        ("call_start", {"contact_id": "+77770000000"}),
    ]:
        assert (await act(client, headers, action, **fields)).status_code == 404
    assert (
        await act(client, headers, "office_status", status="forward", number="77770000000")
    ).status_code == 400
    forwarded = await accepted(client, headers, "office_status", status="forward", number="6601")
    assert forwarded["forward_number"] == "6601"


async def test_training_metrics_use_server_time_for_calls_and_breaks(client, operator, session):
    headers = auth(await login_with_work_sites(client, operator.login))
    await prepare(client, headers)
    await accepted(client, headers, "call_start", contact_id="operator-01")
    event = await session.scalar(select(OktellEvent).where(OktellEvent.kind == "call_start"))
    event.created_at = datetime.now(UTC) - timedelta(seconds=20)
    await session.commit()
    ended = await accepted(client, headers, "call_end")
    assert ended["metrics"]["talk_seconds"] >= 20
    assert ended["metrics"]["calls"] == ended["metrics"]["successful"] == 1
    await accepted(client, headers, "pause", reason="break")
    pause = await session.scalar(select(OktellEvent).where(OktellEvent.kind == "pause"))
    pause.created_at = datetime.now(UTC) - timedelta(seconds=10)
    await session.commit()
    resumed = await accepted(client, headers, "resume")
    assert resumed["metrics"]["break_seconds"] >= 10


async def test_current_pause_timer_resets_while_break_total_accumulates(operator):
    workspace = initial()
    started = datetime(2026, 10, 11, 12, tzinfo=UTC)

    def at(seconds):
        return started + timedelta(seconds=seconds)

    apply(workspace, "login", {"login": "6600"}, str(uuid4()), at(0))
    apply(workspace, "join", {}, str(uuid4()), at(0))
    apply(workspace, "pause", {"reason": "break"}, str(uuid4()), at(5))
    first = build(workspace, operator, at(15))
    assert first["pause_seconds"] == first["metrics"]["break_seconds"] == 10
    # A snapshot only reads elapsed server time; it cannot accumulate a pause twice.
    assert build(workspace, operator, at(15))["metrics"] == first["metrics"]
    apply(workspace, "resume", {}, str(uuid4()), at(15))
    working = build(workspace, operator, at(17))
    assert working["pause_seconds"] == 0 and working["metrics"]["break_seconds"] == 10

    apply(workspace, "pause", {"reason": "break"}, str(uuid4()), at(20))
    second = build(workspace, operator, at(24))
    assert second["pause_seconds"] == 4 and second["metrics"]["break_seconds"] == 14
    apply(workspace, "resume", {}, str(uuid4()), at(26))
    after = build(workspace, operator, at(30))
    assert after["pause_seconds"] == 0 and after["metrics"]["break_seconds"] == 16

    apply(workspace, "pause", {"reason": "technical"}, str(uuid4()), at(31))
    technical = build(workspace, operator, at(35))
    assert technical["pause_seconds"] == 4 and technical["metrics"]["break_seconds"] == 16
    apply(workspace, "leave", {}, str(uuid4()), at(36))
    assert build(workspace, operator, at(40))["pause_seconds"] == 0
    apply(workspace, "reset", {}, str(uuid4()), at(41))
    reset = build(workspace, operator, at(45))
    assert reset["pause_seconds"] == reset["metrics"]["break_seconds"] == 0
