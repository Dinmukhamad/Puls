"""Trainees retain verified practice without workplace access or a coin economy."""

from datetime import date
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models.access import AccessRule
from app.models.city import CityAward
from app.models.coin import CoinTransaction
from app.models.driver_shift import DriverShift
from app.models.enums import Role
from app.models.learning import LearningAttempt
from app.models.user import CoinAccount
from app.services.access import SECTIONS
from tests.conftest import auth, login, login_with_work_sites, make_user
from tests.test_crm_course import COURSE, KEYS, finish_intro, task
from tests.test_learning import publish


@pytest.fixture
async def trainee(session):
    return await make_user(session, login="trainee-one", role=Role.TRAINEE)


async def test_staff_can_create_and_promote_same_trainee_account(client, session, head):
    h = auth(await login(client, head.login))
    payload = {
        "login": "new-trainee",
        "full_name": "Новый Стажёр",
        "role": "trainee",
        "password": "password123",
    }
    result = await client.post("/api/v1/admin/users", headers=h, json=payload)
    assert result.status_code == 201, result.text
    user = result.json()
    assert user["role"] == "trainee" and user["hired_on"] is None
    assert await session.get(CoinAccount, user["id"]) is None
    own = auth(await login(client, "new-trainee"))
    synced = await client.post("/api/v1/learning/trainee/progress", headers=own)
    assert synced.status_code == 200, synced.text
    awards = list(await session.scalars(select(CityAward).where(CityAward.user_id == user["id"])))
    assert awards and all(a.coins == a.xp == 0 for a in awards)
    changed = await client.patch(
        f"/api/v1/admin/users/{user['id']}",
        headers=h,
        json={"role": "operator", "hired_on": "2026-10-17"},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["id"] == user["id"]
    assert changed.json()["hired_on"] == "2026-10-17"
    assert (await client.get("/api/v1/auth/me", headers=own)).json()["role"] == "operator"
    assert (await client.get("/api/v1/learning/city", headers=own)).json()["missions"][0][
        "state"
    ] == "completed"
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0


async def test_trainee_role_ceiling_cannot_be_bypassed_by_section_grants(client, session, trainee):
    for section in SECTIONS:
        session.add(
            AccessRule(
                target_type="user", target_id=str(trainee.id), section=section.code, effect="allow"
            )
        )
    await session.commit()
    own = auth(await login(client, trainee.login))
    permissions = (await client.get("/api/v1/me/access", headers=own)).json()
    assert {k for k, v in permissions["allowed"].items() if v} == {"training"}
    for path in [
        "/me/balance",
        "/me/wallet",
        "/rating",
        "/analytics/overview",
        "/admin/users",
        "/admin/sessions",
        "/shop",
        "/games/wheel",
        "/learning/city/world",
        "/learning/city/estates",
        "/learning/city/sandbox",
    ]:
        response = await client.get("/api/v1" + path, headers=own)
        # Unknown construction URLs still cannot resolve to a trainee capability.
        assert response.status_code in (403, 404, 405), (path, response.text)
    for path, body in [
        ("/learning/city/plots/academy-0/build", {"item": "garden"}),
        ("/learning/city/quests/0/answer", {"answer": 0}),
        ("/admin/sessions/revoke-bulk", {"scope": "all", "session_ids": ["a"]}),
    ]:
        assert (await client.post("/api/v1" + path, headers=own, json=body)).status_code == 403
    assert (await client.get("/api/v1/auth/me", headers=own)).status_code == 200


async def test_verified_learning_persists_without_rewards_across_promotion(
    client, session, trainee, head
):
    material = await publish(client, head, coins_reward=100)
    own = auth(await login(client, trainee.login))
    started = await client.post(f"/api/v1/learning/{material['id']}/start", headers=own)
    assert started.status_code == 200, started.text
    attempt_id = started.json()["id"]
    assert not started.json()["is_preview"]
    answered = await client.put(
        f"/api/v1/learning/attempts/{attempt_id}/answer", headers=own, json={"step": 0, "answer": 0}
    )
    assert answered.status_code == 200, answered.text
    finished = await client.post(f"/api/v1/learning/attempts/{attempt_id}/finish", headers=own)
    assert finished.status_code == 200, finished.text
    assert finished.json()["state"] == "passed" and finished.json()["awarded_coins"] == 0
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0
    assert await session.get(CoinAccount, trainee.id) is None
    h = auth(await login(client, head.login))
    promoted = await client.patch(
        f"/api/v1/admin/users/{trainee.id}", headers=h, json={"role": "operator"}
    )
    assert promoted.status_code == 200, promoted.text
    catalog = (await client.get("/api/v1/learning", headers=own)).json()
    item = next(m for m in catalog if m["id"] == material["id"])
    assert item["completed"] and item["attempt_id"] == attempt_id
    await client.post(f"/api/v1/learning/attempts/{attempt_id}/finish", headers=own)
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0
    saved = await session.get(LearningAttempt, attempt_id, populate_existing=True)
    assert not saved.is_preview and saved.state == "passed"


async def test_real_crm_training_and_qr_work_for_trainees(client, session, trainee, head):
    own = auth(await login(client, trainee.login))
    status = (await client.get("/api/v1/work-sites-access/status", headers=own)).json()
    assert status["required"] and not status["granted"]
    assert (await client.get(COURSE, headers=own)).status_code == 403
    own = auth(await login_with_work_sites(client, trainee.login))
    await finish_intro(client, own)
    state = (await client.get(COURSE, headers=own)).json()
    assert task(state, KEYS[0])["state"] == "passed"
    assert (await client.post("/api/v1/learning/trainee/progress", headers=own)).status_code == 200
    h = auth(await login(client, head.login))
    view = await client.get(f"/api/v1/admin/learning/city/operators/{trainee.id}", headers=h)
    assert view.status_code == 200
    assert any(m["key"] == "crm_first" and m["current"] > 0 for m in view.json()["missions"])
    await client.patch(f"/api/v1/admin/users/{trainee.id}", headers=h, json={"role": "operator"})
    assert task((await client.get(COURSE, headers=own)).json(), KEYS[0])["state"] == "passed"


async def test_trainee_city_has_only_learning_and_cannot_self_complete(client, session, trainee):
    own = auth(await login(client, trainee.login))
    result = await client.post("/api/v1/learning/trainee/progress", headers=own)
    assert result.status_code == 200, result.text
    data = result.json()
    assert not data["preview"] and not data["can_build"]
    assert data["plots"] == data["buildings"] == [] and data["quests"] is None
    assert all(m["coins"] == m["xp"] == 0 for m in data["missions"])
    assert data["balance"] == data["available"] == 0
    # The tour of the operator's site is not on a trainee's way, and cannot be finished by one.
    assert "site_tour" not in {m["key"] for m in data["missions"]}
    assert (await client.post("/api/v1/learning/city/tour/finish", headers=own)).status_code == 403
    response = await client.post(
        "/api/v1/learning/city/missions/driver_five/claim",
        headers=own,
        json={"revision": data["revision"]},
    )
    assert response.status_code == 409
    before = await session.scalar(select(func.count()).select_from(CityAward))
    await client.post("/api/v1/learning/trainee/progress", headers=own)
    assert await session.scalar(select(func.count()).select_from(CityAward)) == before
    assert await session.get(CoinAccount, trainee.id) is None


async def test_trainee_driver_shift_is_real_and_staff_can_see_results(
    client, session, trainee, head
):
    own = auth(await login(client, trainee.login))
    shift_id = str(uuid4())
    started = await client.post(
        "/api/v1/learning/driver/shifts", headers=own, json={"id": shift_id, "mode": "assessment"}
    )
    assert started.status_code == 200, started.text
    shift = await session.get(DriverShift, shift_id)
    assert shift and not shift.is_preview
    h = auth(await login(client, head.login))
    report = await client.get(
        f"/api/v1/admin/learning-analytics/driver/operators/{trainee.id}", headers=h
    )
    assert report.status_code == 200, report.text
    assert report.json()["sessions"]


async def test_trainee_has_no_hire_date_and_trainer_can_create_them(client, session):
    trainer = await make_user(session, login="school-trainer", role=Role.TRAINER)
    h = auth(await login(client, trainer.login))
    payload = {
        "login": "school-trainee",
        "full_name": "Стажёр Школы",
        "role": "trainee",
        "password": "password123",
    }
    bad = await client.post(
        "/api/v1/admin/users", headers=h, json={**payload, "hired_on": str(date.today())}
    )
    assert bad.status_code == 400
    created = await client.post("/api/v1/admin/users", headers=h, json=payload)
    assert created.status_code == 201, created.text
    assert created.json()["role"] == "trainee"
    listing = await client.get("/api/v1/admin/users?role=trainee", headers=h)
    assert listing.status_code == 200 and listing.json()["items"][0]["role"] == "trainee"


async def test_trainee_scenario_is_real_private_and_has_no_reward(client, session, trainee):
    from app.models.scenario import ScenarioAttempt

    own = auth(await login(client, trainee.login))
    catalog = await client.get("/api/v1/learning/scenarios", headers=own)
    assert catalog.status_code == 200, catalog.text
    assert catalog.json()["is_preview"] is False
    assert catalog.json()["items"][0]["coins_reward"] == 0
    started = await client.post("/api/v1/learning/scenarios/business_park/start", headers=own)
    assert started.status_code == 200, started.text
    attempt = await session.get(ScenarioAttempt, started.json()["id"])
    assert attempt and not attempt.is_preview
    assert attempt.snapshot["reward"]["coins"] == 0
    other = await make_user(session, login="another-trainee", role=Role.TRAINEE)
    stranger = auth(await login(client, other.login))
    read = await client.get(
        f"/api/v1/learning/scenarios/attempts/{attempt.id}", headers=stranger
    )
    assert read.status_code == 404
    assert await session.scalar(select(func.count()).select_from(CoinTransaction)) == 0
