"""Violations a supervisor records the moment they notice them: foreign sites (docs/CHANNELS.md)."""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import aliased

from app.core.deps import SessionDep, StaffUser, managed_operators_filter
from app.models.contest import ContestWeek, Violation
from app.models.user import User
from app.services import violations as violations_service

router = APIRouter(prefix="/admin/violations", tags=["Нарушения"])


class ViolationIn(BaseModel):
    user_id: int = Field(gt=0)
    count: int = Field(ge=1, le=violations_service.MAX_COUNT)
    noticed_on: date | None = Field(
        default=None, description="День, когда обнаружено; без него — сегодня"
    )
    comment: str = Field(min_length=3, max_length=500)


class ViolationOut(BaseModel):
    id: int
    user_id: int
    user_name: str
    count: int
    noticed_on: date
    comment: str | None = None
    week_id: int
    week_label: str
    week_starts_on: date
    week_ends_on: date
    week_status: str
    author_name: str | None = None
    created_at: str
    cancelled: bool


async def _out(session, ids: list[int]) -> list[ViolationOut]:
    target, author = aliased(User), aliased(User)
    rows = await session.execute(
        select(Violation, target.full_name, author.full_name, ContestWeek)
        .join(target, target.id == Violation.user_id)
        .outerjoin(author, author.id == Violation.created_by_id)
        .join(ContestWeek, ContestWeek.id == Violation.week_id)
        .where(Violation.id.in_(ids or [0]))
        .order_by(Violation.noticed_on.desc(), Violation.id.desc())
    )
    return [
        ViolationOut(
            id=item.id, user_id=item.user_id, user_name=name, count=item.count,
            noticed_on=item.noticed_on, comment=item.comment, week_id=week.id,
            week_label=week.label, week_starts_on=week.starts_on, week_ends_on=week.ends_on,
            week_status=str(week.status), author_name=author_name,
            created_at=item.created_at.isoformat(), cancelled=item.cancelled_at is not None,
        )
        for item, name, author_name, week in rows
    ]


@router.post(
    "", response_model=ViolationOut, status_code=status.HTTP_201_CREATED,
    summary="Отметить посторонние сайты",
)
async def record_violation(
    session: SessionDep, actor: StaffUser, payload: ViolationIn
) -> ViolationOut:
    violation, _ = await violations_service.record(
        session, actor, user_id=payload.user_id, count=payload.count,
        noticed_on=payload.noticed_on, comment=payload.comment,
    )
    await session.commit()
    return (await _out(session, [violation.id]))[0]


@router.get("", response_model=list[ViolationOut], summary="Отметки о нарушениях")
async def list_violations(
    session: SessionDep,
    actor: StaffUser,
    user_id: Annotated[int | None, Query(gt=0)] = None,
    week_id: Annotated[int | None, Query(gt=0)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[ViolationOut]:
    """The records of the operators the viewer manages, the latest first."""
    query = (
        select(Violation.id)
        .join(User, User.id == Violation.user_id)
        .where(await managed_operators_filter(session, actor))
        .order_by(Violation.noticed_on.desc(), Violation.id.desc())
        .limit(limit)
    )
    if user_id is not None:
        query = query.where(Violation.user_id == user_id)
    if week_id is not None:
        query = query.where(Violation.week_id == week_id)
    return await _out(session, list(await session.scalars(query)))


@router.delete("/{violation_id}", response_model=ViolationOut, summary="Отменить отметку")
async def cancel_violation(
    session: SessionDep, actor: StaffUser, violation_id: int
) -> ViolationOut:
    violation = await violations_service.cancel(session, actor, violation_id)
    await session.commit()
    return (await _out(session, [violation.id]))[0]
