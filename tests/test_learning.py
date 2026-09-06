from sqlalchemy import func, select

from app.models.coin import CoinTransaction
from app.models.learning import LearningAttempt
from app.models.progress import XpEntry
from tests.conftest import auth, login


def content(**changes):
    return {
        "kind": "test",
        "title": "Работа с обращением",
        "status": "published",
        "xp_reward": 50,
        "coins_reward": 5,
        "pass_percent": 100,
        "steps": [
            {
                "text": "Что сделать первым?",
                "options": ["Уточнить запрос", "Завершить разговор"],
                "correct": 0,
                "explanation": "Уточнение помогает найти решение.",
            }
        ],
        **changes,
    }


async def publish(client, head, **changes):
    response = await client.post(
        "/api/v1/admin/learning",
        headers=auth(await login(client, head.login)),
        json=content(**changes),
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_learning_hides_answers_resumes_and_awards_once(client, session, operator, head):
    material = await publish(client, head)
    headers = auth(await login(client, operator.login))
    catalog = (await client.get("/api/v1/learning", headers=headers)).json()
    assert "steps" not in catalog[0]
    path = f"/api/v1/learning/{material['id']}/start"
    attempt = (await client.post(path, headers=headers)).json()
    assert "correct" not in attempt["content"]["steps"][0]
    assert "explanation" not in attempt["content"]["steps"][0]
    assert (await client.post(path, headers=headers)).json()["id"] == attempt["id"]
    base = f"/api/v1/learning/attempts/{attempt['id']}"
    assert (await client.post(base + "/finish", headers=headers)).status_code == 400
    assert (
        await client.put(base + "/answer", headers=headers, json={"step": 0, "answer": 0})
    ).status_code == 200
    assert (await client.get(base, headers=headers)).json()["answers"] == {"0": 0}
    for _ in range(2):
        result = await client.post(base + "/finish", headers=headers)
        assert result.status_code == 200, result.text
        assert result.json()["state"] == "passed"
        assert result.json()["awarded_xp"] == 50
        assert result.json()["content"]["steps"][0]["correct"] == 0
    assert (
        await client.put(base + "/answer", headers=headers, json={"step": 0, "answer": 1})
    ).status_code == 409
    retry = (await client.post(path, headers=headers)).json()
    assert retry["id"] != attempt["id"]
    base = f"/api/v1/learning/attempts/{retry['id']}"
    await client.put(base + "/answer", headers=headers, json={"step": 0, "answer": 0})
    result = (await client.post(base + "/finish", headers=headers)).json()
    assert (result["awarded_xp"], result["awarded_coins"]) == (0, 0)
    assert await session.scalar(select(func.count(XpEntry.id))) == 1
    assert await session.scalar(select(func.count(CoinTransaction.id))) == 1


async def test_learning_snapshot_survives_edits_and_archiving(client, operator, head):
    material = await publish(client, head)
    headers = auth(await login(client, operator.login))
    attempt = (
        await client.post(f"/api/v1/learning/{material['id']}/start", headers=headers)
    ).json()
    response = await client.put(
        f"/api/v1/admin/learning/{material['id']}",
        headers=auth(await login(client, head.login)),
        json=content(
            status="archived",
            xp_reward=999,
            steps=[{"text": "Новый вопрос", "options": ["Нет", "Да"], "correct": 1}],
        ),
    )
    assert response.status_code == 200
    base = f"/api/v1/learning/attempts/{attempt['id']}"
    await client.put(base + "/answer", headers=headers, json={"step": 0, "answer": 0})
    result = (await client.post(base + "/finish", headers=headers)).json()
    assert result["state"] == "passed" and result["awarded_xp"] == 50
    assert (
        await client.post(f"/api/v1/learning/{material['id']}/start", headers=headers)
    ).status_code == 404


async def test_learning_permissions_and_drafts(client, session, operator, supervisor, head):
    material = await publish(client, head, status="draft")
    own = auth(await login(client, operator.login))
    assert (await client.get("/api/v1/learning", headers=own)).json() == []
    assert (
        await client.post(f"/api/v1/learning/{material['id']}/start", headers=own)
    ).status_code == 404
    assert (
        await client.post("/api/v1/admin/learning", headers=own, json=content())
    ).status_code == 403
    staff = auth(await login(client, supervisor.login))
    assert (
        await client.post("/api/v1/admin/learning", headers=staff, json=content())
    ).status_code == 403
    published = await publish(client, head)
    attempt = (await client.post(f"/api/v1/learning/{published['id']}/start", headers=own)).json()
    path = f"/api/v1/learning/attempts/{attempt['id']}"
    assert (await client.get(path, headers=staff)).status_code == 404
    results = (await client.get("/api/v1/admin/learning-results", headers=staff)).json()
    assert results["total"] == 1 and results["items"][0]["user_id"] == operator.id
    assert await session.scalar(select(func.count(LearningAttempt.id))) == 1


async def test_learning_failed_attempt_does_not_award_and_honors_no_back(
    client, session, operator, head
):
    material = await publish(client, head, allow_back=False)
    headers = auth(await login(client, operator.login))
    attempt = (
        await client.post(f"/api/v1/learning/{material['id']}/start", headers=headers)
    ).json()
    base = f"/api/v1/learning/attempts/{attempt['id']}"
    assert (
        await client.put(base + "/answer", headers=headers, json={"step": 0, "answer": 5})
    ).status_code == 400
    await client.put(base + "/answer", headers=headers, json={"step": 0, "answer": 1})
    assert (
        await client.put(base + "/answer", headers=headers, json={"step": 0, "answer": 0})
    ).status_code == 409
    result = (await client.post(base + "/finish", headers=headers)).json()
    assert result["state"] == "failed" and result["score"] == 0
    assert await session.scalar(select(func.count(XpEntry.id))) == 0


async def test_simulator_state_machine_and_private_fields(client, head, operator):
    material = await publish(client, head, kind="simulator")
    headers = auth(await login(client, operator.login))
    attempt = (
        await client.post(f"/api/v1/learning/{material['id']}/start", headers=headers)
    ).json()
    base = f"/api/v1/learning/attempts/{attempt['id']}"
    action_path = base + "/simulator"
    assert (
        await client.post(action_path, headers=headers, json={"action": "finish_trip"})
    ).status_code == 409
    assert (
        await client.post(
            action_path, headers=headers, json={"action": "register", "phone": "+77771234567"}
        )
    ).status_code == 422
    for action in (
        "register",
        "verify",
        "photo",
        "mode",
        "route",
        "online",
        "skip",
        "online",
        "accept",
        "arrive",
        "start_trip",
    ):
        response = await client.post(action_path, headers=headers, json={"action": action})
        assert response.status_code == 200, response.text
    assert (
        await client.post(action_path, headers=headers, json={"action": "resolve"})
    ).status_code == 400
    await client.put(base + "/answer", headers=headers, json={"step": 0, "answer": 0})
    assert (await client.post(base + "/finish", headers=headers)).status_code == 409
    for action in ("resolve", "finish_trip"):
        assert (
            await client.post(action_path, headers=headers, json={"action": action})
        ).status_code == 200
    assert (await client.post(base + "/finish", headers=headers)).json()["state"] == "passed"
