"""Voice dialogue is server-owned; transcripts and verified actions remain per account."""

import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models.enums import Role
from app.models.voice_training import VoiceTrainingAttempt
from app.services import voice_training
from tests.conftest import auth, login, login_with_work_sites, make_group, make_user

pytestmark = pytest.mark.asyncio
BASE = "/api/v1/learning/voice"
EXPLAIN = (
    "Вы звоните с номера, который не совпадает с номером регистрации. "
    "По этому звонку я не могу поменять номер. Позвоните с номера регистрации. "
    "Можно изменить номер в приложении или обратиться в WhatsApp."
)
NEXT = "Напишите в WhatsApp, что нужно сменить номер и старой SIM-карты больше нет."


async def start(client, headers, persona="calm"):
    response = await client.post(
        BASE + "/start",
        headers=headers,
        json={"scenario_key": "phone_change", "persona": persona},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def answer(client, headers, attempt, text, **overrides):
    return await client.post(
        BASE + f"/attempts/{attempt['id']}/answer",
        headers=headers,
        json={"request_id": str(uuid4()), "turn": attempt["turn"], "text": text, **overrides},
    )


def inspection(attempt, system, **overrides):
    return {
        "system": system,
        "driver_id": attempt["driver"]["id"],
        "park_id": attempt["driver"]["park_id"],
        "incoming_phone": attempt["incoming_phone"],
        "registration_phone": attempt["driver"]["phone"],
        **overrides,
    }


async def inspect(client, headers, attempt, system, **overrides):
    return await client.post(
        BASE + f"/attempts/{attempt['id']}/inspect",
        headers=headers,
        json=inspection(attempt, system, **overrides),
    )


async def finish(client, headers, attempt):
    response = await client.post(BASE + f"/attempts/{attempt['id']}/finish", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Я не могу поменять номер по этому звонку", False),
        ("Нельзя изменить номер таким способом", False),
        ("Помогу разобраться, как изменить номер в приложении", False),
        ("Для смены номера обратитесь в WhatsApp", False),
        ("Я не изменю номер по звонку", False),
        ("Не переживайте, сейчас я сам поменяю номер", True),
        ("Я не могу поменять номер, но сейчас всё равно его изменю", True),
        ("Мы уже сменили номер", True),
        ("Сейчас я сам поменяю номер, напишите в WhatsApp", True),
        ("Я могу изменить вам номер прямо сейчас", True),
        ("Вы сказали: я изменю номер", False),
    ],
)
async def test_critical_flags_apply_negation_to_the_action(text, expected):
    assert voice_training.intents(text)["critical"] is expected


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Есть WhatsApp", (False, False, False, False)),
        ("WhatsApp вам не поможет", (False, False, False, False)),
        ("В WhatsApp обращаться не надо", (False, False, False, False)),
        ("В WhatsApp обращаться нельзя", (False, False, False, False)),
        ("В WhatsApp нет смысла обращаться", (False, False, False, False)),
        ("Не следует обращаться в WhatsApp", (False, False, False, False)),
        ("Не пишите в WhatsApp", (False, False, False, False)),
        ("Обратитесь в WhatsApp", (True, False, False, False)),
        ("Можно сменить номер в приложении или обратиться в WhatsApp", (True, False, True, False)),
        (NEXT, (True, True, False, False)),
        ("Можно изменить номер в приложении", (False, False, True, False)),
        ("Откройте Такси Про и измените номер", (False, False, True, True)),
        ("Приложение не открывается?", (False, False, False, False)),
        ("В приложении нельзя изменить номер", (False, False, False, False)),
    ],
)
async def test_channel_mentions_need_a_positive_action(text, expected):
    found = voice_training.intents(text)
    assert tuple(found[key] for key in ("whatsapp", "next_whatsapp", "app", "next_app")) == expected


@pytest.mark.parametrize(
    "text",
    [
        "Вы не сможете позвонить с номера регистрации",
        "Нельзя позвонить с номера регистрации",
        "Не получится позвонить с регистрационного номера",
    ],
)
async def test_unavailable_registered_call_is_not_proposed(text):
    assert not voice_training.intents(text)["registered_call"]


async def test_start_catalog_private_before_qr_no_solution_and_all_operator_groups(
    client, session, operator
):
    headers = auth(await login(client, operator.login))
    response = await client.get(BASE, headers=headers)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert len(response.json()["scenarios"][0]["personas"]) == 4
    attempt = await start(client, headers)
    assert attempt["turn"] == 0 and attempt["stage"] == "opening"
    assert attempt["result"] is None and "requests" not in attempt and "snapshot" not in attempt
    assert attempt["driver"]["phone"] != attempt["incoming_phone"]
    assert attempt["driver"]["name"] == "Ким Виктор Андреевич"
    assert attempt["practice"] == {"dispatch": False, "oktell": False, "compared": False}
    assert len(attempt["transcript"]) == 1
    assert "WhatsApp" not in attempt["transcript"][0]["text"]
    catalog = (await client.get(BASE, headers=headers)).json()
    assert catalog["attempts"][0]["id"] == attempt["id"]
    assert catalog["attempts"][0]["score"] is None
    read = await client.get(BASE + f"/attempts/{attempt['id']}", headers=headers)
    assert read.json() == attempt


async def test_idempotency_expected_turn_and_ownership(client, session, operator):
    headers = auth(await login(client, operator.login))
    attempt = await start(client, headers)
    request_id = str(uuid4())
    response = await answer(client, headers, attempt, EXPLAIN, request_id=request_id)
    assert response.status_code == 200, response.text
    next_attempt = response.json()
    assert next_attempt["turn"] == 1 and next_attempt["stage"] == "lost_sim"
    assert "SIM" in next_attempt["transcript"][-1]["text"]
    duplicate = await answer(client, headers, attempt, EXPLAIN, request_id=request_id)
    assert duplicate.json() == next_attempt
    changed = await answer(client, headers, attempt, NEXT, request_id=request_id)
    assert changed.status_code == 409
    stale = await answer(client, headers, attempt, NEXT)
    assert stale.status_code == 409
    assert len(next_attempt["transcript"]) == 3
    other = await make_user(session, login="other-voice")
    foreign = auth(await login(client, other.login))
    for method, suffix, body in [
        ("GET", "", None),
        ("POST", "/finish", {}),
        ("POST", "/answer", {"request_id": str(uuid4()), "turn": 1, "text": NEXT}),
        ("POST", "/retry", {"turn": 0}),
        ("POST", "/review", {"comment": "Проверьте оценку"}),
    ]:
        response = await client.request(
            method,
            BASE + f"/attempts/{attempt['id']}" + suffix,
            headers=foreign,
            json=body,
        )
        assert response.status_code == 404, response.text


async def test_inspection_requires_qr_real_seed_both_reads_and_explicit_comparison(
    client, session, operator
):
    plain = auth(await login(client, operator.login))
    attempt = await start(client, plain)
    denied = await inspect(client, plain, attempt, "dispatch")
    assert denied.status_code == 403 and denied.json()["code"] == "work_sites_qr_required"
    headers = auth(await login_with_work_sites(client, operator.login))
    assert (await inspect(client, headers, attempt, "compare")).status_code == 409
    assert (
        await inspect(client, headers, attempt, "dispatch", driver_id="wrong")
    ).status_code == 400
    assert (
        await inspect(client, headers, attempt, "oktell", incoming_phone="7000")
    ).status_code == 400
    assert (await inspect(client, headers, attempt, "dispatch")).status_code == 200
    assert (await inspect(client, headers, attempt, "compare")).status_code == 409
    read = await inspect(client, headers, attempt, "oktell")
    assert read.json()["practice"] == {"dispatch": True, "oktell": True, "compared": False}
    assert (
        await inspect(client, headers, attempt, "compare", registration_phone="7000")
    ).status_code == 400
    compared = await inspect(
        client,
        headers,
        attempt,
        "compare",
        registration_phone="8" + attempt["driver"]["phone"][2:],
    )
    assert compared.json()["practice"]["compared"]
    attempt = (await answer(client, headers, attempt, EXPLAIN)).json()
    attempt = (await answer(client, headers, attempt, NEXT)).json()
    assert attempt["stage"] == "resolved" and attempt["can_finish"]
    assert attempt["result"] is None
    finished = await finish(client, headers, attempt)
    assert finished["result"]["score"] == 100
    assert all(item["passed"] for item in finished["result"]["criteria"])
    assert not finished["result"]["critical_errors"]
    for item in finished["result"]["criteria"]:
        assert item["quote"] and item["turn"] is not None and item["example"]
    assert (await inspect(client, headers, finished, "dispatch")).status_code == 409
    assert (await finish(client, headers, finished)) == finished


@pytest.mark.parametrize("persona", ["calm", "confused", "hurried", "irritated"])
async def test_lost_sim_always_revealed_persona_followups_and_channel_not_enough(
    client, operator, persona
):
    headers = auth(await login(client, operator.login))
    attempt = await start(client, headers, persona)
    attempt = (await answer(client, headers, attempt, "Здравствуйте, проверю данные.")).json()
    assert attempt["stage"] == "opening"
    attempt = (await answer(client, headers, attempt, "Позвоните со старого номера.")).json()
    assert attempt["stage"] == "lost_sim"
    attempt = (await answer(client, headers, attempt, "Позвоните со старого номера.")).json()
    assert "Я же сказал" in attempt["transcript"][-1]["text"]
    attempt = (await answer(client, headers, attempt, "Есть WhatsApp")).json()
    assert attempt["stage"] != "resolved"
    attempt = (await answer(client, headers, attempt, EXPLAIN)).json()
    if persona == "confused":
        assert "простыми словами" in attempt["transcript"][-1]["text"]
    elif persona == "hurried":
        assert "одно действие" in attempt["transcript"][-1]["text"]
    attempt = (await answer(client, headers, attempt, NEXT)).json()
    assert attempt["stage"] == "resolved"
    finished = await finish(client, headers, attempt)
    assert finished["result"]["score"] == 75  # no Work Sites events
    assert not finished["result"]["criteria"][0]["passed"]


async def test_early_finish_critical_evidence_retry_preserves_original_and_history(
    client, session, operator
):
    headers = auth(await login(client, operator.login))
    attempt = await start(client, headers)
    attempt = (await answer(client, headers, attempt, "Не переживайте, сам поменяю номер.")).json()
    finished = await finish(client, headers, attempt)
    errors = finished["result"]["critical_errors"]
    assert len(errors) == 1 and errors[0]["turn"] == 0
    assert errors[0]["quote"] == "Не переживайте, сам поменяю номер."
    retry = await client.post(
        BASE + f"/attempts/{attempt['id']}/retry",
        headers=headers,
        json={"turn": 0},
    )
    assert retry.status_code == 200, retry.text
    retried = retry.json()
    assert retried["id"] != attempt["id"] and retried["retry_of"] == attempt["id"]
    assert retried["turn"] == 0 and retried["stage"] == "opening"
    assert len(retried["transcript"]) == 1 and retried["result"] is None
    retried = (await answer(client, headers, retried, EXPLAIN)).json()
    retried = (await answer(client, headers, retried, "Обратитесь в WhatsApp")).json()
    assert retried["stage"] == "next_step"
    retried = (await answer(client, headers, retried, NEXT)).json()
    retried = await finish(client, headers, retried)
    later_retry = await client.post(
        BASE + f"/attempts/{retried['id']}/retry",
        headers=headers,
        json={"turn": 2},
    )
    assert later_retry.status_code == 200, later_retry.text
    prefix = later_retry.json()
    assert prefix["stage"] == "next_step" and prefix["turn"] == 2
    assert len(prefix["transcript"]) == 5
    original = (await client.get(BASE + f"/attempts/{attempt['id']}", headers=headers)).json()
    assert original == finished
    assert await session.scalar(select(func.count()).select_from(VoiceTrainingAttempt)) == 3
    history = (await client.get(BASE, headers=headers)).json()["attempts"]
    assert len(history) == 3 and history[1]["score"] == 75


async def test_persisted_review_queue_supervisor_scope_and_mentor_resolution(
    client, session, operator, supervisor
):
    headers = auth(await login(client, operator.login))
    attempt = await finish(client, headers, await start(client, headers))
    request = {"comment": "Фраза распознана неверно, прошу проверить."}
    saved = await client.post(
        BASE + f"/attempts/{attempt['id']}/review",
        headers=headers,
        json=request,
    )
    assert saved.status_code == 200 and saved.json()["result"]["review_status"] == "pending"
    assert (await client.get(BASE + "/reviews", headers=headers)).status_code == 403
    own_mentor = auth(await login(client, supervisor.login))
    queue = await client.get(BASE + "/reviews", headers=own_mentor)
    assert queue.status_code == 200, queue.text
    assert queue.json()["reviews"][0]["attempt_id"] == attempt["id"]
    other = await make_user(session, login="other-supervisor", role=Role.SUPERVISOR)
    await make_group(session, code="voice-other", supervisor_id=other.id)
    other_headers = auth(await login(client, other.login))
    assert (await client.get(BASE + "/reviews", headers=other_headers)).json()["reviews"] == []
    assert (
        await client.get(
            BASE + f"/reviews/{attempt['id']}",
            headers=other_headers,
        )
    ).status_code == 404
    detail = await client.get(BASE + f"/reviews/{attempt['id']}", headers=own_mentor)
    assert detail.json()["learner"]["id"] == operator.id
    assert detail.json()["review"]["comment"] == request["comment"]
    response = await client.post(
        BASE + f"/reviews/{attempt['id']}/resolve",
        headers=own_mentor,
        json={"comment": "Посмотрел запись текста. Разберите следующий шаг на встрече."},
    )
    assert response.status_code == 200, response.text
    result = response.json()["result"]
    assert result["review_status"] == "reviewed" and result["mentor_comment"]
    learner = (await client.get(BASE + f"/attempts/{attempt['id']}", headers=headers)).json()
    assert learner["result"] == result
    history = (await client.get(BASE, headers=headers)).json()["attempts"]
    assert history[0]["review_status"] == "reviewed"


async def test_concurrent_duplicate_answer_is_applied_once(client, operator):
    headers = auth(await login(client, operator.login))
    attempt = await start(client, headers)
    request_id = str(uuid4())
    responses = await asyncio.gather(
        *(answer(client, headers, attempt, EXPLAIN, request_id=request_id) for _ in range(2))
    )
    assert all(response.status_code == 200 for response in responses)
    assert responses[0].json() == responses[1].json()
    saved = (await client.get(BASE + f"/attempts/{attempt['id']}", headers=headers)).json()
    assert saved["turn"] == 1 and len(saved["transcript"]) == 3


async def test_staff_review_visibility_hides_leadership_transcripts(client, session):
    head = await make_user(session, login="voice-head", role=Role.HEAD)
    trainer = await make_user(session, login="voice-trainer", role=Role.TRAINER)
    headers = auth(await login(client, head.login))
    attempt = await finish(client, headers, await start(client, headers))
    saved = await client.post(
        BASE + f"/attempts/{attempt['id']}/review",
        headers=headers,
        json={"comment": "Прошу проверить учебную попытку."},
    )
    assert saved.status_code == 200
    trainer_headers = auth(await login(client, trainer.login))
    assert (await client.get(BASE + "/reviews", headers=trainer_headers)).json()["reviews"] == []
    assert (
        await client.get(
            BASE + f"/reviews/{attempt['id']}",
            headers=trainer_headers,
        )
    ).status_code == 404
    own = await client.get(BASE + f"/reviews/{attempt['id']}", headers=headers)
    assert own.status_code == 200


async def test_trainee_can_practise_voice_but_keeps_qr_and_mentor_boundaries(client, session):
    learner = await make_user(session, login="voice-trainee", role=Role.TRAINEE)
    headers = auth(await login(client, learner.login))
    assert (await client.get(BASE, headers=headers)).status_code == 200
    attempt = await start(client, headers)
    response = await inspect(client, headers, attempt, "dispatch")
    assert response.status_code == 403
    assert (await client.get(BASE + "/reviews", headers=headers)).status_code == 403
    headers = auth(await login_with_work_sites(client, learner.login))
    response = await inspect(client, headers, attempt, "dispatch")
    assert response.status_code == 200
    assert response.json()["practice"]["dispatch"] is True
    result = await finish(client, headers, attempt)
    assert result["state"] == "completed"
