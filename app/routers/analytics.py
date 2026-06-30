from __future__ import annotations

from datetime import date, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import Group, Operator, PeriodReport, User
from app.services.analytics import (
    OperatorAnalyticsRow,
    classify_risk,
    compute_daily_dynamics,
    compute_groups_comparison,
    compute_heatmap,
    compute_kpi_summary,
    compute_load_vs_efficiency,
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
from app.services.analytics_cache import cache_get, cache_key, cache_set
from app.services.period_reports import OperatorPeriodMetrics, normalize_name

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _require_analytics_access(current_user: User = Depends(get_current_user)) -> User:
    """Руководитель, администратор — полный доступ. Супервайзер — доступ есть,
    но scoping по группе пока не сужается (в модели User нет supervisor_group_id).
    Оператор — запрещено."""
    if current_user.role not in ("supervisor", "manager", "admin"):
        raise HTTPException(status_code=403, detail="Доступ к аналитике запрещён для вашей роли")
    return current_user


def _site_operators(db: Session) -> List[Operator]:
    return list(db.scalars(select(Operator)))


def _build_site_map(operators: List[Operator]) -> dict:
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


PERIOD_NOT_CALCULATED_MESSAGE = (
    "Период ещё не рассчитан. Сначала выполните расчёт периода в разделе «Расчёт периода»."
)


def _metrics_from_period_report(pr: PeriodReport, full_name: str, name_key: str) -> OperatorPeriodMetrics:
    """
    Строит OperatorPeriodMetrics напрямую из уже сохранённой записи PeriodReport —
    БЕЗ единого обращения к Excel. Это и есть основная оптимизация: вся
    аналитика (кроме daily-dynamics/heatmap, которым нужна посуточная
    разбивка, которой в агрегированном PeriodReport нет) больше не парсит
    файлы и не вызывает calculate_period_report при каждом запросе.
    """
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
    return db.scalar(
        select(PeriodReport.id)
        .where(PeriodReport.period_start == start_date, PeriodReport.period_end == end_date)
        .limit(1)
    ) is not None


def _get_rows(
    db: Session,
    start_date: date,
    end_date: date,
    group_id: Optional[int] = None,
    operator_query: Optional[str] = None,
    participation_status: Optional[str] = None,
    only_with_data: bool = False,
) -> List[OperatorAnalyticsRow]:
    """
    Строит строки аналитики ИСКЛЮЧИТЕЛЬНО из сохранённых PeriodReport с
    точным совпадением (period_start, period_end). Никакого автоматического
    fallback на Excel-парсинг — если период не рассчитан, явная ошибка
    с понятным сообщением (см. ТЗ: "Период ещё не рассчитан...").
    """
    reports = list(
        db.scalars(
            select(PeriodReport).where(
                PeriodReport.period_start == start_date,
                PeriodReport.period_end == end_date,
            )
        )
    )
    if not reports:
        raise HTTPException(status_code=404, detail=PERIOD_NOT_CALCULATED_MESSAGE)

    operator_ids = [r.operator_id for r in reports]
    operators = {
        o.id: o for o in db.scalars(select(Operator).where(Operator.id.in_(operator_ids)))
    }

    rows: List[OperatorAnalyticsRow] = []
    for pr in reports:
        operator = operators.get(pr.operator_id)
        if not operator:
            continue  # оператор был удалён после сохранения расчёта — пропускаем сиротские записи
        name_key = normalize_name(operator.full_name)
        metrics = _metrics_from_period_report(pr, operator.full_name, name_key)
        rows.append(OperatorAnalyticsRow(
            full_name=operator.full_name,
            name_key=name_key,
            operator_id=operator.id,
            group_id=operator.group_id,
            group_name=operator.group_name,
            participation_status=operator.participation_status,
            metrics=metrics,
            risk_status=classify_risk(metrics),
        ))

    rows = filter_rows(rows, group_id, operator_query, participation_status, only_with_data)
    return rows


@router.get("/available-periods")
def get_available_periods(
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    """
    Список периодов, для которых уже выполнен и сохранён расчёт (есть хотя
    бы одна запись PeriodReport). Frontend должен предлагать пользователю
    выбирать период именно из этого списка, а не вводить произвольные даты.
    """
    rows = db.execute(
        select(PeriodReport.period_start, PeriodReport.period_end)
        .distinct()
        .order_by(PeriodReport.period_end.desc())
    ).all()
    return {
        "items": [
            {"start_date": str(s), "end_date": str(e), "label": f"{s.strftime('%d.%m.%Y')} – {e.strftime('%d.%m.%Y')}"}
            for s, e in rows
        ]
    }


@router.get("/summary")
def get_summary(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    operator_query: Optional[str] = Query(None),
    participation_status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    key = cache_key("summary", start_date=start_date, end_date=end_date, group_id=group_id,
                     operator_query=operator_query, participation_status=participation_status)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = _get_rows(db, start_date, end_date, group_id, operator_query, participation_status)
    kpi = compute_kpi_summary(rows)
    result = {
        "period": {"start": str(start_date), "end": str(end_date)},
        "kpi": kpi,
    }
    cache_set(key, result)
    return result


@router.get("/daily-dynamics")
def get_daily_dynamics(
    start_date: date,
    end_date: date,
    metric: str = Query("calls", pattern="^(calls|kvz|operators)$"),
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    """
    Посуточная динамика требует посуточного разреза, которого нет в
    агрегированном PeriodReport — для этого эндпоинта Excel-парсинг
    оправдан и остаётся (он лежит вне сферы основной оптимизации,
    т.к. структурно не может строиться из агрегатов).
    """
    from app.models.entities import UploadedReportFile

    report_row = db.scalar(select(UploadedReportFile).where(UploadedReportFile.file_kind == "report"))
    if not report_row:
        raise HTTPException(status_code=400, detail="Сначала загрузите файл Report")

    site_ops = _site_operators(db)
    if group_id is not None:
        site_ops = [o for o in site_ops if o.group_id == group_id]
    site_keys = {normalize_name(o.full_name) for o in site_ops if o.full_name}

    days = (end_date - start_date).days
    if days > 31:
        raise HTTPException(status_code=400, detail="Период для динамики по дням ограничен 31 днём")

    dynamics = compute_daily_dynamics(report_row.content, start_date, end_date, site_keys, metric)
    return {"metric": metric, "items": dynamics}


@router.get("/operators")
def get_operators_table(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    operator_query: Optional[str] = Query(None),
    participation_status: Optional[str] = Query(None),
    only_with_data: bool = Query(False),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    key = cache_key("operators", start_date=start_date, end_date=end_date, group_id=group_id,
                     operator_query=operator_query, participation_status=participation_status,
                     only_with_data=only_with_data)
    cached = cache_get(key)
    if cached is not None:
        return cached

    rows = _get_rows(db, start_date, end_date, group_id, operator_query, participation_status, only_with_data)

    def quality_band(q):
        if q is None:
            return None
        if q >= 90:
            return "green"
        if q >= 80:
            return "yellow"
        if q >= 70:
            return "orange"
        return "red"

    out = []
    for r in rows:
        m = r.metrics
        out.append({
            "full_name": r.full_name,
            "group_name": r.group_name,
            "calls_total": m.calls_total,
            "total_hours": m.total_hours,
            "base_hours": m.base_hours,
            "kvz": m.kvz if m.base_hours > 0 else None,
            "quality_avg": m.quality_avg if m.quality_calls_count > 0 else None,
            "quality_band": quality_band(m.quality_avg if m.quality_calls_count > 0 else None),
            "quality_calls_count": m.quality_calls_count,
            "call_time_hours": m.call_time_hours,
            "efficiency_percent": m.efficiency_percent if m.base_hours > 0 else None,
            "penalty_minutes": m.penalty_minutes,
            "penalty_points": m.penalty_points,
            "final_points": m.final_points,
            "risk_status": r.risk_status,
        })
    return {"items": out}


@router.get("/groups-comparison")
def get_groups_comparison(
    start_date: date,
    end_date: date,
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    key = cache_key("groups-comparison", start_date=start_date, end_date=end_date)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = _get_rows(db, start_date, end_date)
    result = {"items": compute_groups_comparison(rows)}
    cache_set(key, result)
    return result


@router.get("/quality-kvz-matrix")
def get_quality_kvz_matrix(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    key = cache_key("quality-kvz-matrix", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = _get_rows(db, start_date, end_date, group_id)
    result = {"items": compute_quality_kvz_matrix(rows), "thresholds": {"quality": 85, "kvz": 10}}
    cache_set(key, result)
    return result


@router.get("/top-and-attention")
def get_top_and_attention(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    key = cache_key("top-and-attention", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = _get_rows(db, start_date, end_date, group_id)
    result = compute_top_and_attention(rows)
    cache_set(key, result)
    return result


@router.get("/penalties")
def get_penalties(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    key = cache_key("penalties", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = _get_rows(db, start_date, end_date, group_id)
    result = compute_penalties_analytics(rows)
    cache_set(key, result)
    return result


@router.get("/points-breakdown")
def get_points_breakdown(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    operator_query: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    key = cache_key("points-breakdown", start_date=start_date, end_date=end_date, group_id=group_id,
                     operator_query=operator_query)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = _get_rows(db, start_date, end_date, group_id, operator_query)
    result = {"items": compute_points_breakdown(rows)}
    cache_set(key, result)
    return result


@router.get("/points")
def get_points_analysis(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    operator_query: Optional[str] = Query(None),
    participation_status: Optional[str] = Query(None),
    only_with_data: bool = Query(False),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    """
    Полный анализ итоговых баллов: разбор вклада показателей, сравнение
    с предыдущим периодом (если для него тоже есть сохранённый расчёт),
    топ роста/просадки, статусы, рекомендации.
    """
    key = cache_key("points", start_date=start_date, end_date=end_date, group_id=group_id,
                     operator_query=operator_query, participation_status=participation_status,
                     only_with_data=only_with_data)
    cached = cache_get(key)
    if cached is not None:
        return cached

    rows = _get_rows(db, start_date, end_date, group_id, operator_query, participation_status, only_with_data)

    period_length = (end_date - start_date).days
    prev_end = start_date - timedelta(days=1)
    prev_start = prev_end - timedelta(days=period_length)

    prev_rows = None
    try:
        prev_rows = _get_rows(db, prev_start, prev_end, group_id, operator_query, participation_status, only_with_data)
    except HTTPException:
        prev_rows = None  # нет сохранённого расчёта за прошлый период — сравнение недоступно, это нормально

    analysis = compute_points_analysis(rows, prev_rows)
    analysis["period"] = {"start": str(start_date), "end": str(end_date)}
    analysis["previous_period"] = {"start": str(prev_start), "end": str(prev_end)} if prev_rows else None
    cache_set(key, analysis)
    return analysis


@router.get("/heatmap")
def get_heatmap(
    start_date: date,
    end_date: date,
    metric: str = Query("quality", pattern="^(quality|calls|kvz|efficiency|penalty)$"),
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    """Посуточный heatmap — структурно требует Excel (см. комментарий в daily-dynamics)."""
    from app.models.entities import UploadedReportFile

    monthly_row = db.scalar(select(UploadedReportFile).where(UploadedReportFile.file_kind == "monthly"))
    report_row = db.scalar(select(UploadedReportFile).where(UploadedReportFile.file_kind == "report"))
    if not report_row:
        raise HTTPException(status_code=400, detail="Сначала загрузите файлы")

    days = (end_date - start_date).days
    if days > 31:
        raise HTTPException(status_code=400, detail="Heatmap ограничена периодом 31 день")

    site_ops = _site_operators(db)
    if group_id is not None:
        site_ops = [o for o in site_ops if o.group_id == group_id]
    site_keys = {normalize_name(o.full_name): o.full_name for o in site_ops if o.full_name}

    result = compute_heatmap(
        monthly_row.content if monthly_row else None, report_row.content,
        start_date, end_date, site_keys, metric,
    )
    return result


@router.get("/risk-pyramid")
def get_risk_pyramid(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    key = cache_key("risk-pyramid", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = _get_rows(db, start_date, end_date, group_id)
    result = compute_risk_pyramid(rows)
    cache_set(key, result)
    return result


@router.get("/quality-coverage")
def get_quality_coverage(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    key = cache_key("quality-coverage", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = _get_rows(db, start_date, end_date, group_id)
    result = compute_quality_coverage(rows)
    cache_set(key, result)
    return result


@router.get("/load-vs-efficiency")
def get_load_vs_efficiency(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    key = cache_key("load-vs-efficiency", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = _get_rows(db, start_date, end_date, group_id)
    result = {"items": compute_load_vs_efficiency(rows)}
    cache_set(key, result)
    return result


@router.get("/quality-vs-penalties")
def get_quality_vs_penalties(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    key = cache_key("quality-vs-penalties", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = _get_rows(db, start_date, end_date, group_id)
    result = {"items": compute_quality_vs_penalties(rows)}
    cache_set(key, result)
    return result


@router.get("/groups-list")
def get_groups_list(
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    groups = list(db.scalars(select(Group).where(Group.status == "active")))
    return {"items": [{"id": g.id, "name": g.name} for g in groups]}
