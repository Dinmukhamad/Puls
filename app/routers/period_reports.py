from __future__ import annotations

import re
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.db import get_db
from app.models.entities import CoinTransaction, Operator, PeriodReport, User
from app.services.period_reports import calculate_period_report

router = APIRouter(prefix="/reports", tags=["period-reports"])

# In-memory cache of last uploaded files per session (simple, single-admin use case)
_LAST_UPLOAD: dict = {"monthly": None, "report": None}


def _normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", str(name).strip().lower())


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


class PeriodSummaryOut(BaseModel):
    period: dict
    operators: List[OperatorMetricsOut]
    warnings: List[dict]


@router.post("/period-report/upload")
async def upload_period_files(
    monthly_report_file: UploadFile = File(...),
    report_file: UploadFile = File(...),
    _: User = Depends(require_roles("supervisor", "manager", "admin")),
) -> dict:
    """Загрузка двух Excel-файлов. Проверяет формат, сохраняет в памяти процесса."""
    for f, label in ((monthly_report_file, "Monthly Report"), (report_file, "Report")):
        if not f.filename.lower().endswith(".xlsx"):
            raise HTTPException(status_code=400, detail=f"Файл «{label}» должен быть в формате .xlsx")

    monthly_bytes = await monthly_report_file.read()
    report_bytes = await report_file.read()

    if not monthly_bytes:
        raise HTTPException(status_code=400, detail="Monthly Report пустой или повреждён")
    if not report_bytes:
        raise HTTPException(status_code=400, detail="Report пустой или повреждён")

    _LAST_UPLOAD["monthly"] = monthly_bytes
    _LAST_UPLOAD["report"] = report_bytes

    return {"ok": True, "message": "Файлы загружены. Выберите период и нажмите «Рассчитать»."}


@router.get("/operators-period-summary", response_model=PeriodSummaryOut)
def get_period_summary(
    start_date: date,
    end_date: date,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("supervisor", "manager", "admin")),
) -> PeriodSummaryOut:
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="Дата начала не может быть позже даты окончания")

    if not _LAST_UPLOAD["monthly"] or not _LAST_UPLOAD["report"]:
        raise HTTPException(
            status_code=400,
            detail="Сначала загрузите файлы Monthly Report и Report",
        )

    try:
        result = calculate_period_report(
            _LAST_UPLOAD["monthly"], _LAST_UPLOAD["report"], start_date, end_date
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Map to existing operators in DB for operator_id / group
    db_ops = list(db.scalars(select(Operator)))
    name_to_op = {_normalize_name(o.full_name): o for o in db_ops}

    operators_out: List[OperatorMetricsOut] = []
    for m in result.operators:
        db_op = name_to_op.get(_normalize_name(m.full_name))
        operators_out.append(OperatorMetricsOut(
            full_name=m.full_name,
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
        warnings=result.cross_warnings,
    )


class SavePeriodReportRequest(BaseModel):
    start_date: date
    end_date: date
    award_coins: bool = False
    coins_per_points: float = 5.0  # 5 баллов = 1 коин


@router.post("/period-report/save")
def save_period_report(
    payload: SavePeriodReportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("supervisor", "manager", "admin")),
) -> dict:
    """Пересчитывает период и сохраняет результаты в БД. Опционально начисляет коины."""
    if not _LAST_UPLOAD["monthly"] or not _LAST_UPLOAD["report"]:
        raise HTTPException(status_code=400, detail="Сначала загрузите файлы")

    try:
        result = calculate_period_report(
            _LAST_UPLOAD["monthly"], _LAST_UPLOAD["report"],
            payload.start_date, payload.end_date,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    db_ops = list(db.scalars(select(Operator)))
    name_to_op = {_normalize_name(o.full_name): o for o in db_ops}

    saved = 0
    coins_total = 0
    skipped_no_match = []

    for m in result.operators:
        db_op = name_to_op.get(_normalize_name(m.full_name))
        if not db_op:
            skipped_no_match.append(m.full_name)
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
            coins = int(m.final_points / payload.coins_per_points)  # округление вниз
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
        "skipped_no_match": skipped_no_match,
        "message": f"Сохранено {saved} расчётов" + (f", начислено {coins_total} ₡" if payload.award_coins else ""),
    }
