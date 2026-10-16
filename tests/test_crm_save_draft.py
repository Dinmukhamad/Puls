"""Final submission transfers stored files atomically and cannot revive consumed work."""

import json

import pytest
from sqlalchemy import func, select

from app.models.crm import CrmAppeal, CrmAttachment
from app.models.crm_draft import CrmDraft, CrmDraftAttachment
from tests.test_crm_training import BASE, IMAGE, appeal_payload, headers_for, save, start

pytestmark = pytest.mark.asyncio


async def test_final_save_transfers_draft_binary_once_and_rejects_both_stale_writer_shapes(
    client, session, operator
):
    headers = await headers_for(client, operator)
    item = await start(client, headers, "crm_first")
    payload = appeal_payload(item)
    write = {
        "task": "crm_first",
        "draft_key": None,
        "revision": 0,
        "form": {key: value for key, value in payload.items() if key != "training_task"},
    }
    draft_response = await client.put(
        BASE + "/draft", headers=headers, data={"payload": json.dumps(write)}, files=IMAGE
    )
    assert draft_response.status_code == 200, draft_response.text
    draft = draft_response.json()
    final = {**payload, "draft_key": draft["draft_key"], "draft_revision": draft["revision"]}
    result = await save(client, headers, final)  # No upload: the binary lives on the server.
    assert result.status_code == 201, result.text
    record = result.json()
    assert len(record["attachments"]) == 1
    assert record["training_state"]["completed"] == 1
    assert await session.scalar(select(func.count()).select_from(CrmDraft)) == 0
    assert await session.scalar(select(func.count()).select_from(CrmDraftAttachment)) == 0
    assert await session.scalar(select(func.count()).select_from(CrmAttachment)) == 1
    replay = await save(client, headers, final)
    assert replay.status_code == 201 and replay.json()["id"] == record["id"]
    assert await session.scalar(select(func.count()).select_from(CrmAppeal)) == 1
    for stale in (write, {**write, "draft_key": draft["draft_key"], "revision": 1}):
        rejected = await client.put(
            BASE + "/draft", headers=headers, data={"payload": json.dumps(stale)}
        )
        assert rejected.status_code == 409, rejected.text
    assert (await client.get(BASE + "/draft?task=crm_first", headers=headers)).json()["form"] == {}


async def test_failed_save_is_durable_and_optimistic_correction_retains_attachment(
    client, session, operator
):
    headers = await headers_for(client, operator)
    item = await start(client, headers, "crm_first")
    payload = appeal_payload(item, driver_id="wrong-account")
    failed = await save(client, headers, payload, files=IMAGE)
    assert failed.status_code == 201
    record = failed.json()
    write = {
        "task": "crm_first",
        "draft_key": None,
        "revision": 0,
        "appeal_id": record["id"],
        "form": {"comment": "Проверил доступные тарифы водителя"},
    }
    draft_response = await client.put(
        BASE + "/draft", headers=headers, data={"payload": json.dumps(write)}
    )
    assert draft_response.status_code == 200, draft_response.text
    draft = draft_response.json()
    correction = appeal_payload(
        item,
        revision=record["revision"],
        draft_key=draft["draft_key"],
        draft_revision=draft["revision"],
    )
    stale = await save(client, headers, {**correction, "revision": 10}, appeal_id=record["id"])
    assert stale.status_code == 409
    assert (await client.get(BASE + "/draft?task=crm_first", headers=headers)).json()["draft_key"]
    accepted = await save(client, headers, correction, appeal_id=record["id"])
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["training_state"]["completed"] == 1
    assert accepted.json()["attachments"] == record["attachments"]
    assert accepted.json()["revision"] == record["revision"] + 1
    replay = await save(client, headers, correction, appeal_id=record["id"])
    assert replay.status_code == 200
    assert replay.json()["revision"] == accepted.json()["revision"]
    assert (await client.get(BASE + "/draft?task=crm_first", headers=headers)).json()["form"] == {}
