"""Practice cannot be replaced by URL opens, forged completion or a second coin award."""

import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.models.city import CityAward, CitySettings, CityWorld
from app.models.coin import CoinTransaction
from app.models.crm import CrmAppeal
from app.models.enums import Role
from app.models.progress import Notification
from app.models.scenario import ScenarioAttempt
from app.models.settings import AuditLog
from app.services import city, dispatch, scenario_catalog, scenarios
from app.services.city_world import defaults
from app.services.crm_catalog import category_id
from tests.conftest import auth, login, login_with_work_sites, make_user

pytestmark = pytest.mark.asyncio
BASE = "/api/v1/learning/scenarios"
CHOICES = [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1]


@pytest.fixture
async def support_operator(session, operator, supervisor):
    cities = defaults()
    cities[0]["districts"][0]["supervisor_id"] = supervisor.id
    session.add(CityWorld(id=1, revision=1, cities=cities, updated_by_id=supervisor.id))
    await session.commit()
    return operator


async def start(client, headers):
    response = await client.post(BASE + "/business_park/start", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


async def reply(client, headers, attempt_id, step, answer):
    return await client.put(
        BASE + f"/attempts/{attempt_id}/answer",
        headers=headers,
        json={"step": step, "answer": answer},
    )


async def dispatch_body(session, user):
    d = dispatch.fold(await dispatch.history(session, user.id))["drivers"]["zhaksylykov"]
    p = dispatch.PARK_BY_ID[d["park"]]
    return {
        "driver_id": d["id"],
        "license_number": d["license"],
        **{key: d["car"][key] for key in ("brand", "model", "year", "color")},
        "employment": d["employment"],
        "park": p["name"],
        "city": p["city"],
        "classification_result": "not_confirmed",
    }


async def progress_to_crm(client, headers, session, user, attempt, choices=CHOICES):
    for index, choice in enumerate(choices[:-1]):
        response = await reply(client, headers, attempt["id"], index, choice)
        assert response.status_code == 200, response.text
        if choice != CHOICES[index]:
            assert response.json()["current_step"] == index
            response = await reply(client, headers, attempt["id"], index, CHOICES[index])
            assert response.status_code == 200, response.text
        if index in (1, 3):
            assert response.json()["phase"] == "dispatch"
            checked = await inspect(client, headers, attempt, "profile" if index == 1 else "car")
            assert checked.status_code == 200, checked.text
    assert response.json()["phase"] == "crm"


async def inspect(client, headers, attempt, section, **changes):
    return await client.post(
        BASE + f"/attempts/{attempt['id']}/inspect",
        headers=headers,
        json={
            "driver_id": attempt["driver"]["id"],
            "park_id": attempt["driver"]["park_id"],
            "section": section,
            **changes,
        },
    )


async def save_appeal(client, headers, attempt, **overrides):
    d = attempt["driver"]
    path = ["Водитель", "Самозанятый водитель", "Консультация", "Консультация по Тарифам"]
    body = {
        "request_id": str(uuid4()),
        "channel": "Звонок",
        "phone": d["phone"],
        "license_number": d["license_number"],
        "driver_id": d["id"],
        "contacted_at": datetime.now(UTC).isoformat(),
        "park": d["park"],
        "city": d["city"],
        "category_ids": [category_id(path[:index]) for index in range(1, len(path) + 1)],
        "is_ticket": False,
        "comment": (
            "Проверены профиль, автомобиль и условия Business. Допуск не подтверждён;"
            " водитель проверяет актуальный классификатор и диагностику Яндекс Про."
        ),
        "details": {
            "scenario_attempt": str(attempt["id"]),
            "scenario_diagnostics": "awaiting_driver_diagnostics",
            "scenario_outcome": "not_confirmed",
            "scenario_next_action": "check_pro_diagnostics",
        },
    }
    body.update(overrides)
    response = await client.post(
        "/api/v1/learning/crm/appeals", headers=headers, data={"payload": json.dumps(body)}
    )
    assert response.status_code == 201, response.text
    return response.json()


async def complete_practice(client, headers, session, user, attempt, choices=CHOICES):
    await progress_to_crm(client, headers, session, user, attempt, choices)
    appeal = await save_appeal(client, headers, attempt)
    checked = await client.post(
        BASE + f"/attempts/{attempt['id']}/crm-check",
        headers=headers,
        json={"appeal_id": appeal["id"]},
    )
    assert checked.status_code == 200, checked.text
    assert checked.json()["phase"] == "dialogue"
    final_index = len(choices) - 1
    closed = await reply(client, headers, attempt["id"], final_index, choices[-1])
    assert closed.status_code == 200, closed.text
    if choices[-1] != CHOICES[-1]:
        closed = await reply(client, headers, attempt["id"], final_index, CHOICES[-1])
    assert closed.json()["phase"] == "complete"
    return appeal


async def finish(client, headers, attempt):
    return await client.post(BASE + f"/attempts/{attempt['id']}/finish", headers=headers)


async def count(session, model, *where):
    return await session.scalar(select(func.count()).select_from(model).where(*where))


async def test_catalog_before_qr_is_private_no_reward_no_answer_key(
    client, session, support_operator
):
    headers = auth(await login(client, support_operator.login))
    response = await client.get(BASE, headers=headers)
    assert response.status_code == 200 and response.headers["cache-control"] == "private, no-store"
    assert response.json()["items"][0]["coins_reward"] == 100
    attempt = await start(client, headers)
    assert attempt["current_step"] == 0 and attempt["phase"] == "dialogue"
    assert attempt["revision"] == 2
    assert attempt["driver"]["phone"] in attempt["opening_message"]
    assert attempt["steps"][1]["kind"] == "action" and attempt["steps"][0]["kind"] == "reply"
    assert attempt["steps"][5]["resource"] == "classifier"
    assert not attempt["reward_already_claimed"]
    assert all("correct" not in item and "explanation" not in item for item in attempt["steps"])
    assert "observations" not in attempt and "car" not in attempt["driver"]
    assert await count(session, CityAward) == await count(session, CoinTransaction) == 0


async def test_sales_unassigned_archived_group_denied_every_endpoint(
    client, session, operator, supervisor
):
    headers = auth(await login_with_work_sites(client, operator.login))
    for home in (None, "sales", "inactive"):
        cities = defaults()
        if home:
            cities[1 if home == "sales" else 0]["districts"][0]["supervisor_id"] = supervisor.id
        row = await session.get(CityWorld, 1)
        if row:
            row.cities = cities
        else:
            session.add(CityWorld(id=1, revision=1, cities=cities, updated_by_id=supervisor.id))
        if home == "inactive":
            from app.models.user import Group

            group = await session.get(Group, operator.group_id)
            group.is_active = False
        await session.commit()
        for method, path, body in [
            ("GET", "", None),
            ("POST", "/business_park/start", None),
            ("GET", "/attempts/999", None),
            ("PUT", "/attempts/999/answer", {"step": 0, "answer": 0}),
            ("POST", "/attempts/999/dispatch-check", await dispatch_body(session, operator)),
            (
                "POST",
                "/attempts/999/inspect",
                {"driver_id": "unknown", "park_id": "unknown", "section": "profile"},
            ),
            ("POST", "/attempts/999/crm-check", {"appeal_id": 1}),
            ("POST", "/attempts/999/finish", None),
        ]:
            response = await client.request(method, BASE + path, headers=headers, json=body)
            assert response.status_code == 403, (home, path, response.text)
    assert await count(session, ScenarioAttempt) == await count(session, CityAward) == 0


async def test_resume_answer_order_duplicates_and_work_sites_qr(client, session, support_operator):
    headers = auth(await login(client, support_operator.login))
    attempt = await start(client, headers)
    assert (await start(client, headers))["id"] == attempt["id"]
    assert (await reply(client, headers, attempt["id"], 1, 1)).status_code == 409
    accepted = await reply(client, headers, attempt["id"], 0, 0)
    assert accepted.json()["current_step"] == 1
    assert (await reply(client, headers, attempt["id"], 0, 0)).json()["current_step"] == 1
    assert (await reply(client, headers, attempt["id"], 0, 2)).status_code == 409
    assert (await reply(client, headers, attempt["id"], 1, 1)).json()["phase"] == "dispatch"
    assert (await reply(client, headers, attempt["id"], 2, 2)).status_code == 409
    for suffix, body in [
        ("dispatch-check", await dispatch_body(session, support_operator)),
        (
            "inspect",
            {"driver_id": attempt["driver"]["id"], "park_id": "itaxi-ala", "section": "profile"},
        ),
        ("crm-check", {"appeal_id": 1}),
        ("finish", None),
    ]:
        response = await client.post(
            BASE + f"/attempts/{attempt['id']}/{suffix}", headers=headers, json=body
        )
        assert response.status_code == 403 and response.json()["code"] == "work_sites_qr_required"
    reopened = await client.get(BASE + f"/attempts/{attempt['id']}", headers=headers)
    assert reopened.json()["current_step"] == 2


async def test_dispatch_requires_two_ordered_inspections_not_url_open_or_old_payload(
    client, session, support_operator
):
    headers = auth(await login_with_work_sites(client, support_operator.login))
    attempt = await start(client, headers)
    body = await dispatch_body(session, support_operator)
    route = BASE + f"/attempts/{attempt['id']}/dispatch-check"
    assert (await client.post(route, headers=headers, json=body)).status_code == 409
    assert (await inspect(client, headers, attempt, "profile")).status_code == 409
    for i in (0, 1):
        assert (await reply(client, headers, attempt["id"], i, CHOICES[i])).status_code == 200
    # Opening the actual cabinet is useful but is not completion proof.
    assert (await client.get("/api/v1/learning/dispatch", headers=headers)).status_code == 200
    assert (await reply(client, headers, attempt["id"], 2, 2)).status_code == 409
    for field, value in [("driver_id", "other"), ("park_id", "itaxi-ast")]:
        response = await inspect(client, headers, attempt, "profile", **{field: value})
        assert response.status_code == 400, (field, response.text)
    assert (await inspect(client, headers, attempt, "car")).status_code == 409
    assert (await inspect(client, headers, attempt, "profile", verified=True)).status_code == 422
    assert (await client.post(route, headers=headers, json=body)).status_code == 409
    profile = await inspect(client, headers, attempt, "profile")
    assert profile.status_code == 200, profile.text
    assert profile.json()["practice"]["inspections"] == {"profile": True, "car": False}
    assert not profile.json()["practice"]["dispatch"]
    assert profile.json()["phase"] == "dialogue" and profile.json()["current_step"] == 2
    assert (await inspect(client, headers, attempt, "profile")).json() == profile.json()
    assert (await inspect(client, headers, attempt, "car")).status_code == 409
    for i in (2, 3):
        assert (await reply(client, headers, attempt["id"], i, CHOICES[i])).status_code == 200
    assert (await reply(client, headers, attempt["id"], 4, CHOICES[4])).status_code == 409
    accepted = await inspect(client, headers, attempt, "car")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["practice"]["dispatch"] and accepted.json()["phase"] == "dialogue"
    assert accepted.json()["practice"]["inspections"] == {"profile": True, "car": True}
    assert "observations" not in json.dumps(accepted.json())
    assert (await inspect(client, headers, attempt, "car")).json() == accepted.json()
    assert (await client.post(route, headers=headers, json=body)).status_code == 409


async def test_foreign_attempt_and_scope_change_cannot_finish_existing(
    client, session, support_operator, supervisor
):
    headers = auth(await login_with_work_sites(client, support_operator.login))
    attempt = await start(client, headers)
    other = await make_user(session, login="scenario-other", group_id=support_operator.group_id)
    foreign = auth(await login_with_work_sites(client, other.login))
    assert (
        await client.get(BASE + f"/attempts/{attempt['id']}", headers=foreign)
    ).status_code == 404
    assert (await inspect(client, foreign, attempt, "profile")).status_code == 404
    row = await session.get(CityWorld, 1)
    cities = defaults()
    cities[1]["districts"][0]["supervisor_id"] = supervisor.id
    row.cities = cities
    await session.commit()
    assert (await finish(client, headers, attempt)).status_code == 403
    assert (
        await client.get(BASE + f"/attempts/{attempt['id']}", headers=headers)
    ).status_code == 403
    assert await count(session, CityAward) == 0


@pytest.mark.parametrize(
    "change",
    [
        "wrong_driver",
        "wrong_city",
        "missing_diagnostics",
        "wrong_outcome",
        "wrong_attempt",
        "short_comment",
    ],
)
async def test_crm_requires_saved_linked_complete_consultation(
    client, session, support_operator, change
):
    headers = auth(await login_with_work_sites(client, support_operator.login))
    attempt = await start(client, headers)
    await progress_to_crm(client, headers, session, support_operator, attempt)
    appeal = await save_appeal(client, headers, attempt)
    row = await session.get(CrmAppeal, appeal["id"])
    if change == "wrong_driver":
        row.driver_id = "other-driver"
    elif change == "wrong_city":
        row.city = "Астана"
    elif change == "short_comment":
        row.comment = "Ок"
    else:
        key, value = {
            "missing_diagnostics": ("scenario_diagnostics", ""),
            "wrong_outcome": ("scenario_outcome", "confirmed"),
            "wrong_attempt": ("scenario_attempt", "999"),
        }[change]
        row.details = {**row.details, key: value}
    await session.commit()
    response = await client.post(
        BASE + f"/attempts/{attempt['id']}/crm-check",
        headers=headers,
        json={"appeal_id": appeal["id"]},
    )
    assert response.status_code == 400, response.text
    assert (await finish(client, headers, attempt)).status_code == 409
    assert await count(session, CityAward) == 0


async def test_crm_rejects_prior_or_foreign_author_appeal(client, session, support_operator):
    headers = auth(await login_with_work_sites(client, support_operator.login))
    attempt = await start(client, headers)
    await progress_to_crm(client, headers, session, support_operator, attempt)
    appeal = await save_appeal(client, headers, attempt)
    row = await session.get(CrmAppeal, appeal["id"])
    row.created_at = datetime.now(UTC) - timedelta(days=1)
    await session.commit()
    route = BASE + f"/attempts/{attempt['id']}/crm-check"
    assert (
        await client.post(route, headers=headers, json={"appeal_id": row.id})
    ).status_code == 400
    other = await make_user(session, login="scenario-wrong-author")
    row.created_at = datetime.now(UTC)
    row.author_id = other.id
    await session.commit()
    assert (
        await client.post(route, headers=headers, json={"appeal_id": row.id})
    ).status_code == 400


async def test_prior_crm_cannot_be_rebound_with_same_timestamp_tick(
    client,
    session,
    support_operator,
):
    headers = auth(await login_with_work_sites(client, support_operator.login))
    earlier = await start(client, headers)
    choices = CHOICES.copy()
    choices[5] = 0
    appeal = await complete_practice(client, headers, session, support_operator, earlier, choices)
    assert (await finish(client, headers, earlier)).json()["state"] == "failed"
    current = await start(client, headers)
    await progress_to_crm(client, headers, session, support_operator, current)
    # Simulate a forged old proof and a database with second-resolution timestamps.
    row = await session.get(CrmAppeal, appeal["id"])
    attempt = await session.get(ScenarioAttempt, current["id"])
    row.details = {**row.details, "scenario_attempt": str(current["id"])}
    row.created_at = attempt.created_at
    await session.commit()
    response = await client.post(
        BASE + f"/attempts/{current['id']}/crm-check",
        headers=headers,
        json={"appeal_id": row.id},
    )
    assert response.status_code == 400 and "после начала" in response.json()["detail"]


async def test_success_single_city_reward_replay_resume_and_second_run(
    client, session, support_operator
):
    headers = auth(await login_with_work_sites(client, support_operator.login))
    attempt = await start(client, headers)
    assert (await finish(client, headers, attempt)).status_code == 409
    await complete_practice(client, headers, session, support_operator, attempt)
    result = await finish(client, headers, attempt)
    assert result.status_code == 200, result.text
    assert result.json()["state"] == "passed" and result.json()["score"] == 100
    assert result.json()["awarded_coins"] == 100 and result.json()["phase"] == "complete"
    again = await finish(client, headers, attempt)
    assert again.json() == result.json()
    reopened = await client.get(BASE + f"/attempts/{attempt['id']}", headers=headers)
    assert reopened.json() == result.json()
    second = await start(client, headers)
    assert second["id"] != attempt["id"]
    assert second["reward_already_claimed"]
    await complete_practice(client, headers, session, support_operator, second)
    repeated = (await finish(client, headers, second)).json()
    assert repeated["state"] == "passed" and repeated["reward_already_claimed"]
    assert repeated["awarded_coins"] == 0
    assert (
        await count(session, CityAward, CityAward.mission_key == scenario_catalog.MISSION_KEY) == 1
    )
    assert (
        await count(
            session,
            CoinTransaction,
            CoinTransaction.idempotency_key
            == f"city:{support_operator.id}:{scenario_catalog.MISSION_KEY}",
        )
        == 1
    )
    assert await count(session, Notification, Notification.title == "Сценарий пройден") == 1
    assert await count(session, AuditLog, AuditLog.action == "scenario.reward") == 1
    dashboard = (await client.get("/api/v1/learning/city", headers=headers)).json()
    mission = next(m for m in dashboard["missions"] if m["key"] == scenario_catalog.MISSION_KEY)
    assert mission["state"] == "completed" and mission["xp"] == 0


@pytest.mark.parametrize("wrong_steps,passed", [([0, 1], True), ([0, 1, 4], False), ([5], False)])
async def test_threshold_and_critical_safety_gate(
    client, session, support_operator, wrong_steps, passed
):
    headers = auth(await login_with_work_sites(client, support_operator.login))
    attempt = await start(client, headers)
    choices = CHOICES.copy()
    for index in wrong_steps:
        choices[index] = (choices[index] + 1) % 3
    await complete_practice(client, headers, session, support_operator, attempt, choices)
    result = (await finish(client, headers, attempt)).json()
    assert result["score"] == round((len(CHOICES) - len(wrong_steps)) * 100 / len(CHOICES))
    assert all(result["answers"][str(i)] == CHOICES[i] for i in wrong_steps)
    assert all(result["first_answers"][str(i)] != CHOICES[i] for i in wrong_steps)
    assert result["state"] == ("passed" if passed else "failed")
    assert result["awarded_coins"] == (100 if passed else 0)
    assert await count(session, CityAward) == int(passed)


@pytest.mark.parametrize("role", [Role.TRAINER, Role.SUPERVISOR, Role.HEAD, Role.ADMIN])
async def test_staff_preview_uses_real_practice_without_coins_or_city_counts(client, session, role):
    user = await make_user(session, login=f"scenario-{role}", role=role)
    headers = auth(await login(client, user.login))
    attempt = await start(client, headers)
    assert attempt["is_preview"]
    await complete_practice(client, headers, session, user, attempt)
    result = (await finish(client, headers, attempt)).json()
    assert result["state"] == "passed" and result["awarded_coins"] == 0
    assert await count(session, CityAward) == await count(session, CoinTransaction) == 0
    assert (await city.evidence(session, [user.id]))[user.id][scenario_catalog.MISSION_KEY] == 0


async def test_config_snapshot_revision_disabled_new_start_and_zero_reward(
    client, session, support_operator, monkeypatch
):
    headers = auth(await login_with_work_sites(client, support_operator.login))
    attempt = await start(client, headers)
    cfg = await city.settings(session)
    missions = deepcopy(cfg["missions"])
    missions[scenario_catalog.MISSION_KEY].update(coins=0, enabled=False)
    session.add(
        CitySettings(id=1, revision=1, missions=missions, updated_by_id=support_operator.id)
    )
    await session.commit()
    # Existing attempt keeps its original coin and curriculum snapshots.
    monkeypatch.setattr(scenario_catalog, "REVISION", 3)
    monkeypatch.setattr(scenario_catalog, "DISPATCH_AFTER", 5)
    assert (await client.post(BASE + "/business_park/start", headers=headers)).status_code == 409
    await complete_practice(client, headers, session, support_operator, attempt)
    result = (await finish(client, headers, attempt)).json()
    assert result["awarded_coins"] == 100 and result["revision"] == 2
    monkeypatch.setattr(scenario_catalog, "DISPATCH_AFTER", 2)
    assert (await client.post(BASE + "/business_park/start", headers=headers)).status_code == 409
    row = await session.get(CitySettings, 1)
    row.missions = {
        **missions,
        scenario_catalog.MISSION_KEY: {**missions[scenario_catalog.MISSION_KEY], "enabled": True},
    }
    await session.commit()
    other = await make_user(session, login="scenario-zero", group_id=support_operator.group_id)
    own = auth(await login_with_work_sites(client, other.login))
    zero = await start(client, own)
    assert zero["coins_reward"] == 0 and zero["revision"] == 3
    await complete_practice(client, own, session, other, zero)
    completed = (await finish(client, own, zero)).json()
    assert completed["state"] == "passed" and completed["awarded_coins"] == 0
    assert await count(session, CityAward, CityAward.user_id == other.id) == 1
    assert await count(session, CoinTransaction, CoinTransaction.user_id == other.id) == 0


async def test_financial_failure_rolls_back_pass_practice_reward_and_retry(
    client, session, support_operator, monkeypatch
):
    from app.core.errors import ConflictError

    headers = auth(await login_with_work_sites(client, support_operator.login))
    attempt = await start(client, headers)
    await complete_practice(client, headers, session, support_operator, attempt)
    original = scenarios.post_transaction

    async def fail(*args, **kwargs):
        await original(*args, **kwargs)
        raise ConflictError("Учебная проверка сбоя после записи транзакции")

    monkeypatch.setattr(scenarios, "post_transaction", fail)
    assert (await finish(client, headers, attempt)).status_code == 409
    async with SessionLocal() as fresh:
        stored = await fresh.get(ScenarioAttempt, attempt["id"])
        assert stored.state == "in_progress" and stored.finished_at is None
        assert stored.practice["dispatch"] and stored.practice["crm"]
        assert await count(fresh, CityAward) == await count(fresh, CoinTransaction) == 0
    monkeypatch.setattr(scenarios, "post_transaction", original)
    retry = await finish(client, headers, attempt)
    assert retry.status_code == 200 and retry.json()["awarded_coins"] == 100


async def test_wrong_action_waits_for_correction_and_keeps_first_decision(client, support_operator):
    headers = auth(await login(client, support_operator.login))
    attempt = await start(client, headers)
    for wrong in (1, 2):
        response = await reply(client, headers, attempt["id"], 0, wrong)
        assert response.status_code == 200, response.text
        state = response.json()
        assert state["current_step"] == 0 and state["answers"] == {}
        assert state["first_answers"] == {"0": 1}
        assert state["feedback"]["correct"] is False
    resumed = (await client.get(BASE + f"/attempts/{attempt['id']}", headers=headers)).json()
    assert resumed == state
    accepted = (await reply(client, headers, attempt["id"], 0, 0)).json()
    assert accepted["current_step"] == 1 and accepted["answers"] == {"0": 0}
    assert accepted["first_answers"] == {"0": 1}
    assert accepted["steps"][0]["answered_correctly"] is False
    assert accepted["feedback"]["correct"] is True
    assert all(
        "explanation" not in step and "correct" not in step for step in accepted["steps"][1:]
    )
    assert (await reply(client, headers, attempt["id"], 0, 0)).json() == accepted


@pytest.mark.parametrize("changed", ["license", "phone", "park", "city", "employment", "car"])
async def test_car_inspection_rechecks_live_profile_and_car(
    client, session, support_operator, monkeypatch, changed
):
    headers = auth(await login_with_work_sites(client, support_operator.login))
    attempt = await start(client, headers)
    for i in (0, 1):
        assert (await reply(client, headers, attempt["id"], i, CHOICES[i])).status_code == 200
    assert (await inspect(client, headers, attempt, "profile")).status_code == 200
    for i in (2, 3):
        assert (await reply(client, headers, attempt["id"], i, CHOICES[i])).status_code == 200
    original_fold = dispatch.fold

    def changed_account(events):
        cabinet = original_fold(events)
        driver = cabinet["drivers"][scenario_catalog.DRIVER_KEY]
        if changed == "car":
            driver["car"]["year"] -= 1
        elif changed == "park":
            driver["park"] = "itaxi-ast"
        elif changed != "city":
            driver[changed] = "changed"
        return cabinet

    monkeypatch.setattr(dispatch, "fold", changed_account)
    if changed == "city":
        parks = deepcopy(dispatch.PARK_BY_ID)
        parks[attempt["driver"]["park_id"]]["city"] = "Астана"
        monkeypatch.setattr(dispatch, "PARK_BY_ID", parks)
    response = await inspect(client, headers, attempt, "car")
    assert response.status_code == 409, response.text
    state = (await client.get(BASE + f"/attempts/{attempt['id']}", headers=headers)).json()
    assert state["practice"]["inspections"] == {"profile": True, "car": False}
    assert not state["practice"]["dispatch"] and state["current_step"] == 4


async def test_crm_must_be_verified_before_closing_reply_and_finish(
    client, session, support_operator
):
    headers = auth(await login_with_work_sites(client, support_operator.login))
    attempt = await start(client, headers)
    await progress_to_crm(client, headers, session, support_operator, attempt)
    last = len(CHOICES) - 1
    assert (await reply(client, headers, attempt["id"], last, CHOICES[last])).status_code == 409
    assert (await finish(client, headers, attempt)).status_code == 409
    appeal = await save_appeal(client, headers, attempt)
    assert "scenario_checks" not in appeal["details"]
    route = BASE + f"/attempts/{attempt['id']}/crm-check"
    checked = await client.post(route, headers=headers, json={"appeal_id": appeal["id"]})
    assert checked.status_code == 200, checked.text
    assert checked.json()["phase"] == "dialogue" and checked.json()["current_step"] == last
    assert (await client.post(route, headers=headers, json={"appeal_id": appeal["id"]})).json() == (
        checked.json()
    )
    assert (await finish(client, headers, attempt)).status_code == 409
    wrong = await reply(client, headers, attempt["id"], last, 0)
    assert wrong.json()["current_step"] == last and not wrong.json()["feedback"]["correct"]
    closed = await reply(client, headers, attempt["id"], last, CHOICES[last])
    assert closed.json()["phase"] == "complete"
    result = (await finish(client, headers, attempt)).json()
    assert result["state"] == "failed" and result["score"] == 91
    assert result["awarded_coins"] == 0


async def test_finish_revalidates_saved_diagnostics_after_crm_check(
    client, session, support_operator
):
    headers = auth(await login_with_work_sites(client, support_operator.login))
    attempt = await start(client, headers)
    appeal = await complete_practice(client, headers, session, support_operator, attempt)
    row = await session.get(CrmAppeal, appeal["id"])
    row.details = {**row.details, "scenario_diagnostics": "confirmed"}
    await session.commit()
    assert (await finish(client, headers, attempt)).status_code == 400
    assert await count(session, CityAward) == await count(session, CoinTransaction) == 0


async def test_new_revision_starts_fresh_without_changing_legacy_attempt(
    client, session, support_operator
):
    headers = auth(await login_with_work_sites(client, support_operator.login))
    original = await start(client, headers)
    old = await session.get(ScenarioAttempt, original["id"])
    snapshot = deepcopy(old.snapshot)
    snapshot["revision"] = 1
    for key in ("workflow_version", "vehicle_after", "crm_after", "opening_message"):
        snapshot.pop(key)
    snapshot["steps"] = [snapshot["steps"][0], snapshot["steps"][1], snapshot["steps"][-1]]
    for step in snapshot["steps"]:
        for key in ("kind", "prompt", "resource"):
            step.pop(key, None)
    snapshot["crm_requirements"] = [
        {"key": key, "label": key}
        for key in ("classifier", "activation", "standards", "commission", "diagnostics")
    ]
    old.revision = 1
    old.snapshot = snapshot
    await session.commit()
    catalog = (await client.get(BASE, headers=headers)).json()["items"][0]
    assert catalog["revision"] == 2 and catalog["attempt_id"] is None
    current = await start(client, headers)
    assert current["id"] != old.id and current["revision"] == 2
    assert (await start(client, headers))["id"] == current["id"]
    legacy = (await client.get(BASE + f"/attempts/{old.id}", headers=headers)).json()
    assert legacy["revision"] == 1 and legacy["current_step"] == 0
    assert legacy["opening_message"] is None and legacy["state"] == "in_progress"
    assert (await inspect(client, headers, legacy, "profile")).status_code == 409
    for i, choice in enumerate((0, 1)):
        assert (await reply(client, headers, old.id, i, choice)).status_code == 200
    route = BASE + f"/attempts/{old.id}/dispatch-check"
    body = await dispatch_body(session, support_operator)
    assert (
        await client.post(route, headers=headers, json={**body, "city": "Астана"})
    ).status_code == 400
    checked = await client.post(route, headers=headers, json=body)
    assert checked.status_code == 200 and checked.json()["practice"]["dispatch"]
    assert (await client.post(route, headers=headers, json=body)).json() == checked.json()
    assert (await reply(client, headers, old.id, 2, 1)).json()["phase"] == "crm"
    appeal = await save_appeal(
        client,
        headers,
        legacy,
        details={
            "scenario_attempt": str(old.id),
            "scenario_checks": json.dumps([item["key"] for item in snapshot["crm_requirements"]]),
            "scenario_outcome": "not_confirmed",
            "scenario_next_action": "check_pro_diagnostics",
        },
    )
    response = await client.post(
        BASE + f"/attempts/{old.id}/crm-check",
        headers=headers,
        json={"appeal_id": appeal["id"]},
    )
    assert response.status_code == 200 and response.json()["phase"] == "crm"
    result = (await finish(client, headers, legacy)).json()
    assert result["state"] == "passed" and result["awarded_coins"] == 100
    resumed = await start(client, headers)
    assert resumed["id"] == current["id"] and resumed["reward_already_claimed"]
