"""The agreed course checks persisted work, owned call captures and ticket actions."""

import json
import struct
import zlib
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.city import CityAward
from app.models.crm import CrmTicketEvent
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
    assert task(saved["training_state"], key)["state"] == "in_progress"
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
    await finish_phone(client, h, KEYS[4])
    state = (await client.get(COURSE, headers=h)).json()
    assert state["completed"] == 5 and state["active_task"] is None


async def test_old_city_award_does_not_skip_new_course(client, session):
    user, h = await headers(client, session)
    session.add(CityAward(user_id=user.id, mission_key="crm_phone", xp=0, coins=0, snapshot={}))
    await session.commit()
    state = (await client.get(COURSE, headers=h)).json()
    assert state["completed"] == 0
