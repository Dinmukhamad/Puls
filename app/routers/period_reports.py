from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import CoinTransaction, Operator, PeriodReport, UploadedReportFile, User
from app.services.period_reports import calculate_period_report, normalize_name

router = APIRouter(prefix="/reports", tags=["period-reports"])


def _get_uploaded_bytes(db: Session, file_kind: str) -> Optional[bytes]:
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
    operator_id: Optional[int] = None
    group_name: Optional[str] = None
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
    warnings: List[str] = []


class PeriodWarningsOut(BaseModel):
    site_only: List[str] = []
    file_only: List[str] = []
    no_quality: List[str] = []
    no_base_hours: List[str] = []
    ignored_service_rows: List[str] = []


class PeriodSummaryOut(BaseModel):
    period: dict
    operators: List[OperatorMetricsOut]
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

    _save_uploaded_bytes(db, "monthly", monthly_report_file.filename, monthly_bytes, current_user.id)
    _save_uploaded_bytes(db, "report", report_file.filename, report_bytes, current_user.id)

    return {"ok": True, "message": "Файлы загружены и сохранены. Выберите период и нажмите «Рассчитать»."}


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


def _site_operator_names(db: Session) -> List[str]:
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
        raise HTTPException(status_code=400, detail=str(e))

    db_ops = list(db.scalars(select(Operator)))
    name_to_op = {normalize_name(o.full_name): o for o in db_ops}

    operators_out: List[OperatorMetricsOut] = []
    for m in result.operators:
        db_op = name_to_op.get(m.name_key)
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
            final_points=m.final_points,
            warnings=m.warnings,
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
        ),
        summary=result.summary,
    )


class SavePeriodReportRequest(BaseModel):
    start_date: date
    end_date: date
    award_coins: bool = False
    coins_per_points: float = 5.0


@router.post("/period-report/save")
def save_period_report(
    payload: SavePeriodReportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("supervisor", "manager", "admin")),
) -> dict:
    """Пересчитывает период (только matched-операторы) и сохраняет результаты в БД."""
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
        raise HTTPException(status_code=400, detail=str(e))

    db_ops = list(db.scalars(select(Operator)))
    name_to_op = {normalize_name(o.full_name): o for o in db_ops}

    saved = 0
    coins_total = 0

    for m in result.operators:
        db_op = name_to_op.get(m.name_key)
        if not db_op:
            continue

        pr = PeriodReport(
            operator_id=db_op.id,
            period_start=payload.start_date,
            period_end=payload.end_date,
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
            created_by_user_id=current_user.id,
        )

        if payload.award_coins and m.final_points > 0:
            coins = int(m.final_points / payload.coins_per_points)
            pr.coins_awarded = coins
            coins_total += coins

            db_op.current_balance = (db_op.current_balance or 0) + coins
            db_op.total_earned = (db_op.total_earned or 0) + coins
            db.add(CoinTransaction(
                operator_id=db_op.id,
                amount=coins,
                type="period_report",
                comment=f"Расчёт за период {payload.start_date}–{payload.end_date}: {m.final_points} баллов",
                created_by_user_id=current_user.id,
            ))

        db.add(pr)
        saved += 1

    db.commit()

    return {
        "ok": True,
        "saved": saved,
        "coins_awarded_total": coins_total,
        "message": f"Сохранено {saved} расчётов" + (f", начислено {coins_total} ₡" if payload.award_coins else ""),
    }
