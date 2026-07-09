"""Бизнес-логика рейтинга (ТЗ §15.2).

Оркестрация: берёт данные из repository, считает через calculators, собирает
ответ для frontend, управляет кешем. SQL-запросы вынесены в repository,
чистая математика — в calculators. Логика перенесена из routers/rating.py и
services/rating.py дословно, формулы не менялись.
"""
from __future__ import annotations

import time
from datetime import date
from statistics import mean

from sqlalchemy.orm import Session

from app.models.entities import Operator
from app.modules.rating import calculators as calc
from app.modules.rating import repository as repo
from app.modules.rating.calculators import MAX_HOURS_PTS, WEEKDAYS_RU
from app.modules.rating.nominations import invalidate_nominations_cache

# ── Кеш рейтинга ──────────────────────────────────────────────────────────────
# Простой in-memory кеш рейтинга — пересчёт тяжёлый (все PeriodReport + снапшоты),
# а данные меняются редко (только после сохранения расчёта). Кеш живёт 60 секунд.
_RATING_CACHE: dict = {}
_RATING_CACHE_TTL = 60  # секунд


def _rating_cache_get() -> list[dict] | None:
    entry = _RATING_CACHE.get("rows")
    if entry and (time.time() - entry["ts"]) < _RATING_CACHE_TTL:
        return entry["data"]
    return None


def _rating_cache_set(rows: list[dict]) -> None:
    _RATING_CACHE["rows"] = {"data": rows, "ts": time.time()}


def rating_cache_invalidate() -> None:
    """
    Единая точка инвалидации (ТЗ 10.3). Вызывать после изменения данных,
    влияющих на rating_rows/номинации: сохранение PeriodReport, ручное
    начисление/списание коинов, резерв/возврат по заявкам магазина,
    изменение статуса/данных оператора.
    """
    _RATING_CACHE.clear()
    invalidate_nominations_cache()


def latest_period(db: Session) -> tuple[date, date] | None:
    return repo.latest_period(db)


def rating_rows(db: Session, week_start: date | None = None, week_end: date | None = None) -> list[dict]:
    """
    Возвращает турнирную таблицу. week_start/week_end пока игнорируются для
    обратной совместимости сигнатуры — рейтинг строится по последнему
    сохранённому расчёту каждого оператора (т.к. разные операторы могут быть
    рассчитаны за разные периоды через «Расчёт периода»).
    """
    cached = _rating_cache_get()
    if cached is not None:
        return cached

    grouped = repo.all_reports_grouped(db)
    if not grouped:
        return []

    operator_ids = list(grouped.keys())
    operators = repo.participating_operators(db, operator_ids)

    entries = []
    for op_id, reports in grouped.items():
        operator = operators.get(op_id)
        if not operator:
            continue  # не участвует / уволен / неактивен — не попадает в рейтинг
        entries.append((operator, reports[0], reports))  # reports[0] = самый свежий

    # Ранжирование по итоговым баллам текущего (самого свежего) расчёта
    entries.sort(key=lambda e: e[1].final_points, reverse=True)

    # ── Восстановление исторического ранга для расчёта rank_delta ──────
    def snapshot_at(as_of: date) -> list[tuple[int, float]]:
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

    snapshot_cache: dict[date, dict[int, int]] = {}

    def rank_position_at(operator_id: int, as_of: date) -> int | None:
        if as_of not in snapshot_cache:
            snap = snapshot_at(as_of)
            snapshot_cache[as_of] = {op_id: pos for pos, (op_id, _pts) in enumerate(snap, start=1)}
        return snapshot_cache[as_of].get(operator_id)

    # Bulk-загрузка уровней ОДНИМ запросом вместо N вызовов operator_level_badge
    op_ids = [op.id for op, _, _ in entries]
    level_rows = repo.level_assignments(db, op_ids)
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


# ── Payload'ы для endpoint'ов (перенос тел из routers/rating.py) ──────────────

def rating_overview(
    db: Session, op: Operator | None, week_start: date | None, week_end: date | None,
    limit: int | None = None, offset: int = 0,
) -> dict:
    rows = rating_rows(db, week_start, week_end)
    period = latest_period(db)
    period_label = calc.week_label(*period) if period else "—"
    last_updated = repo.max_report_created_at(db)

    # Mark current user row
    for row in rows:
        row["is_current_user"] = op and row["operator_id"] == op.id

    total = len(rows)
    page = rows[offset:offset + limit] if limit is not None else rows

    return {
        "period": period_label,
        "week_start": str(period[0]) if period else None,
        "week_end":   str(period[1]) if period else None,
        "total":      total,
        "limit":      limit,
        "offset":     offset,
        "updated_at": last_updated.isoformat() if last_updated else None,
        "items":      page,
    }


def my_rating(db: Session, op: Operator) -> dict:
    rows = rating_rows(db)
    total = len(rows)
    my_row = next((r for r in rows if r["operator_id"] == op.id), None)

    if not my_row:
        return {
            "operator_id": op.id,
            "full_name": op.full_name,
            "group_name": op.group_name or "",
            "place": None,
            "total_participants": total,
            "weekly_points": 0,
            "weekly_coins": 0,
            "total_balance": op.current_balance or 0,
            "quality_score": 0,
            "efficiency_score": 0,
            "place_change": None,
        }

    return {
        "operator_id": op.id,
        "full_name": op.full_name,
        "group_name": op.group_name or "",
        "place": my_row["rank_position"],
        "total_participants": total,
        "weekly_points": my_row.get("contest_points") or my_row.get("final_score") or 0,
        "weekly_coins": my_row.get("coins_earned") or 0,
        "total_balance": op.current_balance or 0,
        "quality_score": my_row.get("quality_score") or 0,
        "efficiency_score": my_row.get("efficiency_score") or 0,
        "place_change": my_row.get("rank_delta"),
    }


def comparison(db: Session, op: Operator, metric: str, is_self: bool) -> dict:
    rows = rating_rows(db)  # уже кеширован 60с
    if not rows or not op:
        return {"metric": metric, "items": []}

    def val(row: dict) -> float:
        return calc.metric_value(row, metric)

    selected_row = next((r for r in rows if r["operator_id"] == op.id), {})
    selected_val = val(selected_row)
    top1_val  = val(rows[0]) if rows else 0
    top3_vals = [val(r) for r in rows[:3]]
    top3_avg  = round(mean(top3_vals), 1) if top3_vals else 0
    all_avg   = round(mean([val(r) for r in rows]), 1) if rows else 0
    selected_label = "Вы" if is_self else "Выбранный оператор"

    return {
        "metric": metric,
        "items": [
            {"label": "Топ-1",           "value": top1_val,  "is_highlight": False},
            {"label": "Среднее топ-3",   "value": top3_avg,  "is_highlight": False},
            {"label": selected_label,    "value": selected_val, "is_highlight": True},
            {"label": "Среднее по всем", "value": all_avg,   "is_highlight": False},
        ]
    }


def operator_dynamics(db: Session, op: Operator, mode: str, limit: int) -> dict:
    """
    Динамика оператора за последние N рабочих дней с данными.
    Качество звонков НЕ учитывается (только часы, КВЗ, эффективность, штрафы).
    """
    limit = max(1, min(limit, 10))

    rows = repo.operator_daily_metrics(db, op.id, limit)

    if not rows:
        return {
            "operator_id": op.id,
            "full_name": op.full_name,
            "mode": mode,
            "limit": limit,
            "quality_included": False,
            "items": [],
            "summary": {},
            "components_summary": {},
        }

    # ── Норма часов оператора ─────────────────────────────────────
    op_rate = float(op.rate) if op.rate else None

    def daily_norm(d: date) -> float:
        """Дневная норма часов для оператора с учётом его ставки."""
        if not op_rate:
            return 0.0
        wn = repo.work_norm(db, d.year, d.month, op_rate)
        return calc.daily_norm(op_rate, d, wn.monthly_norm_hours if wn else None)

    safe_div = calc.safe_div
    clamp = calc.clamp

    # ── рассчитываем показатели для каждого дня ─────────
    items = []
    for row in rows:
        d = row.metric_date
        norm = daily_norm(d)

        total_hours = clamp(row.worked_hours)
        base_h      = clamp(row.base_hours)
        calls       = clamp(row.calls_count)
        call_time   = clamp(row.efficiency)   # efficiency поле = call_time_hours
        pen_pts     = clamp(row.penalty_points)

        # Баллы за часы
        if norm > 0:
            hours_pts = clamp(safe_div(total_hours, norm), hi=1.0) * MAX_HOURS_PTS
        else:
            hours_pts = 0.0

        # КВЗ
        kvz = clamp(safe_div(calls, base_h))

        # Эффективность (%)
        eff = clamp(safe_div(call_time, base_h) * 100)

        daily_pts   = round(hours_pts + kvz + eff - pen_pts, 2)
        daily_coins = int(max(0, daily_pts) // 5)

        items.append({
            "date":           d.isoformat(),
            "label":          d.strftime("%-d.%m"),
            "weekday":        WEEKDAYS_RU[d.weekday()],
            "total_hours":    round(total_hours, 2),
            "base_hours":     round(base_h, 2),
            "calls_count":    int(calls),
            "call_time_hours": round(call_time, 2),
            "hours_points":   round(hours_pts, 2),
            "kvz":            round(kvz, 2),
            "efficiency":     round(eff, 2),
            "penalty_points": round(pen_pts, 2),
            "daily_points":   daily_pts,
            "daily_coins":    daily_coins,
            "rank":           None,   # заполним ниже
        })

    # ── Место за каждый день ──────────────────────────────────────
    dates_needed = [i["date"] for i in items]
    if dates_needed:
        all_rows = repo.daily_metrics_for_dates(
            db, [date.fromisoformat(x) for x in dates_needed]
        )

        # Группируем по дате
        from collections import defaultdict
        by_date = defaultdict(list)
        for r in all_rows:
            d_str = r.metric_date.isoformat()
            bh = clamp(r.base_hours)
            th = clamp(r.worked_hours)
            calls_ = clamp(r.calls_count)
            eff_   = clamp(r.efficiency)
            pen_   = clamp(r.penalty_points)
            # Норма для этого оператора — приближение (без JOIN)
            dp = round(clamp(th / max(daily_norm(r.metric_date), 0.001), hi=1.0) * MAX_HOURS_PTS
                       + safe_div(calls_, bh)
                       + safe_div(eff_, bh) * 100
                       - pen_, 2)
            by_date[d_str].append((r.operator_id, dp))

        # Считаем ранги
        rank_map = {}
        for d_str, op_pts in by_date.items():
            sorted_ops = sorted(op_pts, key=lambda x: (-x[1], x[0]))
            for rank_pos, (oid, _) in enumerate(sorted_ops, 1):
                if oid == op.id:
                    rank_map[d_str] = rank_pos
                    break

        for item in items:
            item["rank"] = rank_map.get(item["date"])

    # ── Summary ───────────────────────────────────────────────────
    if mode == "rank":
        vals = [i["rank"] or 0 for i in items]
    elif mode == "coins":
        vals = [i["daily_coins"] for i in items]
    else:
        vals = [i["daily_points"] for i in items]

    today_val = vals[-1] if vals else 0
    prev_val  = vals[-2] if len(vals) >= 2 else None
    delta     = round(today_val - prev_val, 2) if prev_val is not None else None
    delta_pct = round(delta / prev_val * 100, 2) if (prev_val and prev_val != 0 and delta is not None) else None
    avg4      = round(sum(vals) / len(vals), 2) if vals else 0

    summary = {
        "today_value":    today_val,
        "previous_value": prev_val,
        "delta":          delta,
        "delta_percent":  delta_pct,
        "average_4_days": avg4,
    }

    # Components summary (последний день)
    last = items[-1] if items else {}
    components = {
        "hours_points":   last.get("hours_points", 0),
        "kvz":            last.get("kvz", 0),
        "efficiency":     last.get("efficiency", 0),
        "penalty_points": last.get("penalty_points", 0),
    }

    return {
        "operator_id":       op.id,
        "full_name":         op.full_name,
        "mode":              mode,
        "limit":             limit,
        "quality_included":  False,
        "items":             items,
        "summary":           summary,
        "components_summary": components,
    }


def my_dynamics(db: Session, op: Operator, type: str, weeks: int) -> dict:
    results = repo.period_reports_for_operator(db, op.id, weeks)

    items = []
    for r in results:
        if type == "coins":
            value = r.coins_awarded or 0
        elif type == "points":
            value = r.final_points or 0
        else:
            # "place" — динамика места не хранится напрямую, используем
            # final_points как прокси (выше балл = выше место); для точного
            # места по историческому периоду нужен пересчёт всей выборки,
            # что дорого для графика динамики — упрощаем до баллов.
            value = r.final_points or 0
        items.append({
            "week": calc.week_label(r.period_start, r.period_end),
            "value": value,
        })

    return {"type": type, "items": items}


def my_transactions(db: Session, op: Operator, limit: int) -> list[dict]:
    txs = repo.coin_transactions(db, op.id, limit)
    return [
        {
            "amount": t.amount,
            "comment": t.comment or "",
            "type": t.type or "",
            "created_at": t.created_at.isoformat() if t.created_at else "",
        }
        for t in txs
    ]


def race(db: Session, me: Operator | None, group_id: int | None, mode: str) -> dict:
    """
    Визуальный рейтинг «Гонка баллов». Использует уже посчитанные итоговые
    баллы (PeriodReport.final_points через rating_rows) — не пересчитывает
    ничего на лету. Поддерживает фильтр по группе и режимы отображения.
    """
    all_rows = rating_rows(db)
    total_all = len(all_rows)

    if not all_rows:
        return {
            "current_user": None,
            "items": [],
            "groups": [],
            "total_participants": 0,
            "message": "Рейтинг за выбранный период пока не сформирован.",
        }

    # Группа, к которой относится сам оператор (для подсказки, если он не входит в выбранную группу)
    my_row_global = next((r for r in all_rows if me and r["operator_id"] == me.id), None)
    my_group_name = my_row_global["group_name"] if my_row_global else (me.group_name if me else None)

    # Фильтрация по группе
    if group_id is not None:
        repo.get_operator(db, group_id) and None  # group_id здесь — это Group.id, не Operator.id
        grp = repo.get_group(db, group_id)
        group_name_filter = grp.name if grp else None
        rows = [r for r in all_rows if r["group_name"] == group_name_filter] if group_name_filter else all_rows
    else:
        rows = all_rows

    if not rows:
        return {
            "current_user": None,
            "items": [],
            "groups": [],
            "total_participants": 0,
            "message": "В выбранной группе пока нет данных для рейтинга.",
        }

    # Баллы и место пересчитываются в рамках отфильтрованной выборки (группы),
    # т.к. "место в группе" логически отличается от глобального места
    rows_sorted = sorted(rows, key=lambda r: r["contest_points"] or r["final_score"] or 0, reverse=True)
    for i, r in enumerate(rows_sorted, start=1):
        r["_local_rank"] = i

    total_in_view = len(rows_sorted)

    my_row = next((r for r in rows_sorted if me and r["operator_id"] == me.id), None)

    # current_user payload
    current_user_payload = None
    not_in_group_note = None
    if me:
        if my_row:
            points = my_row["contest_points"] or my_row["final_score"] or 0
            rank = my_row["_local_rank"]
            next_above = rows_sorted[rank - 2] if rank > 1 else None
            top3_ref = rows_sorted[2] if len(rows_sorted) > 2 else (rows_sorted[-1] if rows_sorted else None)
            points_to_next = round((next_above["contest_points"] or next_above["final_score"] or 0) - points, 1) if next_above else 0
            points_to_top3 = round(max(0, (top3_ref["contest_points"] or top3_ref["final_score"] or 0) - points), 1) if rank > 3 and top3_ref else 0

            current_user_payload = {
                "operator_id": me.id,
                "full_name": me.full_name,
                "group": my_row["group_name"],
                "rank": rank,
                "points": points,
                "total_participants": total_in_view,
                "points_to_next_rank": points_to_next,
                "points_to_top_3": points_to_top3,
                "rank_change": my_row.get("rank_delta"),
            }
        else:
            # Оператор не входит в выбранную группу — отдельная заметка, но не блокируем выдачу
            if group_id is not None and my_group_name and my_group_name != (rows_sorted[0]["group_name"] if rows_sorted else None):
                not_in_group_note = "Вы не входите в выбранную группу, но можете сравнить свои баллы с этой группой."
            if my_row_global:
                points = my_row_global["contest_points"] or my_row_global["final_score"] or 0
                current_user_payload = {
                    "operator_id": me.id,
                    "full_name": me.full_name,
                    "group": my_row_global["group_name"],
                    "rank": my_row_global["rank_position"],
                    "points": points,
                    "total_participants": total_all,
                    "points_to_next_rank": None,
                    "points_to_top_3": None,
                    "rank_change": my_row_global.get("rank_delta"),
                    "outside_selected_group": True,
                }

    # Режимы отображения
    my_local_rank = my_row["_local_rank"] if my_row else None
    if mode == "top10":
        display_rows = rows_sorted[:10]
    elif mode == "top20":
        display_rows = rows_sorted[:20]
    elif mode == "my_zone" and my_local_rank:
        lo = max(0, my_local_rank - 6)
        hi = min(len(rows_sorted), my_local_rank + 5)
        display_rows = rows_sorted[lo:hi]
    else:  # all, или my_zone без своих данных
        display_rows = rows_sorted

    items = []
    for r in display_rows:
        points = r["contest_points"] or r["final_score"] or 0
        items.append({
            "operator_id": r["operator_id"],
            "full_name": r["operator_name"],
            "initials": calc.initials(r["operator_name"]),
            "group": r["group_name"],
            "rank": r["_local_rank"],
            "points": points,
            "is_current_user": bool(me and r["operator_id"] == me.id),
        })

    # Сравнение по группам (средний балл каждой группы + личный балл оператора)
    by_group: dict[str, list[float]] = {}
    for r in all_rows:
        g = r["group_name"] or "Без группы"
        by_group.setdefault(g, []).append(r["contest_points"] or r["final_score"] or 0)
    groups_out = [
        {"group": g, "avg_points": round(mean(vals), 1) if vals else 0}
        for g, vals in sorted(by_group.items())
    ]

    return {
        "current_user": current_user_payload,
        "not_in_group_note": not_in_group_note,
        "items": items,
        "groups": groups_out,
        "total_participants": total_in_view,
        "mode": mode,
    }
