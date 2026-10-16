"""Private durable files and CAS must survive reloads without losing saved work."""

import json
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select

from app.api.v1.crm_draft import download_attachment
from app.db.session import SessionLocal
from app.models.crm import CrmAppeal, CrmAttachment
from app.models.crm_draft import CrmDraft, CrmDraftAttachment
from app.models.crm_training import CrmTrainingAttempt
from app.schemas.crm_draft import DraftPutInput
from app.services import crm_draft
from app.services.learning import lock_learner
from tests.conftest import auth, make_user
from tests.conftest import login_with_work_sites as login

pytestmark = pytest.mark.asyncio
PNG = b"\x89PNG\r\n\x1a\n" + b"durable draft"


def body(*, revision=0, key=None, task=None, form=None, **kwargs):
    return DraftPutInput.model_validate(
        {
            "task": task,
            "draft_key": key,
            "revision": revision,
            "form": form or {},
            **kwargs,
        }
    )


async def save(session, user, input_body, files=None):
    row = await crm_draft.put_draft(session, user, input_body, files or [])
    result = await crm_draft.describe(session, row)
    await session.commit()
    return result


async def test_reload_partial_merge_and_independent_task_scopes(session, operator):
    initial = await crm_draft.get_draft(session, operator, "crm_phone")
    assert initial["revision"] == 0 and initial["draft_key"] is None
    first = await save(
        session,
        operator,
        body(
            task="crm_phone",
            form={
                "phone": "+7 ",
                "contacted_at": "2026-10-15T12:",
                "category_ids": [],
                "details": {"callback": ""},
            },
        ),
    )
    await save(session, operator, body(form={"comment": "Общее обращение"}))
    second = await save(
        session,
        operator,
        body(
            task="crm_phone",
            key=first["draft_key"],
            revision=first["revision"],
            form={"license_number": "Ещё не закончен"},
        ),
    )
    assert second["revision"] == 2
    async with SessionLocal() as fresh:
        restored = await crm_draft.get_draft(fresh, operator, "crm_phone")
        assert restored["form"] == {
            "phone": "+7 ",
            "contacted_at": "2026-10-15T12:",
            "category_ids": [],
            "details": {"callback": ""},
            "license_number": "Ещё не закончен",
        }
        assert (await crm_draft.get_draft(fresh, operator))["form"]["comment"]
        assert (await crm_draft.get_draft(fresh, operator, "crm_first"))["draft_key"] is None


async def test_stale_revision_and_key_after_reset_cannot_overwrite_new_draft(session, operator):
    old = await save(session, operator, body(form={"comment": "Сохранено"}))
    with pytest.raises(HTTPException) as stale:
        await crm_draft.put_draft(
            session,
            operator,
            body(key=old["draft_key"], revision=0, form={"comment": "Устарело"}),
            [],
        )
    assert stale.value.status_code == 409
    await session.rollback()
    await session.refresh(operator)
    await crm_draft.delete_draft(session, operator)
    await session.commit()
    new = await save(session, operator, body(form={"comment": "Новый черновик"}))
    assert new["draft_key"] != old["draft_key"]
    with pytest.raises(HTTPException) as reset:
        await crm_draft.put_draft(
            session,
            operator,
            body(key=old["draft_key"], revision=new["revision"], form={"comment": "Устарело"}),
            [],
        )
    assert reset.value.status_code == 409
    await session.rollback()
    await session.refresh(operator)
    assert (await crm_draft.get_draft(session, operator))["form"]["comment"] == "Новый черновик"


async def test_binary_files_are_private_durable_and_deleted_with_own_scope(session, operator):
    saved = await save(session, operator, body(task="crm_first"), [("скрин.png", "image/png", PNG)])
    file = saved["attachments"][0]
    other = await make_user(session, login="draft-other")
    async with SessionLocal() as fresh:
        downloaded = await download_attachment(file["id"], fresh, operator)
        assert downloaded.body == PNG
        assert downloaded.headers["x-content-type-options"] == "nosniff"
        assert "attachment;" in downloaded.headers["content-disposition"]
        assert (await crm_draft.get_draft(fresh, other, "crm_first"))["draft_key"] is None
        with pytest.raises(HTTPException) as missing:
            await download_attachment(file["id"], fresh, other)
        assert missing.value.status_code == 404
    await crm_draft.delete_draft(session, other, "crm_first")
    await session.commit()
    assert await session.scalar(select(func.count()).select_from(CrmDraftAttachment)) == 1
    await crm_draft.delete_draft(session, operator, "crm_first")
    await session.commit()
    assert await session.scalar(select(func.count()).select_from(CrmDraftAttachment)) == 0
    assert await session.scalar(select(func.count()).select_from(CrmDraft)) == 0


async def test_file_limits_apply_to_aggregate_and_replacement_is_atomic(session, operator):
    files = [(f"{i}.png", "image/png", PNG) for i in range(5)]
    saved = await save(session, operator, body(), files)
    with pytest.raises(HTTPException) as too_many:
        await crm_draft.put_draft(
            session,
            operator,
            body(key=saved["draft_key"], revision=saved["revision"]),
            [("six.png", "image/png", PNG)],
        )
    assert too_many.value.status_code == 422
    await session.rollback()
    await session.refresh(operator)
    saved = await save(
        session,
        operator,
        body(
            key=saved["draft_key"],
            revision=saved["revision"],
            remove_attachment_ids=[saved["attachments"][0]["id"]],
        ),
        [("replacement.png", "image/png", PNG)],
    )
    assert len(saved["attachments"]) == 5
    assert saved["attachments"][-1]["name"] == "replacement.png"
    await crm_draft.delete_draft(session, operator)
    await session.commit()
    big = b"x" * (2 * 1024 * 1024)
    saved = await save(
        session, operator, body(), [(f"{i}.png", "image/png", big) for i in range(4)]
    )
    with pytest.raises(HTTPException) as too_large:
        await crm_draft.put_draft(
            session,
            operator,
            body(key=saved["draft_key"], revision=saved["revision"]),
            [("fifth.png", "image/png", PNG)],
        )
    assert too_large.value.status_code == 422
    await session.rollback()
    await session.refresh(operator)
    assert (await crm_draft.get_draft(session, operator))["revision"] == saved["revision"]


async def test_load_and_consume_join_caller_transaction_and_require_exact_scope(session, operator):
    saved = await save(session, operator, body(task="crm_phone"), [("proof.png", "image/png", PNG)])
    await lock_learner(session, operator.id)
    for task, key, revision in [
        ("crm_first", saved["draft_key"], 1),
        ("crm_phone", str(uuid4()), 1),
        ("crm_phone", saved["draft_key"], 0),
    ]:
        with pytest.raises(HTTPException) as conflict:
            await crm_draft.load_for_save(session, operator, key, revision, task)
        assert conflict.value.status_code == 409
    draft, uploads = await crm_draft.load_for_save(
        session, operator, saved["draft_key"], saved["revision"], "crm_phone"
    )
    assert uploads == [("proof.png", "image/png", PNG)]
    await crm_draft.consume_loaded(session, draft)
    await session.rollback()  # E.g. saving the final appeal or its validation failed.
    await session.refresh(operator)
    assert (await crm_draft.get_draft(session, operator, "crm_phone"))["draft_key"] == saved[
        "draft_key"
    ]
    await lock_learner(session, operator.id)
    draft, _ = await crm_draft.load_for_save(
        session, operator, saved["draft_key"], saved["revision"], "crm_phone"
    )
    await crm_draft.consume_loaded(session, draft)
    await session.commit()
    assert (await crm_draft.get_draft(session, operator, "crm_phone"))["draft_key"] is None
    assert await session.scalar(select(func.count()).select_from(CrmDraftAttachment)) == 0


async def test_reconciled_duplicate_file_does_not_double_after_lost_response(session, operator):
    upload = ("proof.png", "image/png", PNG)
    first = await save(session, operator, body(task="crm_phone"), [upload])
    with pytest.raises(HTTPException) as lost_response:
        await crm_draft.put_draft(session, operator, body(task="crm_phone"), [upload])
    assert lost_response.value.status_code == 409
    await session.rollback()
    await session.refresh(operator)
    current = await crm_draft.get_draft(session, operator, "crm_phone")
    retried = await save(
        session,
        operator,
        body(
            task="crm_phone",
            key=current["draft_key"],
            revision=current["revision"],
            form={"comment": "Сохранить локальные изменения"},
        ),
        [upload, upload],
    )
    assert retried["attachments"] == first["attachments"]
    changed = await save(
        session,
        operator,
        body(
            task="crm_phone",
            key=retried["draft_key"],
            revision=retried["revision"],
        ),
        [("different-name.png", "image/png", PNG), ("proof.png", "image/png", PNG + b"changed")],
    )
    assert len(changed["attachments"]) == 3


async def test_editing_context_is_scoped_retained_and_passed_proof_is_immutable(session, operator):
    appeal = CrmAppeal(
        request_id=str(uuid4()),
        author_id=operator.id,
        author_name=operator.full_name,
        channel="Звонок",
        phone="+77000000001",
        license_number="DRAFT-1",
        driver_id="",
        contacted_at=datetime.now(UTC),
        park="iTaxi",
        city="Алматы",
        category_ids=[],
        category_labels=[],
        details={},
        comment="Нужны исправления",
        is_ticket=True,
        status="new",
        training_task="crm_phone",
    )
    session.add(appeal)
    await session.flush()
    original = CrmAttachment(
        appeal_id=appeal.id, name="old.png", mime="image/png", size=len(PNG), data=PNG
    )
    session.add(original)
    await session.commit()
    appeal_id, file_id = appeal.id, original.id
    with pytest.raises(HTTPException) as wrong_scope:
        await crm_draft.put_draft(
            session,
            operator,
            body(
                task="crm_first",
                appeal_id=appeal_id,
            ),
            [],
        )
    assert wrong_scope.value.status_code == 409
    await session.rollback()
    await session.refresh(operator)
    saved = await save(
        session,
        operator,
        body(
            task="crm_phone",
            appeal_id=appeal_id,
            remove_appeal_attachment_ids=[file_id],
        ),
    )
    merged = await save(
        session,
        operator,
        body(
            task="crm_phone",
            key=saved["draft_key"],
            revision=saved["revision"],
            form={"comment": "Исправляю"},
        ),
    )
    assert merged["appeal_id"] == appeal_id
    assert merged["remove_appeal_attachment_ids"] == [file_id]
    session.add(
        CrmTrainingAttempt(
            user_id=operator.id,
            task_key="crm_phone",
            snapshot={},
            phase="passed",
            appeal_id=appeal_id,
        )
    )
    await session.commit()
    with pytest.raises(HTTPException) as passed:
        await crm_draft.put_draft(
            session,
            operator,
            body(
                task="crm_phone",
                key=merged["draft_key"],
                revision=merged["revision"],
                form={"comment": "Переписать успешное доказательство"},
            ),
            [],
        )
    assert passed.value.status_code == 409
    await session.rollback()
    await session.refresh(operator)
    assert (await crm_draft.get_draft(session, operator, "crm_phone"))["revision"] == 2


async def test_http_roundtrip_file_sniffing_cas_and_ownership(client, session, operator):
    base = "/api/v1/learning/crm/draft"
    headers = auth(await login(client, operator.login))
    assert (await client.get(base)).status_code == 401
    first = await client.put(
        base,
        headers=headers,
        data={
            "payload": json.dumps(
                {
                    "revision": 0,
                    "task": "crm_phone",
                    "form": {"phone": "+7 "},
                }
            )
        },
        files=[("files", ("../../доказательство.png", PNG, "text/html"))],
    )
    assert first.status_code == 200, first.text
    data = first.json()
    file = data["attachments"][0]
    assert file["name"] == "доказательство.png" and file["mime"] == "image/png"
    restored = await client.get(base, headers=headers, params={"task": "crm_phone"})
    assert restored.json() == data
    assert (await client.get(base + f"/attachments/{file['id']}", headers=headers)).content == PNG
    other = await make_user(session, login="draft-api-other")
    other_headers = auth(await login(client, other.login))
    assert (
        await client.get(base + f"/attachments/{file['id']}", headers=other_headers)
    ).status_code == 404
    invalid = await client.put(
        base,
        headers=headers,
        data={
            "payload": json.dumps(
                {
                    "task": "crm_phone",
                    "draft_key": data["draft_key"],
                    "revision": data["revision"],
                    "form": {"comment": "Не должен сохраниться"},
                }
            )
        },
        files=[("files", ("bad.svg", b"<svg></svg>", "image/svg+xml"))],
    )
    assert invalid.status_code == 422
    stale = await client.put(
        base,
        headers=headers,
        data={
            "payload": json.dumps(
                {
                    "task": "crm_phone",
                    "draft_key": data["draft_key"],
                    "revision": 0,
                    "form": {},
                }
            )
        },
    )
    assert stale.status_code == 409
    assert (await client.get(base, headers=headers, params={"task": "crm_phone"})).json() == data
    assert (
        await client.delete(base, headers=headers, params={"task": "crm_phone"})
    ).status_code == 204
    assert (
        await client.get(base + f"/attachments/{file['id']}", headers=headers)
    ).status_code == 404


@pytest.mark.parametrize(
    "form",
    [
        {"author_id": 1},
        {"status": "closed"},
        {"phone": "1" * 41},
        {"category_ids": ["x"] * 11},
        {"comment": "x" * 10001},
        {"details": {"forged_proof": "yes"}},
        {"details": {"company": "x" * 2001}},
        {"is_ticket": "true"},
    ],
)
async def test_partial_form_is_bounded_and_whitelisted(form):
    with pytest.raises(ValidationError):
        body(form=form)
