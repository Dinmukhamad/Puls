"""HTTP-слой аналитики (ТЗ §15.1).

Только приём query-параметров, проверка доступа и вызов service.
Бизнес-логика — в app/modules/analytics/service.py, сборка дашборда —
dashboard.py, расчёты — calculators.py, SQL — repository.py, кеш — cache.py.

Экран руководителя целиком собирается одним вызовом /dashboard. Остальные
эндпоинты — справочные (периоды, группы, глоссарий), детализация по
операторам и выгрузка в Excel.
"""
from __future__ import annotations

from datetime import date
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.security import get_current_user, supervisor_scope_group_id
from app.database.db import get_db
from app.models.entities import User
from app.modules.analytics import dashboard as dashboard_builder
from app.modules.analytics import service
from app.modules.analytics.metrics_meta import ANALYTICS_TARGETS_VERSION, all_definitions

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _require_analytics_access(current_user: User = Depends(get_current_user)) -> User:
    """Руководитель, администратор — полный доступ. Супервайзер — доступ есть,
    но scoping по группе пока не сужается (в модели User нет supervisor_group_id).
    Оператор — запрещено."""
    if current_user.role not in ("supervisor", "manager", "admin"):
        raise HTTPException(status_code=403, detail="Доступ к аналитике запрещён для вашей роли")
    return current_user


def _analytics_group_scope(
    group_id: int | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_analytics_access),
) -> int | None:
    supervisor_group_id = supervisor_scope_group_id(db, current_user)
    if supervisor_group_id is None:
        return group_id
    if group_id is not None and group_id != supervisor_group_id:
        raise HTTPException(status_code=403, detail="Доступ к чужой группе запрещён")
    return supervisor_group_id


# ── Экран руководителя ───────────────────────────────────────────────────

@router.get("/dashboard")
def get_dashboard(
    start_date: date,
    end_date: date,
    group_id: int | None = Depends(_analytics_group_scope),
    weekdays: str | None = Query(
        None,
        description="Дни недели через запятую, 0=Пн … 6=Вс. Пусто — все дни.",
    ),
    metric: str = Query("quality", description="Метрика для графика динамики."),
    db: Session = Depends(get_db),
) -> dict:
    """Всё, что нужно экрану аналитики, одним ответом."""
    return dashboard_builder.build(db, start_date, end_date, group_id, weekdays, metric)


@router.get("/management-dashboard")
def get_management_dashboard(
    start_date: date,
    end_date: date,
    group_id: int | None = Depends(_analytics_group_scope),
    operator_query: str | None = Query(None),
    participation_status: str | None = Query(None),
    db: Session = Depends(get_db),
) -> dict:
    """Управленческая сводка: здоровье команды, метрики, группы, приоритеты.

    Функция расчёта (service.management_dashboard) существует и покрыта
    тестами с самого начала, но маршрут к ней потерялся при разделении
    аналитики на экраны. Фронтенд всё это время звал несуществующий адрес и
    показывал «Не удалось загрузить сводку» — раздел не мог открыться в
    принципе. Область видимости и роли — те же, что у остальной аналитики.
    """
    return service.management_dashboard(
        db, start_date, end_date, group_id, operator_query, participation_status
    )


@router.get("/glossary")
def get_glossary(
    _: User = Depends(_require_analytics_access),
) -> dict:
    """Справочник: что означает каждый показатель и какая у него цель."""
    return {"metrics": all_definitions(), "targets_version": ANALYTICS_TARGETS_VERSION}


# ── Справочники и детализация ────────────────────────────────────────────

@router.get("/available-periods")
def get_available_periods(
    db: Session = Depends(get_db),
    group_id: int | None = Depends(_analytics_group_scope),
) -> dict:
    return service.available_periods(db, group_id)


@router.get("/groups-list")
def get_groups_list(
    db: Session = Depends(get_db),
    group_id: int | None = Depends(_analytics_group_scope),
) -> dict:
    return service.groups_list(db, group_id)


@router.get("/summary")
def get_summary(
    start_date: date,
    end_date: date,
    group_id: int | None = Depends(_analytics_group_scope),
    operator_query: str | None = Query(None),
    participation_status: str | None = Query(None),
    db: Session = Depends(get_db),
) -> dict:
    return service.summary(db, start_date, end_date, group_id, operator_query, participation_status)


@router.get("/daily-dynamics")
def get_daily_dynamics(
    start_date: date,
    end_date: date,
    metric: str = Query("calls", pattern="^(calls|kvz|operators|quality|efficiency|penalty)$"),
    group_id: int | None = Depends(_analytics_group_scope),
    operator_id: int | None = Query(None),
    participation_status: str | None = Query(None),
    db: Session = Depends(get_db),
) -> dict:
    return service.daily_dynamics(
        db, start_date, end_date, metric, group_id, operator_id, participation_status
    )


@router.get("/operators")
def get_operators_table(
    start_date: date,
    end_date: date,
    group_id: int | None = Depends(_analytics_group_scope),
    operator_query: str | None = Query(None),
    participation_status: str | None = Query(None),
    only_with_data: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
    sort_by: str = Query("final_points"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
) -> dict:
    return service.operators_table(
        db, start_date, end_date, group_id, operator_query, participation_status, only_with_data,
        page, page_size, sort_by, sort_order,
    )


@router.get("/export.xlsx")
def export_analytics_xlsx(
    start_date: date,
    end_date: date,
    group_id: int | None = Depends(_analytics_group_scope),
    operator_query: str | None = Query(None),
    participation_status: str | None = Query(None),
    only_with_data: bool = Query(False),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    content = service.export_workbook(
        db, start_date, end_date, group_id, operator_query, participation_status, only_with_data
    )
    filename = f"puls-analytics-{start_date}-{end_date}.xlsx"
    return StreamingResponse(
        BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
