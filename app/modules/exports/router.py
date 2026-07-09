"""Экспорт CSV/XLSX (ТЗ §8). Доступ — supervisor/manager/admin; supervisor
ограничен своей группой, как и везде в проекте (ТЗ 10.2). Оператор сюда
не заходит вообще — выгрузка общих таблиц ему не положена (ТЗ 8.6).
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles, supervisor_scope_group_id
from app.database.db import get_db
from app.models.entities import Operator, ShopItem, ShopPurchase, User, WeeklyAccrualDetail
from app.modules.exports.utils import build_export_response
from app.modules.weekly_results.accrual_service import calculate_period_accrual

router = APIRouter(prefix="/exports", tags=["exports"])

ADMIN_DEP = Depends(require_roles("supervisor", "manager", "admin"))


@router.get("/rating", dependencies=[ADMIN_DEP])
def export_rating(
    period_start: date,
    period_end: date,
    format: str = Query("csv"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Поля по ТЗ 8.4. Источник — движок еженедельного расчёта (§3): те же
    цифры, что показывает /weekly-results/preview и кабинет оператора."""
    accruals = calculate_period_accrual(db, period_start, period_end)
    group_id = supervisor_scope_group_id(db, current_user)
    if group_id is not None:
        accruals = [a for a in accruals if a.operator.group_id == group_id]
    accruals = sorted(accruals, key=lambda a: (a.rank_place if a.rank_place is not None else 10**9))

    headers = [
        "Место", "ФИО", "Группа", "Баллы", "Коины за неделю", "Бонусные коины",
        "Общий баланс", "Динамика места", "Опоздания", "Нарушения", "Качество",
        "Эффективность", "Звонки в час",
    ]
    rows = [
        [
            a.rank_place, a.operator.full_name, a.operator.group_name,
            a.contest_points, a.base_coins, a.total_coins - a.base_coins,
            a.operator.current_balance, a.rank_delta,
            a.weekly_result.lateness_count, a.weekly_result.violation_count,
            a.weekly_result.quality_score, a.weekly_result.efficiency_score,
            a.weekly_result.calls_per_hour_score,
        ]
        for a in accruals
    ]
    return build_export_response(headers, rows, f"pulse_rating_{period_start}_{period_end}", format)


@router.get("/operators", dependencies=[ADMIN_DEP])
def export_operators(
    format: str = Query("csv"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    q = select(Operator).order_by(Operator.group_name.asc(), Operator.full_name.asc())
    group_id = supervisor_scope_group_id(db, current_user)
    if group_id is not None:
        q = q.where(Operator.group_id == group_id)
    operators = list(db.scalars(q))

    headers = [
        "ФИО", "Группа", "Должность", "Статус участия", "Статус занятости",
        "Баланс", "В резерве", "Всего начислено", "Всего потрачено", "Ставка",
        "Email", "Дата создания",
    ]
    status_labels = {"participating": "Участвует", "not_participating": "Не участвует"}
    employment_labels = {"active": "Активен", "dismissed": "Уволен"}
    rows = [
        [
            op.full_name, op.group_name, op.position,
            status_labels.get(op.participation_status, op.participation_status),
            employment_labels.get(op.employment_status, op.employment_status),
            op.current_balance, op.reserved_balance, op.total_earned, op.total_spent,
            op.rate, op.email, op.created_at.strftime("%Y-%m-%d %H:%M"),
        ]
        for op in operators
    ]
    return build_export_response(headers, rows, "pulse_operators", format)


@router.get("/shop-requests", dependencies=[ADMIN_DEP])
def export_shop_requests(
    status_filter: str = Query("all", alias="status"),
    format: str = Query("csv"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    q = (
        select(ShopPurchase, Operator, ShopItem, User)
        .join(Operator, Operator.id == ShopPurchase.operator_id)
        .outerjoin(ShopItem, ShopItem.id == ShopPurchase.shop_item_id)
        .outerjoin(User, User.id == ShopPurchase.reviewed_by_user_id)
        .order_by(ShopPurchase.created_at.desc(), ShopPurchase.id.desc())
    )
    if status_filter == "new":
        q = q.where(ShopPurchase.status.in_(["pending", "new"]))
    elif status_filter != "all":
        q = q.where(ShopPurchase.status == status_filter)
    group_id = supervisor_scope_group_id(db, current_user)
    if group_id is not None:
        q = q.where(Operator.group_id == group_id)

    status_labels = {
        "pending": "Ожидает", "new": "Новая", "approved": "Одобрена",
        "rejected": "Отклонена", "completed": "Выдана",
    }
    headers = [
        "Дата", "Оператор", "Группа", "Товар", "Цена", "Статус",
        "Кто рассмотрел", "Дата решения", "Причина отказа", "Дата выдачи",
    ]
    rows = [
        [
            p.created_at.strftime("%Y-%m-%d %H:%M"), op.full_name, op.group_name,
            item.title if item else "", p.price, status_labels.get(p.status, p.status),
            reviewer.full_name if reviewer else "",
            p.reviewed_at.strftime("%Y-%m-%d %H:%M") if p.reviewed_at else "",
            p.reject_reason or "",
            p.completed_at.strftime("%Y-%m-%d %H:%M") if p.completed_at else "",
        ]
        for p, op, item, reviewer in db.execute(q)
    ]
    return build_export_response(headers, rows, "pulse_shop_requests", format)


@router.get("/weekly-results", dependencies=[ADMIN_DEP])
def export_weekly_results(
    period_start: date,
    period_end: date,
    format: str = Query("csv"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Итоги недели (ТЗ 8.1 п.5). Если период уже применён (apply) — берём
    зафиксированные WeeklyAccrualDetail; если ещё нет — считаем предварительно
    тем же движком, что и preview (согласованность с /weekly-results/preview
    и кабинетом оператора)."""
    details = list(db.scalars(
        select(WeeklyAccrualDetail).where(
            WeeklyAccrualDetail.period_start == period_start,
            WeeklyAccrualDetail.period_end == period_end,
        )
    ))
    group_id = supervisor_scope_group_id(db, current_user)

    headers = [
        "Оператор", "Группа", "Баллы", "Базовые коины", "Бонус за место",
        "Без опозданий", "Без нарушений", "Номинация", "Благодарность",
        "Итого коинов", "Место", "Прошлое место", "Динамика",
    ]

    if details:
        operators_by_id = {op.id: op for op in db.scalars(select(Operator))}
        rows = []
        for d in details:
            op = operators_by_id.get(d.operator_id)
            if not op or (group_id is not None and op.group_id != group_id):
                continue
            rows.append([
                op.full_name if op else d.operator_id, op.group_name if op else "",
                d.contest_points, d.base_coins, d.bonus_top_coins, d.bonus_no_late_coins,
                d.bonus_no_violation_coins, d.bonus_nomination_coins, d.bonus_thanks_coins,
                d.total_coins, d.rank_place, d.previous_rank_place, d.rank_delta,
            ])
    else:
        accruals = calculate_period_accrual(db, period_start, period_end)
        if group_id is not None:
            accruals = [a for a in accruals if a.operator.group_id == group_id]
        rows = [
            [
                a.operator.full_name, a.operator.group_name, a.contest_points, a.base_coins,
                a.bonus_top_coins, a.bonus_no_late_coins, a.bonus_no_violation_coins,
                a.bonus_nomination_coins, a.bonus_thanks_coins, a.total_coins,
                a.rank_place, a.previous_rank_place, a.rank_delta,
            ]
            for a in accruals
        ]

    return build_export_response(headers, rows, f"pulse_weekly_results_{period_start}_{period_end}", format)


@router.get("/coin-transactions", dependencies=[ADMIN_DEP])
def export_coin_transactions_alias(
    type: str = "all",
    operator_id: str = "all",
    start_date: date | None = None,
    end_date: date | None = None,
    source: str = "all",
    created_by: str = "all",
    format: str = Query("csv"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Тот же отчёт, что /coins/transactions/export (ТЗ 8.5 поля), просто под
    именем из ТЗ §8.3 и с поддержкой XLSX. Общий query builder с coins_router,
    чтобы фильтры и права доступа не разъезжались между двумя путями."""
    from app.models.entities import CoinTransaction
    from app.modules.wallet.coins_router import _build_transactions_query

    q = _build_transactions_query(db, current_user, type, operator_id, start_date, end_date, source, created_by)
    q = q.order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc())

    headers = ["Дата", "Оператор", "Группа", "Тип операции", "Количество коинов", "Комментарий", "Автор", "Источник", "Связанная заявка"]
    rows = [
        [
            tx.created_at.strftime("%Y-%m-%d %H:%M"), op.full_name, op.group_name, tx.type, tx.amount,
            tx.comment, user.full_name if user else "Система", tx.source_type or "", tx.related_purchase_id or "",
        ]
        for tx, op, user in db.execute(q)
    ]
    return build_export_response(headers, rows, "pulse_coin_transactions", format)
