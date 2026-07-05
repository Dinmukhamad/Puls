"""HTTP-слой аналитики (ТЗ §15.1).

Только приём query-параметров, проверка доступа и вызов service.
Бизнес-логика — в app/modules/analytics/service.py, расчёты — calculators.py,
SQL — repository.py, кеш — cache.py.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database.db import get_db
from app.models.entities import User
from app.modules.analytics import service

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _require_analytics_access(current_user: User = Depends(get_current_user)) -> User:
    """Руководитель, администратор — полный доступ. Супервайзер — доступ есть,
    но scoping по группе пока не сужается (в модели User нет supervisor_group_id).
    Оператор — запрещено."""
    if current_user.role not in ("supervisor", "manager", "admin"):
        raise HTTPException(status_code=403, detail="Доступ к аналитике запрещён для вашей роли")
    return current_user


@router.get("/available-periods")
def get_available_periods(
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.available_periods(db)


@router.get("/summary")
def get_summary(
    start_date: date,
    end_date: date,
    group_id: int | None = Query(None),
    operator_query: str | None = Query(None),
    participation_status: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.summary(db, start_date, end_date, group_id, operator_query, participation_status)


@router.get("/daily-dynamics")
def get_daily_dynamics(
    start_date: date,
    end_date: date,
    metric: str = Query("calls", pattern="^(calls|kvz|operators)$"),
    group_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.daily_dynamics(db, start_date, end_date, metric, group_id)


@router.get("/operators")
def get_operators_table(
    start_date: date,
    end_date: date,
    group_id: int | None = Query(None),
    operator_query: str | None = Query(None),
    participation_status: str | None = Query(None),
    only_with_data: bool = Query(False),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.operators_table(
        db, start_date, end_date, group_id, operator_query, participation_status, only_with_data
    )


@router.get("/groups-comparison")
def get_groups_comparison(
    start_date: date,
    end_date: date,
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.groups_comparison(db, start_date, end_date)


@router.get("/quality-kvz-matrix")
def get_quality_kvz_matrix(
    start_date: date,
    end_date: date,
    group_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.quality_kvz_matrix(db, start_date, end_date, group_id)


@router.get("/top-and-attention")
def get_top_and_attention(
    start_date: date,
    end_date: date,
    group_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.top_and_attention(db, start_date, end_date, group_id)


@router.get("/penalties")
def get_penalties(
    start_date: date,
    end_date: date,
    group_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.penalties(db, start_date, end_date, group_id)


@router.get("/points-breakdown")
def get_points_breakdown(
    start_date: date,
    end_date: date,
    group_id: int | None = Query(None),
    operator_query: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.points_breakdown(db, start_date, end_date, group_id, operator_query)


@router.get("/points")
def get_points_analysis(
    start_date: date,
    end_date: date,
    group_id: int | None = Query(None),
    operator_query: str | None = Query(None),
    participation_status: str | None = Query(None),
    only_with_data: bool = Query(False),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.points_analysis(
        db, start_date, end_date, group_id, operator_query, participation_status, only_with_data
    )


@router.get("/heatmap")
def get_heatmap(
    start_date: date,
    end_date: date,
    metric: str = Query("quality", pattern="^(quality|calls|kvz|efficiency|penalty)$"),
    group_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.heatmap(db, start_date, end_date, metric, group_id)


@router.get("/risk-pyramid")
def get_risk_pyramid(
    start_date: date,
    end_date: date,
    group_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.risk_pyramid(db, start_date, end_date, group_id)


@router.get("/quality-coverage")
def get_quality_coverage(
    start_date: date,
    end_date: date,
    group_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.quality_coverage(db, start_date, end_date, group_id)


@router.get("/load-vs-efficiency")
def get_load_vs_efficiency(
    start_date: date,
    end_date: date,
    group_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.load_vs_efficiency(db, start_date, end_date, group_id)


@router.get("/quality-vs-penalties")
def get_quality_vs_penalties(
    start_date: date,
    end_date: date,
    group_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.quality_vs_penalties(db, start_date, end_date, group_id)


@router.get("/overview")
def get_overview(
    start_date: date,
    end_date: date,
    group_id: int | None = Query(None),
    operator_query: str | None = Query(None),
    participation_status: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.overview(db, start_date, end_date, group_id, operator_query, participation_status)


@router.get("/operators-combined")
def get_operators_combined(
    start_date: date,
    end_date: date,
    group_id: int | None = Query(None),
    operator_query: str | None = Query(None),
    participation_status: str | None = Query(None),
    only_with_data: bool = Query(False),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.operators_combined(
        db, start_date, end_date, group_id, operator_query, participation_status, only_with_data
    )


@router.get("/matrix-combined")
def get_matrix_combined(
    start_date: date,
    end_date: date,
    group_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.matrix_combined(db, start_date, end_date, group_id)


@router.get("/quality-combined")
def get_quality_combined(
    start_date: date,
    end_date: date,
    group_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.quality_combined(db, start_date, end_date, group_id)


@router.get("/groups-list")
def get_groups_list(
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    return service.groups_list(db)
