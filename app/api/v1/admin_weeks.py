"""Управление неделями конкурса: загрузка показателей, расчёт, закрытие (п. 7)."""

from __future__ import annotations

from dataclasses import asdict
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, File, UploadFile, status
from sqlalchemy import delete, select

from app.core.deps import HeadUser, SessionDep, StaffUser, visible_users_filter
from app.core.errors import ConflictError
from app.models.contest import ContestWeek, OperatorWeekMetric, OperatorWeekResult
from app.models.enums import WeekStatus
from app.models.user import User
from app.schemas.admin import (
    MetricsBulkIn,
    WeekCloseReportOut,
    WeekCreate,
    WeekPreviewOut,
    WeekPreviewRow,
)
from app.schemas.common import Message
from app.schemas.imports import ImportPreviewOut
from app.schemas.rating import WeekOut
from app.services import imports as import_service
from app.services import weekly as weekly_service
from app.services.rules import write_audit

router = APIRouter(prefix="/admin/weeks", tags=["Недели конкурса"])


@router.get("", response_model=list[WeekOut], summary="Список недель")
async def list_weeks(session: SessionDep, _: StaffUser, limit: int = 50) -> list[ContestWeek]:
    rows = await session.scalars(
        select(ContestWeek).order_by(ContestWeek.starts_on.desc()).limit(limit)
    )
    return list(rows)


@router.post(
    "",
    response_model=WeekOut,
    status_code=status.HTTP_201_CREATED,
    summary="Завести неделю",
)
async def create_week(session: SessionDep, actor: StaffUser, payload: WeekCreate) -> ContestWeek:
    """Создаёт неделю по любой дате внутри неё. Повторный вызов вернёт существующую."""
    week = await weekly_service.get_or_create_week(session, payload.any_day, title=payload.title)
    await write_audit(
        session,
        actor_id=actor.id,
        action="week.create",
        entity_type="contest_week",
        entity_id=week.id,
    )
    await session.commit()
    return week


@router.post(
    "/{week_id}/import/preview",
    response_model=ImportPreviewOut,
    summary="Проверить CSV/XLSX без сохранения",
)
async def import_preview(
    session: SessionDep,
    actor: StaffUser,
    week_id: int,
    file: Annotated[UploadFile, File()],
) -> ImportPreviewOut:
    week = await weekly_service.get_week(session, week_id)
    if week.status == WeekStatus.CLOSED:
        raise ConflictError("Неделя закрыта: импорт недоступен", code="week_closed")
    try:
        content = await file.read(import_service.MAX_FILE_BYTES + 1)
        return await import_service.preview_file(
            session, actor, week, file.filename or "import.csv", content
        )
    finally:
        await file.close()


@router.post(
    "/{week_id}/metrics",
    response_model=Message,
    summary="Загрузить показатели операторов за неделю",
)
async def upload_metrics(
    session: SessionDep, actor: StaffUser, week_id: int, payload: MetricsBulkIn
) -> Message:
    """
    Пакетная загрузка показателей (шаг 2 п. 7).

    Значения обновляются по ключу (неделя, оператор, показатель), поэтому файл
    можно заливать повторно после исправлений.
    """
    week = await weekly_service.get_week(session, week_id, lock=True)
    if week.status == WeekStatus.CLOSED:
        raise ConflictError(
            f"Неделя {week.label} закрыта: показатели изменить нельзя", code="week_closed"
        )

    await import_service.validate_values(session, actor, payload.values)
    visibility = await visible_users_filter(session, actor)
    visible_ids = select(User.id).where(visibility)
    if payload.replace:
        await session.execute(
            delete(OperatorWeekMetric).where(
                OperatorWeekMetric.week_id == week.id,
                OperatorWeekMetric.user_id.in_(visible_ids),
            )
        )
        await session.flush()

    existing = {
        (row.user_id, row.metric_code): row
        for row in await session.scalars(
            select(OperatorWeekMetric).where(
                OperatorWeekMetric.week_id == week.id,
                OperatorWeekMetric.user_id.in_({value.user_id for value in payload.values}),
            )
        )
    }

    created = updated = 0
    for value in payload.values:
        key = (value.user_id, value.metric_code)
        row = existing.get(key)
        if row is None:
            row = OperatorWeekMetric(
                week_id=week.id,
                user_id=value.user_id,
                metric_code=value.metric_code,
                value=value.value,
                source=payload.source,
            )
            session.add(row)
            existing[key] = row
            created += 1
        else:
            row.value = value.value
            row.source = payload.source
            updated += 1

    # A changed score also changes global ranks and nominations. Discard the
    # derived preview atomically; only Head/Admin can calculate it again.
    await weekly_service.invalidate_calculation(session, week)
    await write_audit(
        session,
        actor_id=actor.id,
        action="week.metrics_upload",
        entity_type="contest_week",
        entity_id=week.id,
        payload={"created": created, "updated": updated, "replace": payload.replace},
    )
    await session.commit()
    return Message(detail=f"Загружено: новых {created}, обновлено {updated}")


@router.post(
    "/{week_id}/recalculate",
    response_model=WeekPreviewOut,
    summary="Пересчитать неделю без начисления коинов",
)
async def recalculate(session: SessionDep, actor: HeadUser, week_id: int) -> WeekPreviewOut:
    """
    Предварительный расчёт: баллы, места и номинации.

    Коины не начисляются - результат можно проверить до закрытия недели.
    """
    week = await weekly_service.get_week(session, week_id, lock=True)
    results = await weekly_service.calculate_week(session, week)
    await write_audit(
        session,
        actor_id=actor.id,
        action="week.recalculate",
        entity_type="contest_week",
        entity_id=week.id,
        payload={"participants": len(results)},
    )
    await session.commit()
    return await _preview(session, week, results, actor)


@router.get(
    "/{week_id}/preview",
    response_model=WeekPreviewOut,
    summary="Итоги недели в текущем виде",
)
async def preview(session: SessionDep, actor: StaffUser, week_id: int) -> WeekPreviewOut:
    week = await weekly_service.get_week(session, week_id)
    results = list(
        await session.scalars(
            select(OperatorWeekResult)
            .join(User, User.id == OperatorWeekResult.user_id)
            .where(
                OperatorWeekResult.week_id == week.id,
                await visible_users_filter(session, actor),
            )
        )
    )
    return await _preview(session, week, results, actor)


@router.post(
    "/{week_id}/close",
    response_model=WeekCloseReportOut,
    summary="Закрыть неделю и начислить коины",
)
async def close(session: SessionDep, actor: HeadUser, week_id: int) -> WeekCloseReportOut:
    """
    Закрывает неделю: пересчитывает итоги и зачисляет коины на балансы.

    Повторный вызов безопасен - начисления защищены ключами идемпотентности.
    """
    week = await weekly_service.get_week(session, week_id, lock=True)
    report = await weekly_service.close_week(session, week, actor_id=actor.id)
    await write_audit(
        session,
        actor_id=actor.id,
        action="week.close",
        entity_type="contest_week",
        entity_id=week.id,
        payload={
            "participants": report.participants,
            "coins_awarded": report.coins_awarded,
        },
    )
    await session.commit()
    return WeekCloseReportOut(**asdict(report))


@router.post(
    "/close-previous",
    response_model=WeekCloseReportOut,
    summary="Закрыть завершившуюся неделю",
)
async def close_previous(session: SessionDep, actor: HeadUser) -> WeekCloseReportOut:
    """
    Закрывает неделю, завершившуюся накануне, не требуя знать её идентификатор.

    Точка входа для внешнего планировщика там, где встроенный не работает:
    на тарифах, где сервис засыпает без трафика. Вызов идемпотентен.
    """
    week = await weekly_service.get_or_create_week(session, date.today() - timedelta(days=3))
    week = await weekly_service.get_week(session, week.id, lock=True)
    report = await weekly_service.close_week(session, week, actor_id=actor.id)
    await write_audit(
        session,
        actor_id=actor.id,
        action="week.close_previous",
        entity_type="contest_week",
        entity_id=week.id,
        payload={"coins_awarded": report.coins_awarded},
    )
    await session.commit()
    return WeekCloseReportOut(**asdict(report))


async def _preview(
    session: SessionDep, week: ContestWeek, results: list[OperatorWeekResult], actor: User
) -> WeekPreviewOut:
    name_rows = await session.execute(
        select(User.id, User.full_name).where(User.id.in_([r.user_id for r in results] or [-1]))
    )
    names = dict(name_rows.all())
    definitions = await weekly_service.active_metric_definitions(session)
    codes = {definition.code for definition in definitions}
    metric_rows = await session.execute(
        select(OperatorWeekMetric.user_id, OperatorWeekMetric.metric_code)
        .join(User, User.id == OperatorWeekMetric.user_id)
        .where(OperatorWeekMetric.week_id == week.id, await visible_users_filter(session, actor))
    )
    reported: dict[int, set[str]] = {}
    for user_id, code in metric_rows:
        reported.setdefault(user_id, set()).add(code)
    all_reported = set().union(*reported.values()) if reported else set()
    rows = sorted(
        (
            WeekPreviewRow(
                user_id=r.user_id,
                full_name=names.get(r.user_id, f"id={r.user_id}"),
                rank=r.rank,
                final_points=r.final_points,
                coins_total=r.coins_total,
                coins_from_points=r.coins_from_points,
                coins_rank_bonus=r.coins_rank_bonus,
                coins_discipline_bonus=r.coins_discipline_bonus,
                coins_nomination_bonus=r.coins_nomination_bonus,
                missing_metrics=sorted(codes - reported.get(r.user_id, set())),
            )
            for r in results
        ),
        key=lambda row: (row.rank is None, row.rank or 0),
    )
    return WeekPreviewOut(
        week_id=week.id,
        week_label=week.label,
        status=str(week.status),
        participants=len(rows),
        coins_total=sum(row.coins_total for row in rows),
        missing_metrics=sorted(codes - all_reported),
        rows=rows,
    )
