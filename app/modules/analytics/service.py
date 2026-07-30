"""Бизнес-логика аналитики (ТЗ §15.2).

Оркестрация: собирает строки аналитики из repository, считает через
calculators (compute_*), управляет TTL-кешем, формирует ответы эндпоинтов.
Логика перенесена дословно из routers/analytics.py; формулы не менялись.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.entities import Group, Operator
from app.modules.analytics import calculators as calc
from app.modules.analytics import repository as repo
from app.modules.analytics.cache import cache_get, cache_key, cache_set
from app.modules.analytics.calculators import (
    OperatorAnalyticsRow,
    classify_risk,
    compute_groups_comparison,
    compute_kpi_summary,
    compute_load_vs_efficiency,
    compute_management_dashboard,
    compute_penalties_analytics,
    compute_points_analysis,
    compute_points_breakdown,
    compute_quality_coverage,
    compute_quality_kvz_matrix,
    compute_quality_vs_penalties,
    compute_risk_pyramid,
    compute_top_and_attention,
    filter_rows,
)
from app.modules.analytics.metrics_meta import metric_definition
from app.modules.reports.excel_parser import normalize_name
from app.modules.reports.period_calculator import OperatorPeriodMetrics, aggregate_daily_rows
from app.modules.work_norms.service import calculate_norm_for_period

PERIOD_NOT_CALCULATED_MESSAGE = (
    "Период ещё не рассчитан. Сначала выполните расчёт периода в разделе «Расчёт периода»."
)


def build_site_map(operators: list) -> dict:
    out = {}
    for o in operators:
        key = normalize_name(o.full_name)
        if not key:
            continue
        out[key] = {
            "id": o.id,
            "full_name": o.full_name,
            "group_id": o.group_id,
            "group_name": o.group_name,
            "participation_status": o.participation_status,
        }
    return out


def enrich_metrics_with_norm(
    db: Session,
    m: OperatorPeriodMetrics,
    operator,
    start_date: date,
    end_date: date,
) -> None:
    """Заполняет поля нормы часов в метриках оператора (in-place)."""
    raw_rate = getattr(operator, "rate", None)
    rate = float(raw_rate) if raw_rate is not None else None
    norm_result = calculate_norm_for_period(db, rate, start_date, end_date, m.total_hours)
    m.rate = norm_result.rate
    m.individual_norm_hours = norm_result.individual_norm_hours
    m.norm_completion_percent = norm_result.norm_completion_percent
    m.hours_points = norm_result.hours_points
    m.overtime_hours = norm_result.overtime_hours
    m.overtime_percent = norm_result.overtime_percent
    if norm_result.warnings:
        for w in norm_result.warnings:
            if w not in m.warnings:
                m.warnings.append(w)
    # Пересчитываем итоговые баллы с правильными hours_points
    if norm_result.individual_norm_hours > 0:
        m.final_points = round(
            m.quality_avg + m.kvz + norm_result.hours_points
            + m.efficiency_percent - m.penalty_points,
            2,
        )


def metrics_from_period_report(pr, full_name: str, name_key: str) -> OperatorPeriodMetrics:
    """Строит OperatorPeriodMetrics напрямую из сохранённого PeriodReport (без Excel)."""
    m = OperatorPeriodMetrics(full_name=full_name, name_key=name_key)
    m.quality_avg = pr.quality_avg
    m.quality_calls_count = pr.quality_calls_count
    m.total_hours = pr.total_hours
    m.base_hours = pr.base_hours
    m.tech_issue_hours = pr.tech_issue_hours
    m.training_hours = pr.training_hours
    m.offline_activity_hours = pr.offline_activity_hours
    m.calls_total = pr.calls_total
    m.kvz = pr.kvz
    m.call_time_hours = pr.call_time_hours
    m.efficiency_percent = pr.efficiency_percent
    m.penalty_sum = pr.penalty_sum
    m.penalty_minutes = pr.penalty_minutes
    m.penalty_points = pr.penalty_points
    m.final_points = pr.final_points
    m.has_any_period_data = any([
        m.quality_calls_count > 0,
        m.total_hours > 0,
        m.calls_total > 0,
        m.base_hours > 0,
        m.penalty_sum > 0,
    ])
    if m.quality_calls_count == 0:
        m.warnings.append("Нет оценок качества за выбранный период")
    if m.base_hours <= 0:
        m.warnings.append("Нет базы часов за выбранный период")
    return m


def _period_is_calculated(db: Session, start_date: date, end_date: date) -> bool:
    return repo.period_is_calculated(db, start_date, end_date)


def aggregate_from_daily_metrics(
    db: Session,
    start_date: date,
    end_date: date,
) -> tuple[dict[int, OperatorPeriodMetrics], list[str]]:
    """Агрегирует operator_daily_metrics за диапазон дат (без Excel)."""
    daily_rows = repo.daily_metrics_in_range(db, start_date, end_date)

    by_operator: dict[int, list[dict]] = {}
    covered_dates: set = set()
    for r in daily_rows:
        covered_dates.add(r.metric_date)
        by_operator.setdefault(r.operator_id, []).append({
            "calls_count": r.calls_count,
            "quality_sum": r.quality_sum,
            "quality_count": r.quality_count,
            "worked_hours": r.worked_hours,
            "tech_issue_hours": r.tech_issue_hours,
            "training_hours": r.training_hours,
            "offline_activity_hours": r.offline_activity_hours,
            "efficiency": r.efficiency,
            "penalty_sum": r.penalty_sum,
        })

    warnings: list[str] = []
    total_days = (end_date - start_date).days + 1
    if not daily_rows:
        available = repo.available_data_date_range(db)
        if available:
            warnings.append(
                f"Нет данных за выбранный период. Данные доступны с {available[0].strftime('%d.%m.%Y')} "
                f"по {available[1].strftime('%d.%m.%Y')}."
            )
        else:
            warnings.append("Нет загруженных данных. Загрузите Monthly Report и Report в разделе «Расчёт периода».")
    elif len(covered_dates) < total_days:
        missing_count = total_days - len(covered_dates)
        all_dates = {start_date + timedelta(days=i) for i in range(total_days)}
        missing_dates = sorted(all_dates - covered_dates)
        first_gap, last_gap = missing_dates[0], missing_dates[-1]
        warnings.append(
            f"Данные доступны частично: с {start_date.strftime('%d.%m.%Y')} по {end_date.strftime('%d.%m.%Y')}. "
            f"Нет данных за {missing_count} из {total_days} дн. "
            f"(например {first_gap.strftime('%d.%m.%Y')}"
            + (f" — {last_gap.strftime('%d.%m.%Y')}" if last_gap != first_gap else "")
            + ")."
        )

    metrics_by_operator: dict[int, OperatorPeriodMetrics] = {
        op_id: aggregate_daily_rows(rows) for op_id, rows in by_operator.items()
    }
    return metrics_by_operator, warnings


def data_availability_warning(db: Session, start_date: date, end_date: date) -> str | None:
    """Лёгкая проверка покрытия дат для /summary (п.8 ТЗ)."""
    covered_dates = repo.covered_dates_in_range(db, start_date, end_date)
    total_days = (end_date - start_date).days + 1

    if not covered_dates:
        available = repo.available_data_date_range(db)
        if available:
            return (
                f"Нет данных за выбранный период. Данные доступны с {available[0].strftime('%d.%m.%Y')} "
                f"по {available[1].strftime('%d.%m.%Y')}."
            )
        return "Нет загруженных данных. Загрузите Monthly Report и Report в разделе «Расчёт периода»."

    if len(covered_dates) < total_days:
        missing_count = total_days - len(covered_dates)
        all_dates = {start_date + timedelta(days=i) for i in range(total_days)}
        missing_dates = sorted(all_dates - covered_dates)
        first_gap, last_gap = missing_dates[0], missing_dates[-1]
        return (
            f"Данные доступны частично: с {start_date.strftime('%d.%m.%Y')} по {end_date.strftime('%d.%m.%Y')}. "
            f"Нет данных за {missing_count} из {total_days} дн. "
            f"(например {first_gap.strftime('%d.%m.%Y')}"
            + (f" — {last_gap.strftime('%d.%m.%Y')}" if last_gap != first_gap else "")
            + ")."
        )
    return None


def _save_period_report_from_metrics(
    db: Session,
    operator_id: int,
    start_date: date,
    end_date: date,
    m: OperatorPeriodMetrics,
) -> None:
    """Сохраняет агрегат как PeriodReport (read-cache) через атомарный upsert."""
    values = dict(
        operator_id=operator_id,
        period_start=start_date,
        period_end=end_date,
        quality_avg=m.quality_avg,
        quality_calls_count=m.quality_calls_count,
        total_hours=m.total_hours,
        base_hours=m.base_hours,
        tech_issue_hours=m.tech_issue_hours,
        training_hours=m.training_hours,
        offline_activity_hours=m.offline_activity_hours,
        calls_total=m.calls_total,
        kvz=m.kvz,
        call_time_hours=m.call_time_hours,
        efficiency_percent=m.efficiency_percent,
        penalty_sum=m.penalty_sum,
        penalty_minutes=m.penalty_minutes,
        penalty_points=m.penalty_points,
        final_points=m.final_points,
    )
    repo.upsert_period_report(db, values)


def get_rows(
    db: Session,
    start_date: date,
    end_date: date,
    group_id: int | None = None,
    operator_query: str | None = None,
    participation_status: str | None = None,
    only_with_data: bool = False,
) -> list[OperatorAnalyticsRow]:
    """Строит строки аналитики для произвольного диапазона дат (см. исходный _get_rows)."""
    existing_reports = repo.period_reports_for_range(db, start_date, end_date)

    daily_metrics, warnings = aggregate_from_daily_metrics(db, start_date, end_date)

    if not daily_metrics and not existing_reports and repo.available_data_date_range(db) is None:
        from app.modules.reports.service import ensure_daily_metrics_from_saved_files

        if ensure_daily_metrics_from_saved_files(db):
            daily_metrics, warnings = aggregate_from_daily_metrics(db, start_date, end_date)

    if not daily_metrics and not existing_reports:
        raise HTTPException(status_code=404, detail=" ".join(warnings) or PERIOD_NOT_CALCULATED_MESSAGE)

    all_operator_ids = set(existing_reports.keys()) | set(daily_metrics.keys())
    operators = repo.operators_by_ids(db, all_operator_ids)

    rows: list[OperatorAnalyticsRow] = []
    for operator_id in all_operator_ids:
        operator = operators.get(operator_id)
        if not operator:
            continue

        if operator_id in daily_metrics:
            m = daily_metrics[operator_id]
            m.full_name = operator.full_name
            m.name_key = normalize_name(operator.full_name)
            enrich_metrics_with_norm(db, m, operator, start_date, end_date)
            _save_period_report_from_metrics(db, operator_id, start_date, end_date, m)
        else:
            pr = existing_reports[operator_id]
            name_key = normalize_name(operator.full_name)
            m = metrics_from_period_report(pr, operator.full_name, name_key)
            enrich_metrics_with_norm(db, m, operator, start_date, end_date)

        rows.append(OperatorAnalyticsRow(
            full_name=operator.full_name,
            name_key=normalize_name(operator.full_name),
            operator_id=operator.id,
            group_id=operator.group_id,
            group_name=operator.group_name,
            participation_status=operator.participation_status,
            metrics=m,
            risk_status=classify_risk(m),
        ))

    try:
        db.commit()  # фиксируем новые/обновлённые PeriodReport-кеши
    except Exception:
        db.rollback()

    rows = filter_rows(rows, group_id, operator_query, participation_status, only_with_data)
    return rows


def _operator_row_payload(r: OperatorAnalyticsRow, include_operator_id: bool) -> dict:
    m = r.metrics
    row = {
        "full_name": r.full_name,
        "group_name": r.group_name,
        "calls_total": m.calls_total,
        "total_hours": m.total_hours,
        "base_hours": m.base_hours,
        "kvz": m.kvz if m.base_hours > 0 else None,
        "quality_avg": m.quality_avg if m.quality_calls_count > 0 else None,
        "quality_band": calc.quality_band(m.quality_avg if m.quality_calls_count > 0 else None),
        "quality_calls_count": m.quality_calls_count,
        "call_time_hours": m.call_time_hours,
        "efficiency_percent": m.efficiency_percent if m.base_hours > 0 else None,
        "penalty_minutes": m.penalty_minutes,
        "penalty_points": m.penalty_points,
        "final_points": m.final_points,
        "risk_status": r.risk_status,
        "rate": m.rate,
        "individual_norm_hours": m.individual_norm_hours if m.individual_norm_hours > 0 else None,
        "norm_completion_percent": round(m.norm_completion_percent, 1) if m.individual_norm_hours > 0 else None,
        "hours_points": m.hours_points if m.individual_norm_hours > 0 else None,
        "overtime_hours": m.overtime_hours if m.overtime_hours > 0 else None,
        "overtime_percent": round(m.overtime_percent, 1) if m.overtime_percent > 0 else None,
    }
    if include_operator_id:
        # порядок ключей как в исходном operators-combined (operator_id после group_name)
        return {
            "full_name": r.full_name,
            "group_name": r.group_name,
            "operator_id": r.operator_id,
            **{k: v for k, v in row.items() if k not in ("full_name", "group_name")},
        }
    return row


# ── Payload-функции эндпоинтов ────────────────────────────────────────────────

def available_periods(db: Session, group_id: int | None = None) -> dict:
    # PeriodReport is a calculated snapshot and may legitimately be empty
    # after new Excel files are uploaded. Analytics itself reads arbitrary
    # ranges from OperatorDailyMetric, so expose that range as well.
    periods = {tuple(row) for row in repo.distinct_periods(db, group_id)}
    daily_range = repo.available_data_date_range(db, group_id)
    if not daily_range:
        from app.modules.reports.service import ensure_daily_metrics_from_saved_files

        if ensure_daily_metrics_from_saved_files(db):
            daily_range = repo.available_data_date_range(db, group_id)
    if daily_range:
        periods.add(tuple(daily_range))
    rows = sorted(periods, key=lambda row: (row[1], row[0]), reverse=True)
    return {
        "items": [
            {"start_date": str(s), "end_date": str(e), "label": f"{s.strftime('%d.%m.%Y')} – {e.strftime('%d.%m.%Y')}"}
            for s, e in rows
        ]
    }


def summary(db, start_date, end_date, group_id, operator_query, participation_status) -> dict:
    key = cache_key("summary", start_date=start_date, end_date=end_date, group_id=group_id,
                    operator_query=operator_query, participation_status=participation_status)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = get_rows(db, start_date, end_date, group_id, operator_query, participation_status)
    kpi = compute_kpi_summary(rows)
    availability_warning = data_availability_warning(db, start_date, end_date)
    result = {
        "period": {"start": str(start_date), "end": str(end_date)},
        "kpi": kpi,
        "data_availability_warning": availability_warning,
    }
    cache_set(key, result)
    return result


def _aggregate_by_day(rows) -> dict:
    """metric_date -> [calls, quality_sum, quality_count, base_hours, efficiency,
    penalty_minutes, {operator_ids с данными}]. Единые формулы §10.2."""
    per: dict = {}
    for r in rows:
        d = per.setdefault(r.metric_date, [0.0, 0.0, 0, 0.0, 0.0, 0.0, set()])
        d[0] += r.calls_count or 0
        d[1] += r.quality_sum or 0
        d[2] += int(r.quality_count or 0)
        d[3] += r.base_hours or 0
        d[4] += r.efficiency or 0
        d[5] += r.penalty_minutes or 0
        if (r.worked_hours or 0) > 0 or (r.calls_count or 0) > 0:
            d[6].add(r.operator_id)
    return per


def _metric_value_for_day(agg, metric: str):
    calls, qsum, qcount, base, eff, pen, ops = agg
    if metric == "calls":
        return round(calls, 2)
    if metric == "kvz":
        return round(calls / base, 2) if base > 0 else None
    if metric == "quality":
        return round(qsum / qcount, 2) if qcount > 0 else None
    if metric == "efficiency":
        return round(eff / base * 100, 2) if base > 0 else None
    if metric == "penalty":
        return round(pen, 2)
    if metric == "operators":
        return len(ops)
    return None


def _scope_info(db, group_id, operator_id) -> dict:
    if operator_id is not None:
        op = db.get(Operator, operator_id)
        return {"kind": "operator", "operator_id": operator_id, "group_id": group_id,
                "label": op.full_name if op else f"Оператор {operator_id}"}
    if group_id is not None:
        grp = db.get(Group, group_id)
        return {"kind": "group", "group_id": group_id, "operator_id": None,
                "label": grp.name if grp else f"Группа {group_id}"}
    return {"kind": "team", "group_id": None, "operator_id": None, "label": "Вся команда"}


def _empty_reason(db, has_rows: bool) -> str | None:
    if has_rows:
        return None
    return "no_data_in_selected_period" if repo.available_data_date_range(db) else "no_reports_uploaded"


def _period_metric_average(values) -> float | None:
    vals = [v for v in values if v is not None]
    return round(sum(vals) / len(vals), 2) if vals else None


def _previous_period_summary(db, start_date, end_date, metric, group_id, operator_id,
                             participation_status, current_values) -> dict:
    length = (end_date - start_date).days + 1
    prev_end = start_date - timedelta(days=1)
    prev_start = prev_end - timedelta(days=length - 1)
    prev_rows = repo.scoped_daily_metrics(
        db, prev_start, prev_end, group_id=group_id,
        operator_id=operator_id, participation_status=participation_status,
    )
    prev_values = [_metric_value_for_day(a, metric) for a in _aggregate_by_day(prev_rows).values()]
    prev_avg = _period_metric_average(prev_values)
    cur_avg = _period_metric_average(current_values)
    change = round(cur_avg - prev_avg, 2) if (cur_avg is not None and prev_avg is not None) else None
    return {"start": str(prev_start), "end": str(prev_end),
            "average": prev_avg, "change": change}


def daily_dynamics(db, start_date, end_date, metric, group_id,
                   operator_id=None, participation_status=None) -> dict:
    """Посуточная динамика из operator_daily_metrics (ТЗ §8, §10.1).

    Excel не парсится. Один и тот же scope для всех метрик. Дни без данных —
    разрыв (value=None, has_data=False), а не 0. Пустой результат — 200 с
    empty_reason, а не 400/500.
    """
    if (end_date - start_date).days > 92:
        raise HTTPException(status_code=400, detail="Период для динамики по дням ограничен 92 днями")

    rows = repo.scoped_daily_metrics(
        db, start_date, end_date, group_id=group_id,
        operator_id=operator_id, participation_status=participation_status,
    )
    per = _aggregate_by_day(rows)

    items, covered, missing, day_values = [], [], [], []
    cur = start_date
    while cur <= end_date:
        agg = per.get(cur)
        if agg is None:
            items.append({"date": str(cur), "value": None, "calls": None, "kvz": None,
                          "quality": None, "efficiency": None, "penalty": None,
                          "operators_on_line": None, "has_data": False})
            missing.append(str(cur))
        else:
            value = _metric_value_for_day(agg, metric)
            items.append({
                "date": str(cur),
                "value": value,
                "calls": _metric_value_for_day(agg, "calls"),
                "kvz": _metric_value_for_day(agg, "kvz"),
                "quality": _metric_value_for_day(agg, "quality"),
                "efficiency": _metric_value_for_day(agg, "efficiency"),
                "penalty": _metric_value_for_day(agg, "penalty"),
                "operators_on_line": _metric_value_for_day(agg, "operators"),
                "has_data": True,
            })
            covered.append(str(cur))
            if value is not None:
                day_values.append(value)
        cur += timedelta(days=1)

    operators_with_data = len({
        r.operator_id for r in rows if (r.worked_hours or 0) > 0 or (r.calls_count or 0) > 0
    })
    return {
        "metric": metric,
        "metric_definition": metric_definition(metric),
        "scope": _scope_info(db, group_id, operator_id),
        "items": items,
        "covered_dates": covered,
        "missing_dates": missing,
        "operators_with_data": operators_with_data,
        "previous_period": _previous_period_summary(
            db, start_date, end_date, metric, group_id, operator_id,
            participation_status, day_values,
        ),
        "data_source": "operator_daily_metrics",
        "empty_reason": _empty_reason(db, bool(rows)),
    }


def operators_table(db, start_date, end_date, group_id, operator_query, participation_status, only_with_data) -> dict:
    key = cache_key("operators", start_date=start_date, end_date=end_date, group_id=group_id,
                    operator_query=operator_query, participation_status=participation_status,
                    only_with_data=only_with_data)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = get_rows(db, start_date, end_date, group_id, operator_query, participation_status, only_with_data)
    out = [_operator_row_payload(r, include_operator_id=False) for r in rows]
    return {"items": out}


def groups_comparison(db, start_date, end_date, group_id=None) -> dict:
    key = cache_key(
        "groups-comparison", start_date=start_date, end_date=end_date, group_id=group_id
    )
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = get_rows(db, start_date, end_date, group_id)
    result = {"items": compute_groups_comparison(rows)}
    cache_set(key, result)
    return result


def quality_kvz_matrix(db, start_date, end_date, group_id) -> dict:
    key = cache_key("quality-kvz-matrix", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = get_rows(db, start_date, end_date, group_id)
    result = {"items": compute_quality_kvz_matrix(rows), "thresholds": {"quality": 85, "kvz": 10}}
    cache_set(key, result)
    return result


def top_and_attention(db, start_date, end_date, group_id) -> dict:
    key = cache_key("top-and-attention", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = get_rows(db, start_date, end_date, group_id)
    result = compute_top_and_attention(rows)
    cache_set(key, result)
    return result


def penalties(db, start_date, end_date, group_id) -> dict:
    key = cache_key("penalties", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = get_rows(db, start_date, end_date, group_id)
    result = compute_penalties_analytics(rows)
    cache_set(key, result)
    return result


def points_breakdown(db, start_date, end_date, group_id, operator_query) -> dict:
    key = cache_key("points-breakdown", start_date=start_date, end_date=end_date, group_id=group_id,
                    operator_query=operator_query)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = get_rows(db, start_date, end_date, group_id, operator_query)
    result = {"items": compute_points_breakdown(rows)}
    cache_set(key, result)
    return result


def points_analysis(db, start_date, end_date, group_id, operator_query, participation_status, only_with_data) -> dict:
    key = cache_key("points", start_date=start_date, end_date=end_date, group_id=group_id,
                    operator_query=operator_query, participation_status=participation_status,
                    only_with_data=only_with_data)
    cached = cache_get(key)
    if cached is not None:
        return cached

    rows = get_rows(db, start_date, end_date, group_id, operator_query, participation_status, only_with_data)

    period_length = (end_date - start_date).days
    prev_end = start_date - timedelta(days=1)
    prev_start = prev_end - timedelta(days=period_length)

    prev_rows = None
    try:
        prev_rows = get_rows(db, prev_start, prev_end, group_id, operator_query, participation_status, only_with_data)
    except HTTPException:
        prev_rows = None

    analysis = compute_points_analysis(rows, prev_rows)
    analysis["period"] = {"start": str(start_date), "end": str(end_date)}
    analysis["previous_period"] = {"start": str(prev_start), "end": str(prev_end)} if prev_rows else None
    cache_set(key, analysis)
    return analysis


def _grid_cell(r, metric: str):
    """Значение и (для качества) число оценок ячейки сетки за один день."""
    if metric == "quality":
        value = round(r.quality_sum / r.quality_count, 2) if r.quality_count else None
        return value, int(r.quality_count or 0)
    if metric == "calls":
        return round(r.calls_count or 0, 2), int(r.calls_count or 0)
    if metric == "kvz":
        return (round(r.calls_count / r.base_hours, 2) if r.base_hours else None), None
    if metric == "efficiency":
        return (round(r.efficiency / r.base_hours * 100, 2) if r.base_hours else None), None
    if metric == "penalty":
        return round(r.penalty_minutes or 0, 2), None
    return None, None


def heatmap(db, start_date, end_date, metric, group_id) -> dict:
    """Сетка «оператор × день» из operator_daily_metrics (ТЗ §10.1).

    Excel не парсится. Совместимый со старым фронтом формат
    ({dates, operators:[{full_name, values}], metric}); дни без данных — None.
    Новый контракт — в daily_grid().
    """
    if (end_date - start_date).days > 31:
        raise HTTPException(status_code=400, detail="Сетка ограничена периодом 31 день")

    rows = repo.scoped_daily_metrics(db, start_date, end_date, group_id=group_id)
    dates, cur = [], start_date
    while cur <= end_date:
        dates.append(str(cur))
        cur += timedelta(days=1)

    by_op: dict = {}
    names: dict = {}
    for r in rows:
        by_op.setdefault(r.operator_id, {})[str(r.metric_date)] = r
        names[r.operator_id] = r.operator_name
    live = repo.operators_by_ids(db, list(by_op.keys())) if by_op else {}

    operators_out = []
    for op_id, day_map in by_op.items():
        op = live.get(op_id)
        values = {d: (_grid_cell(day_map[d], metric)[0] if d in day_map else None) for d in dates}
        operators_out.append({"full_name": op.full_name if op else names.get(op_id, ""), "values": values})
    operators_out.sort(key=lambda o: o["full_name"])
    return {"dates": dates, "operators": operators_out, "metric": metric}


def daily_grid(db, week_start, metric, group_id, operator_id=None, participation_status=None) -> dict:
    """Недельная сетка оценок «оператор × день» из БД (ТЗ §7.3, §10.3).

    Не более 7 дней, недельная пагинация вместо горизонтального скролла.
    Ячейка: значение + число оценок; дни без данных пропущены (разрыв).
    """
    week_end = week_start + timedelta(days=6)
    dates = [week_start + timedelta(days=i) for i in range(7)]
    rows = repo.scoped_daily_metrics(
        db, week_start, week_end, group_id=group_id,
        operator_id=operator_id, participation_status=participation_status,
    )

    by_op: dict = {}
    names: dict = {}
    groups: dict = {}
    for r in rows:
        by_op.setdefault(r.operator_id, {})[str(r.metric_date)] = r
        names[r.operator_id] = r.operator_name
        groups[r.operator_id] = r.group_id
    live = repo.operators_by_ids(db, list(by_op.keys())) if by_op else {}

    operators = []
    for op_id, day_map in by_op.items():
        op = live.get(op_id)
        values = {}
        for d in dates:
            ds = str(d)
            r = day_map.get(ds)
            if r is None:
                continue  # разрыв, а не 0
            value, count = _grid_cell(r, metric)
            values[ds] = {"value": value, "count": count}
        operators.append({
            "operator_id": op_id,
            "full_name": op.full_name if op else names.get(op_id, ""),
            "group_id": op.group_id if op else groups.get(op_id),
            "values": values,
        })
    operators.sort(key=lambda o: o["full_name"])

    meta = metric_definition(metric)
    return {
        "metric": metric,
        "metric_definition": meta,
        "scope": _scope_info(db, group_id, operator_id),
        "week_start": str(week_start),
        "dates": [str(d) for d in dates],
        "operators": operators,
        "legend": {"critical": meta["critical_threshold"], "target": meta["target"],
                   "direction": meta["direction"]},
        "data_source": "operator_daily_metrics",
        "empty_reason": _empty_reason(db, bool(rows)),
    }


def risk_pyramid(db, start_date, end_date, group_id) -> dict:
    key = cache_key("risk-pyramid", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = get_rows(db, start_date, end_date, group_id)
    result = compute_risk_pyramid(rows)
    cache_set(key, result)
    return result


def quality_coverage(db, start_date, end_date, group_id) -> dict:
    key = cache_key("quality-coverage", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = get_rows(db, start_date, end_date, group_id)
    result = compute_quality_coverage(rows)
    cache_set(key, result)
    return result


def load_vs_efficiency(db, start_date, end_date, group_id) -> dict:
    key = cache_key("load-vs-efficiency", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = get_rows(db, start_date, end_date, group_id)
    result = {"items": compute_load_vs_efficiency(rows)}
    cache_set(key, result)
    return result


def quality_vs_penalties(db, start_date, end_date, group_id) -> dict:
    key = cache_key("quality-vs-penalties", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = get_rows(db, start_date, end_date, group_id)
    result = {"items": compute_quality_vs_penalties(rows)}
    cache_set(key, result)
    return result


def overview(db, start_date, end_date, group_id, operator_query, participation_status) -> dict:
    key = cache_key("overview", start_date=start_date, end_date=end_date,
                    group_id=group_id, operator_query=operator_query,
                    participation_status=participation_status)
    cached = cache_get(key)
    if cached is not None:
        return cached

    rows = get_rows(db, start_date, end_date, group_id, operator_query, participation_status)
    kpi = compute_kpi_summary(rows)
    groups_cmp = compute_groups_comparison(rows)
    risk_pyr = compute_risk_pyramid(rows)
    availability_warning = data_availability_warning(db, start_date, end_date)

    result = {
        "period": {"start": str(start_date), "end": str(end_date)},
        "kpi": kpi,
        "data_availability_warning": availability_warning,
        "groups_comparison": groups_cmp,
        "risk_pyramid": risk_pyr,
        "warnings": [],
    }
    cache_set(key, result, ttl_seconds=600)  # 10 минут — дольше стандартного
    return result


def management_dashboard(db, start_date, end_date, group_id, operator_query, participation_status) -> dict:
    key = cache_key("management-dashboard", start_date=start_date, end_date=end_date,
                    group_id=group_id, operator_query=operator_query,
                    participation_status=participation_status)
    cached = cache_get(key)
    if cached is not None:
        return cached

    rows = get_rows(db, start_date, end_date, group_id, operator_query, participation_status)
    result = compute_management_dashboard(rows)
    result["period"] = {"start": str(start_date), "end": str(end_date)}
    result["data_availability_warning"] = data_availability_warning(db, start_date, end_date)
    cache_set(key, result, ttl_seconds=300)
    return result


def operators_combined(db, start_date, end_date, group_id, operator_query, participation_status, only_with_data) -> dict:
    key = cache_key("operators-combined", start_date=start_date, end_date=end_date,
                    group_id=group_id, operator_query=operator_query,
                    participation_status=participation_status, only_with_data=only_with_data)
    cached = cache_get(key)
    if cached is not None:
        return cached

    rows = get_rows(db, start_date, end_date, group_id, operator_query, participation_status, only_with_data)
    ops_out = [_operator_row_payload(r, include_operator_id=True) for r in rows]
    top_attn = compute_top_and_attention(rows)

    result = {"items": ops_out, "top_and_attention": top_attn}
    cache_set(key, result, ttl_seconds=300)
    return result


def matrix_combined(db, start_date, end_date, group_id) -> dict:
    key = cache_key("matrix-combined", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached

    rows = get_rows(db, start_date, end_date, group_id)
    result = {
        "quality_kvz": compute_quality_kvz_matrix(rows),
        "quality_penalties": compute_quality_vs_penalties(rows),
        "load_efficiency": compute_load_vs_efficiency(rows),
        "thresholds": {"quality": 85, "kvz": 10},
    }
    cache_set(key, result, ttl_seconds=300)
    return result


def quality_combined(db, start_date, end_date, group_id) -> dict:
    key = cache_key("quality-combined", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached

    rows = get_rows(db, start_date, end_date, group_id)
    result = {
        "coverage": compute_quality_coverage(rows),
        "penalties": compute_penalties_analytics(rows),
    }
    cache_set(key, result, ttl_seconds=300)
    return result


def groups_list(db, group_id=None) -> dict:
    groups = repo.active_groups(db, group_id)
    return {"items": [{"id": g.id, "name": g.name} for g in groups]}
