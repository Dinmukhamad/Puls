"""Дневные показатели операторов: для аналитики по дням и месяцам, без баллов и коинов."""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import select

from app.core.deps import SessionDep, StaffUser
from app.core.errors import DomainError
from app.models.contest import OperatorDayMetric
from app.schemas.admin import DayMetricsBulkIn, MetricValueIn
from app.schemas.common import Message
from app.services import imports as import_service
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
