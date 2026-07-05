"""Работа с БД для модуля rating (ТЗ §15.3).

Только SQLAlchemy-запросы: выборки операторов, отчётов, метрик, норм, уровней,
транзакций. Никаких игровых расчётов, проверок ролей и форматирования для UI.
Запросы перенесены дословно из routers/rating.py и services/rating.py.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import (
    CoinTransaction,
    Group,
    Operator,
    OperatorDailyMetric,
    OperatorLevel,
    OperatorLevelAssignment,
    PeriodReport,
    WorkNorm,
)


def latest_period(db: Session) -> tuple[date, date] | None:
    """Последний сохранённый период по максимальной period_end среди всех расчётов."""
    result = db.execute(
        select(PeriodReport.period_start, PeriodReport.period_end)
        .order_by(PeriodReport.period_end.desc(), PeriodReport.created_at.desc())
        .limit(1)
    ).first()
    return tuple(result) if result else None


def all_reports_grouped(db: Session) -> dict[int, list[PeriodReport]]:
    """
    Загружает ВСЮ историю PeriodReport одним запросом и группирует по
    operator_id, каждый список отсортирован по period_end (затем created_at)
    по убыванию — самый свежий отчёт оператора первый в списке.
    """
    all_reports = list(
        db.scalars(
            select(PeriodReport).order_by(
                PeriodReport.operator_id,
                PeriodReport.period_end.desc(),
                PeriodReport.created_at.desc(),
            )
        )
    )
    grouped: dict[int, list[PeriodReport]] = defaultdict(list)
    for r in all_reports:
        grouped[r.operator_id].append(r)
    return grouped


def participating_operators(db: Session, operator_ids: list[int]) -> dict[int, Operator]:
    """Активные участвующие операторы из списка id (уволенные/неактивные отсеиваются)."""
    return {
        o.id: o for o in db.scalars(
            select(Operator).where(
                Operator.id.in_(operator_ids),
                Operator.participation_status == "participating",
                Operator.employment_status == "active",
                Operator.is_active.is_(True),
            )
        )
    }


def level_assignments(db: Session, op_ids: list[int]) -> list[tuple]:
    """(OperatorLevelAssignment, OperatorLevel) для операторов; [] если список пуст."""
    if not op_ids:
        return []
    return list(db.execute(
        select(OperatorLevelAssignment, OperatorLevel)
        .join(OperatorLevel, OperatorLevelAssignment.level_id == OperatorLevel.id)
        .where(OperatorLevelAssignment.operator_id.in_(op_ids))
    ))


def max_report_created_at(db: Session):
    return db.scalar(select(func.max(PeriodReport.created_at)))


def operator_daily_metrics(db: Session, operator_id: int, limit: int) -> list[OperatorDailyMetric]:
    """Последние N дней с хотя бы одним рабочим показателем > 0 (хронологический порядок)."""
    rows = list(db.scalars(
        select(OperatorDailyMetric)
        .where(
            OperatorDailyMetric.operator_id == operator_id,
            (
                (OperatorDailyMetric.worked_hours > 0) |
                (OperatorDailyMetric.base_hours > 0) |
                (OperatorDailyMetric.calls_count > 0) |
                (OperatorDailyMetric.efficiency > 0) |
                (OperatorDailyMetric.penalty_points > 0) |
                (OperatorDailyMetric.penalty_minutes > 0)
            )
        )
        .order_by(OperatorDailyMetric.metric_date.desc())
        .limit(limit)
    ))
    rows.reverse()  # хронологический порядок для графика
    return rows


def daily_metrics_for_dates(db: Session, dates: list[date]) -> list:
    """Метрики всех операторов за указанные даты (для расчёта места по дням)."""
    return list(db.execute(
        select(
            OperatorDailyMetric.metric_date,
            OperatorDailyMetric.operator_id,
            OperatorDailyMetric.worked_hours,
            OperatorDailyMetric.base_hours,
            OperatorDailyMetric.calls_count,
            OperatorDailyMetric.efficiency,
            OperatorDailyMetric.penalty_points,
        ).where(
            OperatorDailyMetric.metric_date.in_(dates),
            (
                (OperatorDailyMetric.worked_hours > 0) |
                (OperatorDailyMetric.base_hours > 0) |
                (OperatorDailyMetric.calls_count > 0)
            )
        )
    ))


def work_norm(db: Session, year: int, month: int, rate: float) -> WorkNorm | None:
    return db.scalar(
        select(WorkNorm).where(
            WorkNorm.year == year,
            WorkNorm.month == month,
            WorkNorm.rate == rate,
            WorkNorm.is_active.is_(True),
        )
    )


def period_reports_for_operator(db: Session, operator_id: int, limit: int) -> list[PeriodReport]:
    """Последние N периодов оператора (хронологический порядок)."""
    results = list(db.scalars(
        select(PeriodReport)
        .where(PeriodReport.operator_id == operator_id)
        .order_by(PeriodReport.period_end.desc())
        .limit(limit)
    ))
    results.reverse()
    return results


def coin_transactions(db: Session, operator_id: int, limit: int) -> list[CoinTransaction]:
    return list(db.scalars(
        select(CoinTransaction)
        .where(CoinTransaction.operator_id == operator_id)
        .order_by(CoinTransaction.created_at.desc())
        .limit(limit)
    ))


def get_operator(db: Session, operator_id: int) -> Operator | None:
    return db.get(Operator, operator_id)


def get_group(db: Session, group_id: int) -> Group | None:
    return db.get(Group, group_id)
