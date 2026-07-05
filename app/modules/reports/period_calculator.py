"""Расчёт показателей операторов за период (ТЗ Этап 6, period_calculator.py).

Перенос из services/period_reports.py БЕЗ изменения формул. Использует парсеры
из excel_parser. Формулы КВЗ/эффективности/штрафов/итоговых баллов не менялись.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from app.modules.reports.excel_parser import (
    _SERVICE_ROWS,
    QualityResult,
    is_service_row,
    normalize_name,
    parse_monthly_report,
    parse_monthly_report_daily,
    parse_report_file,
    parse_report_file_daily,
)


@dataclass
class OperatorPeriodMetrics:
    full_name: str
    name_key: str = ""
    quality_avg: float = 0.0
    quality_calls_count: int = 0
    quality_scores: list[float] = field(default_factory=list)
    total_hours: float = 0.0
    base_hours: float = 0.0
    tech_issue_hours: float = 0.0
    training_hours: float = 0.0
    offline_activity_hours: float = 0.0
    calls_total: float = 0.0
    kvz: float = 0.0
    call_time_hours: float = 0.0
    efficiency_percent: float = 0.0
    penalty_sum: float = 0.0
    penalty_minutes: float = 0.0
    penalty_points: float = 0.0
    final_points: float = 0.0
    has_any_period_data: bool = False
    warnings: list[str] = field(default_factory=list)
    # Поля нормы часов (заполняются отдельно через work_norms сервис)
    rate: float | None = None
    individual_norm_hours: float = 0.0
    norm_completion_percent: float = 0.0
    hours_points: float = 0.0
    overtime_hours: float = 0.0
    overtime_percent: float = 0.0
    norm_warnings: list[str] = field(default_factory=list)


PENALTY_RUB_PER_MINUTE = 50.0
PENALTY_POINTS_PER_MINUTE = 5.0


def compute_operator_metrics(
    name_key: str,
    display_name: str,
    quality: QualityResult | None,
    report_data: dict[str, dict[str, tuple[str, float]]],
) -> OperatorPeriodMetrics:
    m = OperatorPeriodMetrics(full_name=display_name, name_key=name_key)

    # Качество
    if quality and quality.scores:
        m.quality_avg = quality.avg
        m.quality_calls_count = quality.count
        m.quality_scores = list(quality.scores)
    else:
        m.warnings.append("Нет оценок качества за выбранный период")

    def sheet_val(sheet: str) -> float:
        entry = report_data.get(sheet, {}).get(name_key)
        return entry[1] if entry else 0.0

    m.total_hours = round(sheet_val("Отработанные часы"), 2)
    m.tech_issue_hours = round(sheet_val("Тех. сбои"), 2)
    m.training_hours = round(sheet_val("Тренинги"), 2)
    m.offline_activity_hours = round(sheet_val("Офлайн активность"), 2)

    base = m.total_hours - m.tech_issue_hours - m.training_hours - m.offline_activity_hours
    if base < 0:
        m.warnings.append("База часов получилась отрицательной. Проверьте тренинги, техсбои и офлайн-активность.")
        base = 0.0
    m.base_hours = round(base, 2)

    m.calls_total = round(sheet_val("Звонки"), 2)
    if m.base_hours > 0:
        m.kvz = round(m.calls_total / m.base_hours, 2)
    else:
        m.kvz = 0.0
        m.warnings.append("Нет базы часов за выбранный период")

    m.call_time_hours = round(sheet_val("Эффективность"), 2)
    if m.base_hours > 0:
        m.efficiency_percent = round(m.call_time_hours / m.base_hours * 100, 2)
    else:
        m.efficiency_percent = 0.0
        if "Нет базы часов за выбранный период" not in m.warnings:
            m.warnings.append("Нет базы часов для расчёта эффективности")

    m.penalty_sum = round(sheet_val("Штрафы"), 2)
    m.penalty_minutes = round(m.penalty_sum / PENALTY_RUB_PER_MINUTE, 2) if m.penalty_sum else 0.0
    m.penalty_points = round(m.penalty_minutes * PENALTY_POINTS_PER_MINUTE, 2)

    # Базовые итоговые баллы БЕЗ часов — norm-aware финальный расчёт
    # делается в роутере после enrich_with_norm(). Сохраняем 0 за часы
    # чтобы роутер мог корректно подставить hours_points.
    m.final_points = round(
        m.quality_avg + m.kvz + m.total_hours + m.efficiency_percent - m.penalty_points,
        2,
    )
    # Пометим что hours_points ещё не заполнен — роутер подставит позже

    m.has_any_period_data = any([
        m.quality_calls_count > 0,
        m.total_hours > 0,
        m.calls_total > 0,
        m.base_hours > 0,
        m.penalty_sum > 0,
    ])

    return m


@dataclass
class PeriodCalculationResult:
    operators: list[OperatorPeriodMetrics]              # только matched, с данными
    warnings_site_only: list[str]                        # есть на сайте, нет в файле
    warnings_file_only: list[str]                        # есть в файле, нет на сайте
    warnings_no_quality: list[str]                       # нет оценок качества
    warnings_no_base_hours: list[str]                    # нет базы часов
    ignored_service_rows: list[str]                      # игнорированные служебные строки
    summary: dict[str, float | None]                  # сводные показатели


def calculate_period_report(
    monthly_report_bytes: bytes,
    report_bytes: bytes,
    period_start: date,
    period_end: date,
    site_operator_names: list[str],
) -> PeriodCalculationResult:
    """
    site_operator_names — список full_name операторов из БД сайта.
    Используется для построения matched-выборки: в расчёт идут только те,
    кто есть и на сайте, и в файле.
    """
    if period_start > period_end:
        raise ValueError("Дата начала не может быть позже даты окончания")

    quality_map = parse_monthly_report(monthly_report_bytes, period_start, period_end)
    report_data = parse_report_file(report_bytes, period_start, period_end)

    # Множество имён операторов сайта (нормализованных)
    site_keys = {normalize_name(n): n for n in site_operator_names if n and not is_service_row(n)}

    # Все ключи из файлов (только реальные, не служебные — уже отфильтровано на парсинге)
    file_keys: dict[str, str] = {}
    for key, qr in quality_map.items():
        file_keys.setdefault(key, qr.display_name)
    for sheet_data in report_data.values():
        for key, (disp, _val) in sheet_data.items():
            file_keys.setdefault(key, disp)

    matched_keys = set(site_keys.keys()) & set(file_keys.keys())
    site_only_keys = set(site_keys.keys()) - set(file_keys.keys())
    file_only_keys = set(file_keys.keys()) - set(site_keys.keys())

    operators: list[OperatorPeriodMetrics] = []
    warnings_no_quality: list[str] = []
    warnings_no_base_hours: list[str] = []

    for key in sorted(matched_keys):
        display = site_keys.get(key) or file_keys.get(key) or key
        q = quality_map.get(key)
        metrics = compute_operator_metrics(key, display, q, report_data)

        if not metrics.has_any_period_data:
            # Matched, но реально нет никаких данных за период — не включаем в расчёт
            continue

        operators.append(metrics)
        if "Нет оценок качества за выбранный период" in metrics.warnings:
            warnings_no_quality.append(display)
        if "Нет базы часов за выбранный период" in metrics.warnings:
            warnings_no_base_hours.append(display)

    operators.sort(key=lambda m: m.final_points, reverse=True)

    warnings_site_only = sorted(site_keys[k] for k in site_only_keys)
    warnings_file_only = sorted(file_keys[k] for k in file_only_keys)

    # Сводные показатели — считаем ТОЛЬКО по matched + has_any_period_data
    included = operators  # уже отфильтрованы выше

    all_quality_scores: list[float] = []
    for op in included:
        all_quality_scores.extend(op.quality_scores)
    avg_quality = round(sum(all_quality_scores) / len(all_quality_scores), 2) if all_quality_scores else None

    total_calls = sum(op.calls_total for op in included)
    total_base_hours = sum(op.base_hours for op in included if op.base_hours > 0)
    total_call_time = sum(op.call_time_hours for op in included if op.base_hours > 0)
    total_penalty_sum = sum(op.penalty_sum for op in included)

    avg_kvz = round(total_calls / total_base_hours, 2) if total_base_hours > 0 else None
    avg_efficiency = round(total_call_time / total_base_hours * 100, 2) if total_base_hours > 0 else None
    penalty_minutes_total = round(total_penalty_sum / PENALTY_RUB_PER_MINUTE, 2) if total_penalty_sum else 0.0

    summary = {
        "operators_count": len(included),
        "site_total_count": len(site_keys),
        "matched_count": len(matched_keys),
        "site_only_count": len(site_only_keys),
        "file_only_count": len(file_only_keys),
        "avg_quality": avg_quality,
        "total_calls": round(total_calls, 2),
        "avg_kvz": avg_kvz,
        "avg_efficiency": avg_efficiency,
        "penalty_minutes_total": penalty_minutes_total,
    }

    return PeriodCalculationResult(
        operators=operators,
        warnings_site_only=warnings_site_only,
        warnings_file_only=warnings_file_only,
        warnings_no_quality=warnings_no_quality,
        warnings_no_base_hours=warnings_no_base_hours,
        ignored_service_rows=sorted(_SERVICE_ROWS),
        summary=summary,
    )


@dataclass
class DailyMetricRow:
    name_key: str
    display_name: str
    metric_date: date
    calls_count: float = 0.0
    quality_scores: list[float] = field(default_factory=list)
    worked_hours: float = 0.0
    tech_issue_hours: float = 0.0
    training_hours: float = 0.0
    offline_activity_hours: float = 0.0
    call_time_hours: float = 0.0  # лист "Эффективность" — часы в звонке за день
    penalty_sum: float = 0.0


def build_daily_metric_rows(
    monthly_bytes: bytes,
    report_bytes: bytes,
    default_year: int | None = None,
) -> list[DailyMetricRow]:
    """
    Главная точка входа для посуточного парсинга. Объединяет Monthly Report
    (оценки качества) и Report (часы/звонки/штрафы) в единый список строк
    "оператор × дата", готовых для сохранения в OperatorDailyMetric.

    Вызывается ОДИН раз при загрузке файлов — не при построении аналитики.
    """
    quality_by_day = parse_monthly_report_daily(monthly_bytes, default_year)
    report_by_sheet = parse_report_file_daily(report_bytes, default_year)

    keys = set(quality_by_day.keys())
    for sheet_data in report_by_sheet.values():
        keys |= set(sheet_data.keys())

    display_names: dict[str, str] = {}
    for (name_key, _d), data in quality_by_day.items():
        display_names.setdefault(name_key, data["display_name"])
    for sheet_data in report_by_sheet.values():
        for (name_key, _d), (disp, _val) in sheet_data.items():
            display_names.setdefault(name_key, disp)

    rows: list[DailyMetricRow] = []
    for name_key, metric_date in sorted(keys):
        q = quality_by_day.get((name_key, metric_date))
        row = DailyMetricRow(
            name_key=name_key,
            display_name=display_names.get(name_key, name_key),
            metric_date=metric_date,
            quality_scores=list(q["scores"]) if q else [],
            calls_count=report_by_sheet.get("Звонки", {}).get((name_key, metric_date), (None, 0.0))[1],
            worked_hours=report_by_sheet.get("Отработанные часы", {}).get((name_key, metric_date), (None, 0.0))[1],
            tech_issue_hours=report_by_sheet.get("Тех. сбои", {}).get((name_key, metric_date), (None, 0.0))[1],
            training_hours=report_by_sheet.get("Тренинги", {}).get((name_key, metric_date), (None, 0.0))[1],
            offline_activity_hours=report_by_sheet.get("Офлайн активность", {}).get((name_key, metric_date), (None, 0.0))[1],
            call_time_hours=report_by_sheet.get("Эффективность", {}).get((name_key, metric_date), (None, 0.0))[1],
            penalty_sum=report_by_sheet.get("Штрафы", {}).get((name_key, metric_date), (None, 0.0))[1],
        )
        rows.append(row)

    return rows


def aggregate_daily_rows(daily_rows: list[dict]) -> OperatorPeriodMetrics:
    """
    Агрегирует список словарей-строк OperatorDailyMetric (за произвольный
    диапазон дат, для ОДНОГО оператора) в OperatorPeriodMetrics — те же
    формулы, что в compute_operator_metrics, но источник — БД, не Excel.

    daily_rows: список dict с полями calls_count, quality_sum, quality_count,
    worked_hours, tech_issue_hours, training_hours, offline_activity_hours,
    efficiency (= call_time_hours за день), penalty_sum.
    """
    if not daily_rows:
        return OperatorPeriodMetrics(full_name="", warnings=["Нет данных за выбранный период"])

    quality_sum = sum(r["quality_sum"] for r in daily_rows)
    quality_count = sum(r["quality_count"] for r in daily_rows)

    total_hours = round(sum(r["worked_hours"] for r in daily_rows), 2)
    tech_issue_hours = round(sum(r["tech_issue_hours"] for r in daily_rows), 2)
    training_hours = round(sum(r["training_hours"] for r in daily_rows), 2)
    offline_activity_hours = round(sum(r["offline_activity_hours"] for r in daily_rows), 2)
    calls_total = round(sum(r["calls_count"] for r in daily_rows), 2)
    call_time_hours = round(sum(r["efficiency"] for r in daily_rows), 2)  # "efficiency" в дневной таблице = часы в звонке за день
    penalty_sum = round(sum(r["penalty_sum"] for r in daily_rows), 2)

    m = OperatorPeriodMetrics(full_name="")
    m.quality_calls_count = quality_count
    m.quality_avg = round(quality_sum / quality_count, 2) if quality_count else 0.0
    if quality_count == 0:
        m.warnings.append("Нет оценок качества за выбранный период")

    m.total_hours = total_hours
    m.tech_issue_hours = tech_issue_hours
    m.training_hours = training_hours
    m.offline_activity_hours = offline_activity_hours

    base = total_hours - tech_issue_hours - training_hours - offline_activity_hours
    if base < 0:
        m.warnings.append("База часов получилась отрицательной. Проверьте тренинги, техсбои и офлайн-активность.")
        base = 0.0
    m.base_hours = round(base, 2)

    m.calls_total = calls_total
    if m.base_hours > 0:
        m.kvz = round(calls_total / m.base_hours, 2)
    else:
        m.kvz = 0.0
        m.warnings.append("Нет базы часов за выбранный период")

    m.call_time_hours = call_time_hours
    if m.base_hours > 0:
        m.efficiency_percent = round(call_time_hours / m.base_hours * 100, 2)
    else:
        m.efficiency_percent = 0.0
        if "Нет базы часов за выбранный период" not in m.warnings:
            m.warnings.append("Нет базы часов для расчёта эффективности")

    m.penalty_sum = penalty_sum
    m.penalty_minutes = round(penalty_sum / PENALTY_RUB_PER_MINUTE, 2) if penalty_sum else 0.0
    m.penalty_points = round(m.penalty_minutes * PENALTY_POINTS_PER_MINUTE, 2)

    # Базовые итоговые баллы БЕЗ часов — norm-aware финальный расчёт
    # делается в роутере после enrich_with_norm(). Сохраняем 0 за часы
    # чтобы роутер мог корректно подставить hours_points.
    m.final_points = round(
        m.quality_avg + m.kvz + m.total_hours + m.efficiency_percent - m.penalty_points,
        2,
    )
    # Пометим что hours_points ещё не заполнен — роутер подставит позже

    m.has_any_period_data = any([
        m.quality_calls_count > 0,
        m.total_hours > 0,
        m.calls_total > 0,
        m.base_hours > 0,
        m.penalty_sum > 0,
    ])

    return m
