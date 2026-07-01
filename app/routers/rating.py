from __future__ import annotations

from datetime import date
from statistics import mean
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database.db import get_db
from app.models.entities import CoinTransaction, Operator, PeriodReport, User
from app.services.rating import latest_period, rating_rows

router = APIRouter(prefix="/rating", tags=["rating"])
PRIVILEGED_RATING_ROLES = {"supervisor", "manager", "admin"}


def _get_operator_for_user(db: Session, user: User) -> Optional[Operator]:
    if user.operator_id:
        return db.get(Operator, user.operator_id)
    return None


def _get_requested_operator(db: Session, user: User, operator_id: Optional[int]) -> Optional[Operator]:
    if operator_id is None:
        return _get_operator_for_user(db, user)

    if user.role not in PRIVILEGED_RATING_ROLES and user.operator_id != operator_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")

    op = db.get(Operator, operator_id)
    if not op:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Оператор не найден")
    return op


def _week_label(ws: date, we: date) -> str:
    return f"{ws.strftime('%d.%m')}–{we.strftime('%d.%m.%Y')}"


def _metric_value(row: Dict, metric: str) -> float:
    if metric == "coins":
        return float(row.get("coins_earned") or 0)
    if metric == "quality":
        return float(row.get("quality_score") or 0)
    if metric == "efficiency":
        return float(row.get("efficiency_score") or 0)
    return float(row.get("contest_points") or row.get("final_score") or 0)


@router.get("")
def get_rating(
    week_start: Optional[date] = None,
    week_end: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    rows = rating_rows(db, week_start, week_end)
    period = latest_period(db)
    period_label = _week_label(*period) if period else "—"
    last_updated = db.scalar(select(func.max(PeriodReport.created_at)))

    # Mark current user row
    op = _get_operator_for_user(db, current_user)
    for row in rows:
        row["is_current_user"] = op and row["operator_id"] == op.id

    return {
        "period": period_label,
        "week_start": str(period[0]) if period else None,
        "week_end":   str(period[1]) if period else None,
        "total":      len(rows),
        "updated_at": last_updated.isoformat() if last_updated else None,
        "items":      rows,
    }


@router.get("/me")
def get_my_rating(
    operator_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    op = _get_requested_operator(db, current_user, operator_id)
    if not op:
        return {"no_operator": True}

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


@router.get("/me/comparison")
def get_my_comparison(
    metric: str = "points",
    operator_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    op = _get_requested_operator(db, current_user, operator_id)
    rows = rating_rows(db)
    if not rows or not op:
        return {"metric": metric, "items": []}

    def val(row: Dict) -> float:
        return _metric_value(row, metric)

    selected_row = next((r for r in rows if r["operator_id"] == op.id), {})
    selected_val = val(selected_row)
    top1_val  = val(rows[0]) if rows else 0
    top3_vals = [val(r) for r in rows[:3]]
    top3_avg  = round(mean(top3_vals), 1) if top3_vals else 0
    all_avg   = round(mean([val(r) for r in rows]), 1) if rows else 0
    selected_label = "Вы" if current_user.operator_id == op.id else "Выбранный оператор"

    return {
        "metric": metric,
        "items": [
            {"label": "Топ-1",           "value": top1_val,  "is_highlight": False},
            {"label": "Среднее топ-3",   "value": top3_avg,  "is_highlight": False},
            {"label": selected_label,    "value": selected_val, "is_highlight": True},
            {"label": "Среднее по всем", "value": all_avg,   "is_highlight": False},
        ]
    }




@router.get("/operator-dynamics")
def get_operator_dynamics(
    mode: str = "points",        # points | coins | rank
    limit: int = 4,
    operator_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Динамика оператора за последние N рабочих дней с данными.
    Качество звонков НЕ учитывается (только часы, КВЗ, эффективность, штрафы).
    """
    from app.models.entities import OperatorDailyMetrics, WorkNorm
    from sqlalchemy import func as sqlfunc
    import calendar

    op = _get_requested_operator(db, current_user, operator_id)
    if not op:
        return {"operator_id": None, "items": [], "summary": {}, "components_summary": {}}

    limit = max(1, min(limit, 10))

    # ── Шаг 1-3: последние N дат с рабочими данными ──────────────
    rows = list(db.scalars(
        select(OperatorDailyMetrics)
        .where(
            OperatorDailyMetrics.operator_id == op.id,
            # Хотя бы один рабочий показатель > 0
            (
                (OperatorDailyMetrics.worked_hours > 0) |
                (OperatorDailyMetrics.base_hours > 0) |
                (OperatorDailyMetrics.calls_count > 0) |
                (OperatorDailyMetrics.efficiency > 0) |
                (OperatorDailyMetrics.penalty_points > 0) |
                (OperatorDailyMetrics.penalty_minutes > 0)
            )
        )
        .order_by(OperatorDailyMetrics.metric_date.desc())
        .limit(limit)
    ))
    rows.reverse()  # хронологический порядок для графика

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
    MAX_HOURS_PTS = 25.0

    def daily_norm(d: date) -> float:
        """Дневная норма часов для оператора с учётом его ставки."""
        if not op_rate:
            return 0.0
        days_in_month = calendar.monthrange(d.year, d.month)[1]
        wn = db.scalar(
            select(WorkNorm).where(
                WorkNorm.year == d.year,
                WorkNorm.month == d.month,
                WorkNorm.rate == op_rate,
                WorkNorm.is_active.is_(True),
            )
        )
        if wn:
            return float(wn.monthly_norm_hours) / days_in_month
        # Fallback: стандартные нормы
        std = {0.5: (84, 88), 0.75: (126, 132), 1.0: (168, 176)}
        norms = std.get(op_rate, (168, 176))
        monthly = norms[0] if days_in_month == 30 else norms[1]
        return monthly / days_in_month

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

    # ── Шаг 4-5: рассчитываем показатели для каждого дня ─────────
    WEEKDAYS_RU = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]

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
        from app.models.entities import Operator as OpModel
        # Все метрики всех операторов за нужные даты
        all_rows = list(db.execute(
            select(
                OperatorDailyMetrics.metric_date,
                OperatorDailyMetrics.operator_id,
                OperatorDailyMetrics.worked_hours,
                OperatorDailyMetrics.base_hours,
                OperatorDailyMetrics.calls_count,
                OperatorDailyMetrics.efficiency,
                OperatorDailyMetrics.penalty_points,
            ).where(
                OperatorDailyMetrics.metric_date.in_([date.fromisoformat(x) for x in dates_needed]),
                (
                    (OperatorDailyMetrics.worked_hours > 0) |
                    (OperatorDailyMetrics.base_hours > 0) |
                    (OperatorDailyMetrics.calls_count > 0)
                )
            )
        ))

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

@router.get("/me/dynamics")
def get_my_dynamics(
    type: str = "place",
    weeks: int = 8,
    operator_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    op = _get_requested_operator(db, current_user, operator_id)
    if not op:
        return {"type": type, "items": []}

    results = list(db.scalars(
        select(PeriodReport)
        .where(PeriodReport.operator_id == op.id)
        .order_by(PeriodReport.period_end.desc())
        .limit(weeks)
    ))
    results.reverse()

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
            "week": _week_label(r.period_start, r.period_end),
            "value": value,
        })

    return {"type": type, "items": items}


@router.get("/me/transactions")
def get_my_transactions(
    limit: int = 5,
    operator_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[dict]:
    op = _get_requested_operator(db, current_user, operator_id)
    if not op:
        return []

    txs = list(db.scalars(
        select(CoinTransaction)
        .where(CoinTransaction.operator_id == op.id)
        .order_by(CoinTransaction.created_at.desc())
        .limit(limit)
    ))

    return [
        {
            "amount": t.amount,
            "comment": t.comment or "",
            "type": t.type or "",
            "created_at": t.created_at.isoformat() if t.created_at else "",
        }
        for t in txs
    ]


@router.get("/nominations")
def get_nominations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    op = _get_operator_for_user(db, current_user)
    rows = rating_rows(db)
    if not rows:
        return {"items": []}

    nominations = []

    # Best points — top-1
    if rows:
        top = rows[0]
        nominations.append({
            "title": "Лучший результат недели",
            "winner_name": top["operator_name"],
            "value": f"{top.get('contest_points') or top.get('final_score', 0):.0f} баллов",
            "coins_bonus": 50,
            "is_current_user": op and top["operator_id"] == op.id,
        })

    # Best coins
    by_coins = sorted(rows, key=lambda r: r.get("coins_earned") or 0, reverse=True)
    if by_coins:
        top_c = by_coins[0]
        nominations.append({
            "title": "Больше всего коинов",
            "winner_name": top_c["operator_name"],
            "value": f"{top_c.get('coins_earned', 0)} ₡",
            "coins_bonus": 30,
            "is_current_user": op and top_c["operator_id"] == op.id,
        })

    # Best progress (biggest rank delta)
    with_delta = [(r, r.get("rank_delta") or 0) for r in rows]
    best_progress = max(with_delta, key=lambda x: x[1], default=(None, 0))
    if best_progress[0] and best_progress[1] > 0:
        bp = best_progress[0]
        nominations.append({
            "title": "Лучший прогресс недели",
            "winner_name": bp["operator_name"],
            "value": f"+{best_progress[1]} позиций",
            "coins_bonus": 15,
            "is_current_user": op and bp["operator_id"] == op.id,
        })

    return {"items": nominations}


def _initials(full_name: str) -> str:
    parts = [p for p in full_name.strip().split() if p]
    if not parts:
        return "??"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[1][0]).upper()


@router.get("/race")
def get_rating_race(
    group_id: Optional[int] = None,
    mode: str = "top10",  # top10 | top20 | my_zone | all
    operator_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Визуальный рейтинг «Гонка баллов». Использует уже посчитанные итоговые
    баллы (PeriodReport.final_points через rating_rows) — не пересчитывает
    ничего на лету. Поддерживает фильтр по группе и режимы отображения.
    """
    me = _get_requested_operator(db, current_user, operator_id)

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
        target_group = db.get(Operator, group_id) and None  # group_id здесь — это Group.id, не Operator.id
        from app.models.entities import Group
        grp = db.get(Group, group_id)
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
            "initials": _initials(r["operator_name"]),
            "group": r["group_name"],
            "rank": r["_local_rank"],
            "points": points,
            "is_current_user": bool(me and r["operator_id"] == me.id),
        })

    # Сравнение по группам (средний балл каждой группы + личный балл оператора)
    by_group: Dict[str, List[float]] = {}
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
