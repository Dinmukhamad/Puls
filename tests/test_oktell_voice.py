"""Drivers of the voice trainer call into Oktell: ring, answer, talk, hang up, missed calls."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models.enums import Role
from app.models.oktell import OktellEvent
from app.models.voice_training import VoiceTrainingAttempt
from app.services import voice_training
from tests.conftest import auth, login, login_with_work_sites, make_user
from tests.test_oktell import BASE, accepted, act
from tests.test_voice_scenarios import EDITOR, support_city, write
from tests.test_voice_training import EXPLAIN

pytestmark = pytest.mark.asyncio
VOICE = "/api/v1/learning/voice"


async def ready(client, headers, auto_answer=True):
    await accepted(client, headers, "login", login="6600", password="training")
    await accepted(client, headers, "join")
    return await accepted(
        client, headers, "phone_settings", web_phone=True, auto_answer=auto_answer
    )


async def attempt_of(client, headers, attempt_id):
    response = await client.get(f"{VOICE}/attempts/{attempt_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


async def say(client, headers, attempt, text):
    response = await client.post(
        f"{VOICE}/attempts/{attempt['id']}/answer",
        headers=headers,
        json={"request_id": str(uuid4()), "turn": attempt["turn"], "text": text},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_a_driver_rings_only_when_the_operator_takes_calls(client, operator):
    headers = auth(await login_with_work_sites(client, operator.login))
    await accepted(client, headers, "login", login="6600", password="training")
    assert (await act(client, headers, "ring")).status_code == 400
    await accepted(client, headers, "join")
    assert (await act(client, headers, "ring")).status_code == 400
    await accepted(client, headers, "phone_settings", web_phone=True, auto_answer=False)
    for away, back in [
        (("pause", {"reason": "break"}), ("resume", {})),
        (("center_mode", {"mode": "manual"}), ("center_mode", {"mode": "automatic"})),
        (("office_status", {"status": "dnd"}), ("office_status", {"status": "available"})),
    ]:
        await accepted(client, headers, away[0], **away[1])
        refused = await act(client, headers, "ring")
        assert refused.status_code == 400 and "автоматическом" in refused.json()["detail"]
        await accepted(client, headers, back[0], **back[1])
    ringing = await accepted(client, headers, "ring")
    assert ringing["voice_calls"] and ringing["ring_seconds"] == 25
    call = ringing["ringing"]
    assert call["name"] == "Водитель" and call["number"] == "+77015550192"
    # Who calls and in what mood stays on the server until the operator answers.
    assert set(call) == {"id", "number", "name", "department", "started_at"}
    assert "_ring_call" not in ringing and "persona" not in str(ringing)
    assert (await act(client, headers, "ring")).status_code == 400


async def test_an_answered_call_is_a_voice_attempt_that_hanging_up_finishes(
    client, operator, session
):
    headers = auth(await login_with_work_sites(client, operator.login))
    await ready(client, headers)
    call = (await accepted(client, headers, "ring"))["ringing"]
    request_id = str(uuid4())
    answered = await act(client, headers, "answer", request_id=request_id)
    assert answered.status_code == 200, answered.text
    # A retried answer is the same answer: one attempt, not two.
    assert (await act(client, headers, "answer", request_id=request_id)).json() == answered.json()
    state = answered.json()
    active = state["active_call"]
    assert state["ringing"] is None and active["direction"] == "inbound"
    assert active["number"] == call["number"] and active["id"] == call["id"]
    total = select(func.count()).select_from(VoiceTrainingAttempt)
    assert await session.scalar(total) == 1
    attempt = await attempt_of(client, headers, active["voice_attempt_id"])
    assert attempt["channel"] == "oktell" and attempt["state"] == "in_progress"
    assert attempt["incoming_phone"] == call["number"] and attempt["language"] == "ru"
    # The incoming number is on screen: reading the call is done by answering it.
    assert attempt["practice"] == {"dispatch": False, "oktell": True, "compared": False}
    attempt = await say(client, headers, attempt, EXPLAIN)
    assert attempt["transcript"][-1]["role"] == "driver"
    for action, fields in [("leave", {}), ("pause", {"reason": "break"}), ("ring", {})]:
        assert (await act(client, headers, action, **fields)).status_code == 400
    ended = await accepted(client, headers, "call_end")
    entry = ended["calls"][0]
    assert ended["active_call"] is None and entry["status"] == "completed"
    assert entry["direction"] == "inbound" and entry["voice_attempt_id"] == attempt["id"]
    assert ended["metrics"]["calls"] == 1 and ended["metrics"]["successful"] == 1
    finished = await attempt_of(client, headers, attempt["id"])
    assert finished["state"] == "completed" and finished["result"]["score"] is not None
    catalog = (await client.get(VOICE, headers=headers)).json()
    assert catalog["attempts"][0]["channel"] == "oktell"


async def test_the_trainer_takes_the_drivers_calls_too(client, session):
    trainer = await make_user(session, login="oktell-trainer", role=Role.TRAINER)
    headers = auth(await login_with_work_sites(client, trainer.login))
    assert (await ready(client, headers, auto_answer=False))["voice_calls"] is True
    call = (await accepted(client, headers, "ring"))["ringing"]
    active = (await accepted(client, headers, "answer"))["active_call"]
    assert active["direction"] == "inbound" and active["id"] == call["id"]
    attempt = await attempt_of(client, headers, active["voice_attempt_id"])
    assert attempt["channel"] == "oktell" and attempt["state"] == "in_progress"
    ended = await accepted(client, headers, "call_end")
    assert ended["calls"][0]["status"] == "completed"
    finished = await attempt_of(client, headers, attempt["id"])
    assert finished["state"] == "completed" and finished["result"]["score"] is not None


async def test_an_unanswered_call_is_missed_and_cannot_be_answered(client, operator, session):
    headers = auth(await login_with_work_sites(client, operator.login))
    await ready(client, headers, auto_answer=False)
    await accepted(client, headers, "ring")
    ring = await session.scalar(select(OktellEvent).where(OktellEvent.kind == "ring"))
    ring.created_at = datetime.now(UTC) - timedelta(seconds=26)
    await session.commit()
    state = (await client.get(BASE, headers=headers)).json()
    missed = state["calls"][0]
    assert state["ringing"] is None and missed["status"] == "missed"
    assert missed["direction"] == "inbound" and missed["duration_seconds"] == 0
    assert state["metrics"]["calls"] == 1 and state["metrics"]["successful"] == 0
    refused = await act(client, headers, "answer")
    assert refused.status_code == 400 and "пропущенные" in refused.json()["detail"]
    assert await session.scalar(select(func.count()).select_from(VoiceTrainingAttempt)) == 0
    # A pause while the call rings lets it go as well.
    await accepted(client, headers, "ring")
    paused = await accepted(client, headers, "pause", reason="break")
    assert paused["ringing"] is None and paused["calls"][0]["status"] == "missed"


async def test_the_language_is_kept_and_a_repeated_moment_rings_as_the_next_call(
    client, operator
):
    headers = auth(await login_with_work_sites(client, operator.login))
    await ready(client, headers)
    chosen = await accepted(client, headers, "voice_language", language="kk")
    assert chosen["voice_language"] == "kk"
    await accepted(client, headers, "ring")
    answered = await accepted(client, headers, "answer")
    first = await attempt_of(client, headers, answered["active_call"]["voice_attempt_id"])
    assert first["language"] == "kk" and first["channel"] == "oktell"
    await say(client, headers, first, EXPLAIN)
    await accepted(client, headers, "call_end")
    wrong = await act(client, headers, "ring", retry={"attempt_id": first["id"], "turn": 7})
    assert wrong.status_code == 400
    await accepted(client, headers, "ring", retry={"attempt_id": first["id"], "turn": 0})
    answered = await accepted(client, headers, "answer")
    second = await attempt_of(client, headers, answered["active_call"]["voice_attempt_id"])
    assert second["retry_of"] == first["id"] and second["persona"] == first["persona"]
    assert second["language"] == "kk" and second["channel"] == "oktell"
    assert second["turn"] == 0 and len(second["transcript"]) == 1
    # Resetting the workspace hangs up first: the call's attempt is finished, not left open.
    await accepted(client, headers, "reset")
    assert (await attempt_of(client, headers, second["id"]))["state"] == "completed"


async def test_calls_come_from_every_published_situation_in_the_language(
    client, session, operator, supervisor
):
    for _ in range(30):
        call = await voice_training.incoming(session, operator, "ru", ["phone_change", "calm"])
        # Never the same driver in the same mood twice in a row.
        assert call["scenario_key"] == "phone_change" and call["persona"] != "calm"
        assert call["number"] == "+77015550192" and call["language"] == "ru"
    await support_city(session, supervisor)
    staff = auth(await login(client, supervisor.login))
    data = await write(client, staff)
    published = await client.post(
        f"{EDITOR}/{data['id']}/publish", headers=staff,
        json={"draft_version": data["draft_version"]},
    )
    assert published.status_code == 200, published.text
    keys = {
        (await voice_training.incoming(session, operator, "ru"))["scenario_key"]
        for _ in range(60)
    }
    assert keys == {"phone_change", f"custom:{data['id']}"}
    # The scenario is written in Russian: a Kazakh call is never it.
    for _ in range(20):
        call = await voice_training.incoming(session, operator, "kk")
        assert call["scenario_key"] == "phone_change"
