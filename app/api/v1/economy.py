"""The monthly contest and the coin economy's monthly report (services/months.py, economy.py)."""

from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.core.deps import CurrentUser, HeadUser, SessionDep, StaffUser
from app.core.errors import NotFoundError
from app.models.contest import ContestMonth
from app.services import economy, months
from app.services.rules import write_audit

router = APIRouter(tags=["Конкурс месяца и экономика"])


def _month(year: int | None, month: int | None) -> tuple[int, int]:
    if year is None or month is None:
        return economy.this_month()
    if not 1 <= month <= 12 or not 2020 <= year <= 2100:
        raise NotFoundError("Месяц не найден")
    return year, month


@router.get("/contest/month", summary="Конкурс месяца: места и номинации")
async def contest_month(
    session: SessionDep, user: CurrentUser,
    year: int | None = Query(default=None), month: int | None = Query(default=None),
):
    """Standings of the month among all operators, as of its last closed week."""
    year, month = _month(year, month)
    item = await session.scalar(
        select(ContestMonth).where(ContestMonth.year == year, ContestMonth.month == month)
    )
    if item is None:
        return months.empty_view(year, month)
    return await months.view(session, item, viewer=user)


@router.post("/admin/contest/month/calculate", summary="Пересчитать места и номинации месяца")
async def calculate_month(
    session: SessionDep, actor: StaffUser, year: int = Query(), month: int = Query(),
):
    item = await months.get_or_create(session, *_month(year, month))
    if str(item.status) != "closed":
        await months.calculate(session, item)
    data = await months.view(session, item, viewer=actor)
    await session.commit()
    return data


@router.get("/contest/months", summary="Месяцы конкурса")
async def contest_months(session: SessionDep, user: CurrentUser):
    rows = await session.scalars(
        select(ContestMonth).order_by(ContestMonth.year.desc(), ContestMonth.month.desc()).limit(24)
    )
    return [
        {"year": m.year, "month": m.month, "label": m.label,
         "name": months.month_name(m.year, m.month), "status": str(m.status)}
        for m in rows
    ]


@router.post("/admin/contest/month/close", summary="Закрыть месяц и начислить места и номинации")
async def close_month(
    session: SessionDep, actor: HeadUser,
    year: int = Query(), month: int = Query(),
):
    year, month = _month(year, month)
    item = await months.get_or_create(session, year, month)
    result = await months.close(session, item, actor_id=actor.id)
    await write_audit(session, actor_id=actor.id, action="month.close",
                      entity_type="contest_month", entity_id=item.id, payload=result)
    data = await months.view(session, item, viewer=actor)
    await session.commit()
    return {"report": result, "month": data}


@router.get("/admin/economy/report", summary="Экономика месяца: выпуск и сжигание коинов")
async def economy_report(
    session: SessionDep, actor: StaffUser,
    year: int | None = Query(default=None), month: int | None = Query(default=None),
):
    return await economy.report(session, *_month(year, month))
