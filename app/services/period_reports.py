"""Compat-shim: сервис period_reports разбит на
app/modules/reports/excel_parser.py (парсинг) и period_calculator.py (расчёты)
(ТЗ Этап 6). Оставлено для обратной совместимости импортов; новый код
импортируйте напрямую из app.modules.reports.*.
"""
from app.modules.reports.excel_parser import (  # noqa: F401
    REQUIRED_REPORT_SHEETS,
    QualityResult,
    _parse_header_date,
    is_service_row,
    normalize_name,
    parse_monthly_report,
    parse_monthly_report_daily,
    parse_report_file,
    parse_report_file_daily,
    parse_scores,
)
from app.modules.reports.period_calculator import (  # noqa: F401
    PENALTY_POINTS_PER_MINUTE,
    PENALTY_RUB_PER_MINUTE,
    DailyMetricRow,
    OperatorPeriodMetrics,
    PeriodCalculationResult,
    aggregate_daily_rows,
    build_daily_metric_rows,
    calculate_period_report,
    compute_operator_metrics,
)
