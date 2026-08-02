"""Единый дашборд аналитики для руководителя колл-центра.

Один вызов отдаёт всё, что нужно экрану: главные показатели со светофором,
динамику по дням, разрез по дням недели, сравнение групп и список людей,
которым нужно внимание. Фронтенд не считает ничего — он только рисует.

Формулы агрегации совпадают с service._metric_value_for_day (ТЗ §10.2),
чтобы цифры дашборда и выгрузок сходились.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.entities import Group, Operator
from app.modules.analytics import repository as repo
from app.modules.analytics.metrics_meta import (
    ANALYTICS_TARGETS_VERSION,
    HEADLINE_ORDER,
    METRIC_DEFINITIONS,
    TREND_METRICS,
    WEEKDAY_FULL,
    WEEKDAY_LABELS,
    metric_status,
)

MAX_RANGE_DAYS = 92
_MONTHS_GEN = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
]


# ── Агрегация ────────────────────────────────────────────────────────────

def _blank() -> list:
    """[calls, quality_sum, quality_count, base_hours, efficiency, penalty, {ops}]."""
    return [0.0, 0.0, 0, 0.0, 0.0, 0.0, set()]


def _accumulate(bucket: list, row) -> None:
    bucket[0] += row.calls_count or 0
    bucket[1] += row.quality_sum or 0
    bucket[2] += int(row.quality_count or 0)
    bucket[3] += row.base_hours or 0
    bucket[4] += row.efficiency or 0
    bucket[5] += row.penalty_minutes or 0
    if (row.worked_hours or 0) > 0 or (row.calls_count or 0) > 0:
        bucket[6].add(row.operator_id)


def _value(bucket: list, metric: str):
    calls, qsum, qcount, base, eff, pen, ops = bucket
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


def _total(rows) -> list:
    bucket = _blank()
    for r in rows:
        _accumulate(bucket, r)
    return bucket


# ── Помощники ────────────────────────────────────────────────────────────

def _validate(start_date: date, end_date: date) -> None:
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="Начало периода позже конца")
    if (end_date - start_date).days + 1 > MAX_RANGE_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Период больше {MAX_RANGE_DAYS} дней — выберите диапазон покороче",
        )


def _parse_weekdays(raw: str | None) -> list[int]:
    """"0,1,2" -> [0,1,2]. Пусто или мусор -> все дни недели."""
    if not raw:
        return list(range(7))
    picked = sorted({
        int(part) for part in raw.split(",")
        if part.strip().isdigit() and 0 <= int(part) <= 6
    })
    return picked or list(range(7))


def _fmt_day(d: date) -> str:
    return f"{d.day} {_MONTHS_GEN[d.month - 1]}"


def _period_label(start_date: date, end_date: date) -> str:
    if start_date == end_date:
        return f"{_fmt_day(start_date)} {start_date.year}"
    if start_date.year == end_date.year:
        return f"{_fmt_day(start_date)} — {_fmt_day(end_date)} {end_date.year}"
    return f"{_fmt_day(start_date)} {start_date.year} — {_fmt_day(end_date)} {end_date.year}"


def _delta(current, previous, direction: str) -> dict:
    """Изменение к прошлому периоду. improved учитывает направление метрики."""
    if current is None or previous is None:
        return {"value": None, "percent": None, "improved": None, "previous": previous}
    diff = round(current - previous, 2)
    percent = round(diff / previous * 100, 1) if previous else None
    if diff == 0:
        improved = None
    else:
        improved = (diff > 0) if direction == "up" else (diff < 0)
    return {"value": diff, "percent": percent, "improved": improved, "previous": previous}


# ── Основная сборка ──────────────────────────────────────────────────────

def build(
    db: Session,
    start_date: date,
    end_date: date,
    group_id: int | None,
    weekdays_raw: str | None,
    trend_metric: str,
) -> dict:
    _validate(start_date, end_date)
    weekdays = _parse_weekdays(weekdays_raw)
    if trend_metric not in TREND_METRICS:
        trend_metric = "quality"

    span = (end_date - start_date).days + 1
    prev_end = start_date - timedelta(days=1)
    prev_start = prev_end - timedelta(days=span - 1)

    all_rows = repo.scoped_daily_metrics(db, start_date, end_date, group_id=group_id)
    rows = [r for r in all_rows if r.metric_date.weekday() in weekdays]
    prev_rows = [
        r for r in repo.scoped_daily_metrics(db, prev_start, prev_end, group_id=group_id)
        if r.metric_date.weekday() in weekdays
    ]

    total = _total(rows)
    prev_total = _total(prev_rows)

    # Главные показатели.
    metrics = []
    for key in HEADLINE_ORDER:
        meta = METRIC_DEFINITIONS[key]
        value = _value(total, key)
        metrics.append({
            "key": key,
            "label": meta["label"],
            "short": meta["short"],
            "definition": meta["definition"],
            "good": meta["good"],
            "bad": meta["bad"],
            "action": meta["action"],
            "formula": meta["formula"],
            "unit": meta["unit"],
            "decimals": meta["decimals"],
            "direction": meta["direction"],
            "target": meta["target"],
            "critical": meta["critical_threshold"],
            "value": value,
            "status": metric_status(key, value),
            "delta": _delta(value, _value(prev_total, key), meta["direction"]),
        })

    # Динамика по дням выбранной метрики.
    by_day: dict[date, list] = {}
    for r in rows:
        _accumulate(by_day.setdefault(r.metric_date, _blank()), r)

    points, days_with_data = [], 0
    cur = start_date
    while cur <= end_date:
        if cur.weekday() in weekdays:
            bucket = by_day.get(cur)
            has_data = bucket is not None
            if has_data:
                days_with_data += 1
            points.append({
                "date": str(cur),
                "weekday": cur.weekday(),
                "label": _fmt_day(cur),
                "value": _value(bucket, trend_metric) if has_data else None,
                "has_data": has_data,
            })
        cur += timedelta(days=1)

    trend_meta = METRIC_DEFINITIONS[trend_metric]
    trend = {
        "metric": trend_metric,
        "label": trend_meta["label"],
        "unit": trend_meta["unit"],
        "decimals": trend_meta["decimals"],
        "target": trend_meta["target"],
        "direction": trend_meta["direction"],
        "points": points,
    }

    # Разрез по дням недели — замена «фильтра по времени», которого нет в данных.
    per_weekday: dict[int, list] = {}
    weekday_days: dict[int, set] = {}
    for r in rows:
        wd = r.metric_date.weekday()
        _accumulate(per_weekday.setdefault(wd, _blank()), r)
        weekday_days.setdefault(wd, set()).add(r.metric_date)

    weekday_rows = []
    for wd in range(7):
        bucket = per_weekday.get(wd)
        value = _value(bucket, trend_metric) if bucket else None
        weekday_rows.append({
            "weekday": wd,
            "label": WEEKDAY_LABELS[wd],
            "full": WEEKDAY_FULL[wd],
            "value": value,
            "status": metric_status(trend_metric, value),
            "days": len(weekday_days.get(wd, ())),
            "selected": wd in weekdays,
        })

    # Сравнение групп.
    groups = _groups_breakdown(db, rows, group_id)

    # Кому нужно внимание.
    attention = _attention(db, rows)

    operators_with_data = len(total[6])
    empty = operators_with_data == 0 and days_with_data == 0

    return {
        "period": {
            "start": str(start_date),
            "end": str(end_date),
            "days": span,
            "label": _period_label(start_date, end_date),
        },
        "filters": {
            "group_id": group_id,
            "group_label": _group_label(db, group_id),
            "weekdays": weekdays,
            "all_weekdays": len(weekdays) == 7,
            "trend_metric": trend_metric,
        },
        "coverage": {
            "days_with_data": days_with_data,
            "days_in_selection": len(points),
            "operators": operators_with_data,
        },
        "empty": empty,
        "empty_reason": (
            "За выбранный период нет загруженных данных. Проверьте, что отчёты "
            "выгружены, или выберите другой период."
        ) if empty else None,
        "metrics": metrics,
        "trend": trend,
        "weekdays": weekday_rows,
        "groups": groups,
        "attention": attention,
        "trend_metrics": [
            {
                "key": k,
                "label": METRIC_DEFINITIONS[k]["label"],
                "short": METRIC_DEFINITIONS[k]["short"],
            }
            for k in TREND_METRICS
        ],
        "targets_version": ANALYTICS_TARGETS_VERSION,
    }


def _group_label(db: Session, group_id: int | None) -> str:
    if group_id is None:
        return "Все группы"
    group = db.get(Group, group_id)
    return group.name if group else f"Группа {group_id}"


def _groups_breakdown(db: Session, rows, group_id: int | None) -> list[dict]:
    """Сравнение групп по ключевым метрикам. Область берётся по текущему
    Operator.group_id, как и в остальной аналитике."""
    if not rows:
        return []
    operators = repo.operators_by_ids(db, {r.operator_id for r in rows})
    names = {g.id: g.name for g in repo.active_groups(db)}

    per: dict[int | None, list] = {}
    for r in rows:
        op = operators.get(r.operator_id)
        _accumulate(per.setdefault(op.group_id if op else None, _blank()), r)

    out = []
    for gid, bucket in per.items():
        quality = _value(bucket, "quality")
        out.append({
            "group_id": gid,
            "name": names.get(gid, "Без группы") if gid is not None else "Без группы",
            "operators": len(bucket[6]),
            "quality": quality,
            "kvz": _value(bucket, "kvz"),
            "efficiency": _value(bucket, "efficiency"),
            "penalty": _value(bucket, "penalty"),
            "calls": _value(bucket, "calls"),
            "status": metric_status("quality", quality),
        })
    # Лучшие сверху; группы без оценки качества — в конец.
    out.sort(key=lambda g: (g["quality"] is None, -(g["quality"] or 0)))
    return out


def _attention(db: Session, rows, limit: int = 8) -> list[dict]:
    """Операторы в красной зоне хотя бы по одной метрике с целью.

    Сортировка — по тяжести отставания от цели, чтобы сверху был тот, с кем
    нужно разговаривать первым.
    """
    if not rows:
        return []
    per: dict[int, list] = {}
    for r in rows:
        _accumulate(per.setdefault(r.operator_id, _blank()), r)

    operators = repo.operators_by_ids(db, set(per))
    groups = {g.id: g.name for g in repo.active_groups(db)}

    found = []
    for operator_id, bucket in per.items():
        op = operators.get(operator_id)
        if op is None:
            continue
        worst = None
        for key in ("quality", "kvz", "efficiency", "penalty"):
            value = _value(bucket, key)
            if value is None or metric_status(key, value) != "bad":
                continue
            meta = METRIC_DEFINITIONS[key]
            target = meta["target"]
            # Насколько далеко от цели, в долях цели — чтобы сравнивать разные единицы.
            gap = abs(value - target) / target if target else 0
            if worst is None or gap > worst["gap"]:
                worst = {
                    "gap": gap,
                    "metric": key,
                    "metric_label": meta["label"],
                    "value": value,
                    "target": target,
                    "unit": meta["unit"],
                    "decimals": meta["decimals"],
                    "action": meta["action"],
                }
        if worst is None:
            continue
        found.append({
            "operator_id": operator_id,
            "name": op.full_name,
            "group": groups.get(op.group_id, "Без группы"),
            "metric": worst["metric"],
            "metric_label": worst["metric_label"],
            "value": worst["value"],
            "target": worst["target"],
            "unit": worst["unit"],
            "decimals": worst["decimals"],
            "action": worst["action"],
            "gap": round(worst["gap"] * 100, 1),
        })

    found.sort(key=lambda item: -item["gap"])
    return found[:limit]
