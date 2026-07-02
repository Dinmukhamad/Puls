from __future__ import annotations

from datetime import date, timedelta
import json as _json
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import Group, Operator, OperatorDailyMetric, PeriodReport, User
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
from app.services.work_norms import calculate_norm_for_period
from app.services.period_reports import OperatorPeriodMetrics, aggregate_daily_rows, normalize_name

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


def _enrich_metrics_with_norm(
    db: Session,
    m: OperatorPeriodMetrics,
    operator,
    start_date: date,
    end_date: date,
) -> None:
    """Заполняет поля нормы часов в метриках оператора (in-place)."""
    raw_rate = getattr(operator, "rate", None)
    rate = float(raw_rate) if raw_rate is not None else None
    norm_result = calculate_norm_for_period(db, rate, start_date, end_date, m.total_hours)
    m.rate = norm_result.rate
    m.individual_norm_hours = norm_result.individual_norm_hours
    m.norm_completion_percent = norm_result.norm_completion_percent
    m.hours_points = norm_result.hours_points
    m.overtime_hours = norm_result.overtime_hours
    m.overtime_percent = norm_result.overtime_percent
    if norm_result.warnings:
        for w in norm_result.warnings:
            if w not in m.warnings:
                m.warnings.append(w)
    # Пересчитываем итоговые баллы с правильными hours_points
    if norm_result.individual_norm_hours > 0:
        m.final_points = round(
            m.quality_avg + m.kvz + norm_result.hours_points
            + m.efficiency_percent - m.penalty_points,
            2,
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


def _available_data_date_range(db: Session) -> Optional[tuple]:
    """Минимальная и максимальная дата, для которых есть посуточные данные."""
    row = db.execute(
        select(func.min(OperatorDailyMetric.metric_date), func.max(OperatorDailyMetric.metric_date))
    ).first()
    if not row or row[0] is None:
        return None
    return row[0], row[1]


def _aggregate_from_daily_metrics(
    db: Session,
    start_date: date,
    end_date: date,
) -> tuple[Dict[int, OperatorPeriodMetrics], List[str]]:
    """
    Агрегирует operator_daily_metrics за произвольный диапазон дат — БЕЗ
    обращения к Excel. Возвращает {operator_id: OperatorPeriodMetrics} и
    список предупреждений о частично/полностью отсутствующих датах.
    """
    daily_rows = list(
        db.scalars(
            select(OperatorDailyMetric).where(
                OperatorDailyMetric.metric_date >= start_date,
                OperatorDailyMetric.metric_date <= end_date,
            )
        )
    )

    by_operator: Dict[int, List[dict]] = {}
    covered_dates: set = set()
    for r in daily_rows:
        covered_dates.add(r.metric_date)
        by_operator.setdefault(r.operator_id, []).append({
            "calls_count": r.calls_count,
            "quality_sum": r.quality_sum,
            "quality_count": r.quality_count,
            "worked_hours": r.worked_hours,
            "tech_issue_hours": r.tech_issue_hours,
            "training_hours": r.training_hours,
            "offline_activity_hours": r.offline_activity_hours,
            "efficiency": r.efficiency,
            "penalty_sum": r.penalty_sum,
        })

    warnings: List[str] = []
    total_days = (end_date - start_date).days + 1
    if not daily_rows:
        available = _available_data_date_range(db)
        if available:
            warnings.append(
                f"Нет данных за выбранный период. Данные доступны с {available[0].strftime('%d.%m.%Y')} "
                f"по {available[1].strftime('%d.%m.%Y')}."
            )
        else:
            warnings.append("Нет загруженных данных. Загрузите Monthly Report и Report в разделе «Расчёт периода».")
    elif len(covered_dates) < total_days:
        missing_count = total_days - len(covered_dates)
        all_dates = {start_date + timedelta(days=i) for i in range(total_days)}
        missing_dates = sorted(all_dates - covered_dates)
        first_gap, last_gap = missing_dates[0], missing_dates[-1]
        warnings.append(
            f"Данные доступны частично: с {start_date.strftime('%d.%m.%Y')} по {end_date.strftime('%d.%m.%Y')}. "
            f"Нет данных за {missing_count} из {total_days} дн. "
            f"(например {first_gap.strftime('%d.%m.%Y')}"
            + (f" — {last_gap.strftime('%d.%m.%Y')}" if last_gap != first_gap else "")
            + ")."
        )

    metrics_by_operator: Dict[int, OperatorPeriodMetrics] = {
        op_id: aggregate_daily_rows(rows) for op_id, rows in by_operator.items()
    }
    return metrics_by_operator, warnings


def get_data_availability_warning(db: Session, start_date: date, end_date: date) -> Optional[str]:
    """
    Лёгкая проверка покрытия дат (без полной агрегации метрик) — используется
    эндпоинтом /summary, чтобы вернуть frontend понятное сообщение вида
    "Данные доступны частично: с ... по ... . Нет данных за ..." (п.8 ТЗ).
    """
    covered_dates = set(
        db.scalars(
            select(OperatorDailyMetric.metric_date)
            .where(OperatorDailyMetric.metric_date >= start_date, OperatorDailyMetric.metric_date <= end_date)
            .distinct()
        )
    )
    total_days = (end_date - start_date).days + 1

    if not covered_dates:
        available = _available_data_date_range(db)
        if available:
            return (
                f"Нет данных за выбранный период. Данные доступны с {available[0].strftime('%d.%m.%Y')} "
                f"по {available[1].strftime('%d.%m.%Y')}."
            )
        return "Нет загруженных данных. Загрузите Monthly Report и Report в разделе «Расчёт периода»."

    if len(covered_dates) < total_days:
        missing_count = total_days - len(covered_dates)
        all_dates = {start_date + timedelta(days=i) for i in range(total_days)}
        missing_dates = sorted(all_dates - covered_dates)
        first_gap, last_gap = missing_dates[0], missing_dates[-1]
        return (
            f"Данные доступны частично: с {start_date.strftime('%d.%m.%Y')} по {end_date.strftime('%d.%m.%Y')}. "
            f"Нет данных за {missing_count} из {total_days} дн. "
            f"(например {first_gap.strftime('%d.%m.%Y')}"
            + (f" — {last_gap.strftime('%d.%m.%Y')}" if last_gap != first_gap else "")
            + ")."
        )
    return None


def _save_period_report_from_metrics(
    db: Session,
    operator_id: int,
    start_date: date,
    end_date: date,
    m: OperatorPeriodMetrics,
) -> None:
    """
    Сохраняет агрегат как PeriodReport (read-cache для следующего запроса того
    же диапазона) через атомарный upsert на уровне БД (INSERT ... ON CONFLICT
    DO UPDATE). Это устойчиво к гонке нескольких параллельных HTTP-запросов
    (вкладка «Обзор» дёргает /summary, /daily-dynamics, /groups-comparison,
    /risk-pyramid одновременно через Promise.all — без атомарного upsert два
    параллельных запроса одновременно пытаются INSERT одну и ту же строку
    и ловят нарушение UniqueConstraint -> 500).
    """
    values = dict(
        operator_id=operator_id,
        period_start=start_date,
        period_end=end_date,
        quality_avg=m.quality_avg,
        quality_calls_count=m.quality_calls_count,
        total_hours=m.total_hours,
        base_hours=m.base_hours,
        tech_issue_hours=m.tech_issue_hours,
        training_hours=m.training_hours,
        offline_activity_hours=m.offline_activity_hours,
        calls_total=m.calls_total,
        kvz=m.kvz,
        call_time_hours=m.call_time_hours,
        efficiency_percent=m.efficiency_percent,
        penalty_sum=m.penalty_sum,
        penalty_minutes=m.penalty_minutes,
        penalty_points=m.penalty_points,
        final_points=m.final_points,
    )

    bind = db.get_bind()
    if bind.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        stmt = pg_insert(PeriodReport).values(**values)
        update_cols = {k: v for k, v in values.items() if k not in ("operator_id", "period_start", "period_end")}
        stmt = stmt.on_conflict_do_update(
            index_elements=["operator_id", "period_start", "period_end"],
            set_=update_cols,
        )
        db.execute(stmt)
    else:
        # SQLite (тесты/локальная разработка) — нет нативного ON CONFLICT с
        # тем же синтаксисом, используем select-then-write (без гонки —
        # SQLite в этом проекте однопоточный для разработки).
        existing = db.scalar(
            select(PeriodReport).where(
                PeriodReport.operator_id == operator_id,
                PeriodReport.period_start == start_date,
                PeriodReport.period_end == end_date,
            )
        )
        pr = existing or PeriodReport(operator_id=operator_id, period_start=start_date, period_end=end_date)
        for k, v in values.items():
            setattr(pr, k, v)
        if not existing:
            db.add(pr)


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
    Строит строки аналитики для ПРОИЗВОЛЬНОГО диапазона дат:

      1. Если для каждого оператора уже есть точный PeriodReport на этот
         диапазон — используем как кеш (мгновенно, без агрегации).
      2. Иначе агрегируем operator_daily_metrics за диапазон (SUM по дням,
         БЕЗ обращения к Excel) и сохраняем результат как новый PeriodReport
         для следующего раза.
      3. Если данных за диапазон вообще нет — кидаем 404 с понятным
         сообщением о том, какие даты доступны.
    """
    existing_reports = {
        r.operator_id: r
        for r in db.scalars(
            select(PeriodReport).where(
                PeriodReport.period_start == start_date,
                PeriodReport.period_end == end_date,
            )
        )
    }

    daily_metrics, warnings = _aggregate_from_daily_metrics(db, start_date, end_date)

    if not daily_metrics and not existing_reports:
        raise HTTPException(status_code=404, detail=" ".join(warnings) or PERIOD_NOT_CALCULATED_MESSAGE)

    all_operator_ids = set(existing_reports.keys()) | set(daily_metrics.keys())
    operators = {
        o.id: o for o in db.scalars(select(Operator).where(Operator.id.in_(all_operator_ids)))
    }

    rows: List[OperatorAnalyticsRow] = []
    for operator_id in all_operator_ids:
        operator = operators.get(operator_id)
        if not operator:
            continue

        # PeriodReport как кеш приоритетнее свежей агрегации, КРОМЕ случая,
        # когда posted daily-metrics реально есть (значит файлы могли быть
        # перезагружены после сохранения старого PeriodReport — на upload
        # старые PeriodReport уже инвалидируются, так что это редкий путь,
        # но на всякий случай предпочитаем daily-агрегат как источник правды).
        if operator_id in daily_metrics:
            m = daily_metrics[operator_id]
            m.full_name = operator.full_name
            m.name_key = normalize_name(operator.full_name)
            _enrich_metrics_with_norm(db, m, operator, start_date, end_date)
            _save_period_report_from_metrics(db, operator_id, start_date, end_date, m)
        else:
            pr = existing_reports[operator_id]
            name_key = normalize_name(operator.full_name)
            m = _metrics_from_period_report(pr, operator.full_name, name_key)
            _enrich_metrics_with_norm(db, m, operator, start_date, end_date)

        rows.append(OperatorAnalyticsRow(
            full_name=operator.full_name,
            name_key=normalize_name(operator.full_name),
            operator_id=operator.id,
            group_id=operator.group_id,
            group_name=operator.group_name,
            participation_status=operator.participation_status,
            metrics=m,
            risk_status=classify_risk(m),
        ))

    try:
        db.commit()  # фиксируем новые/обновлённые PeriodReport-кеши
    except Exception:
        # Параллельный запрос (например соседняя вкладка через Promise.all)
        # уже закоммитил тот же upsert и удерживал блокировку строки —
        # откатываем нашу транзакцию и читаем то, что записал он; сами
        # вычисленные rows (в памяти, не зависят от commit) всё равно валидны
        # и возвращаются пользователю без потери ответа.
        db.rollback()

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
    availability_warning = get_data_availability_warning(db, start_date, end_date)
    result = {
        "period": {"start": str(start_date), "end": str(end_date)},
        "kpi": kpi,
        "data_availability_warning": availability_warning,
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
            "rate": m.rate,
            "individual_norm_hours": m.individual_norm_hours if m.individual_norm_hours > 0 else None,
            "norm_completion_percent": round(m.norm_completion_percent, 1) if m.individual_norm_hours > 0 else None,
            "hours_points": m.hours_points if m.individual_norm_hours > 0 else None,
            "overtime_hours": m.overtime_hours if m.overtime_hours > 0 else None,
            "overtime_percent": round(m.overtime_percent, 1) if m.overtime_percent > 0 else None,
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



@router.get("/overview")
def get_overview(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    operator_query: Optional[str] = Query(None),
    participation_status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    """
    Комбинированный endpoint для вкладки Обзор — возвращает summary +
    groups-comparison + risk-pyramid одним запросом к БД вместо 3-4 отдельных.
    daily-dynamics исключена (требует Excel-парсинга, грузится отдельно).
    """
    key = cache_key("overview", start_date=start_date, end_date=end_date,
                    group_id=group_id, operator_query=operator_query,
                    participation_status=participation_status)
    cached = cache_get(key)
    if cached is not None:
        return cached

    rows = _get_rows(db, start_date, end_date, group_id, operator_query, participation_status)
    kpi = compute_kpi_summary(rows)
    groups_cmp = compute_groups_comparison(rows)
    risk_pyramid = compute_risk_pyramid(rows)
    availability_warning = get_data_availability_warning(db, start_date, end_date)

    result = {
        "period": {"start": str(start_date), "end": str(end_date)},
        "kpi": kpi,
        "data_availability_warning": availability_warning,
        "groups_comparison": groups_cmp,
        "risk_pyramid": risk_pyramid,
        "warnings": [],
    }
    cache_set(key, result, ttl_seconds=600)  # 10 минут — дольше стандартного
    return result


@router.get("/operators-combined")
def get_operators_combined(
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
    Комбинированный endpoint для вкладки Операторы — таблица + зона внимания
    одним запросом к БД вместо двух.
    """
    key = cache_key("operators-combined", start_date=start_date, end_date=end_date,
                    group_id=group_id, operator_query=operator_query,
                    participation_status=participation_status, only_with_data=only_with_data)
    cached = cache_get(key)
    if cached is not None:
        return cached

    rows = _get_rows(db, start_date, end_date, group_id, operator_query, participation_status, only_with_data)

    def quality_band(q):
        if q is None: return None
        if q >= 90: return "green"
        if q >= 80: return "yellow"
        if q >= 70: return "orange"
        return "red"

    ops_out = []
    for r in rows:
        m = r.metrics
        ops_out.append({
            "full_name": r.full_name,
            "group_name": r.group_name,
            "operator_id": r.operator_id,
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
            "rate": m.rate,
            "individual_norm_hours": m.individual_norm_hours if m.individual_norm_hours > 0 else None,
            "norm_completion_percent": round(m.norm_completion_percent, 1) if m.individual_norm_hours > 0 else None,
            "hours_points": m.hours_points if m.individual_norm_hours > 0 else None,
            "overtime_hours": m.overtime_hours if m.overtime_hours > 0 else None,
            "overtime_percent": round(m.overtime_percent, 1) if m.overtime_percent > 0 else None,
        })

    top_attn = compute_top_and_attention(rows)

    result = {"items": ops_out, "top_and_attention": top_attn}
    cache_set(key, result, ttl_seconds=300)
    return result


@router.get("/matrix-combined")
def get_matrix_combined(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    """quality-kvz-matrix + quality-vs-penalties + load-vs-efficiency одним запросом."""
    key = cache_key("matrix-combined", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached

    rows = _get_rows(db, start_date, end_date, group_id)
    result = {
        "quality_kvz": compute_quality_kvz_matrix(rows),
        "quality_penalties": compute_quality_vs_penalties(rows),
        "load_efficiency": compute_load_vs_efficiency(rows),
        "thresholds": {"quality": 85, "kvz": 10},
    }
    cache_set(key, result, ttl_seconds=300)
    return result


@router.get("/quality-combined")
def get_quality_combined(
    start_date: date,
    end_date: date,
    group_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    """quality-coverage + penalties одним запросом."""
    key = cache_key("quality-combined", start_date=start_date, end_date=end_date, group_id=group_id)
    cached = cache_get(key)
    if cached is not None:
        return cached

    rows = _get_rows(db, start_date, end_date, group_id)
    result = {
        "coverage": compute_quality_coverage(rows),
        "penalties": compute_penalties_analytics(rows),
    }
    cache_set(key, result, ttl_seconds=300)
    return result

@router.get("/groups-list")
def get_groups_list(
    db: Session = Depends(get_db),
    _: User = Depends(_require_analytics_access),
) -> dict:
    groups = list(db.scalars(select(Group).where(Group.status == "active")))
    return {"items": [{"id": g.id, "name": g.name} for g in groups]}
