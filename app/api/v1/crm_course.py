"""Practical CRM course inside the existing QR-protected work sites."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import undefer

from app.api.v1.crm import read_files
from app.core.deps import CurrentUser, SessionDep
from app.core.work_sites import require_work_sites
from app.models.crm import CrmTicket, CrmTicketAttachment, CrmTicketEvent
from app.schemas.crm_course import CourseAction, TicketAction
from app.schemas.crm_draft import DraftPutInput
from app.services import crm_course, crm_draft
from app.services.learning import lock_learner

router = APIRouter(
    prefix="/learning/crm", tags=["Практика CRM"], dependencies=[Depends(require_work_sites)]
)


@router.get("/course")
async def state(session: SessionDep, user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    return await crm_course.state(session, user)


@router.post("/course/tasks/{key}/start")
async def start(key: str, session: SessionDep, user: CurrentUser):
    await lock_learner(session, user.id)
    result = await crm_course.start(session, user, key)
    await session.commit()
    return result


@router.post("/course/tasks/{key}/actions")
async def action(key: str, body: CourseAction, session: SessionDep, user: CurrentUser):
    await lock_learner(session, user.id)
    result = await crm_course.action(session, user, key, body)
    await session.commit()
    return result


@router.post("/course/tasks/{key}/capture")
async def capture(key: str, session: SessionDep, user: CurrentUser, file: UploadFile = File(...)):
    image = await file.read(2 * 1024 * 1024 + 1)
    await lock_learner(session, user.id)
    result = await crm_course.capture(session, user, key, image)
    await session.commit()
    return result


@router.get("/tickets/{ticket_id}")
async def ticket(ticket_id: int, session: SessionDep, user: CurrentUser):
    await lock_learner(session, user.id)
    row = await session.get(CrmTicket, ticket_id)
    if row is None:
        raise HTTPException(404, "Учебный тикет не найден")
    result = await crm_course.opened_ticket(session, user, row)
    await session.commit()
    return result


async def editable_ticket(session, user, ticket_id):
    row = await session.get(CrmTicket, ticket_id)
    if row is None:
        raise HTTPException(404, "Учебный тикет не найден")
    await crm_course.describe_ticket(session, user, row)
    return row


@router.get("/tickets/{ticket_id}/draft")
async def comment_draft(ticket_id: int, session: SessionDep, user: CurrentUser):
    await editable_ticket(session, user, ticket_id)
    return await crm_draft.get_draft(session, user, f"ticket:{ticket_id}")


@router.put("/tickets/{ticket_id}/draft")
async def save_comment_draft(
    ticket_id: int,
    session: SessionDep,
    user: CurrentUser,
    payload: str = Form(..., max_length=40000),
    files: list[UploadFile] = File(default=[]),
):
    try:
        body = DraftPutInput.model_validate_json(payload)
    except ValidationError:
        raise HTTPException(422, "Проверь текст комментария и повтори сохранение.") from None
    uploads = await read_files(files)
    await lock_learner(session, user.id)
    row = await editable_ticket(session, user, ticket_id)
    if row.status != "rework":
        raise HTTPException(409, "Добавить комментарий можно после возврата на доработку")
    appeal = await session.get(crm_course.CrmAppeal, row.appeal_id)
    attempt = await crm_course.own_attempt(session, user, appeal.training_task)
    if attempt.phase == "passed":
        raise HTTPException(409, "Комментарий уже отправлен")
    body.task = f"ticket:{ticket_id}"
    body.appeal_id = None
    body.remove_appeal_attachment_ids = []
    draft = await crm_draft.put_draft(session, user, body, uploads)
    result = await crm_draft.describe(session, draft)
    await session.commit()
    return result


@router.post("/tickets/{ticket_id}/actions")
async def ticket_action(
    ticket_id: int,
    session: SessionDep,
    user: CurrentUser,
    payload: str = Form(..., max_length=15000),
    files: list[UploadFile] = File(default=[]),
):
    try:
        body = TicketAction.model_validate_json(payload)
    except ValidationError:
        raise HTTPException(
            422, "Не удалось отправить действие. Проверь комментарий и повтори."
        ) from None
    uploads = await read_files(files)
    if len(uploads) > 5:
        raise HTTPException(422, "Можно приложить до 5 файлов")
    await lock_learner(session, user.id)
    row = await session.get(CrmTicket, ticket_id)
    if row is None:
        raise HTTPException(404, "Учебный тикет не найден")
    result = await crm_course.ticket_action(session, user, row, body, uploads)
    await session.commit()
    return result


@router.get("/ticket-attachments/{file_id}")
async def attachment(file_id: int, session: SessionDep, user: CurrentUser):
    from urllib.parse import quote

    row = await session.scalar(
        select(CrmTicketAttachment)
        .where(CrmTicketAttachment.id == file_id)
        .options(undefer(CrmTicketAttachment.data))
    )
    event = await session.get(CrmTicketEvent, row.event_id) if row else None
    ticket = await session.get(CrmTicket, event.ticket_id) if event else None
    if ticket is None:
        raise HTTPException(404, "Файл не найден")
    await crm_course.describe_ticket(session, user, ticket)
    return Response(
        row.data,
        media_type=row.mime,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(row.name)}",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
