from __future__ import annotations

import json as _json
from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import require_roles
from app.database.db import get_db
from app.models.entities import (
    AuditLog,
    CoinTransaction,
    Operator,
    OperatorDailyMetric,
    PeriodReport,
    UploadedReportFile,
    User,
)
from app.services.analytics_cache import cache_clear_all
from app.services.period_reports import (
    build_daily_metric_rows,
    calculate_period_report,
    normalize_name,
)
from app.services.rating import rating_cache_invalidate
from app.services.work_norms import calculate_norm_for_period

router = APIRouter(prefix="/reports", tags=["period-reports"])
MAX_REPORT_FILE_BYTES = 15 * 1024 * 1024


def _get_uploaded_bytes(db: Session, file_kind: str) -> bytes | None:
    """Читает загруженный xlsx-файл из БД (переживает редеплой/перезапуск)."""
    row = db.scalar(select(UploadedReportFile).where(UploadedReportFile.file_kind == file_kind))
    return row.content if row else None


def _save_uploaded_bytes(db: Session, file_kind: str, filename: str, content: bytes, user_id: int) -> None:
    row = db.scalar(select(UploadedReportFile).where(UploadedReportFile.file_kind == file_kind))
    if row:
        row.filename = filename
        row.content = content
        row.uploaded_by_user_id = user_id
    else:
        db.add(UploadedReportFile(
            file_kind=file_kind, filename=filename, content=content, uploaded_by_user_id=user_id,
        ))
    db.commit()


class OperatorMetricsOut(BaseModel):
    full_name: str
    operator_id: int | None = None
    group_name: str | None = None
    quality_avg: float
    quality_calls_count: int
    total_hours: float
    base_hours: float
    tech_issue_hours: float
    training_hours: float
    offline_activity_hours: float
    calls_total: float
    kvz: float
    call_time_hours: float
    efficiency_percent: float
    penalty_sum: float
    penalty_minutes: float
    penalty_points: float
    final_points: float
    warnings: list[str] = []
    # Норма часов
    rate: float | None = None
    individual_norm_hours: float = 0.0
    norm_completion_percent: float = 0.0
    hours_points: float = 0.0
    overtime_hours: float = 0.0
    overtime_percent: float = 0.0
    norm_warnings: list[str] = []


class PeriodWarningsOut(BaseModel):
    site_only: list[str] = []
    file_only: list[str] = []
    norm_warnings: list[str] = []
    no_quality: list[str] = []
    no_base_hours: list[str] = []
    ignored_service_rows: list[str] = []


class PeriodSummaryOut(BaseModel):
    period: dict
    operators: list[OperatorMetricsOut]
    warnings: PeriodWarningsOut
    summary: dict


@router.post("/period-report/upload")
async def upload_period_files(
    monthly_report_file: UploadFile = File(...),
    report_file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("supervisor", "manager", "admin")),
) -> dict:
    """Загрузка двух Excel-файлов. Сохраняются в БД — переживают редеплой."""
    for f, label in ((monthly_report_file, "Monthly Report"), (report_file, "Report")):
        if not f.filename.lower().endswith(".xlsx"):
            raise HTTPException(status_code=400, detail=f"Файл «{label}» должен быть в формате .xlsx")

    monthly_bytes = await monthly_report_file.read()
    report_bytes = await report_file.read()

    if not monthly_bytes:
        raise HTTPException(status_code=400, detail="Monthly Report пустой или повреждён")
    if not report_bytes:
        raise HTTPException(status_code=400, detail="Report пустой или повреждён")
    if len(monthly_bytes) > MAX_REPORT_FILE_BYTES or len(report_bytes) > MAX_REPORT_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Размер каждого Excel-файла не должен превышать 15 МБ")

    _save_uploaded_bytes(db, "monthly", monthly_report_file.filename, monthly_bytes, current_user.id)
    _save_uploaded_bytes(db, "report", report_file.filename, report_bytes, current_user.id)

    # Посуточный разбор — ОДИН раз при загрузке, дальше аналитика строится
    # из operator_daily_metrics без повторного парсинга Excel (см. ТЗ).
    daily_stats = _rebuild_daily_metrics(db, monthly_bytes, report_bytes, current_user.id)

    cache_clear_all()  # новые файлы — старые закешированные расчёты аналитики и сохранённые PeriodReport больше не актуальны

    return {
        "ok": True,
        "message": "Файлы загружены и сохранены. Выберите период и нажмите «Рассчитать».",
        "daily_metrics": daily_stats,
    }


def _rebuild_daily_metrics(db: Session, monthly_bytes: bytes, report_bytes: bytes, actor_user_id: int) -> dict:
    """
    Парсит оба файла ПОСУТОЧНО (build_daily_metric_rows) и записывает
    результат в operator_daily_metrics ОДНИМ bulk upsert-запросом (PostgreSQL
    INSERT ... ON CONFLICT DO UPDATE), а не построчным select+insert/update в
    цикле — на ~800 строк построчный вариант means ~800 отдельных round-trip
    к БД по сети (Railway), что и вызывало многосекундное/похожее на
    зависание ожидание ответа на frontend. Bulk-запрос делает то же самое
    за одно обращение к БД.

    Сопоставление со страницами сайта — по нормализованному ФИО, как и
    везде в проекте. Операторы, не найденные на сайте, пропускаются —
    они и так не должны попадать в аналитику (см. matched-only правило).

    Также удаляет все ранее сохранённые PeriodReport — после перезагрузки
    файлов старые агрегаты по точным периодам больше не гарантированно
    соответствуют новым исходным данным (п.9 ТЗ: "обновлять и инвалидировать
    связанные PeriodReport").
    """
    try:
        rows = build_daily_metric_rows(monthly_bytes, report_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    site_ops = list(db.scalars(select(Operator)))
    name_to_op = {normalize_name(o.full_name): o for o in site_ops if o.full_name}

    monthly_file_row = db.scalar(select(UploadedReportFile).where(UploadedReportFile.file_kind == "monthly"))
    report_file_row = db.scalar(select(UploadedReportFile).where(UploadedReportFile.file_kind == "report"))
    monthly_file_id = monthly_file_row.id if monthly_file_row else None
    report_file_id = report_file_row.id if report_file_row else None

    matched = 0
    unmatched_names = set()
    values_to_upsert: list[dict] = []

    for row in rows:
        operator = name_to_op.get(row.name_key)
        if not operator:
            unmatched_names.add(row.display_name)
            continue

        quality_sum = sum(row.quality_scores)
        quality_count = len(row.quality_scores)
        base_hours = max(0.0, row.worked_hours - row.tech_issue_hours - row.training_hours - row.offline_activity_hours)
        kvz = round(row.calls_count / base_hours, 2) if base_hours > 0 else 0.0
        penalty_minutes = round(row.penalty_sum / 50.0, 2) if row.penalty_sum else 0.0
        penalty_points = round(penalty_minutes * 5.0, 2)

        values_to_upsert.append(dict(
            operator_id=operator.id,
            operator_name=operator.full_name,
            group_id=operator.group_id,
            metric_date=row.metric_date,
            calls_count=row.calls_count,
            quality_scores_json=_json.dumps(row.quality_scores),
            quality_sum=quality_sum,
            quality_count=quality_count,
            quality_avg=round(quality_sum / quality_count, 2) if quality_count else 0.0,
            kvz=kvz,
            efficiency=row.call_time_hours,  # сырые часы в звонке за день — % пересчитывается при агрегации диапазона
            worked_hours=row.worked_hours,
            tech_issue_hours=row.tech_issue_hours,
            training_hours=row.training_hours,
            offline_activity_hours=row.offline_activity_hours,
            base_hours=base_hours,
            penalty_sum=row.penalty_sum,
            penalty_minutes=penalty_minutes,
            penalty_points=penalty_points,
            source_monthly_report_id=monthly_file_id,
            source_report_id=report_file_id,
        ))
        matched += 1

    if values_to_upsert:
        bind = db.get_bind()
        if bind.dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import insert as pg_insert
            # PostgreSQL ограничивает число параметров в одном запросе —
            # с запасом бьём на пачки по 500 строк (у нас 20 колонок на
            # строку, 500*20=10000 параметров, безопасно ниже лимита 65535).
            CHUNK = 500
            for i in range(0, len(values_to_upsert), CHUNK):
                chunk = values_to_upsert[i:i + CHUNK]
                stmt = pg_insert(OperatorDailyMetric).values(chunk)
                update_cols = {
                    col: getattr(stmt.excluded, col)
                    for col in chunk[0].keys()
                    if col not in ("operator_id", "metric_date")
                }
                stmt = stmt.on_conflict_do_update(
                    index_elements=["operator_id", "metric_date"],
                    set_=update_cols,
                )
                db.execute(stmt)
        else:
            # SQLite (локальная разработка) — построчный upsert, без bulk-синтаксиса
            for values in values_to_upsert:
                existing = db.scalar(
                    select(OperatorDailyMetric).where(
                        OperatorDailyMetric.operator_id == values["operator_id"],
                        OperatorDailyMetric.metric_date == values["metric_date"],
                    )
                )
                target = existing or OperatorDailyMetric(
                    operator_id=values["operator_id"], metric_date=values["metric_date"],
                )
                for k, v in values.items():
                    setattr(target, k, v)
                if not existing:
                    db.add(target)

    # Старые сохранённые расчёты периодов больше не гарантированно актуальны —
    # инвалидируем (п.9 ТЗ). Пользователь при необходимости пересчитает заново.
    deleted_reports = db.query(PeriodReport).delete()

    db.commit()

    return {
        "matched_daily_rows": matched,
        "unmatched_operators_count": len(unmatched_names),
        "unmatched_operators_sample": sorted(unmatched_names)[:20],
        "invalidated_period_reports": deleted_reports,
    }


@router.get("/period-report/status")
def get_upload_status(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("supervisor", "manager", "admin")),
) -> dict:
    """Позволяет фронтенду узнать, загружены ли файлы (например, после редеплоя)."""
    monthly = db.scalar(select(UploadedReportFile).where(UploadedReportFile.file_kind == "monthly"))
    report = db.scalar(select(UploadedReportFile).where(UploadedReportFile.file_kind == "report"))
    return {
        "monthly": {"filename": monthly.filename, "uploaded_at": str(monthly.uploaded_at)} if monthly else None,
        "report": {"filename": report.filename, "uploaded_at": str(report.uploaded_at)} if report else None,
    }


def _site_operator_names(db: Session) -> list[str]:
    return [o.full_name for o in db.scalars(select(Operator)) if o.full_name]


@router.get("/operators-period-summary", response_model=PeriodSummaryOut)
def get_period_summary(
    start_date: date,
    end_date: date,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("supervisor", "manager", "admin")),
) -> PeriodSummaryOut:
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="Дата начала не может быть позже даты окончания")

    monthly_bytes = _get_uploaded_bytes(db, "monthly")
    report_bytes = _get_uploaded_bytes(db, "report")
    if not monthly_bytes or not report_bytes:
        raise HTTPException(
            status_code=400,
            detail="Сначала загрузите файлы Monthly Report и Report",
        )

    site_names = _site_operator_names(db)

    try:
        result = calculate_period_report(
            monthly_bytes, report_bytes,
            start_date, end_date, site_operator_names=site_names,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    db_ops = list(db.scalars(select(Operator)))
    name_to_op = {normalize_name(o.full_name): o for o in db_ops}

    operators_out: list[OperatorMetricsOut] = []
    norm_warnings_global: list[str] = []

    for m in result.operators:
        db_op = name_to_op.get(m.name_key)
        # Конвертируем Decimal → float (Numeric из БД возвращается как Decimal)
        raw_rate = db_op.rate if db_op else None
        rate = float(raw_rate) if raw_rate is not None else None

        # Рассчитываем норму часов для этого оператора
        norm_result = calculate_norm_for_period(
            db, rate, start_date, end_date, m.total_hours
        )

        # Итоговые баллы: если норма рассчитана — используем hours_points,
        # иначе — total_hours (обратная совместимость)
        if norm_result.individual_norm_hours > 0:
            final_points = round(
                m.quality_avg + m.kvz + norm_result.hours_points
                + m.efficiency_percent - m.penalty_points,
                2,
            )
        else:
            final_points = m.final_points

        if norm_result.warnings:
            for w in norm_result.warnings:
                entry = f"{db_op.full_name if db_op else m.full_name}: {w}"
                if entry not in norm_warnings_global:
                    norm_warnings_global.append(entry)

        operators_out.append(OperatorMetricsOut(
            full_name=db_op.full_name if db_op else m.full_name,
            operator_id=db_op.id if db_op else None,
            group_name=db_op.group_name if db_op else None,
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
            final_points=final_points,
            warnings=m.warnings,
            rate=norm_result.rate,
            individual_norm_hours=norm_result.individual_norm_hours,
            norm_completion_percent=norm_result.norm_completion_percent,
            hours_points=norm_result.hours_points,
            overtime_hours=norm_result.overtime_hours,
            overtime_percent=norm_result.overtime_percent,
            norm_warnings=norm_result.warnings,
        ))

    return PeriodSummaryOut(
        period={"start": str(start_date), "end": str(end_date)},
        operators=operators_out,
        warnings=PeriodWarningsOut(
            site_only=result.warnings_site_only,
            file_only=result.warnings_file_only,
            no_quality=result.warnings_no_quality,
            no_base_hours=result.warnings_no_base_hours,
            ignored_service_rows=[],
            norm_warnings=norm_warnings_global,
        ),
        summary=result.summary,
    )


class SavePeriodReportRequest(BaseModel):
    start_date: date
    end_date: date
    award_coins: bool = False
    coins_per_points: float = 5.0


def _apply_metrics(pr: PeriodReport, m, user_id: int) -> None:
    pr.quality_avg = m.quality_avg
    pr.quality_calls_count = m.quality_calls_count
    pr.total_hours = m.total_hours
    pr.base_hours = m.base_hours
    pr.tech_issue_hours = m.tech_issue_hours
    pr.training_hours = m.training_hours
    pr.offline_activity_hours = m.offline_activity_hours
    pr.calls_total = m.calls_total
    pr.kvz = m.kvz
    pr.call_time_hours = m.call_time_hours
    pr.efficiency_percent = m.efficiency_percent
    pr.penalty_sum = m.penalty_sum
    pr.penalty_minutes = m.penalty_minutes
    pr.penalty_points = m.penalty_points
    pr.final_points = m.final_points
    pr.created_by_user_id = user_id


@router.post("/period-report/save")
def save_period_report(
    payload: SavePeriodReportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("supervisor", "manager", "admin")),
) -> dict:
    """Пересчитывает период (только matched-операторы) и сохраняет результаты в БД."""
    if payload.start_date > payload.end_date:
        raise HTTPException(status_code=400, detail="Дата начала не может быть позже даты окончания")
    if payload.award_coins and payload.coins_per_points <= 0:
        raise HTTPException(status_code=400, detail="Коэффициент начисления коинов должен быть больше нуля")

    monthly_bytes = _get_uploaded_bytes(db, "monthly")
    report_bytes = _get_uploaded_bytes(db, "report")
    if not monthly_bytes or not report_bytes:
        raise HTTPException(status_code=400, detail="Сначала загрузите файлы")

    site_names = _site_operator_names(db)

    try:
        result = calculate_period_report(
            monthly_bytes, report_bytes,
            payload.start_date, payload.end_date, site_operator_names=site_names,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    db_ops = list(db.scalars(select(Operator)))
    name_to_op = {normalize_name(o.full_name): o for o in db_ops}

    saved = 0
    created = 0
    updated = 0
    coins_delta_total = 0

    for m in result.operators:
        db_op = name_to_op.get(m.name_key)
        if not db_op:
            continue

        existing_reports = list(db.scalars(
            select(PeriodReport)
            .where(
                PeriodReport.operator_id == db_op.id,
                PeriodReport.period_start == payload.start_date,
                PeriodReport.period_end == payload.end_date,
            )
            .order_by(PeriodReport.created_at.desc(), PeriodReport.id.desc())
        ))
        pr = existing_reports[0] if existing_reports else PeriodReport(
            operator_id=db_op.id,
            period_start=payload.start_date,
            period_end=payload.end_date,
        )
        for stale_report in existing_reports[1:]:
            db.delete(stale_report)

        old_coins = pr.coins_awarded or 0
        _apply_metrics(pr, m, current_user.id)

        if payload.award_coins:
            desired_coins = int(m.final_points / payload.coins_per_points) if m.final_points > 0 else 0
            coin_delta = desired_coins - old_coins
            if coin_delta < 0 and (db_op.current_balance or 0) + coin_delta < 0:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Нельзя уменьшить ранее начисленные коины для {db_op.full_name}: "
                        "текущего баланса недостаточно для автоматической корректировки"
                    ),
                )
            pr.coins_awarded = desired_coins

            if coin_delta:
                coins_delta_total += coin_delta
                db_op.current_balance = (db_op.current_balance or 0) + coin_delta
                if coin_delta > 0:
                    db_op.total_earned = (db_op.total_earned or 0) + coin_delta
                else:
                    db_op.total_earned = max(0, (db_op.total_earned or 0) + coin_delta)

                db.add(CoinTransaction(
                    operator_id=db_op.id,
                    amount=coin_delta,
                    type="period_report" if not existing_reports else "period_report_adjustment",
                    comment=(
                        f"Расчёт за период {payload.start_date}–{payload.end_date}: "
                        f"{m.final_points} баллов, коины {old_coins} → {desired_coins}"
                    ),
                    created_by_user_id=current_user.id,
                ))
        else:
            pr.coins_awarded = old_coins

        db.add(pr)
        saved += 1
        if existing_reports:
            updated += 1
        else:
            created += 1

    db.add(AuditLog(
        action="period_report_saved",
        entity_type="period_report",
        details=(
            f"Сохранён расчёт за период {payload.start_date}–{payload.end_date}: "
            f"created={created}, updated={updated}, coins_delta={coins_delta_total}"
        ),
        performed_by_user_id=current_user.id,
    ))

    db.commit()
    cache_clear_all()  # новый/обновлённый расчёт периода — сбрасываем кеш аналитики
    rating_cache_invalidate()  # рейтинг тоже изменился

    return {
        "ok": True,
        "saved": saved,
        "created": created,
        "updated": updated,
        "coins_delta_total": coins_delta_total,
        "coins_awarded_total": coins_delta_total,
        "message": f"Сохранено {saved} расчётов" + (
            f", изменение баланса {coins_delta_total:+d} ₡" if payload.award_coins else ""
        ),
    }
