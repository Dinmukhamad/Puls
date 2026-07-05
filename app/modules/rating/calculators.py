"""Чистые расчёты рейтинга (ТЗ §15.5).

Никаких SQL-запросов, FastAPI, env или обращения к БД — только математика,
чтобы функции были легко тестируемыми. Логика перенесена дословно из
routers/rating.py и services/rating.py без изменения формул.
"""
from __future__ import annotations

import calendar
from datetime import date

# Максимум баллов за часы (было в operator-dynamics).
MAX_HOURS_PTS = 25.0

WEEKDAYS_RU = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]


def week_label(ws: date, we: date) -> str:
    return f"{ws.strftime('%d.%m')}–{we.strftime('%d.%m.%Y')}"


def metric_value(row: dict, metric: str) -> float:
    if metric == "coins":
        return float(row.get("coins_earned") or 0)
    if metric == "quality":
        return float(row.get("quality_score") or 0)
    if metric == "efficiency":
        return float(row.get("efficiency_score") or 0)
    return float(row.get("contest_points") or row.get("final_score") or 0)


def initials(full_name: str) -> str:
    parts = [p for p in full_name.strip().split() if p]
    if not parts:
        return "??"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[1][0]).upper()


def safe_div(a, b, default=0.0):
    try:
        if b and b != 0:
            return a / b
        return default
    except Exception:
        return default


def clamp(v, lo=0.0, hi=None):
    v = max(lo, v or 0.0)
    return min(v, hi) if hi is not None else v


def daily_norm(rate: float | None, d: date, monthly_norm_hours: float | None) -> float:
    """
    Дневная норма часов для оператора с учётом его ставки.

    monthly_norm_hours — значение из активного WorkNorm (передаётся из
    service/repository); если None, используется стандартный fallback.
    Формула перенесена дословно из get_operator_dynamics.daily_norm.
    """
    if not rate:
        return 0.0
    days_in_month = calendar.monthrange(d.year, d.month)[1]
    if monthly_norm_hours is not None:
        return float(monthly_norm_hours) / days_in_month
    # Fallback: стандартные нормы
    std = {0.5: (84, 88), 0.75: (126, 132), 1.0: (168, 176)}
    norms = std.get(rate, (168, 176))
    monthly = norms[0] if days_in_month == 30 else norms[1]
    return monthly / days_in_month
