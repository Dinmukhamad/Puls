from typing import Literal

from fastapi import APIRouter
from sqlalchemy import func, select

from app.core.deps import (
    CurrentUser,
    HeadUser,
    PaginationDep,
    SessionDep,
    StaffUser,
    visible_users_filter,
)
from app.core.errors import ConflictError, NotFoundError
from app.models.learning import LearningAttempt, LearningContent
from app.models.user import User
from app.schemas.common import Page
from app.schemas.learning import AnswerInput, ContentInput, SimulatorAction
from app.services import learning
from app.services.rules import write_audit

router = APIRouter(tags=["Обучение"])


@router.get("/learning")
async def catalog(session: SessionDep, user: CurrentUser):
    contents = await session.scalars(
        select(LearningContent)
        .where(LearningContent.status == "published")
        .order_by(LearningContent.is_required.desc(), LearningContent.id.desc())
        .limit(500)
    )
    attempts = list(
        await session.scalars(
            select(LearningAttempt)
            .where(LearningAttempt.user_id == user.id)
            .order_by(LearningAttempt.id.desc())
        )
    )
    latest = {}
    passed = set()
    for item in attempts:
        latest.setdefault(item.content_id, item)
        if item.state == "passed":
            passed.add(item.content_id)
    items = []
    for content in contents:
        data = learning.content_data(content)
        attempt = latest.get(content.id)
        data.update(
            {
                "attempt_id": attempt.id if attempt else None,
                "state": attempt.state if attempt else "new",
                "completed": content.id in passed,
                "answered": len(attempt.answers) if attempt else 0,
            }
        )
        items.append(data)
    return items


@router.post("/learning/{content_id}/start")
async def start(session: SessionDep, user: CurrentUser, content_id: int):
    attempt = await learning.start_attempt(session, user.id, content_id)
    await session.commit()
    return learning.attempt_data(attempt)


@router.get("/learning/attempts/{attempt_id}")
async def attempt(session: SessionDep, user: CurrentUser, attempt_id: int):
    return learning.attempt_data(await learning.own_attempt(session, user.id, attempt_id))


@router.put("/learning/attempts/{attempt_id}/answer")
async def answer(session: SessionDep, user: CurrentUser, attempt_id: int, payload: AnswerInput):
    attempt = await learning.save_answer(session, user.id, attempt_id, payload.step, payload.answer)
    await session.commit()
    return learning.attempt_data(attempt)


@router.post("/learning/attempts/{attempt_id}/finish")
async def finish(session: SessionDep, user: CurrentUser, attempt_id: int):
    attempt = await learning.finish_attempt(session, user.id, attempt_id)
    await session.commit()
    return learning.attempt_data(attempt)


@router.post("/learning/attempts/{attempt_id}/simulator")
async def simulator(
    session: SessionDep, user: CurrentUser, attempt_id: int, payload: SimulatorAction
):
    attempt = await learning.simulator_action(session, user.id, attempt_id, payload.action)
    await session.commit()
    return learning.attempt_data(attempt)


@router.get("/admin/learning")
async def definitions(session: SessionDep, _: StaffUser):
    return [
        learning.content_data(item, editor=True)
        for item in await session.scalars(
            select(LearningContent).order_by(LearningContent.id.desc()).limit(500)
        )
    ]


async def save_content(session, actor, payload, content=None):
    before = learning.content_data(content, editor=True) if content else None
    if content and content.kind != payload.kind:
        raise ConflictError("Тип существующего материала нельзя изменить")
    if content is None:
        content = LearningContent(revision=0)
        session.add(content)
    for key, value in payload.model_dump().items():
        setattr(content, key, value)
    content.revision += 1
    await session.flush()
    after = learning.content_data(content, editor=True)
    # JSON аудит хранит сроки в ISO, сама модель использует datetime.
    for snapshot in (before, after):
        if snapshot and snapshot["deadline"]:
            snapshot["deadline"] = snapshot["deadline"].isoformat()
    await write_audit(
        session,
        actor_id=actor.id,
        action="learning.save",
        entity_type="learning_content",
        entity_id=content.id,
        payload={"before": before, "after": after},
    )
    await session.commit()
    return learning.content_data(content, editor=True)


@router.post("/admin/learning", status_code=201)
async def create(session: SessionDep, actor: HeadUser, payload: ContentInput):
    return await save_content(session, actor, payload)


@router.put("/admin/learning/{content_id}")
async def edit(session: SessionDep, actor: HeadUser, content_id: int, payload: ContentInput):
    content = await session.scalar(
        select(LearningContent).where(LearningContent.id == content_id).with_for_update()
    )
    if content is None:
        raise NotFoundError("Учебный материал не найден")
    return await save_content(session, actor, payload, content)


@router.get("/admin/learning-results")
async def results(
    session: SessionDep,
    actor: StaffUser,
    pagination: PaginationDep,
    user_id: int | None = None,
    content_id: int | None = None,
    kind: Literal["test", "mission", "simulator"] | None = None,
):
    conditions = [await visible_users_filter(session, actor)]
    if user_id is not None:
        conditions.append(LearningAttempt.user_id == user_id)
    if content_id is not None:
        conditions.append(LearningAttempt.content_id == content_id)
    if kind is not None:
        conditions.append(LearningAttempt.snapshot["kind"].as_string() == kind)
    total = int(
        await session.scalar(select(func.count(LearningAttempt.id)).join(User).where(*conditions))
        or 0
    )
    rows = await session.execute(
        select(LearningAttempt, User.full_name)
        .join(User)
        .where(*conditions)
        .order_by(LearningAttempt.id.desc())
        .offset(pagination.offset)
        .limit(pagination.size)
    )
    items = [
        {
            "id": attempt.id,
            "user_id": attempt.user_id,
            "full_name": name,
            "content_id": attempt.content_id,
            "title": attempt.snapshot["title"],
            "kind": attempt.snapshot["kind"],
            "state": attempt.state,
            "answered": len(attempt.answers),
            "total": len(attempt.snapshot["steps"]),
            "score": attempt.score,
            "awarded_coins": attempt.awarded_coins,
            "finished_at": attempt.finished_at,
        }
        for attempt, name in rows
    ]
    return Page.build(items, total, pagination.page, pagination.size)
