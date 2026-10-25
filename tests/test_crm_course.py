"""The agreed course checks persisted work, owned call captures and ticket actions."""

import json
import struct
import zlib
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models.city import CityAward
from app.models.crm import CrmTicketEvent
from app.models.crm_training import CrmTrainingAttempt
from app.models.enums import Role
from app.services.crm_catalog import category_id
from app.services.crm_course import KEYS
from tests.conftest import auth, login, login_with_work_sites, make_user

pytestmark = pytest.mark.asyncio
BASE = "/api/v1/learning/crm"
COURSE = BASE + "/course"


def task(state, key):
    return next(t for t in state["tasks"] if t["key"] == key)


async def headers(client, session, name="course-operator"):
    user = await make_user(session, login=name)
    return user, auth(await login_with_work_sites(client, user.login))


async def start(client, h, key):
    r = await client.post(f"{COURSE}/tasks/{key}/start", headers=h)
    assert r.status_code == 200, r.text
    return task(r.json(), key)


async def action(client, h, key, **body):
    return await client.post(f"{COURSE}/tasks/{key}/actions", headers=h, json=body)


async def finish_intro(client, h):
    t = await start(client, h, KEYS[0])
    r = await action(client, h, KEYS[0], action="list")
    assert r.status_code == 200
    appeal = await client.get(f"{BASE}/appeals/{t['appeal_id']}", headers=h)
    assert appeal.json()["ticket_id"] == t["ticket_id"]
    r = await client.get(f"{BASE}/tickets/{t['ticket_id']}", headers=h)
    assert r.status_code == 200, r.text
    state = (await client.get(COURSE, headers=h)).json()
    assert task(state, KEYS[0])["state"] == "passed"


def png(color=240):
    def chunk(kind, data):
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1440, 720, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress((b"\x00" + bytes([color]) * 1440 * 3) * 720))
        + chunk(b"IEND", b"")
    )


def payload(t, **changes):
    d = t["driver"]
    path = t["category_path"]
    return {
        "request_id": str(uuid4()),
        "training_task": t["key"],
        "channel": "Звонок",
        "phone": d["phone"],
        "license_number": d["license"],
        "driver_id": "",
        "contacted_at": "2026-10-17T12:00:00Z",
        "park": d["park"],
        "city": d["city"],
        "category_ids": [category_id(path[: i + 1]) for i in range(len(path))],
        "details": {},
        "comment": f"Прошу сменить номер на {d['new_phone']}. {d['link']}",
        "is_ticket": True,
        **changes,
    }


async def capture(client, h, t, data=None):
    r = await action(client, h, t["key"], action="inspect", driver_id=t["driver"]["id"])
    assert r.status_code == 200, r.text
    image = data or png()
    r = await client.post(
        f"{COURSE}/tasks/{t['key']}/capture",
        headers=h,
        files={"file": ("call.png", image, "image/png")},
    )
    assert r.status_code == 200, r.text
    return image


async def save_phone(client, h, t, data, **changes):
    r = await client.post(
        f"{BASE}/appeals",
        headers=h,
        data={"payload": json.dumps(payload(t, **changes))},
        files={"files": ("call.png", data, "image/png")},
    )
    assert r.status_code == 201, r.text
    return r.json()


async def finish_phone(client, h, key=KEYS[1]):
    t = await start(client, h, key)
    data = await capture(client, h, t)
    saved = await save_phone(client, h, t, data)
    # The guided lesson ends at the linked ticket; the practice ends once the right appeal is saved.
    assert task(saved["training_state"], key)["state"] == (
        "passed" if key == KEYS[4] else "in_progress"
    )
    assert all(c["ok"] for c in task(saved["training_state"], key)["checks"])
    await client.get(f"{BASE}/appeals/{saved['id']}", headers=h)
    opened = await client.get(f"{BASE}/tickets/{saved['ticket_id']}", headers=h)
    assert opened.status_code == 200, opened.text
    return t, saved


async def finish_mismatch(client, h):
    t = await start(client, h, KEYS[2])
    await action(client, h, t["key"], action="inspect", driver_id=t["driver"]["id"])
    r = await action(
        client, h, t["key"], action="advice", choices=["registered_call", "taxi_pro", "whatsapp"]
    )
    assert r.status_code == 200 and task(r.json(), KEYS[2])["state"] == "passed"


async def ticket_action(client, h, ticket, name, comment="", request_id=None, files=None, **extra):
    body = {
        "request_id": request_id or str(uuid4()),
        "revision": ticket["revision"],
        "action": name,
        "comment": comment,
        **extra,
    }
    return await client.post(
        f"{BASE}/tickets/{ticket['id']}/actions",
        headers=h,
        data={"payload": json.dumps(body)},
        files=files,
    )


async def test_course_access_is_qr_protected_and_sequential(client, session):
    user = await make_user(session, login="course-no-access")
    h = auth(await login(client, user.login))
    assert (await client.get(COURSE, headers=h)).status_code == 403
    h = auth(await login_with_work_sites(client, user.login))
    first = (await client.get(COURSE, headers=h)).json()
    assert first["completed"] == 0
    assert [t["state"] for t in first["tasks"]] == ["available"] + ["locked"] * 4
    assert (await client.post(f"{COURSE}/tasks/{KEYS[1]}/start", headers=h)).status_code == 409
    a = await start(client, h, KEYS[0])
    b = await start(client, h, KEYS[0])
    assert a["appeal_id"] == b["appeal_id"] and a["ticket_id"] == b["ticket_id"]
    assert (await action(client, h, KEYS[0], action="ticket")).status_code == 422
    assert (await client.get(f"{BASE}/tickets/{a['ticket_id']}", headers=h)).status_code == 409
    await finish_intro(client, h)


async def test_phone_uses_current_field_new_comment_and_owned_two_window_capture(client, session):
    _, h = await headers(client, session)
    await finish_intro(client, h)
    t = await start(client, h, KEYS[1])
    assert (
        await action(client, h, t["key"], action="inspect", driver_id="another-driver")
    ).status_code == 422
    assert (
        await client.post(
            f"{COURSE}/tasks/{t['key']}/capture",
            headers=h,
            files={"file": ("call.png", png(), "image/png")},
        )
    ).status_code == 409
    data = await capture(client, h, t)
    saved = await save_phone(client, h, t, data)
    checked = task(saved["training_state"], t["key"])
    assert all(c["ok"] for c in checked["checks"]), checked["checks"]
    assert checked["state"] == "in_progress"  # the separate ticket must actually open
    await client.get(f"{BASE}/appeals/{saved['id']}", headers=h)
    await client.get(f"{BASE}/tickets/{saved['ticket_id']}", headers=h)
    restored = (await client.get(COURSE, headers=h)).json()
    checked = task(restored, t["key"])
    assert checked["state"] == "passed" and checked["capture"]["data_url"].startswith(
        "data:image/png;base64,"
    )
    assert all(s["status"] == "passed" for s in checked["steps"])


async def test_wrong_phone_and_random_image_remain_fixable_saved_work(client, session):
    _, h = await headers(client, session)
    await finish_intro(client, h)
    t = await start(client, h, KEYS[1])
    data = await capture(client, h, t)
    saved = await save_phone(client, h, t, png(10), phone=t["driver"]["new_phone"])
    errors = {c["key"] for c in task(saved["training_state"], t["key"])["checks"] if not c["ok"]}
    assert errors == {"phone", "capture"}
    assert saved["ticket_id"] is None
    update = payload(
        t, revision=saved["revision"], remove_attachment_ids=[saved["attachments"][0]["id"]]
    )
    r = await client.patch(
        f"{BASE}/appeals/{saved['id']}",
        headers=h,
        data={"payload": json.dumps(update)},
        files={"files": ("call.png", data, "image/png")},
    )
    assert r.status_code == 200, r.text
    assert r.json()["id"] == saved["id"] and r.json()["ticket_id"]


async def test_mismatch_requires_all_three_options_and_disallows_new_appeal(client, session):
    _, h = await headers(client, session)
    await finish_intro(client, h)
    await finish_phone(client, h)
    t = await start(client, h, KEYS[2])
    assert t["incoming_phone"] != t["driver"]["phone"]
    await action(client, h, t["key"], action="inspect", driver_id=t["driver"]["id"])
    for choices in (["registered_call"], ["registered_call", "taxi_pro", "whatsapp", "change_now"]):
        assert (
            await action(client, h, t["key"], action="advice", choices=choices)
        ).status_code == 422
    r = await client.post(f"{BASE}/appeals", headers=h, data={"payload": json.dumps(payload(t))})
    assert r.status_code == 409
    await finish_mismatch(client, h)


async def test_rework_uses_ticket_number_real_actions_comment_and_idempotency(client, session):
    user, h = await headers(client, session)
    await finish_intro(client, h)
    await finish_phone(client, h)
    await finish_mismatch(client, h)
    t = await start(client, h, KEYS[3])
    await client.get(f"{BASE}/appeals/{t['appeal_id']}", headers=h)
    ticket = (await client.get(f"{BASE}/tickets/{t['ticket_id']}", headers=h)).json()
    assert ticket["status"] == "awaiting_reply" and "ссылку" in ticket["events"][0]["comment"]
    assert (
        await ticket_action(client, h, ticket, "comment", t["driver"]["link"])
    ).status_code == 409
    rid = str(uuid4())
    r = await ticket_action(client, h, ticket, "moderate", request_id=rid)
    assert r.status_code == 200, r.text
    again = await ticket_action(client, h, ticket, "moderate", request_id=rid)
    assert again.status_code == 200 and again.json()["revision"] == r.json()["revision"]
    assert (await ticket_action(client, h, ticket, "rework")).status_code == 409  # stale tab
    ticket = r.json()
    r = await ticket_action(client, h, ticket, "rework")
    assert r.status_code == 200, r.text
    ticket = r.json()
    assert (await ticket_action(client, h, ticket, "comment", "Просто текст")).status_code == 422
    draft_body = {
        "draft_key": None,
        "revision": 0,
        "form": {"request_id": str(uuid4()), "comment": t["driver"]["link"]},
    }
    draft_saved = await client.put(
        f"{BASE}/tickets/{ticket['id']}/draft",
        headers=h,
        data={"payload": json.dumps(draft_body)},
        files={"files": ("proof.png", png(), "image/png")},
    )
    assert draft_saved.status_code == 200, draft_saved.text
    draft = draft_saved.json()
    restored = (await client.get(f"{BASE}/tickets/{ticket['id']}/draft", headers=h)).json()
    assert restored["form"]["comment"] == t["driver"]["link"] and len(restored["attachments"]) == 1
    stale = await client.put(
        f"{BASE}/tickets/{ticket['id']}/draft", headers=h, data={"payload": json.dumps(draft_body)}
    )
    assert stale.status_code == 409
    rid = str(uuid4())
    r = await ticket_action(
        client,
        h,
        ticket,
        "comment",
        t["driver"]["link"],
        request_id=rid,
        draft_key=draft["draft_key"],
        draft_revision=draft["revision"],
    )
    assert r.status_code == 200, r.text
    assert r.json()["events"][-1]["attachments"]
    assert (await client.get(f"{BASE}/tickets/{ticket['id']}/draft", headers=h)).json()[
        "draft_key"
    ] is None
    again = await ticket_action(client, h, ticket, "comment", t["driver"]["link"], request_id=rid)
    assert again.status_code == 200
    saved = task((await client.get(COURSE, headers=h)).json(), KEYS[3])
    assert saved["state"] == "passed" and all(s["status"] == "passed" for s in saved["steps"])
    events = list(
        await session.scalars(
            select(CrmTicketEvent).where(CrmTicketEvent.ticket_id == ticket["id"])
        )
    )
    assert len(events) == 4
    _, other = await headers(client, session, "course-other")
    assert (await client.get(f"{BASE}/tickets/{ticket['id']}", headers=other)).status_code == 404
    file_id = r.json()["events"][-1]["attachments"][0]["id"]
    assert (
        await client.get(f"{BASE}/ticket-attachments/{file_id}", headers=other)
    ).status_code == 404
    assert (await client.get(f"{BASE}/ticket-attachments/{file_id}", headers=h)).content == png()
    practice, _ = await finish_phone(client, h, KEYS[4])
    phone = task((await client.get(COURSE, headers=h)).json(), KEYS[1])["driver"]["new_phone"]
    # The driver asks for the practice's own new number, the one the check expects.
    assert practice["driver"]["new_phone"] != phone
    assert practice["driver"]["new_phone"] in practice["speech"] and phone not in practice["speech"]
    state = (await client.get(COURSE, headers=h)).json()
    assert state["completed"] == 5 and state["active_task"] is None


async def test_a_lost_learner_starts_the_lesson_over_with_a_new_ticket(client, session):
    user, h = await headers(client, session)
    await finish_intro(client, h)
    await finish_phone(client, h)
    await finish_mismatch(client, h)
    first = await start(client, h, KEYS[3])
    await client.get(f"{BASE}/appeals/{first['appeal_id']}", headers=h)
    ticket = (await client.get(f"{BASE}/tickets/{first['ticket_id']}", headers=h)).json()
    assert ticket["in_lesson"] is True
    assert (await ticket_action(client, h, ticket, "moderate")).status_code == 200
    # A passed lesson stays passed; a lesson never started has nothing to start over.
    for key in (KEYS[2], KEYS[4]):
        assert (await client.post(f"{COURSE}/tasks/{key}/restart", headers=h)).status_code == 409
    r = await client.post(f"{COURSE}/tasks/{KEYS[3]}/restart", headers=h)
    assert r.status_code == 200, r.text
    again = task(r.json(), KEYS[3])
    assert again["state"] == "in_progress" and again["appeal_id"] != first["appeal_id"]
    assert again["ticket_id"] != first["ticket_id"]
    assert [s["status"] for s in again["steps"]] == ["pending"] * 5
    # The old appeal stays in the shared history as an ordinary one: its ticket is no lesson's.
    old = (await client.get(f"{BASE}/appeals/{first['appeal_id']}", headers=h)).json()
    assert old["training_task"] is None
    stale = (await client.get(f"{BASE}/tickets/{first['ticket_id']}", headers=h)).json()
    assert stale["in_lesson"] is False
    assert (await ticket_action(client, h, stale, "rework")).status_code == 404
    await client.get(f"{BASE}/appeals/{again['appeal_id']}", headers=h)
    fresh = (await client.get(f"{BASE}/tickets/{again['ticket_id']}", headers=h)).json()
    assert fresh["in_lesson"] is True and fresh["status"] == "awaiting_reply"
    assert (await ticket_action(client, h, fresh, "moderate")).status_code == 200
    attempts = select(func.count()).select_from(CrmTrainingAttempt).where(
        CrmTrainingAttempt.user_id == user.id, CrmTrainingAttempt.task_key == KEYS[3]
    )
    assert await session.scalar(attempts) == 1


async def test_staff_take_the_course_again_and_learners_keep_their_lessons(client, session):
    trainer = await make_user(session, login="course-trainer", role=Role.TRAINER)
    h = auth(await login_with_work_sites(client, trainer.login))
    await finish_intro(client, h)
    t = await start(client, h, KEYS[1])
    await capture(client, h, t)
    r = await client.post(f"{COURSE}/reset", headers=h)
    assert r.status_code == 200, r.text
    state = r.json()
    assert state["completed"] == 0 and state["active_task"] is None
    assert task(state, KEYS[0])["state"] == "available"
    assert task(state, KEYS[1])["state"] == "locked" and task(state, KEYS[1])["capture"] is None
    count = select(func.count()).select_from(CrmTrainingAttempt).where(
        CrmTrainingAttempt.user_id == trainer.id
    )
    assert await session.scalar(count) == 0
    assert (await start(client, h, KEYS[0]))["state"] == "in_progress"
    _, learner = await headers(client, session, "course-learner")
    await finish_intro(client, learner)
    assert (await client.post(f"{COURSE}/reset", headers=learner)).status_code == 403
    assert task((await client.get(COURSE, headers=learner)).json(), KEYS[0])["state"] == "passed"


async def test_practice_ends_at_saved_appeal_and_stays_fixable(client, session):
    user, h = await headers(client, session)
    for key in KEYS[:4]:
        session.add(
            CrmTrainingAttempt(
                user_id=user.id, task_key=key, revision=2, snapshot={"work": {}}, phase="passed"
            )
        )
    await session.commit()
    t = await start(client, h, KEYS[4])
    steps = [s["key"] for s in t["steps"]]
    assert steps == ["form", "save"]
    data = await capture(client, h, t)
    saved = await save_phone(client, h, t, data, phone=t["driver"]["new_phone"])
    state = task(saved["training_state"], KEYS[4])
    assert state["state"] == "in_progress" and saved["ticket_id"] is None
    assert {c["key"] for c in state["checks"] if not c["ok"]} == {"phone"}
    update = payload(t, revision=saved["revision"])
    r = await client.patch(
        f"{BASE}/appeals/{saved['id']}", headers=h, data={"payload": json.dumps(update)}
    )
    assert r.status_code == 200, r.text
    # No ticket to open: the right saved appeal completes the practice.
    done = task(r.json()["training_state"], KEYS[4])
    assert done["state"] == "passed" and all(s["status"] == "passed" for s in done["steps"])
    assert r.json()["ticket_id"]
    assert (await client.get(COURSE, headers=h)).json()["completed"] == 5


async def test_old_city_award_does_not_skip_new_course(client, session):
    user, h = await headers(client, session)
    session.add(CityAward(user_id=user.id, mission_key="crm_phone", xp=0, coins=0, snapshot={}))
    await session.commit()
    state = (await client.get(COURSE, headers=h)).json()
    assert state["completed"] == 0


async def test_call_form_and_retaken_screenshot_are_persisted(client, session):
    _, h = await headers(client, session)
    await finish_intro(client, h)
    t = await start(client, h, KEYS[1])
    result = await action(
        client, h, t["key"], action="call_form", note=t["driver"]["link"], call_result="Перезвонить"
    )
    assert result.status_code == 200, result.text
    restored = task((await client.get(COURSE, headers=h)).json(), t["key"])
    assert restored["call_form"] == {"note": t["driver"]["link"], "result": "Перезвонить"}
    first = await capture(client, h, t, png(100))
    old = task((await client.get(COURSE, headers=h)).json(), t["key"])["capture"]
    newest = await capture(client, h, t, png(200))
    new = task((await client.get(COURSE, headers=h)).json(), t["key"])["capture"]
    assert old["id"] == new["id"] and old["name"] != new["name"]
    saved = await save_phone(client, h, t, first)
    assert not next(
        c for c in task(saved["training_state"], t["key"])["checks"] if c["key"] == "capture"
    )["ok"]
    update = payload(
        t, revision=saved["revision"], remove_attachment_ids=[saved["attachments"][0]["id"]]
    )
    fixed = await client.patch(
        f"{BASE}/appeals/{saved['id']}",
        headers=h,
        data={"payload": json.dumps(update)},
        files={"files": ("new.png", newest, "image/png")},
    )
    assert fixed.status_code == 200, fixed.text
    assert all(c["ok"] for c in task(fixed.json()["training_state"], t["key"])["checks"])
    # Replacing a shot after a valid save invalidates that proof until the attachment is replaced.
    await capture(client, h, t, png(50))
    after_retake = task((await client.get(COURSE, headers=h)).json(), t["key"])
    assert not next(c for c in after_retake["checks"] if c["key"] == "capture")["ok"]
    await client.get(f"{BASE}/appeals/{fixed.json()['id']}", headers=h)
    await client.get(f"{BASE}/tickets/{fixed.json()['ticket_id']}", headers=h)
    assert task((await client.get(COURSE, headers=h)).json(), t["key"])["state"] == "in_progress"
