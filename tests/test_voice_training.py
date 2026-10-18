"""Voice dialogue is server-owned; transcripts and verified actions remain per account."""

import asyncio
from types import SimpleNamespace
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
    assert len(response.json()["scenarios"][0]["personas"]) == 5
    attempt = await start(client, headers)
    assert attempt["turn"] == 0 and attempt["stage"] == "opening"
    assert attempt["revision"] == voice_training.REVISION == 3
    assert attempt["language"] == "ru"
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
    assert next_attempt["turn"] == 1 and next_attempt["stage"] == "next_step"
    assert "приложении" in next_attempt["transcript"][-1]["text"]
    assert "SIM" not in next_attempt["transcript"][-1]["text"]
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
async def test_lost_sim_relevant_to_registered_call_persona_followups_and_channel_not_enough(
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


def conversation_v2(*answers, persona="calm", snapshot=None):
    transcript = [{"role": "driver", "text": voice_training.OPENING[persona], "turn": 0}]
    stage = "opening"
    for turn, text in enumerate(answers):
        stage, reply = voice_training.next_reply_v2(
            persona, stage, transcript, text, snapshot=snapshot
        )
        transcript.extend(
            [
                {"role": "operator", "text": text, "turn": turn},
                {"role": "driver", "text": reply, "turn": turn + 1},
            ]
        )
    return SimpleNamespace(
        revision=2,
        transcript=transcript,
        stage=stage,
        practice={"events": [{"system": key} for key in ("dispatch", "oktell", "compared")]},
    )


async def test_v2_same_turn_reacts_to_app_whatsapp_or_registered_call():
    app = conversation_v2("Можно изменить номер в приложении Такси Про.")
    whatsapp = conversation_v2("Обратитесь в WhatsApp.")
    call = conversation_v2("Позвоните с номера регистрации.")
    assert "Такси Про" in app.transcript[-1]["text"]
    assert "WhatsApp" in whatsapp.transcript[-1]["text"]
    assert len({attempt.transcript[-1]["text"] for attempt in (app, whatsapp, call)}) == 3
    assert all("SIM" not in attempt.transcript[-1]["text"] for attempt in (app, whatsapp))
    assert call.stage == "lost_sim" and call.transcript[-1]["text"] == voice_training.LOST_SIM


async def test_v2_explaining_the_incoming_call_does_not_request_another_call():
    explanation = "Вы звоните с номера, который не совпадает с номером регистрации."
    attempt = conversation_v2(explanation)
    assert not voice_training.advice_v2(explanation)["registered_call"]
    assert attempt.stage == "next_step"
    assert "SIM" not in attempt.transcript[-1]["text"]
    request = "Вы звоните с другого номера. Перезвоните с номера регистрации."
    assert conversation_v2(request).stage == "lost_sim"


async def test_v2_app_aliases_and_natural_advice_need_no_scripted_repeat():
    for product in ("Такси Про", "ТаксиПро", "TaxiPro", "Яндекс Про", "Яндекс.Про", "Yandex Pro"):
        for instruction in (
            f"Вы можете самостоятельно изменить номер в {product}.",
            f"Номер поменяйте в {product}.",
            f"Откройте {product} и измените номер.",
        ):
            attempt = conversation_v2(instruction)
            assert attempt.stage == "resolved", instruction
            assert "приложении" in attempt.transcript[-1]["text"]
            assert "SIM" not in attempt.transcript[-1]["text"]


async def test_v2_one_appropriate_channel_suffices_for_full_score():
    explanation = "Вы звоните с номера, который не совпадает с номером регистрации."
    for next_step in (
        "Откройте Такси Про и измените номер в приложении.",
        "Напишите в WhatsApp, что хотите изменить номер телефона.",
    ):
        attempt = conversation_v2(explanation, next_step)
        result = voice_training.evaluate_v2(attempt)
        assert result["score"] == 100, result
        assert all(item["passed"] for item in result["criteria"])
        assert result["rules_revision"] == 2
        assert not any(entry["text"] == voice_training.LOST_SIM for entry in attempt.transcript)


async def test_v2_short_followups_keep_the_chosen_channel_and_specific_question():
    for offer, followup, expected in (
        ("Можно изменить номер в Такси Про.", "Откройте его и измените там номер.", "приложении"),
        ("Обратитесь в WhatsApp.", "Напишите туда, что хотите изменить номер.", "WhatsApp"),
    ):
        attempt = conversation_v2(offer, "Сейчас поясню.", followup)
        assert expected in attempt.transcript[4]["text"]
        assert attempt.stage == "resolved"
        assert expected in attempt.transcript[-1]["text"]
    unknown = conversation_v2("Напишите туда, что хотите изменить номер.")
    assert unknown.stage != "resolved"  # There was no established destination.


async def test_v2_corrections_replace_channels_and_never_reuse_an_old_step():
    for correction in (
        "Не меняйте номер в приложении. Напишите в WhatsApp о смене номера.",
        "Вместо Такси Про напишите в WhatsApp о смене номера.",
        "Лучше напишите в WhatsApp о смене номера.",
        "Можно сменить номер в приложении или написать в WhatsApp. Напишите в WhatsApp о смене номера.",
    ):
        attempt = conversation_v2("Можно изменить номер в Такси Про.", correction)
        assert attempt.stage == "resolved", correction
        assert "WhatsApp" in attempt.transcript[-1]["text"], correction
        state = voice_training.dialogue_state_v2(attempt.transcript)
        assert state["channel"] == "whatsapp"
        assert state["step"]["text"] == correction
    retracted = conversation_v2("Обратитесь в WhatsApp.", "Не пишите туда о смене номера.")
    assert retracted.stage != "resolved"
    assert not voice_training.evaluate_v2(retracted)["criteria"][1]["passed"]


async def test_v2_channel_mentions_questions_and_negations_do_not_earn_solution():
    for text in (
        "Есть WhatsApp.",
        "Не пишите в WhatsApp о смене номера.",
        "В WhatsApp обращаться не нужно.",
        "В приложении смена номера недоступна.",
        "Нельзя изменить номер в Такси Про.",
        "Не меняйте номер в приложении.",
        "Вы можете изменить номер в приложении?",
        "У вас есть доступ к приложению Такси Про?",
    ):
        attempt = conversation_v2(text)
        result = voice_training.evaluate_v2(attempt)
        assert attempt.stage != "resolved", text
        assert not result["criteria"][1]["passed"], text
        assert not result["criteria"][3]["passed"], text
    availability = conversation_v2("У вас есть доступ к приложению Такси Про?", "Тогда измените там номер.")
    assert availability.stage == "resolved"


async def test_v2_postposed_prohibitions_retract_the_chosen_channel():
    for offer, prohibition in (
        ("Можно изменить номер в приложении.", "Номер в приложении не изменяйте."),
        ("Можно изменить номер в Такси Про.", "В Такси Про номер не меняйте."),
        ("Обратитесь в WhatsApp.", "В WhatsApp не пишите о смене номера."),
    ):
        attempt = conversation_v2(offer, prohibition)
        result = voice_training.evaluate_v2(attempt)
        assert attempt.stage != "resolved", prohibition
        assert voice_training.dialogue_state_v2(attempt.transcript)["channel"] is None
        assert not result["criteria"][1]["passed"], prohibition
        assert not result["criteria"][3]["passed"], prohibition


async def test_v2_questions_about_a_possible_action_do_not_complete_it():
    for question in (
        "В WhatsApp можно обратиться, чтобы изменить номер?",
        "Написать в WhatsApp о смене номера?",
        "Откройте приложение и измените номер?",
    ):
        attempt = conversation_v2(question)
        result = voice_training.evaluate_v2(attempt)
        assert attempt.stage != "resolved", question
        assert not result["criteria"][1]["passed"], question
        assert not result["criteria"][3]["passed"], question


async def test_v2_a_question_followed_by_advice_uses_the_actual_action():
    for instruction, expected in (
        ("У вас есть Такси Про? Откройте приложение и измените номер.", "Такси Про"),
        ("У вас есть Такси Про? Тогда измените там номер.", "Такси Про"),
        ("У вас есть WhatsApp? Напишите туда, что хотите изменить номер.", "WhatsApp"),
        ("У вас есть Такси Про? Напишите в WhatsApp о смене номера.", "WhatsApp"),
    ):
        attempt = conversation_v2(instruction)
        assert attempt.stage == "resolved", instruction
        assert expected in attempt.transcript[-1]["text"], instruction
        assert voice_training.evaluate_v2(attempt)["criteria"][3]["passed"]
    partial = conversation_v2("У вас есть Такси Про? Обратитесь в WhatsApp.")
    assert partial.stage != "resolved"
    assert "WhatsApp" in partial.transcript[-1]["text"]


async def test_v2_a_warning_about_account_deletion_is_not_an_unsafe_action():
    for warning in (
        "Не нажимайте кнопку «Стереть аккаунт». Откройте Такси Про и измените номер.",
        "Не выбирайте пункт «Удалить аккаунт». Напишите в WhatsApp о смене номера.",
        "Не удаляйте аккаунт. Откройте Такси Про и измените номер.",
    ):
        attempt = conversation_v2(warning)
        result = voice_training.evaluate_v2(attempt)
        assert attempt.stage == "resolved", warning
        assert result["criteria"][1]["passed"], warning
        assert not result["critical_errors"], warning
    unsafe = conversation_v2(
        "Не нажимайте кнопку «Стереть аккаунт», а удалите аккаунт. "
        "Откройте Такси Про и измените номер."
    )
    assert unsafe.stage != "resolved"
    assert voice_training.evaluate_v2(unsafe)["critical_errors"]


async def test_v2_old_sim_is_only_relevant_when_asked_or_registered_call_offered():
    attempt = conversation_v2(
        "У вас осталась старая SIM-карта?",
        "Позвоните с номера регистрации.",
        "Тогда откройте Такси Про и измените номер.",
    )
    assert attempt.transcript[2]["text"] == voice_training.LOST_SIM
    assert "Я же сказал" in attempt.transcript[4]["text"]
    assert attempt.stage == "resolved"
    assert voice_training.evaluate_v2(attempt)["criteria"][1]["passed"]
    switch_to_call = conversation_v2("Можно изменить номер в приложении.", "Позвоните со старого номера.")
    assert switch_to_call.stage == "lost_sim"


async def test_v2_factual_questions_use_server_snapshot_and_preserve_context():
    snapshot = {
        "driver": {"name": "Ким Виктор Андреевич", "phone": "+77015550999"},
        "incoming_phone": "+77015550123",
    }
    attempt = conversation_v2(
        "Назовите, пожалуйста, ФИО.",
        "С какого номера звоните?",
        "Какой номер регистрации?",
        "Можно изменить номер в Такси Про.",
        "Как вас зовут?",
        "Откройте его и измените там номер.",
        snapshot=snapshot,
    )
    assert snapshot["driver"]["name"] in attempt.transcript[2]["text"]
    assert snapshot["incoming_phone"] in attempt.transcript[4]["text"]
    assert snapshot["driver"]["phone"] in attempt.transcript[6]["text"]
    assert attempt.stage == "resolved"


async def test_v2_unsafe_promises_and_account_deletion_never_finish_the_call():
    for text in (
        "Я сам поменяю номер сейчас. Откройте Такси Про и измените номер.",
        "Нажмите кнопку «Стереть аккаунт» в Такси Про и измените номер.",
    ):
        attempt = conversation_v2(text)
        result = voice_training.evaluate_v2(attempt)
        assert attempt.stage != "resolved"
        assert result["score"] <= 50
        assert len(result["critical_errors"]) == 1
        assert result["critical_errors"][0]["quote"] == text
        assert not result["criteria"][1]["passed"]


async def test_v1_saved_attempt_keeps_original_dialogue_evaluation_and_retry(client, session, operator):
    headers = auth(await login(client, operator.login))
    attempt = await start(client, headers)
    saved = await session.get(VoiceTrainingAttempt, attempt["id"])
    saved.revision = 1
    saved.snapshot = {**saved.snapshot, "rules_source": "Учебные правила · голосовой сценарий v1"}
    await session.commit()
    attempt = (await answer(client, headers, attempt, EXPLAIN)).json()
    assert attempt["revision"] == 1 and attempt["stage"] == "lost_sim"
    assert attempt["transcript"][-1]["text"] == voice_training.LOST_SIM
    attempt = (await answer(client, headers, attempt, NEXT)).json()
    finished = await finish(client, headers, attempt)
    assert finished["result"]["score"] == 75
    assert finished["result"]["rules_revision"] == 1
    response = await client.post(
        BASE + f"/attempts/{attempt['id']}/retry", headers=headers, json={"turn": 1}
    )
    assert response.status_code == 200, response.text
    retry = response.json()
    assert retry["revision"] == 1 and retry["stage"] == "lost_sim"
    retry = (await answer(client, headers, retry, NEXT)).json()
    assert retry["stage"] == "resolved"


# --- Revision 3: the driver in character, Russian or Kazakh -----------------------------

SNAPSHOT_KK = {
    "language": "kk",
    "driver": {"name": "Ким Виктор Андреевич", "phone": "+77015550999"},
    "incoming_phone": "+77015550192",
}


def conversation_v3(*answers, persona="calm", language="ru"):
    snapshot = {**SNAPSHOT_KK, "language": language}
    transcript = [{
        "role": "driver", "text": voice_training.OPENING_V3[language][persona],
        "turn": 0, "line": "opening",
    }]
    stage = "opening"
    for turn, text in enumerate(answers):
        stage, reply, line = voice_training.next_reply_v3(
            persona, stage, transcript, text, snapshot=snapshot
        )
        transcript.extend([
            {"role": "operator", "text": text, "turn": turn},
            {"role": "driver", "text": reply, "turn": turn + 1, "line": line},
        ])
    return SimpleNamespace(
        revision=3, transcript=transcript, stage=stage, snapshot=snapshot, persona=persona,
        practice={"events": [{"system": key} for key in ("dispatch", "oktell", "compared")]},
    )


def lines(attempt):
    return [entry["line"] for entry in attempt.transcript if entry["role"] == "driver"]


KK_EXPLAIN = (
    "Сіз тіркелген нөмірден емес, басқа нөмірден хабарласып тұрсыз, сондықтан бұл қоңырау "
    "арқылы нөмірді ауыстыру мүмкін емес."
)


async def test_v3_russian_decisions_match_v2_while_the_wording_follows_the_character():
    answers = (
        "Вы звоните с номера, который не совпадает с номером регистрации.",
        "Позвоните с номера регистрации.",
        "Тогда откройте Такси Про и измените номер.",
    )
    v2 = conversation_v2(*answers, persona="irritated")
    for persona in ("calm", "confused", "hurried", "irritated"):
        v3 = conversation_v3(*answers, persona=persona)
        assert v3.stage == v2.stage == "resolved"
        assert lines(v3) == ["opening", "mismatch", "lost_sim", "resolved_app"]
    calm = conversation_v3(*answers, persona="calm")
    # The calm driver says exactly the revision 2 words.
    assert [e["text"] for e in calm.transcript[2::2]] == [e["text"] for e in v2.transcript[2::2]]
    irritated = conversation_v3(*answers, persona="irritated")
    assert irritated.transcript[2]["text"].startswith("Мне некогда. ")
    assert irritated.transcript[4]["text"].startswith("Я уже теряю время. ")
    assert irritated.transcript[6]["text"].startswith("Ну наконец-то. ")
    confused = conversation_v3(*answers, persona="confused")
    assert confused.transcript[0]["text"].startswith("Здравствуйте… э-э")
    assert confused.transcript[2]["text"].startswith("Э-э… ")
    hurried = conversation_v3(*answers, persona="hurried")
    assert "Давайте быстро" in hurried.transcript[0]["text"]
    for attempt in (calm, irritated, confused, hurried):
        assert voice_training.evaluate_v2(attempt)["score"] == 100


async def test_v3_irritation_builds_up_and_then_alternates():
    texts = [voice_training.say("ru", "irritated", "ask_how", turn) for turn in range(1, 8)]
    prefixes = [text.removesuffix(voice_training.V2_LINES["ask_how"]) for text in texts]
    assert prefixes[:4] == voice_training.MANNER["ru"]["irritated"]
    assert prefixes[4:] == ["Ну сколько можно! ", "Да что ж такое! ", "Ну сколько можно! "]


async def test_v3_the_aggressive_driver_shouts_until_his_frustration_is_owned():
    answers = (
        "Вы звоните с номера, который не совпадает с номером регистрации.",
        "Позвоните с номера регистрации.",
        "Тогда откройте Такси Про и измените номер.",
    )
    rude = conversation_v3(*answers, persona="aggressive")
    assert lines(rude) == ["opening", "mismatch", "lost_sim", "resolved_app"]
    said = [entry["text"] for entry in rude.transcript if entry["role"] == "driver"]
    assert said[0].endswith("Вы там вообще работаете?!")
    shouted = voice_training.AGGRESSIVE_LINES["ru"]["mismatch"]
    assert said[1] == "Алло, вы меня слышите вообще?! " + shouted
    assert said[2].startswith("Я уже третий раз звоню! ")
    assert said[3].startswith("Ну наконец-то нормальный ответ. ")
    result = voice_training.evaluate_v2(rude)
    deescalation = next(item for item in result["criteria"] if item["key"] == "deescalation")
    assert not deescalation["passed"] and result["score"] == 80
    # An apology turns the shouting into grudging calm for the rest of the call.
    owned = conversation_v3(
        "Понимаю ваше недовольство, извините. " + answers[0], *answers[1:], persona="aggressive"
    )
    said = [entry["text"] for entry in owned.transcript if entry["role"] == "driver"]
    assert said[1] == "Ладно. " + voice_training.V2_LINES["mismatch"]
    assert said[2].startswith("Хорошо, слушаю. ")
    result = voice_training.evaluate_v2(owned)
    assert [item["key"] for item in result["criteria"]][-1] == "deescalation"
    assert result["criteria"][-1]["passed"] and result["score"] == 100
    kazakh = conversation_v3(
        "Түсінемін, кешіріңіз. " + KK_EXPLAIN, persona="aggressive", language="kk"
    )
    assert kazakh.transcript[2]["text"].startswith("Жарайды. ")
    assert voice_training.calmed_down([], "Мне очень жаль, что так вышло")
    assert not voice_training.calmed_down([], "Успокойтесь и слушайте")


async def test_v3_kazakh_call_reaches_the_app_step_through_the_lost_sim():
    attempt = conversation_v3(
        KK_EXPLAIN,
        "Тіркелген нөміріңізден қоңырау шалыңыз.",
        "Онда Такси Про қосымшасын ашып, нөміріңізді сол жерде ауыстырыңыз.",
        persona="irritated", language="kk",
    )
    assert lines(attempt) == ["opening", "mismatch", "lost_sim", "resolved_app"]
    assert attempt.stage == "resolved"
    assert "Ескі SIM-картам енді жоқ" in attempt.transcript[4]["text"]
    assert attempt.transcript[-1]["text"].startswith("Әйтеуір. ")
    result = voice_training.evaluate_v2(attempt, "kk")
    assert result["score"] == 100 and not result["critical_errors"]


@pytest.mark.parametrize(
    ("answers", "expected", "stage"),
    [
        (["WhatsApp-қа нөмірді ауыстырғыңыз келетінін жазыңыз."], "resolved_whatsapp", "resolved"),
        (["Қосымшаның орнына WhatsApp-қа жазыңыз, нөмірді ауыстыру керек деп."],
         "resolved_whatsapp", "resolved"),
        (["Қосымшада нөміріңізді өзгерте аласыз."], "resolved_app", "resolved"),
        (["Приложениеге кіріп, номерді ауыстырыңыз."], "resolved_app", "resolved"),
        (["Откройте Такси Про и измените номер."], "resolved_app", "resolved"),
        (["Такси Про қолдана аласыз ба"], "focus_app", "next_step"),
        (["WhatsApp-қа жаза аласыз ба"], "focus_whatsapp", "next_step"),
        (["Қосымшада нөмірді өзгерте алмайсыз."], "rejected", "next_step"),
        (["WhatsApp-қа жазбаңыз, нөмірді ауыстыру үшін."], "rejected", "next_step"),
        (["Аты-жөніңізді айтыңызшы."], "fact_name", "opening"),
        (["Қай нөмірден хабарласып тұрсыз?"], "fact_incoming", "opening"),
        (["Тіркелген нөміріңіз қандай?"], "fact_registered", "opening"),
        (["Ескі SIM-карта қолыңызда ма?"], "lost_sim", "lost_sim"),
        (["Бұл қоңырау арқылы нөмірді ауыстыруға болмайды."], "limit", "next_step"),
        (["Сәлеметсіз бе, қалайсыз?"], "ask_how", "opening"),
    ],
)
async def test_v3_kazakh_answers_are_understood(answers, expected, stage):
    attempt = conversation_v3(*answers, language="kk")
    assert attempt.transcript[-1]["line"] == expected, attempt.transcript[-1]
    assert attempt.stage == stage
    assert attempt.transcript[-1]["text"] == voice_training.say(
        "kk", "calm", expected, 1, voice_training._identity(SNAPSHOT_KK)
    )


@pytest.mark.parametrize(
    "text",
    [
        "Мен нөміріңізді қазір ауыстырып беремін.",
        "Нөміріңізді ауыстырдым, енді Такси Про-ны ашыңыз.",
        "Аккаунтты өшіріңіз де, қайта тіркеліңіз.",
    ],
)
async def test_v3_kazakh_promises_and_account_deletion_are_critical(text):
    attempt = conversation_v3(text, language="kk")
    assert attempt.stage == "clarify"
    result = voice_training.evaluate_v2(attempt, "kk")
    assert result["critical_errors"] and result["score"] <= 50


async def test_v3_kazakh_warnings_and_refusals_are_not_offers():
    warning = conversation_v3(
        "«Аккаунтты өшіру» батырмасын баспаңыз. Такси Про қосымшасын ашып, нөмірді ауыстырыңыз.",
        language="kk",
    )
    assert warning.stage == "resolved"
    assert not voice_training.evaluate_v2(warning, "kk")["critical_errors"]
    refusal = conversation_v3("Нөміріңізді ауыстыра алмаймын.", language="kk")
    assert refusal.transcript[-1]["line"] == "limit"
    assert not voice_training.advice_kk("Тіркелген нөмір жоқ болса, WhatsApp арқылы хабарласыңыз.")[
        "registered_call"
    ]


async def test_v3_kazakh_examples_pass_their_own_criteria():
    examples = voice_training.EXAMPLES["kk"]
    for step in ("app", "whatsapp"):
        attempt = conversation_v3(examples["clarity"], examples[step], language="kk")
        assert attempt.stage == "resolved", step
        assert voice_training.evaluate_v2(attempt, "kk")["score"] == 100


async def test_v3_kazakh_letters_are_optional_in_typed_answers():
    attempt = conversation_v3(
        "Такси Про косымшасын ашып, номиринизди сол жерде ауыстырыныз.", language="kk"
    )
    assert attempt.stage == "resolved"


async def test_v3_start_answer_retry_keep_language_and_line_keys(client, session, operator):
    headers = auth(await login(client, operator.login))
    catalog = (await client.get(BASE, headers=headers)).json()
    assert catalog["scenarios"][0]["languages"] == [
        {"key": "ru", "label": "Русский"}, {"key": "kk", "label": "Қазақша"},
    ]
    response = await client.post(
        BASE + "/start", headers=headers,
        json={"scenario_key": "phone_change", "persona": "hurried", "language": "kk"},
    )
    assert response.status_code == 200, response.text
    attempt = response.json()
    assert attempt["language"] == "kk" and attempt["revision"] == 3
    assert attempt["transcript"][0]["text"] == voice_training.OPENING_V3["kk"]["hurried"]
    attempt = (await answer(client, headers, attempt, KK_EXPLAIN)).json()
    row = await session.get(VoiceTrainingAttempt, attempt["id"])
    await session.refresh(row)
    assert [entry.get("line") for entry in row.transcript if entry["role"] == "driver"] == [
        "opening", "mismatch",
    ]
    assert attempt["transcript"][-1]["text"].startswith("Тезірек болайықшы. ")
    attempt = (await answer(
        client, headers, attempt, "WhatsApp-қа нөмірді ауыстырғыңыз келетінін жазыңыз."
    )).json()
    assert attempt["stage"] == "resolved"
    finished = await finish(client, headers, attempt)
    assert finished["result"]["rules_revision"] == 3
    assert finished["result"]["criteria"][2]["passed"]
    retry = await client.post(
        BASE + f"/attempts/{attempt['id']}/retry", headers=headers, json={"turn": 1}
    )
    assert retry.status_code == 200, retry.text
    retry = retry.json()
    assert retry["language"] == "kk" and retry["stage"] == "next_step"
    summary = (await client.get(BASE, headers=headers)).json()["attempts"]
    assert {item["language"] for item in summary} == {"kk"}


async def test_v2_attempt_in_progress_keeps_its_own_dialogue(client, session, operator):
    headers = auth(await login(client, operator.login))
    attempt = await start(client, headers, persona="irritated")
    saved = await session.get(VoiceTrainingAttempt, attempt["id"])
    saved.revision = 2
    saved.transcript = [
        {"role": "driver", "text": voice_training.OPENING["irritated"], "turn": 0}
    ]
    await session.commit()
    attempt = (await answer(client, headers, attempt, "Позвоните с номера регистрации.")).json()
    assert attempt["revision"] == 2
    assert attempt["transcript"][-1]["text"] == voice_training.LOST_SIM
