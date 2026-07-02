"""
Сервис рейтинга операторов.

Строит турнирную таблицу из таблицы PeriodReport — расчётов, сохранённых
через раздел «Расчёт периода» (Excel-импорт Monthly Report + Report).
Для каждого оператора берётся последний сохранённый период (по period_end),
ранжирование — по final_points. Динамика места считается относительно
предыдущего по дате сохранённого периода того же оператора.

Производительность: вся история PeriodReport нужных операторов загружается
ОДНИМ SQL-запросом и дальше обрабатывается в памяти (группировка, сортировка,
восстановление исторического ранга) — раньше на каждого оператора уходило
до N дополнительных запросов (1 на "предыдущий период" + N на "место на тот
момент"), что давало O(N²) запросов к БД при построении рейтинга.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select
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


def _all_reports_grouped(db: Session) -> Dict[int, List[PeriodReport]]:
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
    grouped: Dict[int, List[PeriodReport]] = defaultdict(list)
    for r in all_reports:
        grouped[r.operator_id].append(r)
    return grouped


def rating_rows(db: Session, week_start: Optional[date] = None, week_end: Optional[date] = None) -> List[Dict]:
    """
    Возвращает турнирную таблицу. week_start/week_end пока игнорируются для
    обратной совместимости сигнатуры — рейтинг строится по последнему
    сохранённому расчёту каждого оператора (т.к. разные операторы могут быть
    рассчитаны за разные периоды через «Расчёт периода»).
    """
    grouped = _all_reports_grouped(db)
    if not grouped:
        return []

    operator_ids = list(grouped.keys())
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
    for op_id, reports in grouped.items():
        operator = operators.get(op_id)
        if not operator:
            continue  # не участвует / уволен / неактивен — не попадает в рейтинг
        entries.append((operator, reports[0], reports))  # reports[0] = самый свежий

    # Ранжирование по итоговым баллам текущего (самого свежего) расчёта
    entries.sort(key=lambda e: e[1].final_points, reverse=True)

    # ── Восстановление исторического ранга для расчёта rank_delta ──────
    # Для каждого "as_of" момента (period_end предыдущего отчёта оператора)
    # нужно знать место среди ВСЕХ операторов на тот момент. Вместо запроса
    # в БД на каждого оператора — строим это полностью в памяти: для каждого
    # уникального as_of-момента один раз вычисляем полный отсортированный
    # снимок (kандидат = последний отчёт оператора с period_end <= as_of).
    def snapshot_at(as_of: date) -> List[Tuple[int, float]]:
        """Возвращает [(operator_id, final_points)] для всех операторов на момент as_of."""
        snap = []
        for op_id, reports in grouped.items():
            if operators.get(op_id) is None:
                continue
            candidate = next((r for r in reports if r.period_end <= as_of), None)
            if candidate:
                snap.append((op_id, candidate.final_points))
        snap.sort(key=lambda x: x[1], reverse=True)
        return snap

    # Кешируем снимки по as_of-дате — разные операторы часто делят один и тот
    # же "предыдущий период", поэтому снимок пересчитывается не на каждого
    # оператора отдельно, а максимум один раз на каждую уникальную дату.
    snapshot_cache: Dict[date, Dict[int, int]] = {}

    def rank_position_at(operator_id: int, as_of: date) -> Optional[int]:
        if as_of not in snapshot_cache:
            snap = snapshot_at(as_of)
            snapshot_cache[as_of] = {op_id: pos for pos, (op_id, _pts) in enumerate(snap, start=1)}
        return snapshot_cache[as_of].get(operator_id)

    output = []
    for position, (operator, report, reports) in enumerate(entries, start=1):
        prev_report = reports[1] if len(reports) > 1 else None
        rank_delta = None
        if prev_report is not None:
            prev_position = rank_position_at(operator.id, prev_report.period_end)
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


def recalculate_period_ranks(db: Session, week_start: date, week_end: date):
    """
    Сохранено для обратной совместимости сигнатуры (использовалось при
    сохранении WeeklyResult). В новой схеме ранги вычисляются динамически
    в rating_rows() на основе PeriodReport, явный пересчёт не требуется.
    """
    return []
"""
Сервис рейтинга операторов.

Строит турнирную таблицу из таблицы PeriodReport — расчётов, сохранённых
через раздел «Расчёт периода» (Excel-импорт Monthly Report + Report).
Для каждого оператора берётся последний сохранённый период (по period_end),
ранжирование — по final_points. Динамика места считается относительно
предыдущего по дате сохранённого периода того же оператора.

Производительность: вся история PeriodReport нужных операторов загружается
ОДНИМ SQL-запросом и дальше обрабатывается в памяти (группировка, сортировка,
восстановление исторического ранга) — раньше на каждого оператора уходило
до N дополнительных запросов (1 на "предыдущий период" + N на "место на тот
момент"), что давало O(N²) запросов к БД при построении рейтинга.
"""
from __future__ import annotations

import time
from collections import defaultdict
from datetime import date
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Operator, OperatorLevel, OperatorLevelAssignment, PeriodReport

# Простой in-memory кеш рейтинга — пересчёт тяжёлый (все PeriodReport + снапшоты),
# а данные меняются редко (только после сохранения расчёта). Кеш живёт 60 секунд.
_RATING_CACHE: Dict = {}
_RATING_CACHE_TTL = 60  # секунд


def _rating_cache_get() -> Optional[List[Dict]]:
    entry = _RATING_CACHE.get("rows")
    if entry and (time.time() - entry["ts"]) < _RATING_CACHE_TTL:
        return entry["data"]
    return None


def _rating_cache_set(rows: List[Dict]) -> None:
    _RATING_CACHE["rows"] = {"data": rows, "ts": time.time()}


def rating_cache_invalidate() -> None:
    """Вызывать после сохранения нового PeriodReport."""
    _RATING_CACHE.clear()


def latest_period(db: Session) -> Optional[Tuple[date, date]]:
    """Последний сохранённый период по максимальной period_end среди всех расчётов."""
    result = db.execute(
        select(PeriodReport.period_start, PeriodReport.period_end)
        .order_by(PeriodReport.period_end.desc(), PeriodReport.created_at.desc())
        .limit(1)
    ).first()
    return tuple(result) if result else None


def _all_reports_grouped(db: Session) -> Dict[int, List[PeriodReport]]:
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
    grouped: Dict[int, List[PeriodReport]] = defaultdict(list)
    for r in all_reports:
        grouped[r.operator_id].append(r)
    return grouped


def rating_rows(db: Session, week_start: Optional[date] = None, week_end: Optional[date] = None) -> List[Dict]:
    """
    Возвращает турнирную таблицу. week_start/week_end пока игнорируются для
    обратной совместимости сигнатуры — рейтинг строится по последнему
    сохранённому расчёту каждого оператора (т.к. разные операторы могут быть
    рассчитаны за разные периоды через «Расчёт периода»).
    """
    # Проверяем in-memory кеш — рейтинг тяжёлый, данные меняются редко
    cached = _rating_cache_get()
    if cached is not None:
        return cached

    grouped = _all_reports_grouped(db)
    if not grouped:
        return []

    operator_ids = list(grouped.keys())
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
    for op_id, reports in grouped.items():
        operator = operators.get(op_id)
        if not operator:
            continue  # не участвует / уволен / неактивен — не попадает в рейтинг
        entries.append((operator, reports[0], reports))  # reports[0] = самый свежий

    # Ранжирование по итоговым баллам текущего (самого свежего) расчёта
    entries.sort(key=lambda e: e[1].final_points, reverse=True)

    # ── Восстановление исторического ранга для расчёта rank_delta ──────
    # Для каждого "as_of" момента (period_end предыдущего отчёта оператора)
    # нужно знать место среди ВСЕХ операторов на тот момент. Вместо запроса
    # в БД на каждого оператора — строим это полностью в памяти: для каждого
    # уникального as_of-момента один раз вычисляем полный отсортированный
    # снимок (kандидат = последний отчёт оператора с period_end <= as_of).
    def snapshot_at(as_of: date) -> List[Tuple[int, float]]:
        """Возвращает [(operator_id, final_points)] для всех операторов на момент as_of."""
        snap = []
        for op_id, reports in grouped.items():
            if operators.get(op_id) is None:
                continue
            candidate = next((r for r in reports if r.period_end <= as_of), None)
            if candidate:
                snap.append((op_id, candidate.final_points))
        snap.sort(key=lambda x: x[1], reverse=True)
        return snap

    # Кешируем снимки по as_of-дате — разные операторы часто делят один и тот
    # же "предыдущий период", поэтому снимок пересчитывается не на каждого
    # оператора отдельно, а максимум один раз на каждую уникальную дату.
    snapshot_cache: Dict[date, Dict[int, int]] = {}

    def rank_position_at(operator_id: int, as_of: date) -> Optional[int]:
        if as_of not in snapshot_cache:
            snap = snapshot_at(as_of)
            snapshot_cache[as_of] = {op_id: pos for pos, (op_id, _pts) in enumerate(snap, start=1)}
        return snapshot_cache[as_of].get(operator_id)

    # Bulk-загрузка уровней ОДНИМ запросом вместо N вызовов operator_level_badge
    op_ids = [op.id for op, _, _ in entries]
    level_rows = list(db.execute(
        select(OperatorLevelAssignment, OperatorLevel)
        .join(OperatorLevel, OperatorLevelAssignment.level_id == OperatorLevel.id)
        .where(OperatorLevelAssignment.operator_id.in_(op_ids))
    )) if op_ids else []
    level_map = {
        assignment.operator_id: {
            "id": level.id, "code": level.code, "name": level.name,
            "color": level.color, "icon": level.icon, "sort_order": level.sort_order,
        }
        for assignment, level in level_rows
    }
    default_level = {"id": None, "code": "trainee", "name": "Стажёр", "color": "#64748B", "icon": "seedling", "sort_order": 10}

    output = []
    for position, (operator, report, reports) in enumerate(entries, start=1):
        prev_report = reports[1] if len(reports) > 1 else None
        rank_delta = None
        if prev_report is not None:
            prev_position = rank_position_at(operator.id, prev_report.period_end)
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
            "level": level_map.get(operator.id, default_level),
        })
    _rating_cache_set(output)
    return output


def recalculate_period_ranks(db: Session, week_start: date, week_end: date):
    """
    Сохранено для обратной совместимости сигнатуры (использовалось при
    сохранении WeeklyResult). В новой схеме ранги вычисляются динамически
    в rating_rows() на основе PeriodReport, явный пересчёт не требуется.
    """
    return []
