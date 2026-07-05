"""Бизнес-логика модуля reports (ТЗ §15.2).

Оркестрация загрузки Excel, посуточного пересчёта, предпросмотра периода и
сохранения расчёта (коины/аудит/уровни/колесо). SQL — в repository, парсинг и
расчёты — в excel_parser/period_calculator. Логика перенесена из
routers/period_reports.py дословно; формулы и §16 не менялись.
"""
from __future__ import annotations

import json as _json
from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.entities import (
    AuditLog,
    CoinTransaction,
    PeriodReport,
    User,
)
from app.modules.analytics.cache import cache_clear_all
from app.modules.operator_levels.service import assign_auto_level
from app.modules.rating.service import rating_cache_invalidate
from app.modules.reports import repository as repo
from app.modules.reports.excel_parser import normalize_name
from app.modules.reports.period_calculator import (
    build_daily_metric_rows,
    calculate_period_report,
)
from app.modules.reports.schemas import (
    OperatorMetricsOut,
    PeriodSummaryOut,
    PeriodWarningsOut,
    SavePeriodReportRequest,
)
from app.modules.work_norms.service import calculate_norm_for_period

MAX_REPORT_FILE_BYTES = 15 * 1024 * 1024


def process_upload(
    db: Session,
    monthly_filename: str,
    monthly_bytes: bytes,
    report_filename: str,
    report_bytes: bytes,
    user_id: int,
) -> dict:
    """Сохраняет файлы, посуточно пересчитывает метрики, инвалидирует кеши."""
    repo.save_uploaded_bytes(db, "monthly", monthly_filename, monthly_bytes, user_id)
    repo.save_uploaded_bytes(db, "report", report_filename, report_bytes, user_id)

    # Посуточный разбор — ОДИН раз при загрузке, дальше аналитика строится
    # из operator_daily_metrics без повторного парсинга Excel (см. ТЗ).
    daily_stats = _rebuild_daily_metrics(db, monthly_bytes, report_bytes, user_id)

    cache_clear_all()  # новые файлы — старые закешированные расчёты аналитики и сохранённые PeriodReport больше не актуальны

    return {
        "ok": True,
        "message": "Файлы загружены и сохранены. Выберите период и нажмите «Рассчитать».",
        "daily_metrics": daily_stats,
    }


def _rebuild_daily_metrics(db: Session, monthly_bytes: bytes, report_bytes: bytes, actor_user_id: int) -> dict:
    """
    Парсит оба файла ПОСУТОЧНО (build_daily_metric_rows) и записывает результат
    в operator_daily_metrics одним bulk upsert-запросом. Также удаляет ранее
    сохранённые PeriodReport (п.9 ТЗ). Логика перенесена дословно.
    """
    try:
        rows = build_daily_metric_rows(monthly_bytes, report_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    site_ops = repo.site_operators(db)
    name_to_op = {normalize_name(o.full_name): o for o in site_ops if o.full_name}

    monthly_file_row = repo.uploaded_file(db, "monthly")
    report_file_row = repo.uploaded_file(db, "report")
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

    repo.bulk_upsert_daily_metrics(db, values_to_upsert)

    # Старые сохранённые расчёты периодов больше не гарантированно актуальны —
    # инвалидируем (п.9 ТЗ). Пользователь при необходимости пересчитает заново.
    deleted_reports = repo.delete_all_period_reports(db)

    db.commit()

    return {
        "matched_daily_rows": matched,
        "unmatched_operators_count": len(unmatched_names),
        "unmatched_operators_sample": sorted(unmatched_names)[:20],
        "invalidated_period_reports": deleted_reports,
    }


def upload_status(db: Session) -> dict:
    """Загружены ли файлы (например, после редеплоя)."""
    monthly = repo.uploaded_file(db, "monthly")
    report = repo.uploaded_file(db, "report")
    return {
        "monthly": {"filename": monthly.filename, "uploaded_at": str(monthly.uploaded_at)} if monthly else None,
        "report": {"filename": report.filename, "uploaded_at": str(report.uploaded_at)} if report else None,
    }


def period_summary(db: Session, start_date: date, end_date: date) -> PeriodSummaryOut:
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="Дата начала не может быть позже даты окончания")

    monthly_bytes = repo.get_uploaded_bytes(db, "monthly")
    report_bytes = repo.get_uploaded_bytes(db, "report")
    if not monthly_bytes or not report_bytes:
        raise HTTPException(
            status_code=400,
            detail="Сначала загрузите файлы Monthly Report и Report",
        )

    site_names = repo.site_operator_names(db)

    try:
        result = calculate_period_report(
            monthly_bytes, report_bytes,
            start_date, end_date, site_operator_names=site_names,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    db_ops = repo.site_operators(db)
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


def save_period_report(db: Session, payload: SavePeriodReportRequest, current_user: User) -> dict:
    """Пересчитывает период (только matched-операторы) и сохраняет результаты в БД."""
    if payload.start_date > payload.end_date:
        raise HTTPException(status_code=400, detail="Дата начала не может быть позже даты окончания")
    if payload.award_coins and payload.coins_per_points <= 0:
        raise HTTPException(status_code=400, detail="Коэффициент начисления коинов должен быть больше нуля")

    monthly_bytes = repo.get_uploaded_bytes(db, "monthly")
    report_bytes = repo.get_uploaded_bytes(db, "report")
    if not monthly_bytes or not report_bytes:
        raise HTTPException(status_code=400, detail="Сначала загрузите файлы")

    site_names = repo.site_operator_names(db)

    try:
        result = calculate_period_report(
            monthly_bytes, report_bytes,
            payload.start_date, payload.end_date, site_operator_names=site_names,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    db_ops = repo.site_operators(db)
    name_to_op = {normalize_name(o.full_name): o for o in db_ops}

    saved = 0
    created = 0
    updated = 0
    coins_delta_total = 0
    saved_reports: list[PeriodReport] = []

    for m in result.operators:
        db_op = name_to_op.get(m.name_key)
        if not db_op:
            continue

        existing_reports = repo.existing_period_reports_for(
            db, db_op.id, payload.start_date, payload.end_date
        )
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
        saved_reports.append(pr)
        assign_auto_level(db, db_op, current_user, payload.start_date, payload.end_date)
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

    # ТЗ 11.2: после создания/пересчёта PeriodReport — проверка правил колеса.
    # Изолированная обёртка: сбой колеса не влияет на сохранение расчёта.
    from app.modules.wheel.eligibility import notify_period_report_saved
    for _pr in saved_reports:
        if _pr.id:
            notify_period_report_saved(_pr.id)

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
