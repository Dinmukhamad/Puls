"""Scenarios written in the editor: keyword dialogue, publication, ТП access and mentor grading."""

from uuid import uuid4

import pytest

from app.models.city import CityWorld
from app.models.enums import Role
from app.services import voice_scenarios
from app.services.city import evidence
from app.services.city_world import defaults
from tests.conftest import auth, login, make_user

EDITOR = "/api/v1/admin/learning/voice-scenarios"
VOICE = "/api/v1/learning/voice"


def content(**patch):
    value = {
        "title": "Не приходят заказы",
        "description": "Водитель на линии, но заказы не приходят.",
        "language": "ru",
        "minutes": 4,
        "driver": {"name": "Аскар Нурланов", "phone": "+77011112233", "park": "iTaxi"},
        "notes": "В аккаунте не пройден фотоконтроль.",
        "solution": "Пройти фотоконтроль в Такси Про, после проверки заказы придут.",
        "opening": "Здравствуйте, я на линии, а заказов нет.",
        "steps": [
            {
                "id": "s1",
                "name": "Причина",
                "replies": [{
                    "keywords": ["фотоконтроль", "фото контроль"],
                    "driver": "А где его пройти?",
                    "next": "s2",
                }],
                "fallback": "Так почему заказов нет?",
            },
            {
                "id": "s2",
                "name": "Следующий шаг",
                "replies": [{
                    "keywords": ["такси про", "приложение"],
                    "driver": "Понял, прохожу в приложении.",
                    "next": "end",
                }],
                "fallback": "Где именно его пройти?",
            },
        ],
        "forbidden": [{
            "keywords": ["удалить аккаунт", "удалим аккаунт"],
            "text": "Предложено удалить аккаунт.",
            "driver": "Удалить? Нет, мне нужно работать!",
        }],
    }
    value.update(patch)
    return value


def test_keywords_ignore_endings_and_negations():
    tokens = voice_scenarios.words
    heard = voice_scenarios.heard
    assert heard("приложение", tokens("Сделайте это в приложении Такси Про"))
    assert heard("такси про", tokens("Откройте Такси, пожалуйста, Про"))
    assert not heard("такси про", tokens("такси и потом ещё через три слова про"))
    assert heard("смен*", tokens("Сменить номер можно"))
    assert heard("номер", tokens("номером"))
    assert not heard("про", tokens("проверьте"))
    # «не» before a phrase turns it over; a phrase that is itself a negation is looked for as it is.
    assert not heard("сменю номер", tokens("Я не сменю номер по этому звонку"))
    assert not heard("сменить номер", tokens("Я не могу сменить номер по звонку"))
    assert heard("фотоконтроль", tokens("У вас не пройден фотоконтроль"))
    assert heard("не смогу", tokens("К сожалению, не смогу помочь"))
    assert heard("нельзя", tokens("По звонку так нельзя"))
    assert not heard("ауыстыру", tokens("нөмірді ауыстыру мүмкін емес"))
    assert heard("нөмір", tokens("нөміріңізді ауыстырыңыз"))


def test_the_engine_follows_keywords_fallbacks_and_forbidden_reactions():
    run = voice_scenarios.simulate(content(), [
        "Здравствуйте, сейчас посмотрю",
        "Давайте удалим аккаунт",
        "У вас не пройден фотоконтроль",
        "Откройте Такси Про и пройдите его",
    ])
    driver = [turn["text"] for turn in run["turns"] if turn["role"] == "driver"]
    assert driver == [
        "Здравствуйте, я на линии, а заказов нет.",
        "Так почему заказов нет?",
        "Удалить? Нет, мне нужно работать!",
        "А где его пройти?",
        "Понял, прохожу в приложении.",
    ]
    operator = [turn for turn in run["turns"] if turn["role"] == "operator"]
    assert operator[0]["fallback"] and operator[1]["forbidden"][0]["keyword"] == "удалить аккаунт"
    assert operator[2]["keyword"] == "фотоконтроль"
    assert run["resolved"] and run["stage"] == "resolved"


def test_publication_names_every_missing_part():
    empty = voice_scenarios.empty_content()
    issues = voice_scenarios.problems(empty)
    assert "Укажите название сценария." in issues
    assert any("добавьте ключевые слова оператора" in item for item in issues)
    assert any("напишите реплику водителя" in item for item in issues)
    assert voice_scenarios.problems(content()) == []
    broken = content()
    broken["steps"][0]["replies"][0]["next"] = "s9"
    assert any("выберите, куда ведёт ответ" in item for item in voice_scenarios.problems(broken))
    island = content()
    island["steps"].append({"id": "s3", "name": "", "replies": [], "fallback": "?"})
    assert voice_scenarios.unreachable(island) == ["s3"]


async def support_city(session, supervisor):
    cities = defaults()
    cities[0]["districts"][0]["supervisor_id"] = supervisor.id
    session.add(CityWorld(id=1, revision=1, cities=cities, updated_by_id=supervisor.id))
    await session.commit()


async def write(client, headers, value=None):
    created = await client.post(EDITOR, headers=headers)
    assert created.status_code == 200, created.text
    data = created.json()
    assert data["status"] == "draft" and data["problems"]
    saved = await client.put(
        f"{EDITOR}/{data['id']}", headers=headers,
        json={"draft_version": data["draft_version"], "content": value or content()},
    )
    assert saved.status_code == 200, saved.text
    return saved.json()


@pytest.mark.asyncio
async def test_trainers_supervisors_heads_and_admins_write_and_publish(
    client, session, operator, supervisor, head
):
    trainer = await make_user(session, login="trainer-vs", role=Role.TRAINER)
    admin = await make_user(session, login="admin-vs", role=Role.ADMIN)
    learner = auth(await login(client, operator.login))
    assert (await client.get(EDITOR, headers=learner)).status_code == 403
    for user in (trainer, supervisor, head, admin):
        headers = auth(await login(client, user.login))
        data = await write(client, headers)
        assert data["problems"] == [] and data["title"] == "Не приходят заказы"
        published = await client.post(
            f"{EDITOR}/{data['id']}/publish", headers=headers,
            json={"draft_version": data["draft_version"]},
        )
        assert published.status_code == 200, published.text
        assert published.json()["status"] == "published" and published.json()["revision"] == 1
    listing = (await client.get(EDITOR, headers=headers)).json()["scenarios"]
    assert len(listing) == 4 and {item["status"] for item in listing} == {"published"}


@pytest.mark.asyncio
async def test_drafts_conflicts_publication_and_withdrawal(client, session, operator, supervisor):
    headers = auth(await login(client, supervisor.login))
    data = await write(client, headers)
    stale = await client.put(
        f"{EDITOR}/{data['id']}", headers=headers,
        json={"draft_version": data["draft_version"] - 1, "content": content()},
    )
    assert stale.status_code == 409
    incomplete = await client.put(
        f"{EDITOR}/{data['id']}", headers=headers,
        json={"draft_version": data["draft_version"], "content": content(opening="")},
    )
    data = incomplete.json()
    refused = await client.post(
        f"{EDITOR}/{data['id']}/publish", headers=headers,
        json={"draft_version": data["draft_version"]},
    )
    assert refused.status_code == 400 and "первую реплику" in refused.text
    data = (await client.put(
        f"{EDITOR}/{data['id']}", headers=headers,
        json={"draft_version": data["draft_version"], "content": content()},
    )).json()
    first = (await client.post(
        f"{EDITOR}/{data['id']}/publish", headers=headers,
        json={"draft_version": data["draft_version"]},
    )).json()
    assert first["revision"] == 1
    # Publishing again without changes keeps the version; an edited draft shows as changed.
    again = (await client.post(
        f"{EDITOR}/{data['id']}/publish", headers=headers,
        json={"draft_version": first["draft_version"]},
    )).json()
    assert again["revision"] == 1
    edited = (await client.put(
        f"{EDITOR}/{data['id']}", headers=headers,
        json={"draft_version": again["draft_version"], "content": content(minutes=6)},
    )).json()
    assert edited["status"] == "changed" and edited["published"]["minutes"] == 4
    assert (await client.delete(f"{EDITOR}/{data['id']}", headers=headers)).status_code == 409
    withdrawn = (await client.post(f"{EDITOR}/{data['id']}/withdraw", headers=headers)).json()
    assert withdrawn["status"] == "withdrawn"
    other = await write(client, headers)
    assert (await client.delete(f"{EDITOR}/{other['id']}", headers=headers)).status_code == 200
    tested = await client.post(
        f"{EDITOR}/test", headers=headers,
        json={"content": content(), "answers": ["Не пройден фотоконтроль"]},
    )
    assert tested.status_code == 200 and tested.json()["turns"][-1]["text"] == "А где его пройти?"


@pytest.mark.asyncio
async def test_tp_operators_play_a_published_call_and_a_mentor_grades_it(
    client, session, operator, supervisor
):
    await support_city(session, supervisor)
    staff = auth(await login(client, supervisor.login))
    data = await write(client, staff)
    await client.post(
        f"{EDITOR}/{data['id']}/publish", headers=staff,
        json={"draft_version": data["draft_version"]},
    )
    key = f"custom:{data['id']}"
    headers = auth(await login(client, operator.login))
    catalog = (await client.get(VOICE, headers=headers)).json()
    item = next(entry for entry in catalog["scenarios"] if entry["key"] == key)
    assert item["custom"] and item["title"] == "Не приходят заказы"
    assert "steps" not in item and "фотоконтроль" not in str(item)
    started = await client.post(
        f"{VOICE}/start", headers=headers,
        json={"scenario_key": key, "persona": "calm", "language": "kk"},
    )
    assert started.status_code == 200, started.text
    attempt = started.json()
    # The scenario's own language; nothing of its keywords or solution before the end.
    assert attempt["language"] == "ru" and attempt["custom"] and attempt["result"] is None
    assert "фотоконтроль" not in str({k: v for k, v in attempt.items() if k != "notes"})
    assert attempt["transcript"][0]["text"] == "Здравствуйте, я на линии, а заказов нет."

    async def say(text):
        response = await client.post(
            f"{VOICE}/attempts/{attempt['id']}/answer", headers=headers,
            json={"request_id": str(uuid4()), "turn": current["turn"], "text": text},
        )
        assert response.status_code == 200, response.text
        return response.json()

    current = attempt
    current = await say("Давайте удалим аккаунт и создадим новый")
    assert current["transcript"][-1]["text"] == "Удалить? Нет, мне нужно работать!"
    current = await say("У вас не пройден фотоконтроль")
    current = await say("Откройте Такси Про")
    assert current["can_finish"]
    assert current["transcript"][-1]["text"] == "Понял, прохожу в приложении."
    inspect = await client.post(
        f"{VOICE}/attempts/{attempt['id']}/inspect", headers=headers, json={"system": "oktell"}
    )
    assert inspect.status_code in (403, 409)
    finish = f"{VOICE}/attempts/{attempt['id']}/finish"
    finished = (await client.post(finish, headers=headers)).json()
    result = finished["result"]
    assert result["manual"] and result["score"] is None
    assert result["review_status"] == "awaiting_grade"
    assert [c["passed"] for c in result["criteria"]] == [True, True]
    assert result["critical_errors"][0]["text"] == "Предложено удалить аккаунт."
    assert result["solution"].startswith("Пройти фотоконтроль")
    disputed = await client.post(
        f"{VOICE}/attempts/{attempt['id']}/review", headers=headers, json={"comment": "Почему?"}
    )
    assert disputed.status_code == 409
    queue = (await client.get(f"{VOICE}/reviews", headers=staff)).json()["reviews"]
    assert [(r["attempt_id"], r["status"], r["manual"]) for r in queue] == [
        (attempt["id"], "awaiting_grade", True)
    ]
    no_score = await client.post(
        f"{VOICE}/reviews/{attempt['id']}/resolve", headers=staff, json={"comment": "Хорошо"}
    )
    assert no_score.status_code == 400
    graded = await client.post(
        f"{VOICE}/reviews/{attempt['id']}/resolve", headers=staff,
        json={"comment": "Решение верное, но удалять аккаунт нельзя.", "score": 85},
    )
    assert graded.status_code == 200, graded.text
    mine = (await client.get(f"{VOICE}/attempts/{attempt['id']}", headers=headers)).json()
    assert mine["result"]["score"] == 85 and mine["result"]["review_status"] == "reviewed"
    assert mine["result"]["mentor_comment"].startswith("Решение верное")
    facts = (await evidence(session, [operator.id]))[operator.id]
    assert facts["voice_calls"] == 1 and facts["voice_good"] == 1


@pytest.mark.asyncio
async def test_only_tp_operators_and_trainees_see_editor_scenarios(client, session, supervisor):
    staff = auth(await login(client, supervisor.login))
    data = await write(client, staff)
    await client.post(
        f"{EDITOR}/{data['id']}/publish", headers=staff,
        json={"draft_version": data["draft_version"]},
    )
    key = f"custom:{data['id']}"
    outsider = await make_user(session, login="sales-op")
    trainee = await make_user(session, login="trainee-vs", role=Role.TRAINEE)
    for user, visible in ((outsider, False), (trainee, True)):
        headers = auth(await login(client, user.login))
        listed = (await client.get(VOICE, headers=headers)).json()["scenarios"]
        keys = [item["key"] for item in listed]
        assert (key in keys) is visible and "phone_change" in keys
        started = await client.post(
            f"{VOICE}/start", headers=headers, json={"scenario_key": key, "persona": "calm"}
        )
        assert started.status_code == (200 if visible else 403), started.text
    await client.post(f"{EDITOR}/{data['id']}/withdraw", headers=staff)
    headers = auth(await login(client, trainee.login))
    keys = [item["key"] for item in (await client.get(VOICE, headers=headers)).json()["scenarios"]]
    assert key not in keys
    gone = await client.post(f"{VOICE}/start", headers=headers, json={"scenario_key": key})
    assert gone.status_code == 404
