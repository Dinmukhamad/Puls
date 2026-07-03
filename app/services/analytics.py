"""
Сервис аналитики для раздела «Аналитика» (руководство, супервайзеры, админы).

Строится поверх app.services.period_reports — переиспользует matched-операторов
(сопоставленных и на сайте, и в файлах) и их посчитанные метрики, добавляя
агрегации: KPI, динамику по дням, матрицу качество×КВЗ, риск-пирамиду,
heatmap, аналитику штрафов, сравнение групп и т.д.

Все расчёты идут ТОЛЬКО по matched-операторам с реальными данными за период —
то же правило, что в period_reports.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta

from app.services.period_reports import (
    OperatorPeriodMetrics,
    parse_monthly_report,
    parse_report_file,
)

# ── Risk thresholds (настраиваемые пороги) ──────────────────────────────
RISK_QUALITY_STABLE = 85
RISK_QUALITY_WATCH = 70
RISK_KVZ_STABLE = 10
RISK_KVZ_WATCH = 8
RISK_EFFICIENCY_STABLE = 50
RISK_EFFICIENCY_WATCH = 40
RISK_PENALTY_STABLE = 5
RISK_PENALTY_WATCH = 20

ATTENTION_QUALITY_THRESHOLD = 80
ATTENTION_KVZ_THRESHOLD = 8
ATTENTION_EFFICIENCY_THRESHOLD = 45
ATTENTION_PENALTY_MINUTES_THRESHOLD = 10


@dataclass
class OperatorAnalyticsRow:
    """Расширенная строка оператора для таблицы аналитики, с group_id/role-фильтрами."""
    full_name: str
    name_key: str
    operator_id: int | None = None
    group_id: int | None = None
    group_name: str | None = None
    participation_status: str | None = None
    metrics: OperatorPeriodMetrics | None = None
    risk_status: str = "no_data"  # stable | watch | critical | no_data


def classify_risk(m: OperatorPeriodMetrics) -> str:
    """Классифицирует оператора по уровню риска согласно ТЗ §17."""
    no_quality = m.quality_calls_count == 0
    no_base_hours = m.base_hours <= 0

    if no_quality or no_base_hours:
        return "no_data"

    critical = (
        m.quality_avg < RISK_QUALITY_WATCH
        or m.kvz < RISK_KVZ_WATCH
        or m.efficiency_percent < RISK_EFFICIENCY_WATCH
        or m.penalty_minutes > RISK_PENALTY_WATCH
    )
    if critical:
        return "critical"

    watch = (
        RISK_QUALITY_WATCH <= m.quality_avg < RISK_QUALITY_STABLE
        or RISK_KVZ_WATCH <= m.kvz < RISK_KVZ_STABLE
        or RISK_EFFICIENCY_WATCH <= m.efficiency_percent < RISK_EFFICIENCY_STABLE
        or RISK_PENALTY_STABLE < m.penalty_minutes <= RISK_PENALTY_WATCH
    )
    if watch:
        return "watch"

    return "stable"


def is_attention_zone(m: OperatorPeriodMetrics) -> bool:
    """Зона внимания согласно ТЗ §11."""
    return (
        m.quality_calls_count == 0
        or m.base_hours <= 0
        or m.quality_avg < ATTENTION_QUALITY_THRESHOLD
        or m.kvz < ATTENTION_KVZ_THRESHOLD
        or m.efficiency_percent < ATTENTION_EFFICIENCY_THRESHOLD
        or m.penalty_minutes > ATTENTION_PENALTY_MINUTES_THRESHOLD
    )


def build_analytics_rows(
    operators_metrics: list[OperatorPeriodMetrics],
    site_operator_map: dict[str, dict],  # name_key -> {id, group_id, group_name, participation_status}
) -> list[OperatorAnalyticsRow]:
    rows: list[OperatorAnalyticsRow] = []
    for m in operators_metrics:
        site = site_operator_map.get(m.name_key, {})
        row = OperatorAnalyticsRow(
            full_name=site.get("full_name", m.full_name),
            name_key=m.name_key,
            operator_id=site.get("id"),
            group_id=site.get("group_id"),
            group_name=site.get("group_name"),
            participation_status=site.get("participation_status"),
            metrics=m,
            risk_status=classify_risk(m),
        )
        rows.append(row)
    return rows


def filter_rows(
    rows: list[OperatorAnalyticsRow],
    group_id: int | None = None,
    operator_query: str | None = None,
    participation_status: str | None = None,
    only_with_data: bool = False,
) -> list[OperatorAnalyticsRow]:
    out = rows
    if group_id is not None:
        out = [r for r in out if r.group_id == group_id]
    if operator_query:
        q = operator_query.lower()
        out = [r for r in out if q in r.full_name.lower()]
    if participation_status and participation_status != "all":
        out = [r for r in out if r.participation_status == participation_status]
    if only_with_data:
        out = [r for r in out if r.metrics and r.metrics.has_any_period_data]
    return out


# ── KPI summary ──────────────────────────────────────────────────────────

def compute_kpi_summary(rows: list[OperatorAnalyticsRow]) -> dict:
    included = [r for r in rows if r.metrics and r.metrics.has_any_period_data]
    metrics = [r.metrics for r in included]

    # Средневзвешенное по количеству оценок — математически тождественно
    # "сумма всех индивидуальных оценок / их количество", не требует хранить
    # сырые оценки (PeriodReport хранит только агрегированные quality_avg/count).
    quality_weighted_sum = sum(m.quality_avg * m.quality_calls_count for m in metrics if m.quality_calls_count > 0)

    total_calls = sum(m.calls_total for m in metrics)
    total_hours = sum(m.total_hours for m in metrics)
    base_hours_list = [m.base_hours for m in metrics if m.base_hours > 0]
    total_base_hours = sum(base_hours_list)
    total_call_time = sum(m.call_time_hours for m in metrics if m.base_hours > 0)
    total_penalty_sum = sum(m.penalty_sum for m in metrics)
    quality_calls_count = sum(m.quality_calls_count for m in metrics)
    operators_no_quality = sum(1 for m in metrics if m.quality_calls_count == 0)

    return {
        "operators_count": len(included),
        "total_calls": round(total_calls, 2),
        "avg_quality": round(quality_weighted_sum / quality_calls_count, 2) if quality_calls_count else None,
        "avg_kvz": round(total_calls / total_base_hours, 2) if total_base_hours > 0 else None,
        "avg_efficiency": round(total_call_time / total_base_hours * 100, 2) if total_base_hours > 0 else None,
        "penalty_minutes_total": round(total_penalty_sum / 50, 2) if total_penalty_sum else 0.0,
        "total_hours": round(total_hours, 2),
        "base_hours_total": round(total_base_hours, 2),
        "quality_calls_count": quality_calls_count,
        "operators_no_quality": operators_no_quality,
    }


# ── Daily dynamics ───────────────────────────────────────────────────────

def compute_daily_dynamics(
    report_bytes: bytes,
    period_start: date,
    period_end: date,
    site_keys: set,
    metric: str = "calls",
) -> list[dict]:
    """
    Считает посуточную динамику для metric in {calls, kvz, operators}.
    Парсит report_file повторно по каждому дню в диапазоне (один день = период).
    """
    out = []
    cur = period_start
    while cur <= period_end:
        day_data = parse_report_file(report_bytes, cur, cur)
        calls_map = day_data.get("Звонки", {})
        hours_map = day_data.get("Отработанные часы", {})
        tech_map = day_data.get("Тех. сбои", {})
        train_map = day_data.get("Тренинги", {})
        offline_map = day_data.get("Офлайн активность", {})

        day_calls = 0.0
        day_base_hours = 0.0
        operators_on_line = 0

        all_keys = set(calls_map.keys()) | set(hours_map.keys())
        for key in all_keys:
            if key not in site_keys:
                continue
            calls_val = calls_map.get(key, (None, 0.0))[1]
            total_h = hours_map.get(key, (None, 0.0))[1]
            tech_h = tech_map.get(key, (None, 0.0))[1]
            train_h = train_map.get(key, (None, 0.0))[1]
            off_h = offline_map.get(key, (None, 0.0))[1]
            base_h = max(0.0, total_h - tech_h - train_h - off_h)

            if calls_val > 0 or total_h > 0:
                operators_on_line += 1
            day_calls += calls_val
            day_base_hours += base_h

        day_kvz = round(day_calls / day_base_hours, 2) if day_base_hours > 0 else None

        out.append({
            "date": str(cur),
            "calls": round(day_calls, 2),
            "kvz": day_kvz,
            "operators_on_line": operators_on_line,
        })
        cur += timedelta(days=1)

    return out


# ── Groups comparison ────────────────────────────────────────────────────

def compute_groups_comparison(rows: list[OperatorAnalyticsRow]) -> list[dict]:
    by_group: dict[tuple[int | None, str], list[OperatorAnalyticsRow]] = defaultdict(list)
    for r in rows:
        if not (r.metrics and r.metrics.has_any_period_data):
            continue
        key = (r.group_id, r.group_name or "Без группы")
        by_group[key].append(r)

    out = []
    for (gid, gname), group_rows in by_group.items():
        metrics = [r.metrics for r in group_rows]
        quality_weighted_sum = sum(m.quality_avg * m.quality_calls_count for m in metrics if m.quality_calls_count > 0)
        quality_calls_count_g = sum(m.quality_calls_count for m in metrics)

        total_calls = sum(m.calls_total for m in metrics)
        base_hours_list = [m.base_hours for m in metrics if m.base_hours > 0]
        total_base_hours = sum(base_hours_list)
        total_call_time = sum(m.call_time_hours for m in metrics if m.base_hours > 0)
        total_penalty = sum(m.penalty_sum for m in metrics)
        no_quality_count = sum(1 for m in metrics if m.quality_calls_count == 0)
        risk_count = sum(1 for r in group_rows if r.risk_status in ("watch", "critical"))

        out.append({
            "group_id": gid,
            "group_name": gname,
            "operators_count": len(group_rows),
            "total_calls": round(total_calls, 2),
            "total_hours": round(sum(m.total_hours for m in metrics), 2),
            "base_hours_total": round(total_base_hours, 2),
            "avg_quality": round(quality_weighted_sum / quality_calls_count_g, 2) if quality_calls_count_g else None,
            "avg_kvz": round(total_calls / total_base_hours, 2) if total_base_hours > 0 else None,
            "avg_efficiency": round(total_call_time / total_base_hours * 100, 2) if total_base_hours > 0 else None,
            "penalty_minutes": round(total_penalty / 50, 2) if total_penalty else 0.0,
            "final_points_sum": round(sum(m.final_points for m in metrics), 2),
            "operators_no_quality": no_quality_count,
            "operators_in_risk": risk_count,
        })

    out.sort(key=lambda g: g["final_points_sum"], reverse=True)
    return out


# ── Quality x KVZ matrix ─────────────────────────────────────────────────

def compute_quality_kvz_matrix(rows: list[OperatorAnalyticsRow]) -> list[dict]:
    out = []
    for r in rows:
        m = r.metrics
        if not (m and m.quality_calls_count > 0 and m.base_hours > 0):
            continue
        out.append({
            "full_name": r.full_name,
            "group_name": r.group_name,
            "quality_avg": m.quality_avg,
            "kvz": m.kvz,
            "calls_total": m.calls_total,
            "final_points": m.final_points,
        })
    return out


# ── Top / Attention zone ─────────────────────────────────────────────────

def compute_top_and_attention(rows: list[OperatorAnalyticsRow], top_n: int = 5) -> dict:
    included = [r for r in rows if r.metrics and r.metrics.has_any_period_data]

    def top_by(key_func, filter_func=None):
        candidates = included if not filter_func else [r for r in included if filter_func(r.metrics)]
        sorted_rows = sorted(candidates, key=lambda r: key_func(r.metrics), reverse=True)[:top_n]
        return [{
            "full_name": r.full_name,
            "group_name": r.group_name,
            "value": round(key_func(r.metrics), 2),
        } for r in sorted_rows]

    attention = [r for r in included if is_attention_zone(r.metrics)]
    attention_out = [{
        "full_name": r.full_name,
        "group_name": r.group_name,
        "quality_avg": r.metrics.quality_avg if r.metrics.quality_calls_count else None,
        "kvz": r.metrics.kvz if r.metrics.base_hours > 0 else None,
        "efficiency_percent": r.metrics.efficiency_percent if r.metrics.base_hours > 0 else None,
        "penalty_minutes": r.metrics.penalty_minutes,
        "reason": _attention_reason(r.metrics),
    } for r in attention]

    return {
        "top_final_points": top_by(lambda m: m.final_points),
        "top_quality": top_by(lambda m: m.quality_avg, lambda m: m.quality_calls_count > 0),
        "top_kvz": top_by(lambda m: m.kvz, lambda m: m.base_hours > 0),
        "top_efficiency": top_by(lambda m: m.efficiency_percent, lambda m: m.base_hours > 0),
        "attention_zone": attention_out,
    }


def _attention_reason(m: OperatorPeriodMetrics) -> str:
    reasons = []
    if m.quality_calls_count == 0:
        reasons.append("нет оценок качества")
    elif m.quality_avg < ATTENTION_QUALITY_THRESHOLD:
        reasons.append(f"качество {m.quality_avg}")
    if m.base_hours <= 0:
        reasons.append("нет базы часов")
    elif m.kvz < ATTENTION_KVZ_THRESHOLD:
        reasons.append(f"КВЗ {m.kvz}")
    if m.base_hours > 0 and m.efficiency_percent < ATTENTION_EFFICIENCY_THRESHOLD:
        reasons.append(f"эффективность {m.efficiency_percent}%")
    if m.penalty_minutes > ATTENTION_PENALTY_MINUTES_THRESHOLD:
        reasons.append(f"штрафы {m.penalty_minutes} мин")
    return ", ".join(reasons) if reasons else "—"


# ── Penalties analytics ───────────────────────────────────────────────────

def compute_penalties_analytics(rows: list[OperatorAnalyticsRow]) -> dict:
    with_penalty = [r for r in rows if r.metrics and r.metrics.penalty_sum > 0]
    total_minutes = sum(r.metrics.penalty_minutes for r in with_penalty)
    total_points_lost = sum(r.metrics.penalty_points for r in with_penalty)

    operators_table = sorted([{
        "full_name": r.full_name,
        "group_name": r.group_name,
        "penalty_sum": r.metrics.penalty_sum,
        "penalty_minutes": r.metrics.penalty_minutes,
        "penalty_points": r.metrics.penalty_points,
    } for r in with_penalty], key=lambda x: x["penalty_minutes"], reverse=True)

    return {
        "total_penalty_minutes": round(total_minutes, 2),
        "operators_with_penalty_count": len(with_penalty),
        "avg_penalty_per_operator": round(total_minutes / len(with_penalty), 2) if with_penalty else 0.0,
        "total_points_lost": round(total_points_lost, 2),
        "operators": operators_table,
        # Причины не структурированы в исходном файле — оставляем "Не указано"
        "by_reason": [{
            "reason": "Не указано (источник не содержит причин)",
            "minutes": round(total_minutes, 2),
            "points_lost": round(total_points_lost, 2),
            "operators_count": len(with_penalty),
        }] if with_penalty else [],
    }


# ── Points contribution breakdown ────────────────────────────────────────

def compute_points_breakdown(rows: list[OperatorAnalyticsRow]) -> list[dict]:
    out = []
    for r in rows:
        m = r.metrics
        if not (m and m.has_any_period_data):
            continue
        out.append({
            "full_name": r.full_name,
            "group_name": r.group_name,
            "quality_contribution": m.quality_avg,
            "kvz_contribution": m.kvz,
            "hours_contribution": m.total_hours,
            "efficiency_contribution": m.efficiency_percent,
            "penalty_contribution": -m.penalty_points,
            "final_points": m.final_points,
        })
    out.sort(key=lambda x: x["final_points"], reverse=True)
    return out


# ── Heatmap by day ────────────────────────────────────────────────────────

def compute_heatmap(
    monthly_report_bytes: bytes | None,
    report_bytes: bytes,
    period_start: date,
    period_end: date,
    site_keys: dict[str, str],  # name_key -> display_name
    metric: str = "quality",
) -> dict:
    """metric in {quality, calls, kvz, efficiency, penalty}"""
    dates = []
    cur = period_start
    while cur <= period_end:
        dates.append(cur)
        cur += timedelta(days=1)

    operator_day_values: dict[str, dict[str, float | None]] = {k: {} for k in site_keys}

    if metric == "quality":
        if not monthly_report_bytes:
            return {"dates": [str(d) for d in dates], "operators": []}
        for d in dates:
            day_quality = parse_monthly_report(monthly_report_bytes, d, d)
            for key in site_keys:
                qr = day_quality.get(key)
                operator_day_values[key][str(d)] = qr.avg if qr and qr.scores else None
    else:
        for d in dates:
            day_report = parse_report_file(report_bytes, d, d)
            for key in site_keys:
                if metric == "calls":
                    entry = day_report.get("Звонки", {}).get(key)
                    operator_day_values[key][str(d)] = entry[1] if entry else None
                elif metric == "penalty":
                    entry = day_report.get("Штрафы", {}).get(key)
                    val = entry[1] if entry else 0.0
                    operator_day_values[key][str(d)] = round(val / 50, 2) if val else 0.0
                elif metric in ("kvz", "efficiency"):
                    hours_entry = day_report.get("Отработанные часы", {}).get(key)
                    tech_entry = day_report.get("Тех. сбои", {}).get(key)
                    train_entry = day_report.get("Тренинги", {}).get(key)
                    off_entry = day_report.get("Офлайн активность", {}).get(key)
                    total_h = hours_entry[1] if hours_entry else 0.0
                    tech_h = tech_entry[1] if tech_entry else 0.0
                    train_h = train_entry[1] if train_entry else 0.0
                    off_h = off_entry[1] if off_entry else 0.0
                    base_h = max(0.0, total_h - tech_h - train_h - off_h)
                    if base_h <= 0:
                        operator_day_values[key][str(d)] = None
                        continue
                    if metric == "kvz":
                        calls_entry = day_report.get("Звонки", {}).get(key)
                        calls_val = calls_entry[1] if calls_entry else 0.0
                        operator_day_values[key][str(d)] = round(calls_val / base_h, 2)
                    else:
                        eff_entry = day_report.get("Эффективность", {}).get(key)
                        eff_val = eff_entry[1] if eff_entry else 0.0
                        operator_day_values[key][str(d)] = round(eff_val / base_h * 100, 2)

    operators_out = []
    for key, display in site_keys.items():
        operators_out.append({
            "full_name": display,
            "values": operator_day_values.get(key, {}),
        })

    return {"dates": [str(d) for d in dates], "operators": operators_out, "metric": metric}


# ── Risk pyramid ──────────────────────────────────────────────────────────

def compute_risk_pyramid(rows: list[OperatorAnalyticsRow]) -> dict:
    buckets: dict[str, list[dict]] = {"stable": [], "watch": [], "critical": [], "no_data": []}
    for r in rows:
        if not r.metrics:
            continue
        entry = {
            "full_name": r.full_name,
            "group_name": r.group_name,
            "quality_avg": r.metrics.quality_avg if r.metrics.quality_calls_count else None,
            "kvz": r.metrics.kvz if r.metrics.base_hours > 0 else None,
            "efficiency_percent": r.metrics.efficiency_percent if r.metrics.base_hours > 0 else None,
            "penalty_minutes": r.metrics.penalty_minutes,
        }
        buckets[r.risk_status].append(entry)

    return {
        "stable": {"count": len(buckets["stable"]), "operators": buckets["stable"]},
        "watch": {"count": len(buckets["watch"]), "operators": buckets["watch"]},
        "critical": {"count": len(buckets["critical"]), "operators": buckets["critical"]},
        "no_data": {"count": len(buckets["no_data"]), "operators": buckets["no_data"]},
    }


# ── Quality coverage dashboard ────────────────────────────────────────────

def compute_quality_coverage(rows: list[OperatorAnalyticsRow]) -> dict:
    included = [r for r in rows if r.metrics and r.metrics.has_any_period_data]
    with_quality = [r for r in included if r.metrics.quality_calls_count > 0]
    without_quality = [r for r in included if r.metrics.quality_calls_count == 0]

    total_evaluated_calls = sum(r.metrics.quality_calls_count for r in with_quality)
    avg_per_operator = round(total_evaluated_calls / len(with_quality), 2) if with_quality else 0.0

    by_group: dict[str, dict] = defaultdict(lambda: {"operators": 0, "evaluated_calls": 0, "with_quality": 0, "quality_weighted_sum": 0.0})
    for r in included:
        g = r.group_name or "Без группы"
        by_group[g]["operators"] += 1
        if r.metrics.quality_calls_count > 0:
            by_group[g]["with_quality"] += 1
            by_group[g]["evaluated_calls"] += r.metrics.quality_calls_count
            by_group[g]["quality_weighted_sum"] += r.metrics.quality_avg * r.metrics.quality_calls_count

    group_table = []
    for g, data in by_group.items():
        avg_q = round(data["quality_weighted_sum"] / data["evaluated_calls"], 2) if data["evaluated_calls"] else None
        group_table.append({
            "group_name": g,
            "operators_count": data["operators"],
            "evaluated_calls": data["evaluated_calls"],
            "avg_evaluations_per_operator": round(data["evaluated_calls"] / data["with_quality"], 2) if data["with_quality"] else 0.0,
            "operators_without_quality": data["operators"] - data["with_quality"],
            "avg_quality": avg_q,
        })

    best_group = max(group_table, key=lambda g: g["avg_evaluations_per_operator"], default=None)
    worst_group = min(
        (g for g in group_table if g["operators_without_quality"] > 0),
        key=lambda g: g["avg_evaluations_per_operator"], default=None
    )

    without_quality_table = [{
        "full_name": r.full_name,
        "group_name": r.group_name,
        "base_hours": r.metrics.base_hours,
        "calls_total": r.metrics.calls_total,
        "reason": "Нет оценок качества за выбранный период",
    } for r in without_quality]

    return {
        "total_evaluated_calls": total_evaluated_calls,
        "avg_evaluations_per_operator": avg_per_operator,
        "operators_without_quality_count": len(without_quality),
        "best_coverage_group": best_group["group_name"] if best_group else None,
        "worst_coverage_group": worst_group["group_name"] if worst_group else None,
        "by_group": group_table,
        "without_quality": without_quality_table,
    }


# ── Load vs efficiency scatter ────────────────────────────────────────────

def compute_load_vs_efficiency(rows: list[OperatorAnalyticsRow]) -> list[dict]:
    out = []
    for r in rows:
        m = r.metrics
        if not (m and m.base_hours > 0):
            continue
        out.append({
            "full_name": r.full_name,
            "group_name": r.group_name,
            "calls_total": m.calls_total,
            "efficiency_percent": m.efficiency_percent,
            "base_hours": m.base_hours,
            "kvz": m.kvz,
            "final_points": m.final_points,
        })
    return out


# ── Quality vs penalties control ──────────────────────────────────────────

def compute_quality_vs_penalties(rows: list[OperatorAnalyticsRow]) -> list[dict]:
    out = []
    for r in rows:
        m = r.metrics
        if not (m and m.has_any_period_data):
            continue
        has_quality = m.quality_calls_count > 0
        has_penalty = m.penalty_minutes > 0

        if not has_quality:
            comment = "Нет оценок качества"
        elif has_quality and m.quality_avg >= 85 and has_penalty:
            comment = "Хорошее качество, но дисциплина проседает"
        elif has_quality and m.quality_avg < 80 and has_penalty:
            comment = "Низкое качество и есть штрафы"
        elif has_quality and not has_penalty:
            comment = "Качество нормальное, штрафов нет"
        else:
            comment = "—"

        out.append({
            "full_name": r.full_name,
            "group_name": r.group_name,
            "quality_avg": m.quality_avg if has_quality else None,
            "penalty_minutes": m.penalty_minutes,
            "points_lost": -m.penalty_points,
            "comment": comment,
        })
    # Сортируем так, чтобы проблемные были выше
    priority = {"Низкое качество и есть штрафы": 0, "Хорошее качество, но дисциплина проседает": 1,
                "Нет оценок качества": 2, "Качество нормальное, штрафов нет": 3, "—": 4}
    out.sort(key=lambda x: priority.get(x["comment"], 5))
    return out


# ── Points analysis (вкладка «Баллы») ──────────────────────────────────

def _result_status(m: OperatorPeriodMetrics) -> str:
    if m.quality_calls_count == 0 and m.base_hours <= 0:
        return "no_data"
    if m.final_points >= 180:
        return "excellent"
    if m.final_points >= 150:
        return "good"
    if m.final_points >= 100:
        return "average"
    return "low"


def _main_change_reason(deltas: dict) -> str:
    """Определяет показатель с наибольшим абсолютным влиянием на изменение."""
    labeled = {
        "quality": ("качества", deltas.get("delta_quality", 0)),
        "kvz": ("КВЗ", deltas.get("delta_kvz", 0)),
        "hours": ("часов", deltas.get("delta_total_hours", 0)),
        "efficiency": ("эффективности", deltas.get("delta_efficiency", 0)),
        "penalty": ("штрафов", -deltas.get("delta_penalty_points", 0)),
    }
    significant = {k: v for k, v in labeled.items() if abs(v[1]) >= 0.5}
    if not significant:
        return "Нет значимых изменений"
    key, (label, val) = max(significant.items(), key=lambda kv: abs(kv[1][1]))
    direction = "Рост за счёт" if val > 0 else "Просадка из-за"
    sign = "+" if val > 0 else ""
    return f"{direction} {label}: {sign}{round(val, 1)}"


def _recommendation_for(m: OperatorPeriodMetrics, delta_final: float | None) -> str:
    if m.quality_calls_count == 0 and m.base_hours <= 0:
        return "Недостаточно данных для рекомендации — проверьте наличие оценок и табеля."
    parts = []
    if m.quality_calls_count > 0 and m.quality_avg < 80:
        parts.append("Провести разбор звонков и дать обратную связь по качеству.")
    if m.base_hours > 0 and m.kvz < 8:
        parts.append("Проверить скорость обработки и причины низкого количества звонков в час.")
    if m.base_hours > 0 and m.efficiency_percent < 45:
        parts.append("Проверить, сколько времени оператор реально находится в звонке.")
    if m.penalty_minutes > 0:
        parts.append("Проверить дисциплину и причины штрафов.")
    if delta_final is not None and delta_final > 15:
        parts.append("Отметить положительную динамику оператора.")
    if not parts:
        return "Показатели в норме, отклонений не выявлено."
    return " ".join(parts)


def compute_points_analysis(
    rows: list[OperatorAnalyticsRow],
    prev_rows: list[OperatorAnalyticsRow] | None,
) -> dict:
    """
    Полный анализ итоговых баллов с разбором вклада и сравнением с прошлым
    периодом (если prev_rows передан — тот же период длительности, смещённый назад).
    """
    included = [r for r in rows if r.metrics and r.metrics.has_any_period_data]

    prev_by_key: dict[str, OperatorPeriodMetrics] = {}
    if prev_rows:
        for r in prev_rows:
            if r.metrics and r.metrics.has_any_period_data:
                prev_by_key[r.name_key] = r.metrics

    operators_out = []
    for r in included:
        m = r.metrics
        prev_m = prev_by_key.get(r.name_key)

        delta_final = round(m.final_points - prev_m.final_points, 2) if prev_m else None
        delta_quality = round(m.quality_avg - prev_m.quality_avg, 2) if (prev_m and m.quality_calls_count and prev_m.quality_calls_count) else None
        delta_kvz = round(m.kvz - prev_m.kvz, 2) if (prev_m and m.base_hours > 0 and prev_m.base_hours > 0) else None
        delta_hours = round(m.total_hours - prev_m.total_hours, 2) if prev_m else None
        delta_efficiency = round(m.efficiency_percent - prev_m.efficiency_percent, 2) if (prev_m and m.base_hours > 0 and prev_m.base_hours > 0) else None
        delta_penalty = round(m.penalty_points - prev_m.penalty_points, 2) if prev_m else None

        deltas_for_reason = {
            "delta_quality": delta_quality or 0,
            "delta_kvz": delta_kvz or 0,
            "delta_total_hours": delta_hours or 0,
            "delta_efficiency": delta_efficiency or 0,
            "delta_penalty_points": delta_penalty or 0,
        }
        main_reason = _main_change_reason(deltas_for_reason) if prev_m else "Нет данных за прошлый период"

        operators_out.append({
            "operator_id": r.operator_id,
            "full_name": r.full_name,
            "group_name": r.group_name,
            "quality": m.quality_avg if m.quality_calls_count else None,
            "kvz": m.kvz if m.base_hours > 0 else None,
            "total_hours": m.total_hours,
            "efficiency": m.efficiency_percent if m.base_hours > 0 else None,
            "penalty_points": m.penalty_points,
            "penalty_minutes": m.penalty_minutes,
            "final_points": m.final_points,
            "previous_final_points": prev_m.final_points if prev_m else None,
            "delta_final_points": delta_final,
            "delta_quality": delta_quality,
            "delta_kvz": delta_kvz,
            "delta_total_hours": delta_hours,
            "delta_efficiency": delta_efficiency,
            "delta_penalty_points": delta_penalty,
            "main_change_reason": main_reason,
            "status": _result_status(m),
            "recommendation": _recommendation_for(m, delta_final),
        })

    operators_out.sort(key=lambda o: o["final_points"], reverse=True)

    finals = [o["final_points"] for o in operators_out]
    deltas = [o["delta_final_points"] for o in operators_out if o["delta_final_points"] is not None]

    growth = [o for o in operators_out if o["delta_final_points"] is not None and o["delta_final_points"] > 0]
    decline = [o for o in operators_out if o["delta_final_points"] is not None and o["delta_final_points"] < 0]

    top_growth = sorted(growth, key=lambda o: o["delta_final_points"], reverse=True)[:5]
    top_decline = sorted(decline, key=lambda o: o["delta_final_points"])[:5]

    summary = {
        "avg_final_points": round(sum(finals) / len(finals), 2) if finals else None,
        "max_final_points": round(max(finals), 2) if finals else None,
        "min_final_points": round(min(finals), 2) if finals else None,
        "avg_delta": round(sum(deltas) / len(deltas), 2) if deltas else None,
        "operators_with_growth": len(growth),
        "operators_with_decline": len(decline),
        "has_previous_period": bool(prev_rows),
    }

    return {
        "summary": summary,
        "operators": operators_out,
        "top_growth": top_growth,
        "top_decline": top_decline,
    }
