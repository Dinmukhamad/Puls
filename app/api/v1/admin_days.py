"""Дневные показатели операторов: для аналитики по дням и месяцам, без баллов и коинов."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile
from sqlalchemy import select

from app.core.deps import SessionDep, StaffUser
from app.core.errors import DomainError
from app.models.contest import ContestWeek, OperatorDayMetric
from app.models.enums import Role
from app.schemas.admin import DayMetricsBulkIn, MetricValueIn
from app.schemas.common import Message
from app.schemas.imports import ReportPreviewOut, ReportWeekOut
from app.services import imports as import_service
from app.services import szov_reports
from app.services import weekly as weekly_service
from app.services.rules import write_audit

router = APIRouter(prefix="/admin/day-metrics", tags=["Недели конкурса"])


@router.post("", response_model=Message, summary="Загрузить показатели операторов по дням")
async def upload_day_metrics(
    session: SessionDep, actor: StaffUser, payload: DayMetricsBulkIn
) -> Message:
    """Значения обновляются по ключу (оператор, день, показатель); файл можно заливать повторно."""
    keys = {(value.user_id, value.day, value.metric_code) for value in payload.values}
    if len(keys) != len(payload.values):
        raise DomainError(
            "Повторяется показатель одного оператора за один день", code="duplicate_metric"
        )
    # Operator scope and metric codes are checked once per (operator, metric) pair.
    pairs = {(value.user_id, value.metric_code): value for value in payload.values}
    await import_service.validate_values(
        session,
        actor,
        [MetricValueIn(user_id=u, metric_code=c, value=v.value) for (u, c), v in pairs.items()],
    )
    days = {value.day for value in payload.values}
    existing = {
        (row.user_id, row.day, row.metric_code): row
        for row in await session.scalars(
            select(OperatorDayMetric).where(
                OperatorDayMetric.day.in_(days),
                OperatorDayMetric.user_id.in_({value.user_id for value in payload.values}),
            )
        )
    }
    created = updated = 0
    for value in payload.values:
        row = existing.get((value.user_id, value.day, value.metric_code))
        if row is None:
            session.add(
                OperatorDayMetric(
                    user_id=value.user_id,
                    day=value.day,
                    metric_code=value.metric_code,
                    value=value.value,
                    source=payload.source,
                )
            )
            created += 1
        else:
            row.value, row.source = value.value, payload.source
            updated += 1
    await write_audit(
        session,
        actor_id=actor.id,
        action="day.metrics_upload",
        entity_type="operator_day_metrics",
        entity_id=None,
        payload={
            "created": created,
            "updated": updated,
            "from": min(days).isoformat(),
            "to": max(days).isoformat(),
        },
    )
    await session.commit()
    return Message(detail=f"Загружено: новых {created}, обновлено {updated}")


async def _read_reports(
    session, actor, files: list[UploadFile], month: str | None
) -> tuple[szov_reports.ParsedReports, dict]:
    contents = []
    try:
        for upload in files:
            content = await upload.read(szov_reports.MAX_FILE_BYTES + 1)
            contents.append((upload.filename or "report.xlsx", content))
    finally:
        for upload in files:
            await upload.close()
    parsed = szov_reports.parse(contents, month or None)
    return parsed, await szov_reports.build_plan(session, actor, parsed)


async def _report_out(session, parsed, plan, weeks=None, detail=None) -> ReportPreviewOut:
    if weeks is None:
        weeks = []
        for item in plan["weeks"]:
            start = item["days"][0]
            iso_year, iso_week, _ = start.isocalendar()
            week = await session.scalar(
                select(ContestWeek).where(
                    ContestWeek.iso_year == iso_year, ContestWeek.iso_week == iso_week
                )
            )
            weeks.append(
                {
                    "label": f"{iso_year}-W{iso_week:02d}",
                    "status": str(week.status) if week else "new",
                    "operators": len(item["values"]),
                }
            )
    return ReportPreviewOut(
        month=f"{parsed.year}-{parsed.month:02d}",
        files=parsed.files,
        matched=len(plan["found"]),
        matched_names=sorted(plan["names"].values()),
        unmatched=plan["unmatched"],
        without_data=len(plan["without_data"]),
        day_values=len(plan["daily"]),
        weeks=[
            ReportWeekOut(
                **week,
                starts_on=item["days"][0].isoformat(),
                ends_on=item["days"][-1].isoformat(),
            )
            for week, item in zip(weeks, plan["weeks"], strict=True)
        ],
        detail=detail,
    )


@router.post(
    "/reports/preview",
    response_model=ReportPreviewOut,
    summary="Проверить месячные отчёты СЗоВ без сохранения",
)
async def preview_reports(
    session: SessionDep,
    actor: StaffUser,
    files: Annotated[list[UploadFile], File()],
    month: Annotated[str | None, Form()] = None,
) -> ReportPreviewOut:
    parsed, plan = await _read_reports(session, actor, files, month)
    return await _report_out(session, parsed, plan)


@router.post(
    "/reports",
    response_model=ReportPreviewOut,
    summary="Загрузить месячные отчёты СЗоВ: дни и недели месяца",
)
async def upload_reports(
    session: SessionDep,
    actor: StaffUser,
    files: Annotated[list[UploadFile], File()],
    month: Annotated[str | None, Form()] = None,
) -> ReportPreviewOut:
    """
    Отчёты по командам и отчёт проверяющих за месяц.

    Каждый день месяца сохраняется для аналитики, полные недели месяца — в показатели
    конкурса. Недели не закрываются, коины не начисляются. Руководитель сразу получает
    предварительный рейтинг, у супервайзера неделя ждёт расчёта руководителем.
    """
    parsed, plan = await _read_reports(session, actor, files, month)
    if not plan["found"]:
        raise DomainError(
            "В отчётах нет операторов, которых вы ведёте на сайте", code="no_operators"
        )
    await szov_reports.ensure_metrics(session)
    for start in (item["days"][0] for item in plan["weeks"]):
        await weekly_service.get_or_create_week(session, start)
    result = await szov_reports.save(
        session, actor, plan, recalculate=actor.role in (Role.HEAD, Role.ADMIN)
    )
    await write_audit(
        session,
        actor_id=actor.id,
        action="day.reports_upload",
        entity_type="operator_day_metrics",
        entity_id=None,
        payload={
            "month": f"{parsed.year}-{parsed.month:02d}",
            "files": [item["filename"] for item in parsed.files],
            "operators": len(plan["found"]),
            "days": result["days"],
        },
    )
    await session.commit()
    saved = sum(1 for week in result["weeks"] if week["status"] != "closed")
    return await _report_out(
        session,
        parsed,
        plan,
        weeks=result["weeks"],
        detail=f"Сохранено: {result['days']} дневных значений, недель — {saved}",
    )
