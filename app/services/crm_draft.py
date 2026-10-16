"""Draft mutations are serialized per learner and committed by the caller."""

from datetime import UTC
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import undefer

from app.db.base import utcnow
from app.models.crm import CrmAppeal, CrmAttachment
from app.models.crm_draft import CrmDraft, CrmDraftAttachment
from app.services.learning import lock_learner

CONFLICT = "Черновик уже изменён в другой вкладке. Обновите его перед сохранением."
MAX_TOTAL = 8 * 1024 * 1024
MAX_FILE = 2 * 1024 * 1024


def scope(task):
    if task not in (None, "crm_first", "crm_phone", "crm_closed"):
        raise HTTPException(422, "Неизвестное учебное задание")
    return task or "general"


async def own_draft(session, user, task=None):
    return await session.scalar(
        select(CrmDraft)
        .where(CrmDraft.user_id == user.id, CrmDraft.scope == scope(task))
        .execution_options(populate_existing=True)
    )


async def attachments(session, draft, *, binary=False):
    query = select(CrmDraftAttachment).where(CrmDraftAttachment.draft_id == draft.id)
    if binary:
        query = query.options(undefer(CrmDraftAttachment.data))
    return list(await session.scalars(query.order_by(CrmDraftAttachment.id)))


async def describe(session, draft, task=None):
    if draft is None:
        return {
            "draft_key": None,
            "task": task,
            "revision": 0,
            "form": {},
            "attachments": [],
            "updated_at": None,
            "appeal_id": None,
            "remove_appeal_attachment_ids": [],
        }
    files = await attachments(session, draft)
    return {
        "draft_key": draft.draft_key,
        "task": None if draft.scope == "general" else draft.scope,
        "revision": draft.revision,
        "form": draft.form,
        "attachments": [
            {"id": f.id, "name": f.name, "mime": f.mime, "size": f.size} for f in files
        ],
        # SQLite drops timezone information from DateTime(timezone=True).
        "updated_at": (
            draft.updated_at.replace(tzinfo=UTC)
            if draft.updated_at.tzinfo is None
            else draft.updated_at.astimezone(UTC)
        ),
        "appeal_id": draft.appeal_id,
        "remove_appeal_attachment_ids": draft.remove_appeal_attachment_ids,
    }


async def get_draft(session, user, task=None):
    return await describe(session, await own_draft(session, user, task), task)


async def check_appeal(session, user, appeal_id, remove_ids, task=None):
    if appeal_id is None:
        if remove_ids:
            raise HTTPException(422, "Сначала выберите сохранённое обращение")
        return []
    appeal = await session.get(CrmAppeal, appeal_id)
    if appeal is None or appeal.author_id != user.id:
        raise HTTPException(404, "Собственное обращение не найдено")
    from app.models.crm_training import CrmTrainingAttempt

    attempt = await session.scalar(
        select(CrmTrainingAttempt).where(CrmTrainingAttempt.appeal_id == appeal_id)
    )
    if appeal.status == "closed" or (attempt is not None and attempt.phase == "passed"):
        raise HTTPException(409, "Успешно проверенное обращение нельзя редактировать")
    if appeal.training_task != task:
        raise HTTPException(409, "Обращение относится к другому учебному заданию")
    files = list(
        await session.scalars(
            select(CrmAttachment)
            .where(CrmAttachment.appeal_id == appeal_id)
            .options(undefer(CrmAttachment.data))
        )
    )
    if set(remove_ids) - {file.id for file in files}:
        raise HTTPException(422, "Вложение не принадлежит выбранному обращению")
    return [file for file in files if file.id not in remove_ids]


async def put_draft(session, user, body, uploads):
    await lock_learner(session, user.id)
    row = await own_draft(session, user, body.task)
    if row is None:
        if body.draft_key is not None or body.revision != 0:
            raise HTTPException(409, CONFLICT)
        request_id = body.form.request_id
        if (
            request_id
            and await session.scalar(
                select(CrmAppeal.id).where(
                    CrmAppeal.author_id == user.id,
                    or_(
                        CrmAppeal.request_id == request_id,
                        CrmAppeal.last_edit_request_id == request_id,
                    ),
                )
            )
            is not None
        ):
            # Even a delayed first PUT (revision=0) may arrive after final Save.
            # Its submission UUID has already been consumed, so it cannot revive work.
            raise HTTPException(409, CONFLICT)
        if body.remove_attachment_ids:
            raise HTTPException(422, "Вложение не принадлежит черновику")
        previous = []
    else:
        if row.draft_key != body.draft_key or row.revision != body.revision:
            raise HTTPException(409, CONFLICT)
        previous = await attachments(session, row, binary=True)
        if set(body.remove_attachment_ids) - {file.id for file in previous}:
            raise HTTPException(422, "Вложение не принадлежит черновику")
    remaining = [file for file in previous if file.id not in body.remove_attachment_ids]
    appeal_id = (
        body.appeal_id if row is None or "appeal_id" in body.model_fields_set else row.appeal_id
    )
    remove_appeal_ids = (
        body.remove_appeal_attachment_ids
        if row is None or "remove_appeal_attachment_ids" in body.model_fields_set
        else row.remove_appeal_attachment_ids
    )
    existing = await check_appeal(session, user, appeal_id, remove_appeal_ids, body.task)
    # A response can be lost after commit. On explicit reconciliation the browser
    # can resend a File; preserve one exact copy without dropping different files.
    seen = {(file.name, file.mime, file.data) for file in remaining + existing}
    unique_uploads = []
    for upload in uploads:
        if upload not in seen:
            seen.add(upload)
            unique_uploads.append(upload)
    uploads = unique_uploads
    if len(remaining) + len(existing) + len(uploads) > 5:
        raise HTTPException(422, "Можно приложить до 5 файлов")
    if any(not data or len(data) > MAX_FILE for _, _, data in uploads) or (
        sum(file.size for file in remaining + existing) + sum(len(data) for _, _, data in uploads)
        > MAX_TOTAL
    ):
        raise HTTPException(422, "До 2 МБ на файл и до 8 МБ на обращение")
    if row is None:
        row = CrmDraft(user_id=user.id, scope=scope(body.task), draft_key=str(uuid4()), revision=0)
        session.add(row)
        await session.flush()
    row.form = {**(row.form or {}), **body.form.model_dump(exclude_none=True, exclude_unset=True)}
    row.appeal_id = appeal_id
    row.remove_appeal_attachment_ids = remove_appeal_ids
    row.revision += 1
    row.updated_at = utcnow()
    for file in previous:
        if file.id in body.remove_attachment_ids:
            await session.delete(file)
    for name, mime, data in uploads:
        session.add(
            CrmDraftAttachment(draft_id=row.id, name=name, mime=mime, data=data, size=len(data))
        )
    await session.flush()
    return row


async def consume_loaded(session, draft):
    """Remove a previously checked draft, in the appeal save transaction (no commit)."""
    if draft is not None:
        await session.execute(
            delete(CrmDraftAttachment).where(CrmDraftAttachment.draft_id == draft.id)
        )
        await session.delete(draft)
        await session.flush()


async def delete_draft(session, user, task=None):
    await lock_learner(session, user.id)
    await consume_loaded(session, await own_draft(session, user, task))


async def load_for_save(session, user, draft_key, draft_revision, task=None):
    """Caller must hold lock_learner. Never consume another scope or a stale draft."""
    if draft_key is None:
        if draft_revision is not None:
            raise HTTPException(422, "Укажите ключ черновика")
        return None, []
    if draft_revision is None:
        raise HTTPException(422, "Укажите ревизию черновика")
    draft = await own_draft(session, user, task)
    if draft is None or draft.draft_key != draft_key or draft.revision != draft_revision:
        raise HTTPException(409, CONFLICT)
    files = await attachments(session, draft, binary=True)
    return draft, [(file.name, file.mime, file.data) for file in files]
