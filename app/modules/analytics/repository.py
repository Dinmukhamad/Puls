"""Работа с БД для модуля analytics (ТЗ §15.3).

Только SQLAlchemy-запросы. Никаких расчётов KPI, проверок ролей и
форматирования для UI. Запросы перенесены дословно из routers/analytics.py.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import (
    Group,
    Operator,
    OperatorDailyMetric,
    PeriodReport,
    UploadedReportFile,
)


def site_operators(db: Session) -> list[Operator]:
    return list(db.scalars(select(Operator)))


def active_groups(db: Session, group_id: int | None = None) -> list[Group]:
    query = select(Group).where(Group.status == "active")
    if group_id is not None:
        query = query.where(Group.id == group_id)
    return list(db.scalars(query))


def period_is_calculated(db: Session, start_date: date, end_date: date) -> bool:
    return db.scalar(
        select(PeriodReport.id)
        .where(PeriodReport.period_start == start_date, PeriodReport.period_end == end_date)
        .limit(1)
    ) is not None


def distinct_periods(db: Session, group_id: int | None = None) -> list:
    query = select(PeriodReport.period_start, PeriodReport.period_end)
    if group_id is not None:
        query = query.join(Operator, Operator.id == PeriodReport.operator_id).where(
            Operator.group_id == group_id
        )
    return db.execute(query.distinct().order_by(PeriodReport.period_end.desc())).all()


def available_data_date_range(db: Session, group_id: int | None = None) -> tuple | None:
    """Минимальная и максимальная дата, для которых есть посуточные данные."""
    query = select(
        func.min(OperatorDailyMetric.metric_date),
        func.max(OperatorDailyMetric.metric_date),
    )
    if group_id is not None:
        query = query.join(Operator, Operator.id == OperatorDailyMetric.operator_id).where(
            Operator.group_id == group_id
        )
    row = db.execute(query).first()
    if not row or row[0] is None:
        return None
    return row[0], row[1]


def daily_metrics_in_range(db: Session, start_date: date, end_date: date) -> list[OperatorDailyMetric]:
    return list(
        db.scalars(
            select(OperatorDailyMetric).where(
                OperatorDailyMetric.metric_date >= start_date,
                OperatorDailyMetric.metric_date <= end_date,
            )
        )
    )


def scoped_daily_metrics(
    db: Session,
    start_date: date,
    end_date: date,
    *,
    group_id: int | None = None,
    operator_id: int | None = None,
    participation_status: str | None = None,
) -> list[OperatorDailyMetric]:
    """Посуточные метрики за диапазон с единым scope (ТЗ §10.1): группа,
    оператор и статус участия. Область берётся по текущему Operator, а не по
    снимку group_id в метрике — как и остальные эндпоинты аналитики.
    Ни при каких условиях не читает Excel.
    """
    query = select(OperatorDailyMetric).where(
        OperatorDailyMetric.metric_date >= start_date,
        OperatorDailyMetric.metric_date <= end_date,
    )
    if operator_id is not None:
        query = query.where(OperatorDailyMetric.operator_id == operator_id)
    if group_id is not None or participation_status:
        query = query.join(Operator, Operator.id == OperatorDailyMetric.operator_id)
        if group_id is not None:
            query = query.where(Operator.group_id == group_id)
        if participation_status:
            query = query.where(Operator.participation_status == participation_status)
    return list(db.scalars(query))


def covered_dates_in_range(db: Session, start_date: date, end_date: date) -> set:
    return set(
        db.scalars(
            select(OperatorDailyMetric.metric_date)
            .where(OperatorDailyMetric.metric_date >= start_date, OperatorDailyMetric.metric_date <= end_date)
            .distinct()
        )
    )


def period_reports_for_range(db: Session, start_date: date, end_date: date) -> dict[int, PeriodReport]:
    return {
        r.operator_id: r
        for r in db.scalars(
            select(PeriodReport).where(
                PeriodReport.period_start == start_date,
                PeriodReport.period_end == end_date,
            )
        )
    }


def operators_by_ids(db: Session, operator_ids) -> dict[int, Operator]:
    return {
        o.id: o for o in db.scalars(select(Operator).where(Operator.id.in_(operator_ids)))
    }


def uploaded_report_file(db: Session, file_kind: str) -> UploadedReportFile | None:
    return db.scalar(select(UploadedReportFile).where(UploadedReportFile.file_kind == file_kind))


def upsert_period_report(db: Session, values: dict, known: PeriodReport | None = None) -> None:
    """
    Атомарный upsert PeriodReport (INSERT ... ON CONFLICT DO UPDATE) для
    postgres, select-then-write для sqlite. Устойчиво к гонке параллельных
    HTTP-запросов (вкладка «Обзор» дёргает несколько эндпоинтов через
    Promise.all). Логика перенесена дословно из _save_period_report_from_metrics.

    ``known`` — уже загруженная строка за тот же период (вызывающий получает их
    пачкой через period_reports_for_range). Позволяет не делать повторный SELECT
    на каждого оператора: это давало по одному лишнему запросу на оператора при
    каждом чтении аналитики.
    """
    bind = db.get_bind()
    if bind.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        stmt = pg_insert(PeriodReport).values(**values)
        update_cols = {k: v for k, v in values.items() if k not in ("operator_id", "period_start", "period_end")}
        stmt = stmt.on_conflict_do_update(
            index_elements=["operator_id", "period_start", "period_end"],
            set_=update_cols,
        )
        db.execute(stmt)
    else:
        existing = known
        if existing is None:
            existing = db.scalar(
                select(PeriodReport).where(
                    PeriodReport.operator_id == values["operator_id"],
                    PeriodReport.period_start == values["period_start"],
                    PeriodReport.period_end == values["period_end"],
                )
            )
        pr = existing or PeriodReport(
            operator_id=values["operator_id"],
            period_start=values["period_start"],
            period_end=values["period_end"],
        )
        for k, v in values.items():
            setattr(pr, k, v)
        if not existing:
            db.add(pr)
