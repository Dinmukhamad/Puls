"""Единый источник определений метрик и целевых порогов аналитики (ТЗ §10.4).

Каждая метрика описывается ключом, названием, определением, формулой, единицей,
целью, критическим порогом и направлением («выше — лучше» / «ниже — лучше»).
Значения порогов совпадают с risk-порогами в calculators.py, чтобы 85/10/50/5
не дублировались в разных местах. Версия порогов возвращается в API.
"""
from __future__ import annotations

from app.modules.analytics.calculators import (
    RISK_EFFICIENCY_STABLE,
    RISK_EFFICIENCY_WATCH,
    RISK_KVZ_STABLE,
    RISK_KVZ_WATCH,
    RISK_PENALTY_STABLE,
    RISK_PENALTY_WATCH,
    RISK_QUALITY_STABLE,
    RISK_QUALITY_WATCH,
)

# Версия набора целей/порогов (ТЗ §10.4: version/effective_from).
ANALYTICS_TARGETS_VERSION = "2026-07-01"

# direction: "up" — чем больше, тем лучше; "down" — чем меньше, тем лучше.
METRIC_DEFINITIONS: dict[str, dict] = {
    "calls": {
        "metric_key": "calls",
        "label": "Обработанные звонки",
        "definition": "Сколько звонков обработала выбранная область за день.",
        "formula": "SUM(calls_count)",
        "unit": "звонки",
        "target": None,
        "critical_threshold": None,
        "direction": "up",
    },
    "kvz": {
        "metric_key": "kvz",
        "label": "Звонков в час",
        "definition": "Скорость обработки: звонки на базовый рабочий час.",
        "formula": "SUM(calls_count) / SUM(base_hours)",
        "unit": "звонков/ч",
        "target": float(RISK_KVZ_STABLE),
        "critical_threshold": float(RISK_KVZ_WATCH),
        "direction": "up",
    },
    "quality": {
        "metric_key": "quality",
        "label": "Качество",
        "definition": "Средняя оценка проверенных звонков.",
        "formula": "SUM(quality_sum) / SUM(quality_count)",
        "unit": "%",
        "target": float(RISK_QUALITY_STABLE),
        "critical_threshold": float(RISK_QUALITY_WATCH),
        "direction": "up",
    },
    "efficiency": {
        "metric_key": "efficiency",
        "label": "Время в разговоре",
        "definition": "Доля базовых часов, проведённых в разговоре.",
        "formula": "SUM(call_time_hours) / SUM(base_hours) × 100%",
        "unit": "%",
        "target": float(RISK_EFFICIENCY_STABLE),
        "critical_threshold": float(RISK_EFFICIENCY_WATCH),
        "direction": "up",
    },
    "penalty": {
        "metric_key": "penalty",
        "label": "Штрафы",
        "definition": "Суммарные штрафные минуты за день.",
        "formula": "SUM(penalty_minutes)",
        "unit": "мин",
        "target": float(RISK_PENALTY_STABLE),
        "critical_threshold": float(RISK_PENALTY_WATCH),
        "direction": "down",
    },
    "operators": {
        "metric_key": "operators",
        "label": "Операторы на линии",
        "definition": "Сколько операторов имели часы или звонки за день.",
        "formula": "COUNT(DISTINCT operator_id) c worked_hours>0 или calls_count>0",
        "unit": "чел.",
        "target": None,
        "critical_threshold": None,
        "direction": "up",
    },
}


def metric_definition(metric_key: str) -> dict:
    """Определение метрики с версией целей; безопасно для неизвестного ключа."""
    base = METRIC_DEFINITIONS.get(metric_key) or METRIC_DEFINITIONS["calls"]
    return {**base, "targets_version": ANALYTICS_TARGETS_VERSION}
