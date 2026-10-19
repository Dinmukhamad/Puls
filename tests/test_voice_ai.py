"""Claude plays the editor's drivers and grades their calls; the trainer works without it."""

import json
from types import SimpleNamespace
from uuid import uuid4

import anthropic
import httpx2
import pytest
from pydantic import SecretStr
from sqlalchemy import func, select

from app.models.voice_ai import VoiceAIUsage
from app.services import voice_ai, voice_training
from tests.conftest import auth, login, login_with_work_sites
from tests.test_voice_scenarios import EDITOR, VOICE, support_city, write

pytestmark = pytest.mark.asyncio


class FakeClaude:
    """Answers queued per call: a dict is the model's JSON, a string raw text, an error raised."""

    def __init__(self, *answers, stop="end_turn"):
        self.answers, self.calls, self.stop = list(answers), [], stop
        self.messages = self

    def with_options(self, **options):
        self.options = options
        return self

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        text = answer if isinstance(answer, str) else json.dumps(answer, ensure_ascii=False)
        return SimpleNamespace(
            content=[
                SimpleNamespace(type="thinking", thinking=""),
                SimpleNamespace(type="text", text=text),
            ],
            stop_reason=self.stop,
            usage=SimpleNamespace(
                input_tokens=1000, output_tokens=200,
                cache_read_input_tokens=0, cache_creation_input_tokens=0,
            ),
        )


def connect(monkeypatch, fake, key="sk-ant-test"):
    monkeypatch.setattr(voice_ai.settings, "ANTHROPIC_API_KEY", SecretStr(key))
    monkeypatch.setattr(voice_ai, "client", lambda: fake)


async def published_call(client, session, operator, supervisor, persona="calm"):
    await support_city(session, supervisor)
    staff = auth(await login(client, supervisor.login))
    data = await write(client, staff)
    published = await client.post(
        f"{EDITOR}/{data['id']}/publish", headers=staff,
        json={"draft_version": data["draft_version"]},
    )
    assert published.status_code == 200, published.text
    headers = auth(await login(client, operator.login))
    started = await client.post(
        f"{VOICE}/start", headers=headers,
        json={"scenario_key": f"custom:{data['id']}", "persona": persona, "language": "ru"},
    )
    assert started.status_code == 200, started.text
    return headers, staff, started.json()


async def say(client, headers, attempt, text):
    response = await client.post(
        f"{VOICE}/attempts/{attempt['id']}/answer", headers=headers,
        json={"request_id": str(uuid4()), "turn": attempt["turn"], "text": text},
    )
    assert response.status_code == 200, response.text
    return response.json()


GRADE = {
    "criteria": [
        {"key": "s1", "passed": True, "feedback": "Назвал причину.",
         "quote": "не пройден фотоконтроль", "turn": 1, "example": ""},
        {"key": "s2", "passed": True, "feedback": "Дал шаг.", "quote": "пройдите его в Такси Про",
         "turn": 2, "example": ""},
        # A quote the operator never said is not shown as his words.
        {"key": "solution", "passed": True, "feedback": "Решение верное.", "quote": "я всё починил",
         "turn": 2, "example": ""},
        {"key": "clarity", "passed": False, "feedback": "Не поздоровался.", "quote": "",
         "turn": 0, "example": "Здравствуйте! Сейчас помогу."},
    ],
    # Not said either: the cap for critical errors does not apply.
    "critical_errors": [{"text": "Грубость", "quote": "иди отсюда", "turn": 1}],
    "summary": "Решение найдено, вежливости не хватило.",
}


async def test_claude_plays_the_editors_driver_and_grades_the_call(
    client, session, operator, supervisor, monkeypatch
):
    headers, staff, attempt = await published_call(client, session, operator, supervisor)
    fake = FakeClaude(
        {"reply": "А почему он не пройден? Я же всё делал!", "step": "s2", "resolved": False},
        {"reply": "Понял, прохожу в Такси Про. Спасибо!", "step": "end", "resolved": True},
        GRADE,
    )
    connect(monkeypatch, fake)
    attempt = await say(
        client, headers, attempt, "У вас не пройден фотоконтроль, поэтому заказов нет"
    )
    assert attempt["transcript"][-1]["text"] == "А почему он не пройден? Я же всё делал!"
    assert not attempt["can_finish"]
    driver = fake.calls[0]
    # Haiku with low effort and a JSON schema; no sampling parameters, the scenario card cached.
    assert driver["model"] == "claude-haiku-5-5" and driver["output_config"]["effort"] == "low"
    schema = driver["output_config"]["format"]["schema"]
    assert schema["properties"]["step"]["enum"] == ["s1", "s2", "end"]
    assert "temperature" not in driver
    assert driver["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "Пройти фотоконтроль в Такси Про" in driver["system"][0]["text"]
    assert "Оператор (реплика 1): У вас не пройден фотоконтроль" in driver["messages"][0]["content"]
    attempt = await say(
        client, headers, attempt,
        "Фото контроль пройдите его в Такси Про, после проверки заказы придут",
    )
    assert attempt["can_finish"] and attempt["stage"] == "resolved"
    finished = await client.post(f"{VOICE}/attempts/{attempt['id']}/finish", headers=headers)
    result = finished.json()["result"]
    assert result["ai"] and not result["manual"] and result["review_status"] is None
    # Two of the author's steps, the solution and the manner: three of four are passed.
    assert [c["key"] for c in result["criteria"]] == ["s1", "s2", "solution", "clarity"]
    assert result["score"] == 75 and result["critical_errors"] == []
    quotes = {c["key"]: (c["quote"], c["turn"]) for c in result["criteria"]}
    assert quotes["s1"] == ("не пройден фотоконтроль", 0)
    assert quotes["solution"] == (None, None)
    assert result["criteria"][3]["example"] == "Здравствуйте! Сейчас помогу."
    assert fake.calls[2]["output_config"]["effort"] == "medium"
    # Graded already: not in the mentors' queue, but the operator can dispute it.
    async def queued():
        reviews = (await client.get(f"{VOICE}/reviews", headers=staff)).json()["reviews"]
        return [item for item in reviews if item["attempt_id"] == attempt["id"]]

    assert await queued() == []
    disputed = await client.post(
        f"{VOICE}/attempts/{attempt['id']}/review", headers=headers,
        json={"comment": "Я поздоровался"},
    )
    assert disputed.status_code == 200, disputed.text
    assert [item["status"] for item in await queued()] == ["pending"]
    rows = list(await session.scalars(select(VoiceAIUsage).order_by(VoiceAIUsage.id)))
    assert [row.purpose for row in rows] == ["driver", "driver", "grade"]
    assert rows[0].cost_usd == pytest.approx((1000 * 0.10 + 200 * 0.50) / 1_000_000)
    status = (await client.get(f"{VOICE}/ai", headers=staff)).json()
    assert status["active"] and status["calls"] == 3 and status["budget_usd"] == 5.0
    assert (await client.get(f"{VOICE}/ai", headers=headers)).status_code == 403


async def test_without_a_key_or_over_the_budget_the_keywords_and_the_mentor_stay(
    client, session, operator, supervisor, monkeypatch
):
    headers, staff, attempt = await published_call(client, session, operator, supervisor)
    fake = FakeClaude()
    connect(monkeypatch, fake, key="")
    attempt = await say(client, headers, attempt, "У вас не пройден фотоконтроль")
    # The author's own line for the recognised step.
    assert attempt["transcript"][-1]["text"] == "А где его пройти?" and fake.calls == []
    session.add(VoiceAIUsage(purpose="driver", model="claude-haiku-5-5", cost_usd=5.0))
    await session.commit()
    connect(monkeypatch, fake)
    assert (await client.get(f"{VOICE}/ai", headers=staff)).json()["active"] is False
    attempt = await say(client, headers, attempt, "В приложении Такси Про")
    finished = await client.post(f"{VOICE}/attempts/{attempt['id']}/finish", headers=headers)
    result = finished.json()["result"]
    assert fake.calls == [] and result["manual"] and result["review_status"] == "awaiting_grade"


@pytest.mark.parametrize("failure", ["error", "not json", "refusal"])
async def test_a_failing_model_never_stops_the_call(
    client, session, operator, supervisor, monkeypatch, failure
):
    headers, _, attempt = await published_call(client, session, operator, supervisor)
    broken = {
        "error": anthropic.APITimeoutError(request=httpx2.Request("POST", "https://api.anthropic.com")),
        "not json": "Конечно! Вот реплика водителя.",
        "refusal": {"reply": "", "step": "s1", "resolved": False},
    }[failure]
    fake = FakeClaude(broken, stop="refusal" if failure == "refusal" else "end_turn")
    connect(monkeypatch, fake)
    attempt = await say(client, headers, attempt, "У вас не пройден фотоконтроль")
    assert attempt["transcript"][-1]["text"] == "А где его пройти?" and len(fake.calls) == 1
    count = await session.scalar(select(func.count()).select_from(VoiceAIUsage))
    # A refused or broken answer was still billed and counts; a timed-out request was not.
    assert count == (0 if failure == "error" else 1)


async def test_the_aggressive_driver_is_graded_on_calming_him_down(
    client, session, operator, supervisor, monkeypatch
):
    headers, _, attempt = await published_call(client, session, operator, supervisor, "aggressive")
    fake = FakeClaude(
        {"reply": "Да сколько можно?! Позовите старшего!", "step": "s1", "resolved": False},
        {"criteria": [], "critical_errors": [], "summary": ""},
    )
    connect(monkeypatch, fake)
    attempt = await say(client, headers, attempt, "Подождите")
    assert "агрессивный" in fake.calls[0]["system"][0]["text"]
    finished = await client.post(f"{VOICE}/attempts/{attempt['id']}/finish", headers=headers)
    result = finished.json()["result"]
    assert result["criteria"][-1]["key"] == "deescalation" and result["score"] == 0
    assert result["criteria"][0]["feedback"] == "ИИ не оценил этот пункт."


OKTELL = "/api/v1/learning/oktell"
EXPLAINED = (
    "Вы звоните не с номера регистрации, поэтому по звонку я номер не поменяю. Скачайте "
    "Такси Про, зайдите в профиль, там кнопка номера: впишите новый, придёт код, введите его."
)
PHONE_GRADE = {
    "criteria": [
        {"key": "solution", "passed": True, "feedback": "Способ доступный.",
         "quote": "Скачайте Такси Про", "turn": 2, "example": ""},
        {"key": "clarity", "passed": True, "feedback": "Причина названа.",
         "quote": "звоните не с номера регистрации", "turn": 2, "example": ""},
        {"key": "next_step", "passed": True, "feedback": "Шаги понятны.",
         "quote": "впишите новый, придёт код", "turn": 2, "example": ""},
    ],
    "critical_errors": [],
    "summary": "Причина и способ объяснены понятно.",
}


async def test_claude_leads_the_phone_change_call_and_grades_it_by_meaning(
    client, operator, monkeypatch
):
    from tests.test_voice_training import answer, finish, start

    first = "Подождите, а с номера-то что не так? Я же сам Виктор Ким."
    fake = FakeClaude(
        {"reply": first, "resolved": False},
        {"reply": "Старой симки у меня уже нет, со старого номера не позвоню.", "resolved": False},
        {"reply": "Понял, скачаю Такси Про и поменяю номер. Спасибо, до свидания!",
         "resolved": True},
        PHONE_GRADE,
    )
    connect(monkeypatch, fake)
    sites = auth(await login_with_work_sites(client, operator.login))
    assert (await client.get(OKTELL, headers=sites)).json()["voice_ai"] is True
    headers = auth(await login(client, operator.login))
    attempt = await start(client, headers, "irritated")
    attempt = (await answer(client, headers, attempt, "Секунду, я проверяю ваши данные")).json()
    assert attempt["transcript"][-1]["text"] == first and attempt["transcript"][-1]["ai"]
    assert attempt["ai_driver"] and attempt["stage"] == "opening"
    call = fake.calls[0]
    assert call["model"] == "claude-haiku-5-5" and call["output_config"]["effort"] == "low"
    assert call["output_config"]["format"]["schema"]["required"] == ["reply", "resolved"]
    card = call["system"][0]["text"]
    assert attempt["driver"]["phone"] in card and attempt["incoming_phone"] in card
    assert "Правильное решение" in card and "раздражённый" in card
    assert "не узнали эту реплику" in call["messages"][0]["content"]
    assert "Черновик ответа водителя: «" in call["messages"][0]["content"]
    attempt = (await answer(client, headers, attempt, "Позвоните со старого номера.")).json()
    # The rules' move stays on the line: the lost SIM is remembered for them.
    assert attempt["stage"] == "lost_sim" and attempt["transcript"][-1]["line"] == "lost_sim"
    attempt = (await answer(client, headers, attempt, EXPLAINED)).json()
    # Claude understood the steps the rules did not: the driver got his answer.
    assert attempt["stage"] == "resolved" and attempt["can_finish"]
    result = (await finish(client, headers, attempt))["result"]
    assert result["ai"] and result["model"] == "claude-haiku-5-5" and not result["manual"]
    assert [c["key"] for c in result["criteria"]] == [
        "verification", "solution", "clarity", "next_step"
    ]
    # «Проверка данных» is the systems' record: nothing was opened in Диспетчерская.
    assert not result["criteria"][0]["passed"] and result["score"] == 75
    assert result["criteria"][2]["quote"] == "звоните не с номера регистрации"
    assert result["criteria"][2]["turn"] == 2
    assert result["solution"] == voice_training.EXAMPLES["ru"]["solution"]
    assert result["summary"] and "rules_score" in result
    grade = fake.calls[3]
    assert grade["output_config"]["effort"] == "medium"
    assert "оценивается отдельно" in grade["messages"][0]["content"]
    catalog = (await client.get(f"{VOICE}", headers=headers)).json()
    assert catalog["ai_active"] and catalog["attempts"][0]["ai_driver"]
    assert catalog["attempts"][0]["ai_grade"]


async def test_a_forbidden_promise_never_ends_the_call_and_rules_errors_stay(
    client, operator, monkeypatch
):
    from tests.test_voice_training import answer, finish, start

    fake = FakeClaude(
        {"reply": "Отлично, спасибо!", "resolved": True},
        {"criteria": [], "critical_errors": [], "summary": "Пообещал сам сменить номер."},
    )
    connect(monkeypatch, fake)
    headers = auth(await login(client, operator.login))
    attempt = await start(client, headers)
    promise = "Я могу изменить вам номер прямо сейчас"
    attempt = (await answer(client, headers, attempt, promise)).json()
    assert attempt["stage"] != "resolved"
    assert "недопустимое" in fake.calls[0]["messages"][0]["content"]
    result = (await finish(client, headers, attempt))["result"]
    assert result["ai"] and result["critical_errors"] and result["score"] <= 50
    assert result["criteria"][1]["feedback"] == "ИИ не оценил этот пункт."


@pytest.mark.parametrize("failure", ["error", "no key"])
async def test_without_claude_the_phone_change_call_is_the_rules_own(
    client, operator, monkeypatch, failure
):
    from tests.test_voice_training import EXPLAIN, NEXT, answer, finish, start

    timeout = anthropic.APIConnectionError(
        request=httpx2.Request("POST", "https://api.anthropic.com")
    )
    fake = FakeClaude(*[timeout] * 4)
    connect(monkeypatch, fake, key="" if failure == "no key" else "sk-ant-test")
    sites = auth(await login_with_work_sites(client, operator.login))
    assert (await client.get(OKTELL, headers=sites)).json()["voice_ai"] is (failure == "error")
    headers = auth(await login(client, operator.login))
    attempt = await start(client, headers)
    attempt = (await answer(client, headers, attempt, "Позвоните со старого номера.")).json()
    assert attempt["transcript"][-1]["text"] == voice_training.LOST_SIM
    assert "ai" not in attempt["transcript"][-1] and not attempt["ai_driver"]
    attempt = (await answer(client, headers, attempt, EXPLAIN)).json()
    attempt = (await answer(client, headers, attempt, NEXT)).json()
    result = (await finish(client, headers, attempt))["result"]
    assert "ai" not in result and result["score"] == 75
    assert len(fake.calls) == (0 if failure == "no key" else 4)


async def test_a_past_call_graded_by_the_rules_can_be_sent_to_claude(
    client, session, operator, supervisor, monkeypatch
):
    from tests.test_voice_training import EXPLAIN, NEXT, answer, finish, start

    headers = auth(await login(client, operator.login))
    attempt = await start(client, headers)
    attempt = (await answer(client, headers, attempt, EXPLAIN)).json()
    attempt = (await answer(client, headers, attempt, NEXT)).json()
    attempt = await finish(client, headers, attempt)
    rules = attempt["result"]
    url = f"{VOICE}/attempts/{attempt['id']}/ai-review"
    refused = await client.post(url, headers=headers)
    assert refused.status_code == 409 and "не подключён" in refused.json()["detail"]
    fake = FakeClaude("не JSON", {**PHONE_GRADE, "summary": "Хорошо объяснено."})
    connect(monkeypatch, fake)
    failed = await client.post(url, headers=headers)
    assert failed.status_code == 409 and "не смог" in failed.json()["detail"]
    # The failed answer was paid for and is counted.
    assert await session.scalar(select(func.count()).select_from(VoiceAIUsage)) == 1
    reviewed = await client.post(url, headers=headers)
    assert reviewed.status_code == 200, reviewed.text
    result = reviewed.json()["result"]
    # Both grades stay: the rules' as it was, Claude's beside it.
    assert result["score"] == rules["score"] and result["criteria"] == rules["criteria"]
    assert result["ai_review"]["ai"] and result["ai_review"]["summary"] == "Хорошо объяснено."
    assert result["ai_review"]["rules_score"] == rules["score"]
    again = await client.post(url, headers=headers)
    assert again.json()["result"]["ai_review"] == result["ai_review"] and len(fake.calls) == 2
    # A leader sends an operator's call from the team's page (voice_team), not this one.
    other = auth(await login(client, supervisor.login))
    assert (await client.post(url, headers=other)).status_code == 403
    in_progress = await start(client, headers)
    assert (
        await client.post(f"{VOICE}/attempts/{in_progress['id']}/ai-review", headers=headers)
    ).status_code == 409
    silent = await finish(client, headers, in_progress)
    response = await client.post(f"{VOICE}/attempts/{silent['id']}/ai-review", headers=headers)
    assert response.status_code == 409 and "нет ответов оператора" in response.json()["detail"]
    assert len(fake.calls) == 2


async def test_a_call_claude_already_graded_or_from_the_editor_is_not_sent_again(
    client, session, operator, supervisor, monkeypatch
):
    headers, _, attempt = await published_call(client, session, operator, supervisor)
    fake = FakeClaude(
        {"reply": "Понял, спасибо!", "step": "end", "resolved": True},
        {"criteria": [], "critical_errors": [], "summary": ""},
    )
    connect(monkeypatch, fake)
    attempt = await say(client, headers, attempt, "Пройдите фотоконтроль в Такси Про")
    finished = await client.post(f"{VOICE}/attempts/{attempt['id']}/finish", headers=headers)
    assert finished.json()["transcript"][-1]["ai"]
    response = await client.post(f"{VOICE}/attempts/{attempt['id']}/ai-review", headers=headers)
    assert response.status_code == 409


async def test_a_moment_of_a_call_claude_kept_open_can_be_repeated(client, operator, monkeypatch):
    from tests.test_voice_training import EXPLAIN, NEXT, answer, finish, start

    fake = FakeClaude(
        {"reply": "Хорошо, а что именно написать?", "resolved": False},
        {"reply": "Подождите, а что написать-то?", "resolved": False},
        {"reply": "Понял, спасибо!", "resolved": True},
        {"criteria": [], "critical_errors": [], "summary": ""},
        {"reply": "Понял, напишу.", "resolved": True},
    )
    connect(monkeypatch, fake)
    headers = auth(await login(client, operator.login))
    attempt = await start(client, headers)
    attempt = (await answer(client, headers, attempt, EXPLAIN)).json()
    # The rules would end the call here; Claude's driver still asks.
    attempt = (await answer(client, headers, attempt, NEXT)).json()
    assert attempt["stage"] == "next_step"
    attempt = (await answer(client, headers, attempt, "Напишите: прошу сменить номер.")).json()
    assert attempt["stage"] == "resolved"
    attempt = await finish(client, headers, attempt)
    retried = await client.post(
        f"{VOICE}/attempts/{attempt['id']}/retry", headers=headers, json={"turn": 2}
    )
    assert retried.status_code == 200, retried.text
    assert retried.json()["stage"] != "resolved"
    text = "Напишите в WhatsApp о смене номера"
    again = (await answer(client, headers, retried.json(), text)).json()
    assert again["stage"] == "resolved" and again["transcript"][-1]["ai"]
