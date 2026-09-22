"""Training CRM: all authenticated participants share the complete history."""

import re
from pathlib import PurePath
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import undefer

from app.core.deps import CurrentUser, LearningEditor, SessionDep
from app.models.crm import CrmAppeal, CrmAttachment, CrmCategory
from app.schemas.crm import AppealInput, CategoryInput, StatusInput
from app.services.crm_catalog import CITIES, PARKS, category_id, default_categories

router = APIRouter(tags=["Учебная CRM"])
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
    return {"parks": PARKS, "cities": CITIES, "categories": await catalog(session)}


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
        )
    }


async def detail(session, row):
    files = await session.scalars(
        select(CrmAttachment).where(CrmAttachment.appeal_id == row.id).order_by(CrmAttachment.id)
    )
    return dict(
        **brief(row),
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


@router.post(PREFIX + "/appeals", status_code=201)
async def create_appeal(
    session: SessionDep,
    user: CurrentUser,
    payload: str = Form(..., max_length=30000),
    files: list[UploadFile] = File(default=[]),
):
    try:
        body = AppealInput.model_validate_json(payload)
    except ValidationError as exc:
        raise HTTPException(422, "; ".join(e["msg"] for e in exc.errors())) from exc
    existing = await session.scalar(
        select(CrmAppeal).where(
            CrmAppeal.author_id == user.id, CrmAppeal.request_id == str(body.request_id)
        )
    )
    if existing:
        return await detail(session, existing)
    uploads = await read_files(files)
    labels = validate_appeal(body, {n["id"]: n for n in await catalog(session)}, uploads)
    row = CrmAppeal(
        **body.model_dump(exclude={"request_id"}),
        request_id=str(body.request_id),
        author_id=user.id,
        author_name=user.full_name,
        category_labels=labels,
        status="new" if body.is_ticket else "recorded",
    )
    session.add(row)
    try:
        await session.flush()
        for name, mime, data in uploads:
            session.add(
                CrmAttachment(appeal_id=row.id, name=name, mime=mime, data=data, size=len(data))
            )
        await session.commit()
    except IntegrityError:
        await session.rollback()
        existing = await session.scalar(
            select(CrmAppeal).where(
                CrmAppeal.author_id == user.id, CrmAppeal.request_id == str(body.request_id)
            )
        )
        if existing:
            return await detail(session, existing)
        raise
    return await detail(session, row)


@router.patch("/admin/learning/crm/appeals/{appeal_id}/status")
async def update_status(
    appeal_id: int, body: StatusInput, session: SessionDep, user: LearningEditor
):
    row = await session.get(CrmAppeal, appeal_id)
    if not row or not row.is_ticket:
        raise HTTPException(404, "Тикет не найден")
    row.status = body.status
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
