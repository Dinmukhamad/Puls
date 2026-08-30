"""API для норм часов (work_norms) и ставок операторов."""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_operator_access, require_roles
from app.database.db import get_db
from app.models.entities import Operator, User, WorkNorm
from app.modules.work_norms.service import (
    VALID_RATES,
    calculate_norm_for_period,
    create_norm,
    deactivate_norm,
    get_norm,
    list_norms,
    update_norm,
)

router = APIRouter(prefix="/work-norms", tags=["work-norms"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class WorkNormOut(BaseModel):
    id: int
    year: int
    month: int
    month_days: int
    rate: float
    monthly_norm_hours: float
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorkNormCreate(BaseModel):
    year: int
    month: int
    rate: float
    monthly_norm_hours: float

    @field_validator("rate")
    @classmethod
    def validate_rate(cls, v: float) -> float:
        if v not in VALID_RATES:
            raise ValueError(f"Ставка должна быть одной из: {sorted(VALID_RATES)}")
        return v

    @field_validator("month")
    @classmethod
    def validate_month(cls, v: int) -> int:
        if not 1 <= v <= 12:
            raise ValueError("Месяц должен быть от 1 до 12")
        return v

    @field_validator("monthly_norm_hours")
    @classmethod
    def validate_hours(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("Норма часов должна быть больше 0")
        return v


class WorkNormUpdate(BaseModel):
    monthly_norm_hours: float

    @field_validator("monthly_norm_hours")
    @classmethod
    def validate_hours(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("Норма часов должна быть больше 0")
        return v


class OperatorRateUpdate(BaseModel):
    rate: float | None

    @field_validator("rate")
    @classmethod
    def validate_rate(cls, v: float | None) -> float | None:
        if v is not None and v not in VALID_RATES:
            raise ValueError(f"Ставка должна быть одной из: {sorted(VALID_RATES)}")
        return v


class WorkNormCalcOut(BaseModel):
    operator_id: int
    rate: float | None
    period_start: date
    period_end: date
    individual_norm_hours: float
    total_worked_hours: float
    norm_completion_percent: float
    hours_points: float
    overtime_hours: float
    overtime_percent: float
    warnings: list[str]


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=list[WorkNormOut])
def api_list_norms(
    active_only: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("supervisor", "manager", "admin")),
) -> list[WorkNorm]:
    return list_norms(db, active_only=active_only)


@router.post("", response_model=WorkNormOut)
def api_create_norm(
    payload: WorkNormCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("manager", "admin")),
) -> WorkNorm:
    existing = db.scalar(
        select(WorkNorm).where(
            WorkNorm.year == payload.year,
            WorkNorm.month == payload.month,
            WorkNorm.rate == payload.rate,
        )
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Норма для ставки {payload.rate} за {payload.month}/{payload.year} уже существует"
        )
    norm = create_norm(
        db, payload.year, payload.month, payload.rate,
        payload.monthly_norm_hours, current_user.id
    )
    db.commit()
    db.refresh(norm)
    return norm


@router.patch("/{norm_id}", response_model=WorkNormOut)
def api_update_norm(
    norm_id: int,
    payload: WorkNormUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("manager", "admin")),
) -> WorkNorm:
    norm = get_norm(db, norm_id)
    if not norm:
        raise HTTPException(status_code=404, detail="Норма не найдена")
    update_norm(db, norm, payload.monthly_norm_hours)
    db.commit()
    db.refresh(norm)
    return norm


@router.delete("/{norm_id}")
def api_deactivate_norm(
    norm_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> dict:
    norm = get_norm(db, norm_id)
    if not norm:
        raise HTTPException(status_code=404, detail="Норма не найдена")
    deactivate_norm(db, norm)
    db.commit()
    return {"ok": True}


# ── Ставка оператора ─────────────────────────────────────────────────────────

@router.patch("/operators/{operator_id}/rate")
def api_set_operator_rate(
    operator_id: int,
    payload: OperatorRateUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("manager", "admin")),
) -> dict:
    op = db.get(Operator, operator_id)
    if not op:
        raise HTTPException(status_code=404, detail="Оператор не найден")
    op.rate = payload.rate
    db.commit()
    return {"ok": True, "operator_id": operator_id, "rate": payload.rate}


@router.get("/operators/{operator_id}/work-norm", response_model=WorkNormCalcOut)
def api_operator_work_norm(
    operator_id: int,
    start_date: date,
    end_date: date,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    op = db.get(Operator, operator_id)
    if not op:
        raise HTTPException(status_code=404, detail="Оператор не найден")

    # Ставка, норма и отработанные часы — персональные данные сотрудника.
    # Свои показатели оператор видит всегда; чужие — только штат, и супервайзер
    # лишь в пределах своей группы. Без этой проверки любой авторизованный
    # пользователь читал метрики коллег перебором operator_id.
    if current_user.operator_id != operator_id:
        require_operator_access(db, current_user, op)

    # Получаем фактические часы из period_report
    from app.models.entities import PeriodReport
    report = db.scalar(
        select(PeriodReport).where(
            PeriodReport.operator_id == operator_id,
            PeriodReport.period_start == start_date,
            PeriodReport.period_end == end_date,
        ).order_by(PeriodReport.created_at.desc()).limit(1)
    )
    total_worked_hours = report.total_hours if report else 0.0

    result = calculate_norm_for_period(db, op.rate, start_date, end_date, total_worked_hours)

    return {
        "operator_id": operator_id,
        "rate": result.rate,
        "period_start": start_date,
        "period_end": end_date,
        "individual_norm_hours": result.individual_norm_hours,
        "total_worked_hours": result.total_worked_hours,
        "norm_completion_percent": result.norm_completion_percent,
        "hours_points": result.hours_points,
        "overtime_hours": result.overtime_hours,
        "overtime_percent": result.overtime_percent,
        "warnings": result.warnings,
    }
