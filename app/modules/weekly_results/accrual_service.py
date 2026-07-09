"""Автоматический еженедельный расчёт и бонусы (ТЗ §3).

calculate_period_accrual() — чистая функция, ничего не пишет в БД. Используется
и preview, и как первый шаг apply — вычисляет базовые коины, бонусы (топ-3,
без опозданий, без нарушений, номинации, благодарность водителя) для каждого
оператора, у которого есть WeeklyResult за период.

apply_period_accrual() — записывает результат: создаёт WeeklyAccrualRun,
по одной WeeklyAccrualDetail на оператора (уникальность по operator+period —
защита от повторного начисления, ТЗ 3.4) и транзакции в истории коинов.

Источник данных WeeklyResult для периода — либо ручная запись через
POST /weekly-results, либo автоматический «мост» из reports.save_period_report
(см. app/modules/reports/service.py::_sync_weekly_result).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.entities import (
    CoinRule,
    Operator,
    User,
    WeeklyAccrualDetail,
    WeeklyAccrualRun,
    WeeklyResult,
    now_utc,
)
from app.modules.settings.service import get_active_coin_rule
from app.modules.wallet.service import add_transaction, points_to_coins


@dataclass
class OperatorAccrual:
    operator: Operator
    weekly_result: WeeklyResult
    contest_points: float
    base_coins: int
    bonus_top_coins: int = 0
    bonus_no_late_coins: int = 0
    bonus_no_violation_coins: int = 0
    bonus_nomination_coins: int = 0
    bonus_thanks_coins: int = 0
    rank_place: int | None = None
    previous_rank_place: int | None = None
    rank_delta: int | None = None
    already_accrued: bool = False
    eligible_for_bonus: bool = True  # False, если contest_points < min_points_for_accrual (ТЗ 4.3)
    nomination_wins: list[str] = field(default_factory=list)  # какие категории выиграл (для достижений §7)

    @property
    def total_coins(self) -> int:
        return (
            self.base_coins
            + self.bonus_top_coins
            + self.bonus_no_late_coins
            + self.bonus_no_violation_coins
            + self.bonus_nomination_coins
            + self.bonus_thanks_coins
        )


def _eligible_weekly_results(
    db: Session, period_start: date, period_end: date, coin_rule: CoinRule
) -> list[WeeklyResult]:
    rows = list(db.scalars(
        select(WeeklyResult)
        .join(Operator, Operator.id == WeeklyResult.operator_id)
        .where(WeeklyResult.week_start == period_start, WeeklyResult.week_end == period_end)
    ))
    eligible = []
    for row in rows:
        op = row.operator
        if not coin_rule.accrue_to_fired and op.employment_status == "dismissed":
            continue
        if not coin_rule.accrue_to_inactive and (not op.is_active or op.participation_status != "participating"):
            continue
        eligible.append(row)
    return eligible


def _previous_rank(db: Session, operator_id: int, period_start: date) -> int | None:
    prev = db.scalar(
        select(WeeklyResult)
        .where(WeeklyResult.operator_id == operator_id, WeeklyResult.week_end < period_start)
        .order_by(WeeklyResult.week_end.desc())
    )
    return prev.rank_position if prev else None


def _already_accrued_operator_ids(db: Session, period_start: date, period_end: date) -> set[int]:
    return set(db.scalars(
        select(WeeklyAccrualDetail.operator_id).where(
            WeeklyAccrualDetail.period_start == period_start,
            WeeklyAccrualDetail.period_end == period_end,
        )
    ))


def _award_top(
    candidates: list[OperatorAccrual],
    metric,
    enabled: bool,
    bonus: int,
    category: str,
    positive_only: bool = False,
) -> None:
    if not enabled or not candidates:
        return
    pool = [a for a in candidates if (metric(a) or 0) > 0] if positive_only else candidates
    if not pool:
        return
    best = max(pool, key=lambda a: metric(a) or 0)
    best.bonus_nomination_coins += bonus
    best.nomination_wins.append(category)


def _apply_nominations(accruals: list[OperatorAccrual], coin_rule: CoinRule) -> None:
    """Номинации недели (ТЗ 4.3): лучший по звонкам / качеству / эффективности /
    прогрессу / благодарностям — +nomination_bonus победителю каждой включённой
    категории. При равенстве значений побеждает первый в порядке обхода —
    явного правила разбора ничьей в ТЗ нет.

    Все категории — positive_only: если у всех кандидатов метрика равна 0
    (например, единственный оператор в периоде, или показатель ещё не
    заполнен), «победителя» нет — награждать 0 == 0 было бы бессмысленно, а
    не «честной» номинацией. Также не рассматриваем тех, кто не прошёл порог
    min_points_for_accrual — им бонусы не положены вообще (ТЗ 4.3).

    «Без опозданий» отдельной номинацией не выведена — уже покрыта flat-бонусом
    no_late_bonus, дублировать его под другим именем не стал.
    """
    candidates = [a for a in accruals if not a.already_accrued and a.eligible_for_bonus]
    _award_top(candidates, lambda a: a.weekly_result.calls_per_hour_score, coin_rule.nomination_calls_enabled, coin_rule.nomination_bonus, "calls", positive_only=True)
    _award_top(candidates, lambda a: a.weekly_result.quality_score, coin_rule.nomination_quality_enabled, coin_rule.nomination_bonus, "quality", positive_only=True)
    _award_top(candidates, lambda a: a.weekly_result.efficiency_score, coin_rule.nomination_efficiency_enabled, coin_rule.nomination_bonus, "efficiency", positive_only=True)
    _award_top(candidates, lambda a: a.rank_delta, coin_rule.nomination_progress_enabled, coin_rule.nomination_bonus, "progress", positive_only=True)
    _award_top(candidates, lambda a: a.weekly_result.thanks_count, coin_rule.nomination_thanks_enabled, coin_rule.nomination_bonus, "thanks", positive_only=True)


def calculate_period_accrual(db: Session, period_start: date, period_end: date) -> list[OperatorAccrual]:
    """Preview-расчёт: ничего не пишет в БД, можно вызывать сколько угодно раз."""
    coin_rule = get_active_coin_rule(db)
    rows = _eligible_weekly_results(db, period_start, period_end, coin_rule)
    if not rows:
        return []

    # Ранг внутри периода по итоговому баллу — топ-3 бонус (ТЗ 3.3.5)
    rows_sorted = sorted(rows, key=lambda r: r.final_score, reverse=True)
    rank_by_op = {row.operator_id: idx + 1 for idx, row in enumerate(rows_sorted)}
    already_accrued_ids = _already_accrued_operator_ids(db, period_start, period_end)

    accruals: list[OperatorAccrual] = []
    for row in rows:
        rank = rank_by_op[row.operator_id]
        eligible_for_bonus = row.final_score >= coin_rule.min_points_for_accrual
        base_coins = points_to_coins(row.final_score, db) if eligible_for_bonus else 0
        already = row.operator_id in already_accrued_ids

        acc = OperatorAccrual(
            operator=row.operator,
            weekly_result=row,
            contest_points=row.final_score,
            base_coins=base_coins,
            rank_place=rank,
            previous_rank_place=_previous_rank(db, row.operator_id, period_start),
            already_accrued=already,
            eligible_for_bonus=eligible_for_bonus,
        )
        acc.rank_delta = (acc.previous_rank_place - rank) if acc.previous_rank_place else None

        if not already and eligible_for_bonus:
            if rank == 1:
                acc.bonus_top_coins = coin_rule.top_1_bonus
            elif rank == 2:
                acc.bonus_top_coins = coin_rule.top_2_bonus
            elif rank == 3:
                acc.bonus_top_coins = coin_rule.top_3_bonus
            if row.lateness_count == 0:
                acc.bonus_no_late_coins = coin_rule.no_late_bonus
            if row.violation_count == 0:
                acc.bonus_no_violation_coins = coin_rule.no_violation_bonus
            if row.thanks_count > 0:
                acc.bonus_thanks_coins = coin_rule.driver_thanks_bonus

        accruals.append(acc)

    _apply_nominations(accruals, coin_rule)
    return accruals


def apply_period_accrual(
    db: Session, period_start: date, period_end: date, current_user: User | None, mode: str
) -> WeeklyAccrualRun:
    """Применяет расчёт: создаёт run, детали по каждому оператору и транзакции.

    Если для оператора за этот период уже есть WeeklyAccrualDetail (из любого
    предыдущего run'а) — повторно не начисляем, только считаем как skipped
    (ТЗ 3.4). Базовые коины реконсилируются по дельте от WeeklyResult.coins_earned,
    чтобы не задвоить то, что уже могло быть начислено вручную или через
    reports/save_period_report — это тот же паттерн, что уже используется там.
    """
    run = WeeklyAccrualRun(
        period_start=period_start,
        period_end=period_end,
        mode=mode,
        status="running",
        created_by=current_user.username if current_user else "system",
        created_by_user_id=current_user.id if current_user else None,
    )
    db.add(run)
    db.flush()

    try:
        accruals = calculate_period_accrual(db, period_start, period_end)
        operators_count = 0
        skipped = 0
        total_base = 0
        total_bonus = 0

        for acc in accruals:
            if acc.already_accrued:
                skipped += 1
                continue

            detail = WeeklyAccrualDetail(
                run_id=run.id,
                operator_id=acc.operator.id,
                period_start=period_start,
                period_end=period_end,
                contest_points=acc.contest_points,
                base_coins=acc.base_coins,
                bonus_top_coins=acc.bonus_top_coins,
                bonus_no_late_coins=acc.bonus_no_late_coins,
                bonus_no_violation_coins=acc.bonus_no_violation_coins,
                bonus_nomination_coins=acc.bonus_nomination_coins,
                bonus_thanks_coins=acc.bonus_thanks_coins,
                total_coins=acc.total_coins,
                rank_place=acc.rank_place,
                previous_rank_place=acc.previous_rank_place,
                rank_delta=acc.rank_delta,
            )
            try:
                with db.begin_nested():
                    db.add(detail)
                    db.flush()
            except IntegrityError:
                # Гонка: кто-то успел начислить за этот период параллельно
                # (ручной apply + auto-cron почти одновременно). Не наша ошибка —
                # просто пропускаем, как и штатный повторный запуск.
                skipped += 1
                continue

            base_delta = acc.base_coins - acc.weekly_result.coins_earned
            if base_delta:
                add_transaction(
                    db, acc.operator, base_delta, "weekly_accrual",
                    f"Итоги недели {period_start}–{period_end}: {acc.contest_points:.0f} баллов",
                    created_by=current_user, source_type="weekly_auto_accrual", source_id=run.id,
                )
            acc.weekly_result.coins_earned = acc.base_coins
            acc.weekly_result.rank_position = acc.rank_place
            acc.weekly_result.previous_rank_position = acc.previous_rank_place

            for bonus_amount, bonus_type, label in (
                (acc.bonus_top_coins, "bonus_top", "Топ недели"),
                (acc.bonus_no_late_coins, "bonus_no_late", "Неделя без опозданий"),
                (acc.bonus_no_violation_coins, "bonus_no_violation", "Неделя без нарушений"),
                (acc.bonus_nomination_coins, "bonus_nomination", "Номинация недели"),
                (acc.bonus_thanks_coins, "bonus_driver_thanks", "Благодарность от водителя"),
            ):
                if bonus_amount:
                    add_transaction(
                        db, acc.operator, bonus_amount, bonus_type, label,
                        created_by=current_user, source_type="weekly_auto_accrual", source_id=run.id,
                    )

            operators_count += 1
            total_base += acc.base_coins
            total_bonus += acc.total_coins - acc.base_coins

            from app.modules.achievements.service import check_weekly_achievements
            check_weekly_achievements(db, acc, current_user)

        run.status = "success"
        run.finished_at = now_utc()
        run.operators_count = operators_count
        run.skipped_existing_count = skipped
        run.total_base_coins = total_base
        run.total_bonus_coins = total_bonus
        run.total_coins = total_base + total_bonus
        db.commit()

        from app.modules.rating.service import rating_cache_invalidate
        rating_cache_invalidate()
        return run
    except Exception as exc:  # noqa: BLE001 — сознательно широкий catch: любая ошибка помечает run как failed
        db.rollback()
        failed_run = WeeklyAccrualRun(
            period_start=period_start,
            period_end=period_end,
            mode=mode,
            status="failed",
            created_by=current_user.username if current_user else "system",
            created_by_user_id=current_user.id if current_user else None,
            finished_at=now_utc(),
            error_message=str(exc)[:2000],
        )
        db.add(failed_run)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка расчёта за {period_start}–{period_end}: {exc}",
        ) from exc


def run_history(db: Session, limit: int = 50) -> list[WeeklyAccrualRun]:
    return list(db.scalars(
        select(WeeklyAccrualRun).order_by(WeeklyAccrualRun.created_at.desc()).limit(limit)
    ))


def latest_weekly_period(db: Session) -> tuple[date, date] | None:
    """Последний период, за который есть хоть один WeeklyResult — используется
    как дефолт для отчётов/сводок, если период не передан явно (ТЗ §9)."""
    row = db.scalar(select(WeeklyResult).order_by(WeeklyResult.week_end.desc()))
    return (row.week_start, row.week_end) if row else None
