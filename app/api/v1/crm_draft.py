"""Private server drafts, including durable uploaded files, for training CRM."""

from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import undefer

from app.core.deps import CurrentUser, SessionDep
from app.core.work_sites import require_work_sites
from app.models.crm_draft import CrmDraft, CrmDraftAttachment
from app.schemas.crm_draft import DraftPutInput, Task
from app.services import crm_draft

router = APIRouter(tags=["Учебная CRM"], dependencies=[Depends(require_work_sites)])
PREFIX = "/learning/crm/draft"


@router.get(PREFIX)
async def get_draft(session: SessionDep, user: CurrentUser, task: Task | None = None):
    return await crm_draft.get_draft(session, user, task)


@router.put(PREFIX)
async def put_draft(
    session: SessionDep,
    user: CurrentUser,
    payload: str = Form(..., max_length=40000),
    files: list[UploadFile] = File(default=[]),
):
    from app.api.v1.crm import read_files

    try:
        body = DraftPutInput.model_validate_json(payload)
    except ValidationError as exc:
        raise HTTPException(422, "; ".join(error["msg"] for error in exc.errors())) from exc
    uploads = await read_files(files)
    draft = await crm_draft.put_draft(session, user, body, uploads)
    result = await crm_draft.describe(session, draft)
    await session.commit()
    return result


@router.delete(PREFIX, status_code=204)
async def delete_draft(session: SessionDep, user: CurrentUser, task: Task | None = None):
    await crm_draft.delete_draft(session, user, task)
    await session.commit()
    return Response(status_code=204)


@router.get(PREFIX + "/attachments/{file_id}")
async def download_attachment(file_id: int, session: SessionDep, user: CurrentUser):
    row = await session.scalar(
        select(CrmDraftAttachment)
        .join(CrmDraft, CrmDraft.id == CrmDraftAttachment.draft_id)
        .where(CrmDraftAttachment.id == file_id, CrmDraft.user_id == user.id)
        .options(undefer(CrmDraftAttachment.data))
    )
    if row is None:
        raise HTTPException(404, "Вложение не найдено")
    return Response(
        row.data,
        media_type=row.mime,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(row.name, safe='')}",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )
