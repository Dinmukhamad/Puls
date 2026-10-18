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
from app.services import voice_ai
from tests.conftest import auth, login
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
