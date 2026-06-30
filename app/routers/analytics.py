from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import Group, Operator, User
from app.services.analytics import (
    build_analytics_rows,
    compute_daily_dynamics,
    compute_groups_comparison,
    compute_heatmap,
    compute_kpi_summary,
    compute_load_vs_efficiency,
    compute_penalties_analytics,
    compute_points_breakdown,
    compute_quality_coverage,
    compute_quality_kvz_matrix,
    compute_quality_vs_penalties,
    compute_risk_pyramid,
    compute_top_and_attention,
    filter_rows,
)
from app.services.period_reports import (
    calculate_period_report,
    normalize_name,
    parse_monthly_report,
    parse_report_file,
)

router = APIRouter(prefix="/analytics", tags=["analytics"])

from app.models.entities import UploadedReportFile


def _get_uploaded_bytes(db: Session, file_kind: str):
    """Читает загруженный xlsx-файл из БД (та же таблица, что period_reports)."""
    row = db.scalar(select(UploadedReportFile).where(UploadedReportFile.file_kind == file_kind))
    return row.content if row else None


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


def _get_rows(
    db: Session,
    start_date: date,
    end_date: date,
    group_id: Optional[int] = None,
    operator_query: Optional[str] = None,
    participation_status: Optional[str] = None,
    only_with_data: bool = False,
):
    monthly_bytes = _get_uploaded_bytes(db, "monthly")
    report_bytes = _get_uploaded_bytes(db, "report")
    if not monthly_bytes or not report_bytes:
        raise HTTPException(status_code=400, detail="Сначала загрузите файлы Monthly Report и Report в разделе «Расчёт периода»")

    site_ops = _site_operators(db)
    site_names = [o.full_name for o in site_ops if o.full_name]
    site_map = _build_site_map(site_ops)

    try:
        result = calculate_period_report(
            _LAST_UPLOAD["monthly"], _LAST_UPLOAD["report"],
            start_date, end_date, site_operator_names=site_names,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    rows = build_analytics_rows(result.operators, site_map)
    rows = filter_rows(rows, group_id, operator_query, participation_status, only_with_data)
    return rows, result, site_map


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
    rows, result, _site_map = _get_rows(db, start_date, end_date, group_id, operator_query, participation_status)
    kpi = compute_kpi_summary(rows)
    return {
        "period": {"start": str(start_date), "end": str(end_date)},
        "kpi": kpi,
        "warnings": {
            "site_only": result.warnings_site_only,
            "file_only": result.warnings_file_only,
            "no_quality": result.warnings_no_quality,
            "no_base_hours": result.warnings_no_base_hours,
        },
    }


@router.get("/daily-dynamics")
def get_daily_dynamics(
    start_date: date,
    end_date: date,
    metric: str = Query("calls", pattern="^(calls|kvz|operators)$"),
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    report_bytes = _get_uploaded_bytes(db, "report")
    if not report_bytes:
        raise HTTPException(status_code=400, detail="Сначала загрузите файл Report")

    site_ops = _site_operators(db)
    if group_id is not None:
        site_ops = [o for o in site_ops if o.group_id == group_id]
    site_keys = {normalize_name(o.full_name) for o in site_ops if o.full_name}

    days = (end_date - start_date).days
    if days > 31:
        raise HTTPException(status_code=400, detail="Период для динамики по дням ограничен 31 днём")

    dynamics = compute_daily_dynamics(report_bytes, start_date, end_date, site_keys, metric)
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
    rows, _result, _site_map = _get_rows(db, start_date, end_date, group_id, operator_query, participation_status, only_with_data)

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
    rows, _result, _site_map = _get_rows(db, start_date, end_date)
    return {"items": compute_groups_comparison(rows)}


@router.get("/quality-kvz-matrix")
def get_quality_kvz_matrix(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    rows, _result, _site_map = _get_rows(db, start_date, end_date, group_id)
    return {"items": compute_quality_kvz_matrix(rows), "thresholds": {"quality": 85, "kvz": 10}}


@router.get("/top-and-attention")
def get_top_and_attention(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    rows, _result, _site_map = _get_rows(db, start_date, end_date, group_id)
    return compute_top_and_attention(rows)


@router.get("/penalties")
def get_penalties(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    rows, _result, _site_map = _get_rows(db, start_date, end_date, group_id)
    return compute_penalties_analytics(rows)


@router.get("/points-breakdown")
def get_points_breakdown(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    operator_query: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    rows, _result, _site_map = _get_rows(db, start_date, end_date, group_id, operator_query)
    return {"items": compute_points_breakdown(rows)}


@router.get("/heatmap")
def get_heatmap(
    start_date: date,
    end_date: date,
    metric: str = Query("quality", pattern="^(quality|calls|kvz|efficiency|penalty)$"),
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    monthly_bytes = _get_uploaded_bytes(db, "monthly")
    report_bytes = _get_uploaded_bytes(db, "report")
    if not report_bytes:
        raise HTTPException(status_code=400, detail="Сначала загрузите файлы")

    days = (end_date - start_date).days
    if days > 31:
        raise HTTPException(status_code=400, detail="Heatmap ограничена периодом 31 день")

    site_ops = _site_operators(db)
    if group_id is not None:
        site_ops = [o for o in site_ops if o.group_id == group_id]
    site_keys = {normalize_name(o.full_name): o.full_name for o in site_ops if o.full_name}

    result = compute_heatmap(
        monthly_bytes, report_bytes,
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
    rows, _result, _site_map = _get_rows(db, start_date, end_date, group_id)
    return compute_risk_pyramid(rows)


@router.get("/quality-coverage")
def get_quality_coverage(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    rows, _result, _site_map = _get_rows(db, start_date, end_date, group_id)
    return compute_quality_coverage(rows)


@router.get("/load-vs-efficiency")
def get_load_vs_efficiency(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    rows, _result, _site_map = _get_rows(db, start_date, end_date, group_id)
    return {"items": compute_load_vs_efficiency(rows)}


@router.get("/quality-vs-penalties")
def get_quality_vs_penalties(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    rows, _result, _site_map = _get_rows(db, start_date, end_date, group_id)
    return {"items": compute_quality_vs_penalties(rows)}


@router.get("/warnings")
def get_warnings(
    start_date: date,
    end_date: date,
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    _rows, result, _site_map = _get_rows(db, start_date, end_date)
    return {
        "site_only": result.warnings_site_only,
        "file_only": result.warnings_file_only,
        "no_quality": result.warnings_no_quality,
        "no_base_hours": result.warnings_no_base_hours,
        "ignored_service_rows": result.ignored_service_rows,
    }


@router.get("/groups-list")
def get_groups_list(
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    groups = list(db.scalars(select(Group).where(Group.status == "active")))
    return {"items": [{"id": g.id, "name": g.name} for g in groups]}
