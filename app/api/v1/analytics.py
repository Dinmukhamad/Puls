"""Scoped analytics endpoints; reading does not calculate or award rewards."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from app.core.deps import CurrentUser, SessionDep, StaffUser
from app.core.errors import DomainError
from app.schemas.analytics import AnalyticsOut
from app.services.analytics import report

router = APIRouter(prefix="/analytics", tags=["Аналитика"])


@router.get("/summary", response_model=AnalyticsOut)
@router.get("/overview", response_model=AnalyticsOut)
async def summary(
    session: SessionDep,
    actor: StaffUser,
    week_id: Annotated[int | None, Query(gt=0)] = None,
    group_id: Annotated[int | None, Query(gt=0)] = None,
    metric_code: Annotated[str | None, Query(max_length=64)] = None,
    operator_ids: Annotated[str | None, Query(max_length=100)] = None,
) -> AnalyticsOut:
    try:
        ids = [int(value) for value in operator_ids.split(",")] if operator_ids else []
        if any(value <= 0 for value in ids):
            raise ValueError("Non-positive id")
    except ValueError as exc:
        raise DomainError(
            "Укажите идентификаторы операторов через запятую", code="invalid_operators"
        ) from exc
    return await report(
        session,
        actor,
        week_id=week_id,
        group_id=group_id,
        metric_code=metric_code,
        operator_ids=ids,
    )


@router.get("/me", response_model=AnalyticsOut)
async def my_trend(
    session: SessionDep,
    actor: CurrentUser,
    week_id: Annotated[int | None, Query(gt=0)] = None,
    metric_code: Annotated[str | None, Query(max_length=64)] = None,
) -> AnalyticsOut:
    return await report(session, actor, week_id=week_id, metric_code=metric_code, own=True)
