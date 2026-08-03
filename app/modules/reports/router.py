"""HTTP-слой модуля reports (ТЗ §15.1).

Только приём запроса, проверка ролей и вызов service. Бизнес-логика — в
service.py, SQL — repository.py, парсинг/расчёты — excel_parser/period_calculator.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.security import require_roles
from app.database.db import SessionLocal, get_db
from app.models.entities import User
from app.modules.reports import service
from app.modules.reports.schemas import PeriodSummaryOut, SavePeriodReportRequest

router = APIRouter(prefix="/reports", tags=["period-reports"])


def _process_upload_in_thread(monthly_name, monthly_bytes, report_name, report_bytes, user_id):
    """Тяжёлая обработка выполняется в worker-потоке — поэтому и сессия БД должна
    создаваться ЗДЕСЬ, а не передаваться из get_db. Сессию/соединение SQLAlchemy
    (psycopg) нельзя использовать из другого потока: это портит соединение в пуле
    и каскадом ломает БД для остальных запросов. process_upload сам делает
    commit/rollback, нам остаётся закрыть сессию."""
    db = SessionLocal()
    try:
        return service.process_upload(
            db, monthly_name, monthly_bytes, report_name, report_bytes, user_id
        )
    finally:
        db.close()


@router.post("/period-report/upload")
async def upload_period_files(
    monthly_report_file: UploadFile = File(...),
    report_file: UploadFile = File(...),
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
    if len(monthly_bytes) > service.MAX_REPORT_FILE_BYTES or len(report_bytes) > service.MAX_REPORT_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Размер каждого Excel-файла не должен превышать 15 МБ")

    # Обработчик async ради await file.read(), поэтому живёт на event loop.
    # process_upload синхронный и тяжёлый (sha256, парсинг Excel, запись в БД) —
    # уводим его в threadpool, но с собственной сессией внутри потока.
    return await run_in_threadpool(
        _process_upload_in_thread,
        monthly_report_file.filename, monthly_bytes,
        report_file.filename, report_bytes,
        current_user.id,
    )


@router.get("/period-report/status")
def get_upload_status(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("supervisor", "manager", "admin")),
) -> dict:
    """Позволяет фронтенду узнать, загружены ли файлы (например, после редеплоя)."""
    return service.upload_status(db)


@router.get("/operators-period-summary", response_model=PeriodSummaryOut)
def get_period_summary(
    start_date: date,
    end_date: date,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("supervisor", "manager", "admin")),
) -> PeriodSummaryOut:
    return service.period_summary(db, start_date, end_date)


@router.post("/period-report/save")
def save_period_report(
    payload: SavePeriodReportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("supervisor", "manager", "admin")),
) -> dict:
    return service.save_period_report(db, payload, current_user)
