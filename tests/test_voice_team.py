"""Leaders see how their operators train calls; drivers call the operators, not the leaders."""

import pytest

from app.models.enums import Role
from tests.conftest import auth, login, login_with_work_sites, make_group, make_user
from tests.test_voice_ai import FakeClaude, connect
from tests.test_voice_training import EXPLAIN, NEXT, answer, finish, start

pytestmark = pytest.mark.asyncio
VOICE = "/api/v1/learning/voice"
TEAM = f"{VOICE}/team"


async def call(client, headers, *texts, persona="calm"):
    attempt = await start(client, headers, persona)
    for text in texts:
        attempt = (await answer(client, headers, attempt, text)).json()
    return await finish(client, headers, attempt)


async def test_leaders_see_their_operators_calls_and_scores(client, session, operator, supervisor):
    other_sv = await make_user(session, login="sv2", role=Role.SUPERVISOR)
    other_group = await make_group(session, code="G2", supervisor_id=other_sv.id)
    stranger = await make_user(session, login="op2", full_name="Чужой Оператор",
                               group_id=other_group.id)
    idle = await make_user(session, login="op3", full_name="Без Звонков",
                           group_id=operator.group_id)
    trainer = await make_user(session, login="tr1", role=Role.TRAINER)
    mine = auth(await login(client, operator.login))
    good = await call(client, mine, EXPLAIN, NEXT)
    weak = await call(client, mine, "Позвоните со старого номера.")
    other = auth(await login(client, stranger.login))
    theirs = await call(client, other, EXPLAIN)

    staff = auth(await login(client, supervisor.login))
    data = (await client.get(TEAM, headers=staff)).json()
    names = [row["name"] for row in data["operators"]]
    # A supervisor sees his own groups only; the operator without calls is listed too.
    assert names == ["Без Звонков", "Оператор Первый"] and idle.full_name in names
    summary = data["summary"]
    assert summary["calls"] == 2 and summary["operators"] == 2 and summary["practiced"] == 1
    assert summary["average"] == round((good["result"]["score"] + weak["result"]["score"]) / 2)
    assert summary["low"] == 1 and summary["awaiting_grade"] == 0
    row = next(item for item in data["operators"] if item["id"] == operator.id)
    assert row["calls"] == 2 and row["best"] == good["result"]["score"]
    assert row["last"]["id"] == weak["id"] and row["group_name"] == "Группа G1"
    assert [c["id"] for c in data["calls"]] == [weak["id"], good["id"]]
    assert data["calls"][0]["grader"] == "rules"
    assert data["calls"][0]["user_name"] == "Оператор Первый"
    assert data["skills"] and data["skills"][0]["passed"] < data["skills"][0]["total"]
    assert data["ai"]["budget_usd"] == 5.0 and data["groups"] == [{"id": operator.group_id,
                                                                   "name": "Группа G1"}]
    # Any call of his own operator opens with its review; another group's does not.
    opened = await client.get(f"{TEAM}/calls/{good['id']}", headers=staff)
    assert opened.status_code == 200, opened.text
    assert opened.json()["learner"]["name"] == "Оператор Первый"
    assert opened.json()["result"]["score"] == good["result"]["score"]
    assert (await client.get(f"{TEAM}/calls/{theirs['id']}", headers=staff)).status_code == 404

    for leader in (trainer, await make_user(session, login="head-v", role=Role.HEAD)):
        everyone = (await client.get(TEAM, headers=auth(await login(client, leader.login)))).json()
        assert {r["name"] for r in everyone["operators"]} >= {"Оператор Первый", "Чужой Оператор"}
        assert everyone["summary"]["calls"] == 3
    group = (await client.get(TEAM, headers=staff, params={"group_id": operator.group_id,
                                                           "days": 7})).json()
    assert group["period"]["days"] == 7 and group["summary"]["calls"] == 2
    assert (await client.get(TEAM, headers=staff, params={"days": 12})).status_code == 400
    assert (await client.get(TEAM, headers=mine)).status_code == 403


async def test_drivers_call_operators_not_leaders(client, session, supervisor, head):
    trainer = await make_user(session, login="tr-calls", role=Role.TRAINER)
    for leader in (supervisor, head, trainer):
        headers = auth(await login(client, leader.login))
        refused = await client.post(f"{VOICE}/start", headers=headers,
                                    json={"scenario_key": "phone_change", "persona": "calm"})
        assert refused.status_code == 403
        sites = auth(await login_with_work_sites(client, leader.login))
        assert (await client.get("/api/v1/learning/oktell", headers=sites)).json()[
            "voice_calls"] is False
    admin = await make_user(session, login="adm-calls", role=Role.ADMIN)
    assert (await start(client, auth(await login(client, admin.login))))["turn"] == 0


async def test_the_queue_and_a_leaders_ai_review(client, session, operator, supervisor,
                                                 monkeypatch):
    mine = auth(await login(client, operator.login))
    done = await call(client, mine, EXPLAIN, NEXT)
    disputed = await client.post(f"{VOICE}/attempts/{done['id']}/review", headers=mine,
                                 json={"comment": "Я объяснил причину"})
    assert disputed.status_code == 200
    staff = auth(await login(client, supervisor.login))
    data = (await client.get(TEAM, headers=staff)).json()
    assert data["summary"]["disputes"] == 1
    assert data["queue"][0]["id"] == done["id"]
    assert data["queue"][0]["comment"] == "Я объяснил причину"
    opened = (await client.get(f"{TEAM}/calls/{done['id']}", headers=staff)).json()
    assert opened["needs_answer"] and opened["review"]["comment"] == "Я объяснил причину"
    fake = FakeClaude({
        "criteria": [], "critical_errors": [], "summary": "Причина названа, шаг понятен.",
    })
    connect(monkeypatch, fake)
    reviewed = await client.post(f"{TEAM}/calls/{done['id']}/ai-review", headers=staff)
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["result"]["ai_review"]["summary"] == "Причина названа, шаг понятен."
    assert reviewed.json()["learner"]["id"] == operator.id
    after = (await client.get(TEAM, headers=staff)).json()
    assert after["calls"][0]["ai_review"] is not None
    other_sv = await make_user(session, login="sv-x", role=Role.SUPERVISOR)
    other = auth(await login(client, other_sv.login))
    assert (await client.post(f"{TEAM}/calls/{done['id']}/ai-review",
                              headers=other)).status_code == 404
    # The leader answers the dispute from the call page; the queue empties.
    answered = await client.post(f"{VOICE}/reviews/{done['id']}/resolve", headers=staff,
                                 json={"comment": "Согласен, причина названа."})
    assert answered.status_code == 200, answered.text
    reread = (await client.get(f"{TEAM}/calls/{done['id']}", headers=staff)).json()
    assert not reread["needs_answer"]
    assert reread["result"]["mentor_comment"] == "Согласен, причина названа."
    final = (await client.get(TEAM, headers=staff)).json()
    assert final["summary"]["disputes"] == 0 and final["queue"] == []


async def test_the_operator_sees_his_progress_and_what_to_train(client, operator):
    headers = auth(await login(client, operator.login))
    empty = (await client.get(VOICE, headers=headers)).json()["progress"]
    assert empty["calls"] == 0 and empty["best"] is None and empty["weak"] == []
    good = await call(client, headers, EXPLAIN, NEXT)
    weak = await call(client, headers, "Позвоните со старого номера.")
    progress = (await client.get(VOICE, headers=headers)).json()["progress"]
    assert progress["calls"] == 2 and progress["calls_30d"] == 2
    assert progress["best"]["id"] == good["id"] and progress["worst"]["id"] == weak["id"]
    assert progress["average"] == round((good["result"]["score"] + weak["result"]["score"]) / 2)
    first = progress["weak"][0]
    assert first["passed"] < first["total"] and first["label"]
    assert first["example"] and first["attempt_id"] in (good["id"], weak["id"])
