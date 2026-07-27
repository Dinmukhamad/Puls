"""Работа с БД для модуля reports (ТЗ §15.3).

Только SQLAlchemy-запросы: чтение/запись загруженных файлов, операторы, bulk
upsert посуточных метрик, инвалидация PeriodReport. Запросы перенесены из
routers/period_reports.py без изменения логики.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    Operator,
    OperatorDailyMetric,
    PeriodReport,
    UploadedReportFile,
    WeeklyResult,
)


def uploaded_file(db: Session, file_kind: str) -> UploadedReportFile | None:
    return db.scalar(select(UploadedReportFile).where(UploadedReportFile.file_kind == file_kind))


def get_uploaded_bytes(db: Session, file_kind: str) -> bytes | None:
    """Читает загруженный xlsx-файл из БД (переживает редеплой/перезапуск)."""
    row = uploaded_file(db, file_kind)
    return row.content if row else None


def save_uploaded_bytes(db: Session, file_kind: str, filename: str, content: bytes, user_id: int) -> None:
    row = uploaded_file(db, file_kind)
    if row:
        row.filename = filename
        row.content = content
        row.uploaded_by_user_id = user_id
    else:
        db.add(UploadedReportFile(
            file_kind=file_kind, filename=filename, content=content, uploaded_by_user_id=user_id,
        ))
    db.flush()


def site_operators(db: Session) -> list[Operator]:
    return list(db.scalars(select(Operator)))


def site_operator_names(db: Session) -> list[str]:
    return [o.full_name for o in db.scalars(select(Operator)) if o.full_name]


def bulk_upsert_daily_metrics(db: Session, values_to_upsert: list[dict]) -> None:
    """Bulk upsert operator_daily_metrics (postgres ON CONFLICT / sqlite построчно)."""
    if not values_to_upsert:
        return
    bind = db.get_bind()
    if bind.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        # PostgreSQL ограничивает число параметров в одном запросе —
        # с запасом бьём на пачки по 500 строк (у нас 20 колонок на
        # строку, 500*20=10000 параметров, безопасно ниже лимита 65535).
        CHUNK = 500
        for i in range(0, len(values_to_upsert), CHUNK):
            chunk = values_to_upsert[i:i + CHUNK]
            stmt = pg_insert(OperatorDailyMetric).values(chunk)
            update_cols = {
                col: getattr(stmt.excluded, col)
                for col in chunk[0].keys()
                if col not in ("operator_id", "metric_date")
            }
            stmt = stmt.on_conflict_do_update(
                index_elements=["operator_id", "metric_date"],
                set_=update_cols,
            )
            db.execute(stmt)
    else:
        # SQLite (локальная разработка) — построчный upsert, без bulk-синтаксиса
        for values in values_to_upsert:
            existing = db.scalar(
                select(OperatorDailyMetric).where(
                    OperatorDailyMetric.operator_id == values["operator_id"],
                    OperatorDailyMetric.metric_date == values["metric_date"],
                )
            )
            target = existing or OperatorDailyMetric(
                operator_id=values["operator_id"], metric_date=values["metric_date"],
            )
            for k, v in values.items():
                setattr(target, k, v)
            if not existing:
                db.add(target)


def delete_all_period_reports(db: Session) -> int:
    return db.query(PeriodReport).delete()


def existing_period_reports_for(db: Session, operator_id: int, start_date: date, end_date: date) -> list[PeriodReport]:
    return list(db.scalars(
        select(PeriodReport)
        .where(
            PeriodReport.operator_id == operator_id,
            PeriodReport.period_start == start_date,
            PeriodReport.period_end == end_date,
        )
        .order_by(PeriodReport.created_at.desc(), PeriodReport.id.desc())
    ))


def weekly_result_for(db: Session, operator_id: int, week_start: date, week_end: date) -> WeeklyResult | None:
    """Мост reports → weekly_results (ТЗ §3): найти существующую строку WeeklyResult
    за тот же период, чтобы не создавать дубликат и не затирать вручную введённые
    lateness_count/violation_count/thanks_count."""
    return db.scalar(
        select(WeeklyResult).where(
            WeeklyResult.operator_id == operator_id,
            WeeklyResult.week_start == week_start,
            WeeklyResult.week_end == week_end,
        )
    )
