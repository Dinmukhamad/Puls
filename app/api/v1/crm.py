"""Training CRM: all authenticated participants share the complete history."""

import re
from pathlib import PurePath
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy import String, cast, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import undefer

from app.core.deps import CurrentUser, LearningEditor, LearningReader, SessionDep
from app.core.work_sites import require_work_sites
from app.db.base import utcnow
from app.models.crm import CrmAppeal, CrmAttachment, CrmCategory, CrmInstruction
from app.models.crm_training import CrmTrainingAttempt
from app.schemas.crm import AppealInput, CategoryInput, InstructionInput, StatusInput
from app.services import crm_course, crm_draft, crm_training
from app.services.crm_catalog import CITIES, PARKS, category_id, default_categories
from app.services.crm_instructions import default_instructions
from app.services.learning import lock_learner

router = APIRouter(tags=["Учебная CRM"], dependencies=[Depends(require_work_sites)])
PREFIX = "/learning/crm"
MAX_FILE = 2 * 1024 * 1024


async def catalog(session):
    rows = await session.scalars(select(CrmCategory).order_by(CrmCategory.label))
    return default_categories() + [
        {
            "id": r.id,
            "parent_id": r.parent_id,
            "label": r.label,
            "hint": r.hint,
            "rules": [],
            "disabled": False,
            "custom": True,
        }
        for r in rows
    ]


@router.get(PREFIX + "/catalog")
async def get_catalog(session: SessionDep, user: CurrentUser):
    nodes = await catalog(session)
    instructions = default_instructions(nodes)
    for row in await session.scalars(select(CrmInstruction)):
        if row.key in instructions:
            instructions[row.key] = {
                "key": row.key,
                "title": row.title,
                "body": row.body,
                "steps": row.steps,
                "revision": row.revision,
            }
    return {"parks": PARKS, "cities": CITIES, "categories": nodes, "instructions": instructions}


@router.put("/admin/learning/crm/instructions/{key}")
async def save_instruction(
    key: str, body: InstructionInput, session: SessionDep, user: LearningReader
):
    # Unlike category/status administration, instructions are also editable by supervisors.
    if key not in default_instructions(await catalog(session)):
        raise HTTPException(404, "Инструкция не найдена")
    values = body.model_dump(exclude={"revision"})
    revision = body.revision + 1
    if body.revision == 0:
        session.add(CrmInstruction(key=key, **values, revision=revision, updated_by_id=user.id))
    else:
        result = await session.execute(
            update(CrmInstruction)
            .where(CrmInstruction.key == key, CrmInstruction.revision == body.revision)
            .values(**values, revision=revision, updated_by_id=user.id)
        )
        if not result.rowcount:
            raise HTTPException(
                409, "Инструкцию уже изменили. Обновите её и повторите редактирование."
            )
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            409, "Инструкцию уже изменили. Обновите её и повторите редактирование."
        ) from None
    return dict(key=key, **values, revision=revision)


@router.post("/admin/learning/crm/categories", status_code=201)
async def add_category(body: CategoryInput, session: SessionDep, user: LearningEditor):
    nodes = {n["id"]: n for n in await catalog(session)}
    path = [body.label]
    parent = body.parent_id
    while parent:
        node = nodes.get(parent)
        if not node or node["disabled"]:
            raise HTTPException(422, "Родительская категория недоступна")
        path.insert(0, node["label"])
        parent = node["parent_id"]
    if len(path) > 10:
        raise HTTPException(422, "Допустимо не более 10 уровней категорий")
    key = category_id(path)
    if key in nodes:
        raise HTTPException(409, "Такая категория уже существует")
    session.add(CrmCategory(id=key, **body.model_dump()))
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, "Такая категория уже существует") from None
    return dict(id=key, **body.model_dump(), rules=[], disabled=False, custom=True)


def brief(row):
    return {
        key: getattr(row, key)
        for key in (
            "id",
            "author_id",
            "author_name",
            "channel",
            "phone",
            "license_number",
            "driver_id",
            "contacted_at",
            "park",
            "city",
            "category_ids",
            "category_labels",
            "details",
            "comment",
            "is_ticket",
            "status",
            "created_at",
            "revision",
            "training_task",
        )
    }


async def detail(session, row):
    files = await session.scalars(
        select(CrmAttachment).where(CrmAttachment.appeal_id == row.id).order_by(CrmAttachment.id)
    )
    ticket = await session.scalar(
        select(crm_course.CrmTicket).where(crm_course.CrmTicket.appeal_id == row.id)
    )
    return dict(
        **brief(row),
        ticket_id=ticket.id if ticket else None,
        attachments=[{"id": f.id, "name": f.name, "mime": f.mime, "size": f.size} for f in files],
    )


@router.get(PREFIX + "/appeals")
async def list_appeals(
    session: SessionDep,
    user: CurrentUser,
    q: str = Query("", max_length=200),
    status: str = "",
    park: str = "",
    channel: str = "",
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
):
    conditions = []
    if q.strip():
        term = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append(
            or_(
                *(
                    column.ilike(f"%{term}%", escape="\\")
                    for column in (
                        CrmAppeal.phone,
                        CrmAppeal.author_name,
                        CrmAppeal.license_number,
                        CrmAppeal.comment,
                        cast(CrmAppeal.id, String),
                    )
                )
            )
        )
    for value, column in (
        (status, CrmAppeal.status),
        (park, CrmAppeal.park),
        (channel, CrmAppeal.channel),
    ):
        if value:
            conditions.append(column == value)
    total = await session.scalar(select(func.count()).select_from(CrmAppeal).where(*conditions))
    rows = await session.scalars(
        select(CrmAppeal)
        .where(*conditions)
        .order_by(CrmAppeal.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    counts = dict(
        (
            await session.execute(select(CrmAppeal.status, func.count()).group_by(CrmAppeal.status))
        ).all()
    )
    return {
        "items": [brief(row) for row in rows],
        "total": total,
        "page": page,
        "size": size,
        "counts": counts,
    }


@router.get(PREFIX + "/appeals/{appeal_id}")
async def get_appeal(appeal_id: int, session: SessionDep, user: CurrentUser):
    row = await session.get(CrmAppeal, appeal_id)
    if not row:
        raise HTTPException(404, "Обращение не найдено")
    if row.training_task in crm_course.KEYS and row.author_id == user.id:
        await lock_learner(session, user.id)
        await crm_course.opened_appeal(session, user, row)
        await session.commit()
    return await detail(session, row)


def validate_appeal(body, nodes, files):
    if body.park not in PARKS or body.city not in CITIES:
        raise HTTPException(422, "Выберите таксопарк и город из списка")
    if (
        not re.fullmatch(r"[+\d\s()\-]+", body.phone)
        or not 5 <= len(re.sub(r"\D", "", body.phone)) <= 15
    ):
        raise HTTPException(422, "Проверьте номер телефона")
    parent, selected = None, []
    for key in body.category_ids:
        node = nodes.get(key)
        if not node or node["parent_id"] != parent or node["disabled"]:
            raise HTTPException(422, "Выберите доступную цепочку категорий")
        selected.append(node)
        parent = key
    if any(n["parent_id"] == parent and not n["disabled"] for n in nodes.values()):
        raise HTTPException(422, "Выберите все уровни категории")
    rules = {rule for node in selected for rule in node["rules"]}
    fields = body.details
    requirements = {
        "cooperation": [
            ("company", "Название компании"),
            ("callback", "Номер для обратного звонка"),
            ("service", "Предлагаемая услуга"),
        ],
        "employee": [("employee", "Имя сотрудника")],
        "transaction": [("transaction", "Транзакция / РРН")],
        "conditions": [("conditions", "Условия работы")],
    }
    for rule, required in requirements.items():
        for key, label in required if rule in rules else []:
            if not fields.get(key):
                raise HTTPException(422, f"Заполните поле «{label}»")
    if "description" in rules and not body.comment:
        raise HTTPException(422, "Опишите ситуацию в комментарии")
    if "account_link" in rules and not re.search(r"https?://[^\s/]+/\S+", body.comment):
        raise HTTPException(
            422, "Добавьте в комментарий ссылку на аккаунт водителя в диспетчерской"
        )
    if (
        "phone_change" in rules
        and len(
            {
                re.sub(r"\D", "", p)
                for p in re.findall(
                    r"(?<!\d)\+?\d[\d ()-]{8,}\d", re.sub(r"https?://\S+", "", body.comment)
                )
            }
        )
        < 2
    ):
        raise HTTPException(422, "В комментарии нужны два разных номера: старый и новый")
    has_image = any(mime.startswith("image/") for _, mime, _ in files)
    if "image" in rules and not has_image:
        raise HTTPException(422, "Для этого запроса обязателен скриншот")
    if "error_description" in rules and not has_image and not fields.get("error_description"):
        raise HTTPException(422, "Приложите скриншот или заполните описание ошибки")
    return [n["label"] for n in selected]


async def read_files(files):
    if len(files) > 5:
        raise HTTPException(422, "Можно приложить до 5 файлов")
    result = []
    total = 0
    for upload in files:
        data = await upload.read(MAX_FILE + 1)
        total += len(data)
        if not data or len(data) > MAX_FILE or total > 8 * 1024 * 1024:
            raise HTTPException(422, "До 2 МБ на файл и до 8 МБ на обращение")
        # Sniff safe image types; untrusted HTML/SVG cannot be served as active content.
        mime = (
            "image/png"
            if data.startswith(b"\x89PNG\r\n\x1a\n")
            else "image/jpeg"
            if data.startswith(b"\xff\xd8\xff")
            else "image/webp"
            if data[:4] == b"RIFF" and data[8:12] == b"WEBP"
            else "application/pdf"
            if data.startswith(b"%PDF-")
            else None
        )
        if not mime:
            raise HTTPException(422, "Допустимы PNG, JPEG, WebP и PDF")
        name = PurePath((upload.filename or "file").replace("\\", "/")).name[:200]
        result.append((name, mime, data))
    return result


SAVE_META = {
    "request_id",
    "training_task",
    "draft_key",
    "draft_revision",
    "revision",
    "remove_attachment_ids",
}


def appeal_body(payload):
    try:
        return AppealInput.model_validate_json(payload)
    except ValidationError as exc:
        raise HTTPException(422, "; ".join(e["msg"] for e in exc.errors())) from exc


def unique_uploads(uploads, existing=()):
    """A confirmed draft upload is not attached twice after a response is lost."""
    seen = set(existing)
    result = []
    for item in uploads:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


def bound_uploads(uploads, existing=()):
    files = [*existing, *uploads]
    if len(files) > 5 or sum(len(data) for _, _, data in files) > 8 * 1024 * 1024:
        raise HTTPException(422, "До 5 файлов, по 2 МБ каждый и до 8 МБ на обращение")


async def require_started_training(session, user, key):
    """Only an explicit, unfinished start may accept a new training proof."""
    if key is None:
        return
    if key in crm_course.KEYS:
        await crm_course.require_started(session, user, key)
        return
    attempts, awards = await crm_training._records(session, user)
    if crm_training._passed(key, attempts, awards):
        raise HTTPException(409, "Это учебное задание уже пройдено")
    if key not in attempts:
        raise HTTPException(409, "Сначала начните это учебное задание CRM")
    index = crm_training.TASK_KEYS.index(key)
    if index and not crm_training._passed(crm_training.TASK_KEYS[index - 1], attempts, awards):
        raise HTTPException(409, "Сначала пройдите предыдущее учебное задание CRM")


async def saved_result(session, user, row, state=None):
    result = await detail(session, row)
    if row.training_task:
        service = crm_course if row.training_task in crm_course.KEYS else crm_training
        result["training_state"] = state or await service.state(session, user)
    return result


async def save_labels(session, body, uploads):
    nodes = {n["id"]: n for n in await catalog(session)}
    try:
        return validate_appeal(body, nodes, uploads)
    except HTTPException as exc:
        if not body.training_task or exc.status_code != 422:
            raise
        # The training grader must retain mistakes as actual saved work and explain
        # them. It independently checks the full expected path, fields and evidence.
        return [nodes[key]["label"] for key in body.category_ids if key in nodes]


@router.post(PREFIX + "/appeals", status_code=201)
async def create_appeal(
    session: SessionDep,
    user: CurrentUser,
    payload: str = Form(..., max_length=30000),
    files: list[UploadFile] = File(default=[]),
):
    body = appeal_body(payload)
    if body.training_task and body.details.get("scenario_attempt"):
        raise HTTPException(422, "Учебное задание CRM и попытка сценария сохраняются отдельно")
    await lock_learner(session, user.id)
    scenario_attempt = None
    if body.details.get("scenario_attempt"):
        from app.services import scenarios

        marker = body.details["scenario_attempt"]
        if not marker.isdecimal() or int(marker) <= 0:
            raise HTTPException(422, "Некорректная попытка сценария")
        candidate = await scenarios.own_attempt(session, user, int(marker), lock=True)
        if scenarios.office_workflow(candidate):
            scenario_attempt = candidate
    existing = await session.scalar(
        select(CrmAppeal).where(
            CrmAppeal.author_id == user.id, CrmAppeal.request_id == str(body.request_id)
        )
    )
    if existing:
        if existing.training_task != body.training_task:
            raise HTTPException(409, "Этот запрос уже использован для другого обращения")
        return await saved_result(session, user, existing)
    await require_started_training(session, user, body.training_task)
    if body.remove_attachment_ids:
        raise HTTPException(422, "Удаление вложений доступно при исправлении обращения")
    draft, draft_uploads = await crm_draft.load_for_save(
        session, user, body.draft_key, body.draft_revision, body.training_task
    )
    if draft and draft.appeal_id is not None:
        raise HTTPException(409, "Этот черновик исправляет сохранённое обращение")
    uploads = await read_files(files)
    uploads = unique_uploads([*draft_uploads, *uploads])
    bound_uploads(uploads)
    labels = await save_labels(session, body, uploads)
    row = CrmAppeal(
        **body.model_dump(exclude=SAVE_META),
        request_id=str(body.request_id),
        training_task=body.training_task,
        revision=1,
        author_id=user.id,
        author_name=user.full_name,
        category_labels=labels,
        status="new" if body.is_ticket else "recorded",
        created_at=utcnow(),
    )
    session.add(row)
    try:
        await session.flush()
        if scenario_attempt is not None:
            from app.schemas.scenario import ScenarioCrmCheck

            # Save and verify together: an invalid consultation is rolled back,
            # and a successful response always advances this same scenario.
            await scenarios.crm_check(
                session, user, scenario_attempt.id, ScenarioCrmCheck(appeal_id=row.id)
            )
        for name, mime, data in uploads:
            session.add(
                CrmAttachment(appeal_id=row.id, name=name, mime=mime, data=data, size=len(data))
            )
        await session.flush()
        training_state = None
        if body.training_task:
            service = crm_course if body.training_task in crm_course.KEYS else crm_training
            training_state = await service.autograde(
                session, user, body.training_task, row, uploads
            )
        await crm_draft.consume_loaded(session, draft)
        await session.commit()
    except IntegrityError:
        await session.rollback()
        existing = await session.scalar(
            select(CrmAppeal).where(
                CrmAppeal.author_id == user.id, CrmAppeal.request_id == str(body.request_id)
            )
        )
        if existing:
            return await saved_result(session, user, existing)
        raise
    return await saved_result(session, user, row, training_state)


@router.patch(PREFIX + "/appeals/{appeal_id}")
async def correct_appeal(
    appeal_id: int,
    session: SessionDep,
    user: CurrentUser,
    payload: str = Form(..., max_length=30000),
    files: list[UploadFile] = File(default=[]),
):
    """Correct one's own failed work; passed proof cannot be rewritten."""
    body = appeal_body(payload)
    await lock_learner(session, user.id)
    row = await session.get(CrmAppeal, appeal_id, populate_existing=True)
    if row is None or row.author_id != user.id:
        raise HTTPException(404, "Собственное обращение не найдено")
    if row.last_edit_request_id == str(body.request_id):
        return await saved_result(session, user, row)
    if body.revision is None or body.revision != row.revision:
        raise HTTPException(409, "Обращение уже изменено. Обновите его перед исправлением.")
    if row.details.get("scenario_attempt") or body.details.get("scenario_attempt"):
        raise HTTPException(409, "Обращение сценария исправляется в его учебной попытке")
    if row.training_task is None:
        raise HTTPException(409, "Исправление доступно для текущего учебного задания CRM")
    if row.status == "closed":
        raise HTTPException(409, "Закрытое обращение нельзя изменять")
    proof = await session.scalar(
        select(CrmTrainingAttempt.id).where(
            CrmTrainingAttempt.appeal_id == row.id, CrmTrainingAttempt.phase == "passed"
        )
    )
    if proof is not None:
        raise HTTPException(409, "Проверенное учебное обращение нельзя изменять")
    current_attempt = await session.scalar(
        select(CrmTrainingAttempt).where(
            CrmTrainingAttempt.user_id == user.id,
            CrmTrainingAttempt.task_key == row.training_task,
        )
    )
    if current_attempt is None or current_attempt.appeal_id != row.id:
        raise HTTPException(409, "Исправьте последнее обращение этого учебного задания")
    if body.training_task not in (None, row.training_task):
        raise HTTPException(409, "Учебное назначение обращения нельзя изменять")
    task = row.training_task
    await require_started_training(session, user, task)
    body.training_task = task
    draft, draft_uploads = await crm_draft.load_for_save(
        session, user, body.draft_key, body.draft_revision, task
    )
    if draft and draft.appeal_id != row.id:
        raise HTTPException(409, "Черновик относится к другому обращению")
    old_files = list(
        await session.scalars(
            select(CrmAttachment)
            .where(CrmAttachment.appeal_id == row.id)
            .options(undefer(CrmAttachment.data))
        )
    )
    removed = set(body.remove_attachment_ids)
    if draft:
        removed.update(draft.remove_appeal_attachment_ids)
    if removed - {file.id for file in old_files}:
        raise HTTPException(422, "Вложение не принадлежит этому обращению")
    kept = [file for file in old_files if file.id not in removed]
    kept_uploads = [(file.name, file.mime, file.data) for file in kept]
    uploads = unique_uploads([*draft_uploads, *await read_files(files)], kept_uploads)
    bound_uploads(uploads, kept_uploads)
    labels = await save_labels(session, body, [*kept_uploads, *uploads])
    for key, value in body.model_dump(exclude=SAVE_META).items():
        setattr(row, key, value)
    row.category_labels = labels
    row.revision += 1
    row.last_edit_request_id = str(body.request_id)
    row.status = "new" if body.is_ticket else "recorded"
    for file in old_files:
        if file.id in removed:
            await session.delete(file)
    for name, mime, data in uploads:
        session.add(
            CrmAttachment(appeal_id=row.id, name=name, mime=mime, data=data, size=len(data))
        )
    await session.flush()
    training_state = None
    if task:
        service = crm_course if task in crm_course.KEYS else crm_training
        training_state = await service.autograde(
            session, user, task, row, [*kept_uploads, *uploads]
        )
    await crm_draft.consume_loaded(session, draft)
    await session.commit()
    return await saved_result(session, user, row, training_state)


@router.patch("/admin/learning/crm/appeals/{appeal_id}/status")
async def update_status(
    appeal_id: int, body: StatusInput, session: SessionDep, user: LearningEditor
):
    row = await session.get(CrmAppeal, appeal_id)
    if not row or not row.is_ticket:
        raise HTTPException(404, "Тикет не найден")
    row.status = body.status
    row.revision += 1
    await session.commit()
    return await detail(session, row)


@router.get(PREFIX + "/attachments/{file_id}")
async def download_attachment(file_id: int, session: SessionDep, user: CurrentUser):
    row = await session.scalar(
        select(CrmAttachment)
        .options(undefer(CrmAttachment.data))
        .where(CrmAttachment.id == file_id)
    )
    if not row:
        raise HTTPException(404, "Вложение не найдено")
    return Response(
        row.data,
        media_type=row.mime,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(row.name)}",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )
