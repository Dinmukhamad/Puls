"""Единый источник определений метрик, целей и человеческих объяснений.

Каждая метрика описывает себя сама: как называется, что означает простыми
словами, зачем за ней следить и что делать, если показатель просел. Фронтенд
не хранит ни одной формулировки — он показывает то, что пришло отсюда, поэтому
названия и пороги всегда совпадают с расчётом.

Пороги берутся из calculators.py, чтобы 85/10/50/5 не разъезжались по коду.
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
# definition — что это, одним предложением без жаргона.
# good/bad  — что означает хороший и плохой результат для руководителя.
# action    — что делать, если показатель в красной зоне.
METRIC_DEFINITIONS: dict[str, dict] = {
    "quality": {
        "metric_key": "quality",
        "label": "Качество",
        "short": "Качество",
        "definition": "Средняя оценка за проверенные звонки.",
        "good": "Операторы разговаривают по стандарту, клиенты получают корректные ответы.",
        "bad": "Клиентам отвечают плохо: растут жалобы и повторные обращения.",
        "action": "Послушать звонки худших операторов и назначить разбор с наставником.",
        "formula": "SUM(quality_sum) / SUM(quality_count)",
        "unit": "%",
        "decimals": 1,
        "target": float(RISK_QUALITY_STABLE),
        "critical_threshold": float(RISK_QUALITY_WATCH),
        "direction": "up",
    },
    "kvz": {
        "metric_key": "kvz",
        "label": "Звонков в час",
        "short": "Скорость",
        "definition": "Сколько звонков оператор успевает обработать за час работы.",
        "good": "Линия справляется с потоком, очередь не растёт.",
        "bad": "Звонки обрабатываются медленно, клиенты дольше ждут на линии.",
        "action": "Проверить, не висят ли операторы в паузах и хватает ли людей в смене.",
        "formula": "SUM(calls_count) / SUM(base_hours)",
        "unit": "звонков/ч",
        "decimals": 1,
        "target": float(RISK_KVZ_STABLE),
        "critical_threshold": float(RISK_KVZ_WATCH),
        "direction": "up",
    },
    "efficiency": {
        "metric_key": "efficiency",
        "label": "Время в разговоре",
        "short": "Занятость",
        "definition": "Какую долю рабочего времени оператор реально говорит с клиентами.",
        "good": "Рабочее время тратится на клиентов, а не на простой.",
        "bad": "Операторы много простаивают — смена оплачивается, а работа не идёт.",
        "action": "Посмотреть причины простоя: техпроблемы, обучение, лишние люди в смене.",
        "formula": "SUM(call_time_hours) / SUM(base_hours) × 100%",
        "unit": "%",
        "decimals": 1,
        "target": float(RISK_EFFICIENCY_STABLE),
        "critical_threshold": float(RISK_EFFICIENCY_WATCH),
        "direction": "up",
    },
    "penalty": {
        "metric_key": "penalty",
        "label": "Штрафы",
        "short": "Штрафы",
        "definition": "Сколько штрафных минут набрала команда: опоздания и нарушения.",
        "good": "Дисциплина в порядке, смены начинаются вовремя.",
        "bad": "Люди систематически опаздывают или нарушают регламент.",
        "action": "Разобрать нарушителей поимённо — обычно это несколько повторяющихся людей.",
        "formula": "SUM(penalty_minutes)",
        "unit": "мин",
        "decimals": 0,
        "target": float(RISK_PENALTY_STABLE),
        "critical_threshold": float(RISK_PENALTY_WATCH),
        "direction": "down",
    },
    "calls": {
        "metric_key": "calls",
        "label": "Обработано звонков",
        "short": "Объём",
        "definition": "Сколько всего звонков приняла команда за выбранный период.",
        "good": "Показывает общий объём работы — сам по себе не хорош и не плох.",
        "bad": "Резкий провал обычно значит, что данные не загрузились или не хватило людей.",
        "action": "Сверить с загрузкой отчётов, если объём упал без причины.",
        "formula": "SUM(calls_count)",
        "unit": "звонков",
        "decimals": 0,
        "target": None,
        "critical_threshold": None,
        "direction": "up",
    },
    "operators": {
        "metric_key": "operators",
        "label": "Операторов на линии",
        "short": "Люди",
        "definition": "Сколько операторов реально работали — были часы или звонки.",
        "good": "Справочный показатель: с ним сравнивают объём и скорость.",
        "bad": "Провал означает нехватку людей в смене.",
        "action": "Сравнить с графиком смен: кто не вышел.",
        "formula": "COUNT(DISTINCT operator_id) c worked_hours>0 или calls_count>0",
        "unit": "чел.",
        "decimals": 0,
        "target": None,
        "critical_threshold": None,
        "direction": "up",
    },
}

# Порядок карточек на экране: сначала то, за что руководителя спрашивают.
HEADLINE_ORDER = ["quality", "kvz", "efficiency", "penalty", "calls", "operators"]

# Метрики, у которых есть цель и которые можно строить во времени.
TREND_METRICS = ["quality", "kvz", "efficiency", "penalty", "calls"]

WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
WEEKDAY_FULL = [
    "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье",
]


def metric_definition(metric_key: str) -> dict:
    """Определение метрики с версией целей; безопасно для неизвестного ключа."""
    base = METRIC_DEFINITIONS.get(metric_key) or METRIC_DEFINITIONS["calls"]
    return {**base, "targets_version": ANALYTICS_TARGETS_VERSION}


def metric_status(metric_key: str, value: float | None) -> str:
    """Светофор для значения: good | watch | bad | unknown.

    Учитывает направление метрики: у «Штрафов» меньше — лучше, поэтому пороги
    сравниваются в обратную сторону.
    """
    meta = METRIC_DEFINITIONS.get(metric_key)
    if meta is None or value is None:
        return "unknown"
    target, critical = meta["target"], meta["critical_threshold"]
    if target is None or critical is None:
        return "neutral"
    if meta["direction"] == "up":
        if value >= target:
            return "good"
        return "watch" if value >= critical else "bad"
    # direction == "down": цель — не превышать target.
    if value <= target:
        return "good"
    return "watch" if value <= critical else "bad"


def all_definitions() -> list[dict]:
    """Справочник для экрана «что означает каждый показатель»."""
    return [metric_definition(key) for key in HEADLINE_ORDER]
