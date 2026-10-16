"""Ordinary CRM exercises use persistent, owned proof rather than client checkboxes."""

import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models.city import CityAward
from app.models.crm import CrmAppeal
from app.models.crm_training import CrmTrainingAttempt, CrmTrainingCheck
from app.models.enums import Role
from app.services.city import default_missions
from app.services.crm_catalog import category_id
from tests.conftest import auth, login, login_with_work_sites, make_user

pytestmark = pytest.mark.asyncio
BASE = "/api/v1/learning/crm"
TRAINING = BASE + "/training"
CITY = "/api/v1/learning/city"
IMAGE = [("files", ("screen.png", b"\x89PNG\r\n\x1a\ntraining-image", "image/png"))]


async def headers_for(client, user):
    return auth(await login_with_work_sites(client, user.login))


async def training(client, headers):
    result = await client.get(TRAINING, headers=headers)
    assert result.status_code == 200, result.text
    return result.json()


def task(state, key):
    return next(item for item in state["tasks"] if item["key"] == key)


async def start(client, headers, key):
    result = await client.post(f"{TRAINING}/tasks/{key}/start", headers=headers)
    assert result.status_code == 200, result.text
    return task(result.json(), key)


def appeal_payload(item, **changes):
    driver = item["driver"]
    path = item["category_path"]
    comment = "Объяснил водителю, где посмотреть доступные тарифы."
    if item["key"] == "crm_phone":
        comment = (
            f"Прошу сменить номер. Старый: {driver['phone']}\n"
            f"Новый: {driver['new_phone']}\n{driver['link']}"
        )
    elif item["key"] == "crm_closed":
        comment = f"Прошу снять лимит с аккаунта водителя.\n{driver['link']}"
    return {
        "request_id": str(uuid4()),
        "channel": "Звонок",
        "phone": driver["phone"],
        "license_number": driver["license"],
        "driver_id": driver["id"],
        "contacted_at": datetime.now(UTC).isoformat(),
        "park": driver["park"],
        "city": driver["city"],
        "category_ids": [category_id(path[:i]) for i in range(1, len(path) + 1)],
        "details": {},
        "comment": comment,
        "is_ticket": item["key"] != "crm_first",
        "training_task": item["key"],
        **changes,
    }


async def save(client, headers, body, *, files=None, appeal_id=None):
    method = client.post if appeal_id is None else client.patch
    path = BASE + "/appeals" + (f"/{appeal_id}" if appeal_id is not None else "")
    return await method(path, headers=headers, data={"payload": json.dumps(body)}, files=files)


async def count(session, model):
    return await session.scalar(select(func.count()).select_from(model))


async def test_three_sequential_tasks_use_real_fleet_proof_and_keep_business_status(
    client, session, operator
):
    headers = await headers_for(client, operator)
    initial = await training(client, headers)
    assert initial["revision"] == 1 and initial["active_task"] is None
    assert [item["state"] for item in initial["tasks"]] == ["available", "locked", "locked"]
    fleet = (await client.get("/api/v1/learning/dispatch", headers=headers)).json()
    for index, key in enumerate(("crm_first", "crm_phone", "crm_closed")):
        item = await start(client, headers, key)
        assert item["driver"]["id"] == fleet["test_driver"]
        assert f"/contractors/{fleet['test_driver']}/details" in item["driver"]["link"]
        assert item["state"] == "in_progress" and item["started_at"]
        result = await save(
            client, headers, appeal_payload(item), files=IMAGE if key == "crm_phone" else None
        )
        assert result.status_code == 201, result.text
        saved = result.json()
        done = task(saved["training_state"], key)
        assert done["state"] == "passed" and done["appeal_id"] == saved["id"]
        assert done["passed_at"] and all(check["ok"] for check in done["checks"])
        assert all(step["status"] == "passed" for step in done["steps"])
        assert saved["status"] == ("recorded" if index == 0 else "new")
        assert saved["training_state"]["completed"] == index + 1
        assert saved["training_state"]["active_task"] is None
    assert await count(session, CrmTrainingAttempt) == 3
    reopened = await training(client, headers)
    assert reopened["completed"] == 3


@pytest.mark.parametrize(
    "changes,check_key",
    [
        ({"driver_id": "wrong-driver"}, "driver_id"),
        ({"category_ids": [category_id(["Водитель"])]}, "category"),
        ({"phone": "abc+77756102284"}, "phone_format"),
        ({"comment": "Всё верно, консультация завершена."}, "comment"),
    ],
)
async def test_incorrect_saved_exercise_keeps_record_and_specific_feedback(
    client, session, operator, changes, check_key
):
    headers = await headers_for(client, operator)
    item = await start(client, headers, "crm_first")
    result = await save(client, headers, appeal_payload(item, **changes))
    assert result.status_code == 201, result.text
    saved = result.json()
    feedback = task(saved["training_state"], "crm_first")
    assert feedback["state"] == "in_progress" and saved["training_state"]["completed"] == 0
    failed = next(check for check in feedback["checks"] if check["key"] == check_key)
    assert not failed["ok"] and failed["message"]
    assert await count(session, CrmAppeal) == 1
    reopened = await client.get(f"{BASE}/appeals/{saved['id']}", headers=headers)
    assert reopened.status_code == 200
    persisted = task((await training(client, headers)), "crm_first")
    assert persisted["checks"] == feedback["checks"]
    assert task(saved["training_state"], "crm_phone")["state"] == "locked"


async def test_future_task_and_save_before_explicit_start_are_blocked(client, session, operator):
    headers = await headers_for(client, operator)
    initial = await training(client, headers)
    future = await client.post(f"{TRAINING}/tasks/crm_phone/start", headers=headers)
    assert future.status_code == 409
    premature = await save(client, headers, appeal_payload(task(initial, "crm_first")))
    assert premature.status_code == 409
    assert await count(session, CrmAppeal) == 0
    assert await count(session, CrmTrainingAttempt) == 0
    assert (await training(client, headers))["active_task"] is None


async def test_failed_record_can_be_corrected_and_passed_proof_is_immutable(
    client, session, operator
):
    headers = await headers_for(client, operator)
    item = await start(client, headers, "crm_first")
    body = appeal_payload(item, driver_id="wrong-driver")
    failed = await save(client, headers, body)
    assert failed.status_code == 201, failed.text
    first = failed.json()
    corrected = {**body, "driver_id": item["driver"]["id"], "revision": first["revision"]}
    result = await save(client, headers, corrected, appeal_id=first["id"])
    assert result.status_code == 200, result.text
    passed = result.json()
    assert passed["revision"] == first["revision"] + 1
    assert task(passed["training_state"], "crm_first")["state"] == "passed"
    assert await count(session, CrmAppeal) == 1
    replay = await save(
        client,
        headers,
        {**corrected, "comment": "Не заменять проверенный тарифный итог."},
        appeal_id=first["id"],
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["revision"] == passed["revision"]
    assert replay.json()["comment"] == corrected["comment"]
    forbidden = await save(
        client,
        headers,
        {
            **corrected,
            "request_id": str(uuid4()),
            "revision": passed["revision"],
            "comment": "Другой итог по тарифам.",
        },
        appeal_id=first["id"],
    )
    assert forbidden.status_code == 409
    reopened = (await client.get(f"{BASE}/appeals/{first['id']}", headers=headers)).json()
    assert reopened["comment"] == corrected["comment"]


async def test_duplicate_create_uuid_keeps_original_record_and_proof(client, session, operator):
    headers = await headers_for(client, operator)
    item = await start(client, headers, "crm_first")
    body = appeal_payload(item)
    first = await save(client, headers, body)
    assert first.status_code == 201, first.text
    repeated = await save(client, headers, {**body, "comment": "Заменённый текст по тарифам."})
    assert repeated.status_code == 201, repeated.text
    assert repeated.json()["id"] == first.json()["id"]
    assert repeated.json()["comment"] == body["comment"]
    assert task(repeated.json()["training_state"], "crm_first")["state"] == "passed"
    assert await count(session, CrmAppeal) == 1


async def test_phone_feedback_requires_target_link_both_numbers_and_real_image(
    client, session, operator
):
    headers = await headers_for(client, operator)
    definition = default_missions()["crm_first"]
    session.add(
        CityAward(
            user_id=operator.id,
            mission_key="crm_first",
            snapshot=definition,
            xp=definition["xp"],
            coins=definition["coins"],
        )
    )
    await session.commit()
    item = await start(client, headers, "crm_phone")
    wrong = appeal_payload(item, comment="Прошу сменить номер. https://[")
    saved = await save(client, headers, wrong)
    assert saved.status_code == 201, saved.text
    first = saved.json()
    feedback = task(first["training_state"], "crm_phone")
    checks = {c["key"]: c for c in feedback["checks"]}
    assert not checks["link"]["ok"]
    assert not checks["numbers"]["ok"]
    assert not checks["attachment"]["ok"]
    assert feedback["state"] == "in_progress" and await count(session, CrmAppeal) == 1
    correct = appeal_payload(item, request_id=wrong["request_id"], revision=first["revision"])
    result = await save(client, headers, correct, appeal_id=first["id"], files=IMAGE)
    assert result.status_code == 200, result.text
    assert len(result.json()["attachments"]) == 1
    assert task(result.json()["training_state"], "crm_phone")["state"] == "passed"
    assert result.json()["status"] == "new"


async def test_explicit_check_request_replay_is_persistent_and_bound(client, session, operator):
    headers = await headers_for(client, operator)
    item = await start(client, headers, "crm_first")
    saved = await save(client, headers, appeal_payload(item, driver_id="wrong-driver"))
    assert saved.status_code == 201, saved.text
    request = {"appeal_id": saved.json()["id"], "request_id": str(uuid4())}
    path = f"{TRAINING}/tasks/crm_first/check"
    first = await client.post(path, headers=headers, json=request)
    again = await client.post(path, headers=headers, json=request)
    assert first.status_code == again.status_code == 200
    assert again.json() == first.json()
    assert task(first.json(), "crm_first")["state"] == "in_progress"
    assert await count(session, CrmTrainingCheck) == 1
    reused = await client.post(f"{TRAINING}/tasks/crm_phone/check", headers=headers, json=request)
    assert reused.status_code == 409


@pytest.mark.parametrize("foreign", [False, True], ids=["before-start", "different-author"])
async def test_stale_or_foreign_appeal_never_earns_credit(client, session, operator, foreign):
    headers = await headers_for(client, operator)
    initial = await training(client, headers)
    item = task(initial, "crm_first")
    author = await make_user(session, login="other-crm-learner") if foreign else operator
    body = appeal_payload(item)
    row = CrmAppeal(
        **{key: value for key, value in body.items() if key not in ("contacted_at", "request_id")},
        request_id=body["request_id"],
        author_id=author.id,
        author_name=author.full_name,
        contacted_at=datetime.now(UTC),
        category_labels=item["category_path"],
        created_at=datetime.now(UTC) - timedelta(minutes=1),
        status="recorded",
    )
    session.add(row)
    await session.commit()
    await start(client, headers, "crm_first")
    checked = await client.post(
        f"{TRAINING}/tasks/crm_first/check",
        headers=headers,
        json={"appeal_id": row.id, "request_id": str(uuid4())},
    )
    assert checked.status_code == 200, checked.text
    state = checked.json()
    feedback = task(state, "crm_first")
    assert state["completed"] == 0 and feedback["state"] == "in_progress"
    failed_key = "author" if foreign else "fresh"
    assert not next(c for c in feedback["checks"] if c["key"] == failed_key)["ok"]
    if foreign:
        assert feedback["appeal_id"] is None


async def test_city_progress_uses_validated_training_not_raw_appeal_count(client, operator):
    headers = await headers_for(client, operator)
    city = (await client.get(CITY, headers=headers)).json()
    welcome = await client.post(
        f"{CITY}/missions/welcome/claim", headers=headers, json={"revision": city["revision"]}
    )
    assert welcome.status_code == 200, welcome.text
    item = task(await training(client, headers), "crm_first")
    raw = appeal_payload(item)
    raw.pop("training_task")
    saved = await save(client, headers, raw)
    assert saved.status_code == 201, saved.text
    after_raw = (await client.get(CITY, headers=headers)).json()
    first = next(m for m in after_raw["missions"] if m["key"] == "crm_first")
    assert first["current"] == 0 and first["state"] != "ready"
    item = await start(client, headers, "crm_first")
    passed = await save(client, headers, appeal_payload(item))
    assert passed.status_code == 201, passed.text
    after_pass = (await client.get(CITY, headers=headers)).json()
    first = next(m for m in after_pass["missions"] if m["key"] == "crm_first")
    assert first["current"] == 1 and first["state"] == "ready"


async def test_existing_city_award_is_preserved_without_fabricated_appeal_proof(
    client, session, operator
):
    headers = await headers_for(client, operator)
    definition = default_missions()["crm_first"]
    legacy = CityAward(
        user_id=operator.id,
        mission_key="crm_first",
        snapshot=definition,
        xp=definition["xp"],
        coins=definition["coins"],
    )
    session.add(legacy)
    await session.commit()
    state = await training(client, headers)
    first = task(state, "crm_first")
    assert first["state"] == "passed" and first["passed_at"]
    assert first["appeal_id"] is None and first["started_at"] is None
    assert first["checks"] == [] and await count(session, CrmTrainingAttempt) == 0
    assert task(state, "crm_phone")["state"] == "available"
    assert (await start(client, headers, "crm_phone"))["state"] == "in_progress"
    preserved = await session.get(CityAward, (operator.id, "crm_first"))
    assert preserved.xp == definition["xp"] and preserved.coins == definition["coins"]


async def test_training_keeps_existing_authentication_and_qr_boundary(client, operator):
    assert (await client.get(TRAINING)).status_code == 401
    headers = auth(await login(client, operator.login))
    assert (await client.get(TRAINING, headers=headers)).status_code == 403
    assert (
        await client.post(f"{TRAINING}/tasks/crm_first/start", headers=headers)
    ).status_code == 403


async def test_older_failed_proof_cannot_replace_latest_or_be_corrected(client, operator):
    headers = await headers_for(client, operator)
    item = await start(client, headers, "crm_first")
    body = appeal_payload(item, driver_id="incorrect-account")
    first = await save(client, headers, body)
    second = await save(client, headers, {**body, "request_id": str(uuid4())})
    assert first.status_code == second.status_code == 201
    latest = second.json()["id"]
    checked = await client.post(
        f"{TRAINING}/tasks/crm_first/check",
        headers=headers,
        json={"appeal_id": first.json()["id"], "request_id": str(uuid4())},
    )
    assert checked.status_code == 200, checked.text
    feedback = task(checked.json(), "crm_first")
    assert feedback["appeal_id"] == latest and feedback["state"] == "in_progress"
    assert not next(c for c in feedback["checks"] if c["key"] == "current")["ok"]
    corrected = appeal_payload(item, revision=first.json()["revision"])
    rejected = await save(client, headers, corrected, appeal_id=first.json()["id"])
    assert rejected.status_code == 409
    assert task(await training(client, headers), "crm_first")["appeal_id"] == latest


async def test_ordinary_record_cannot_be_edited_through_training_patch(client, operator):
    headers = await headers_for(client, operator)
    item = task(await training(client, headers), "crm_first")
    body = appeal_payload(item)
    body.pop("training_task")
    saved = await save(client, headers, body)
    assert saved.status_code == 201, saved.text
    edited = await save(
        client,
        headers,
        {**body, "request_id": str(uuid4()), "revision": saved.json()["revision"]},
        appeal_id=saved.json()["id"],
    )
    assert edited.status_code == 409


async def test_staff_status_change_increments_revision_and_rejects_stale_correction(
    client, session, operator
):
    headers = await headers_for(client, operator)
    item = await start(client, headers, "crm_first")
    body = appeal_payload(item, is_ticket=True)
    saved = await save(client, headers, body)
    assert saved.status_code == 201, saved.text
    record = saved.json()
    staff = await make_user(session, login="crm-training-reviewer", role=Role.TRAINER)
    staff_headers = await headers_for(client, staff)
    updated = await client.patch(
        f"/api/v1/admin/learning/crm/appeals/{record['id']}/status",
        headers=staff_headers,
        json={"status": "in_progress"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["revision"] == record["revision"] + 1
    stale = await save(
        client,
        headers,
        {**body, "request_id": str(uuid4()), "revision": record["revision"]},
        appeal_id=record["id"],
    )
    assert stale.status_code == 409


async def operator_on(client, session, key):
    """A new operator with the tasks before `key` passed and `key` started."""
    user = await make_user(session, login=f"crm-way-{uuid4().hex[:8]}")
    headers = await headers_for(client, user)
    for previous in ("crm_first", "crm_phone", "crm_closed"):
        item = await start(client, headers, previous)
        if previous == key:
            return headers, item
        files = IMAGE if previous == "crm_phone" else None
        result = await save(client, headers, appeal_payload(item), files=files)
        assert result.status_code == 201, result.text


def ten(phone):
    return "".join(ch for ch in phone if ch.isdigit())[-10:]


def written(key, item):
    """What operators write the usual ways, each of which counts."""
    d = item["driver"]
    link = d["link"]
    if key == "crm_first":
        return [
            {"phone": ten(d["phone"])},
            {"phone": "8 " + ten(d["phone"])},
            {"phone": "+7 (775) 610-22-84" if ten(d["phone"]) == "7756102284" else d["phone"]},
            {"license_number": d["license"].lower()},
            {"comment": "Подсказал, что Эконом и Комфорт видны в Таксометре в разделе «Режимы»."},
        ]
    if key == "crm_phone":
        new = d["new_phone"]
        return [
            {"comment": f"Старый номер {ten(d['phone'])}, новый {ten(new)}. {link}"},
            {"comment": f"Старый 8{ten(d['phone'])}, новый 8{ten(new)}.\n{link}"},
            {"comment": f"Старый {d['phone']} новый {new} {link.replace('/details', '')}"},
            {"comment": f"Старый {d['phone']} новый {new} {link.replace('https://', '')}"},
            {"comment": f"Старый {d['phone']} новый {new} ({link.split('&lang')[0]})."},
        ]
    return [
        {"comment": f"Водитель просит снять ограничение на наличные. {link}"},
        {"comment": f"ЛИМИТ мешает работать, просит убрать.\n{link.replace('https', 'http')}"},
    ]


@pytest.mark.parametrize("key", ["crm_first", "crm_phone", "crm_closed"])
async def test_the_usual_ways_operators_write_count_as_the_hints_say(
    client, session, operator, key
):
    headers, item = await operator_on(client, session, key)
    for changes in written(key, item):
        # Each way on a task not passed yet: a new operator each time.
        headers, item = await operator_on(client, session, key)
        files = IMAGE if key == "crm_phone" else None
        result = await save(client, headers, appeal_payload(item, **changes), files=files)
        assert result.status_code == 201, result.text
        done = task(result.json()["training_state"], key)
        failed = [c for c in done["checks"] if not c["ok"]]
        assert done["state"] == "passed", (changes, failed)


async def test_failed_checks_say_what_is_wrong_and_the_task_shows_the_driver_type(
    client, session, operator
):
    headers, item = await operator_on(client, session, "crm_phone")
    d = item["driver"]
    assert d["type"] == "Самозанятый водитель" == item["category_path"][1]
    # The speech is the driver's alone; what to do is the goal.
    assert "Создай" not in item["speech"] and "Создай тикет" in item["goal"]
    wrong = appeal_payload(
        item,
        phone="+7 700 000 00 00",
        channel="Чат",
        is_ticket=False,
        comment=f"Старый {d['phone']}. Аккаунт {d['id']}",
    )
    result = await save(client, headers, wrong, files=IMAGE)
    assert result.status_code == 201, result.text
    feedback = task(result.json()["training_state"], "crm_phone")
    why = {c["key"]: c["message"] for c in feedback["checks"] if not c["ok"]}
    assert set(why) == {"phone", "channel", "ticket", "link", "numbers"}
    assert d["phone"] in why["phone"]
    assert "«Звонок»" in why["channel"]
    assert "только ID" in why["link"]
    assert "новый номер" in why["numbers"] and d["new_phone"] in why["numbers"]
    steps = {s["key"]: s for s in feedback["steps"]}
    assert steps["category"]["label"] == "Выбери полную категорию и тип записи"
    assert steps["category"]["status"] == "failed"
    no_park = appeal_payload(
        item,
        request_id=wrong["request_id"],
        comment=f"{d['phone']} {d['new_phone']} " + d["link"].split("?")[0],
    )
    again = await save(
        client,
        headers,
        {**no_park, "revision": result.json()["revision"]},
        appeal_id=result.json()["id"],
    )
    assert again.status_code == 200, again.text
    link = next(
        c for c in task(again.json()["training_state"], "crm_phone")["checks"] if c["key"] == "link"
    )
    assert not link["ok"] and "park_id" in link["message"]
