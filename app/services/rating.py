"""
Сервис рейтинга операторов.

Строит турнирную таблицу из таблицы PeriodReport — расчётов, сохранённых
через раздел «Расчёт периода» (Excel-импорт Monthly Report + Report).
Для каждого оператора берётся последний сохранённый период (по period_end),
ранжирование — по final_points. Динамика места считается относительно
предыдущего по дате сохранённого периода того же оператора.
"""
from __future__ import annotations

from datetime import date
from typing import Dict, List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import Operator, PeriodReport


def latest_period(db: Session) -> Optional[Tuple[date, date]]:
    """Последний сохранённый период по максимальной period_end среди всех расчётов."""
    result = db.execute(
        select(PeriodReport.period_start, PeriodReport.period_end)
        .order_by(PeriodReport.period_end.desc(), PeriodReport.created_at.desc())
        .limit(1)
    ).first()
    return tuple(result) if result else None


def _latest_report_per_operator(db: Session) -> Dict[int, PeriodReport]:
    """
    Для каждого operator_id берём самый последний сохранённый PeriodReport
    (по period_end, затем created_at — на случай пересчёта того же периода).
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
    latest: Dict[int, PeriodReport] = {}
    for r in all_reports:
        if r.operator_id not in latest:
            latest[r.operator_id] = r
    return latest


def _previous_report_for(db: Session, operator_id: int, before_period_end: date) -> Optional[PeriodReport]:
    """Предыдущий по дате сохранённый расчёт того же оператора (для динамики места)."""
    return db.scalar(
        select(PeriodReport)
        .where(
            PeriodReport.operator_id == operator_id,
            PeriodReport.period_end < before_period_end,
        )
        .order_by(PeriodReport.period_end.desc(), PeriodReport.created_at.desc())
        .limit(1)
    )


def rating_rows(db: Session, week_start: Optional[date] = None, week_end: Optional[date] = None) -> List[Dict]:
    """
    Возвращает турнирную таблицу. week_start/week_end пока игнорируются для
    обратной совместимости сигнатуры — рейтинг строится по последнему
    сохранённому расчёту каждого оператора (т.к. разные операторы могут быть
    рассчитаны за разные периоды через «Расчёт периода»).
    """
    latest_by_op = _latest_report_per_operator(db)
    if not latest_by_op:
        return []

    operator_ids = list(latest_by_op.keys())
    operators = {
        o.id: o for o in db.scalars(
            select(Operator).where(
                Operator.id.in_(operator_ids),
                Operator.participation_status == "participating",
                Operator.employment_status == "active",
                Operator.is_active.is_(True),
            )
        )
    }

    entries = []
    for op_id, report in latest_by_op.items():
        operator = operators.get(op_id)
        if not operator:
            continue  # не участвует / уволен / неактивен — не попадает в рейтинг
        entries.append((operator, report))

    # Ранжирование по итоговым баллам
    entries.sort(key=lambda pair: pair[1].final_points, reverse=True)

    output = []
    for position, (operator, report) in enumerate(entries, start=1):
        prev_report = _previous_report_for(db, operator.id, report.period_end)
        rank_delta = None
        if prev_report is not None:
            # Найдём, каким было место оператора в предыдущем периоде —
            # пересчитываем ранг той эпохи по той же выборке отчётов,
            # действовавших на тот момент.
            prev_position = _rank_position_at(db, operator.id, prev_report.period_end, operators.keys())
            if prev_position is not None:
                rank_delta = prev_position - position

        output.append({
            "operator_id": operator.id,
            "operator_name": operator.full_name,
            "group_name": operator.group_name,
            "contest_points": report.final_points,
            "final_score": report.final_points,
            "quality_score": report.quality_avg,
            "efficiency_score": report.efficiency_percent,
            "coins_earned": report.coins_awarded,
            "total_balance": operator.current_balance or 0,
            "rank_position": position,
            "rank_delta": rank_delta,
            "period_start": str(report.period_start),
            "period_end": str(report.period_end),
        })
    return output


def _rank_position_at(db: Session, operator_id: int, as_of_period_end: date, candidate_op_ids) -> Optional[int]:
    """
    Восстанавливает место оператора среди расчётов, актуальных на дату
    as_of_period_end (т.е. последний расчёт каждого оператора с
    period_end <= as_of_period_end на тот момент).
    """
    candidates = []
    for op_id in candidate_op_ids:
        r = db.scalar(
            select(PeriodReport)
            .where(PeriodReport.operator_id == op_id, PeriodReport.period_end <= as_of_period_end)
            .order_by(PeriodReport.period_end.desc(), PeriodReport.created_at.desc())
            .limit(1)
        )
        if r:
            candidates.append((op_id, r.final_points))

    if not candidates:
        return None

    candidates.sort(key=lambda x: x[1], reverse=True)
    for pos, (op_id, _pts) in enumerate(candidates, start=1):
        if op_id == operator_id:
            return pos
    return None


def recalculate_period_ranks(db: Session, week_start: date, week_end: date):
    """
    Сохранено для обратной совместимости сигнатуры (использовалось при
    сохранении WeeklyResult). В новой схеме ранги вычисляются динамически
    в rating_rows() на основе PeriodReport, явный пересчёт не требуется.
    """
    return []
