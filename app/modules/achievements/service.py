"""Бейджи и достижения (ТЗ §7).

check_weekly_achievements() — вызывается из accrual_service.apply_period_accrual
для каждого начисленного оператора (top-3, качество, номинации звонков/
эффективности, без опозданий, легенда команды по общему балансу).

check_test_score_achievement() — вызывается из tests/service.py::finish_attempt.

grant_manual() — ручная выдача (admin/manager), закрывает недетектируемые
условия типа «помощь новичку», где нет объективного триггера в данных.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import (
    Achievement,
    Operator,
    OperatorAchievement,
    User,
    WeeklyResult,
    now_utc,
)
from app.modules.wallet.service import add_transaction

DEFAULT_ACHIEVEMENTS = [
    {
        "code": "top_3_week", "title": "Топ-3 недели", "description": "Попасть в топ-3 за неделю",
        "icon": "🥉", "condition_type": "top_3_week", "condition_value": 3, "reward_coins": 10, "is_repeatable": True,
    },
    {
        "code": "no_late_3_weeks", "title": "Без опозданий 3 недели", "description": "3 недели подряд без опозданий",
        "icon": "⏰", "condition_type": "no_late_streak", "condition_value": 3, "reward_coins": 15, "is_repeatable": False,
    },
    {
        "code": "quality_star", "title": "Звезда качества", "description": "Качество 96%+ за неделю",
        "icon": "⭐", "condition_type": "quality_threshold", "condition_value": 96, "reward_coins": 10, "is_repeatable": True,
    },
    {
        "code": "calls_master", "title": "Мастер звонков", "description": "Лучший по звонкам за неделю",
        "icon": "📞", "condition_type": "calls_leader_week", "condition_value": 0, "reward_coins": 10, "is_repeatable": True,
    },
    {
        "code": "efficiency_top", "title": "Топ эффективности", "description": "Лучший по эффективности за неделю",
        "icon": "⚡", "condition_type": "efficiency_leader_week", "condition_value": 0, "reward_coins": 10, "is_repeatable": True,
    },
    {
        "code": "legend_team", "title": "Легенда команды", "description": "1000 коинов всего начислено",
        "icon": "👑", "condition_type": "total_coins", "condition_value": 1000, "reward_coins": 50, "is_repeatable": False,
    },
    {
        "code": "helper", "title": "Помощник команды", "description": "Ручное начисление за помощь новичку",
        "icon": "🤝", "condition_type": "manual", "condition_value": 0, "reward_coins": 0, "is_repeatable": True,
    },
    {
        "code": "test_master", "title": "Знаток базы", "description": "Сдать тест на 90%+",
        "icon": "📚", "condition_type": "test_score", "condition_value": 90, "reward_coins": 10, "is_repeatable": True,
    },
]


def ensure_default_achievements(db: Session) -> None:
    """Идемпотентный сид — как ensure_default_levels/ensure_default_wheel."""
    if db.scalar(select(func.count(Achievement.id))) or 0:
        return
    for item in DEFAULT_ACHIEVEMENTS:
        db.add(Achievement(**item, is_active=True))


def _get_or_create_state(db: Session, operator_id: int, achievement: Achievement) -> OperatorAchievement:
    state = db.scalar(select(OperatorAchievement).where(
        OperatorAchievement.operator_id == operator_id,
        OperatorAchievement.achievement_id == achievement.id,
    ))
    if not state:
        state = OperatorAchievement(operator_id=operator_id, achievement_id=achievement.id)
        db.add(state)
        db.flush()
    return state


def _award(
    db: Session,
    operator: Operator,
    achievement: Achievement,
    current_user: User | None,
    progress_value: float | None = None,
) -> OperatorAchievement | None:
    """Отмечает достижение выполненным.

    is_repeatable=True — можно выдавать повторно на каждой неделе/событии,
    где условие выполняется: times_awarded растёт, коины начисляются заново.
    is_repeatable=False — если уже is_completed, повторно НЕ начисляем и не
    трогаем историю (ТЗ 7.4.4/7.6) — просто обновляем progress_value.
    """
    state = _get_or_create_state(db, operator.id, achievement)
    if progress_value is not None:
        state.progress_value = progress_value

    if state.is_completed and not achievement.is_repeatable:
        return None

    state.is_completed = True
    state.times_awarded += 1
    state.completed_at = state.completed_at or now_utc()
    state.last_awarded_at = now_utc()

    if achievement.reward_coins:
        add_transaction(
            db, operator, achievement.reward_coins, "achievement_reward",
            f"Достижение: {achievement.title}",
            created_by=current_user, source_type="achievement", source_id=achievement.id,
        )
    return state


def _update_progress_only(db: Session, operator_id: int, achievement: Achievement, progress_value: float) -> None:
    """Для достижений, где условие ещё не выполнено — просто обновить прогресс,
    чтобы кабинет мог показать «42/1000», не выдавая награду (ТЗ 5.7/7.5)."""
    state = _get_or_create_state(db, operator_id, achievement)
    if not (state.is_completed and not achievement.is_repeatable):
        state.progress_value = progress_value


def _consecutive_no_late_weeks(db: Session, operator_id: int, period_end: date) -> int:
    """Считает подряд идущие (без пропуска недели) записи WeeklyResult с
    lateness_count == 0, начиная с текущей недели и назад."""
    rows = list(db.scalars(
        select(WeeklyResult)
        .where(WeeklyResult.operator_id == operator_id, WeeklyResult.week_end <= period_end)
        .order_by(WeeklyResult.week_end.desc())
    ))
    streak = 0
    expected_end = period_end
    for row in rows:
        if row.week_end != expected_end or row.lateness_count != 0:
            break
        streak += 1
        expected_end = row.week_start - timedelta(days=1)
    return streak


def check_weekly_achievements(db: Session, acc, current_user: User | None = None) -> None:
    """Вызывается из apply_period_accrual для каждого фактически начисленного
    оператора (пропущенные из-за дублей — уже отфильтрованы вызывающей стороной).
    """
    achievements = {
        a.code: a for a in db.scalars(select(Achievement).where(Achievement.is_active.is_(True)))
    }
    operator = acc.operator
    row = acc.weekly_result

    a = achievements.get("top_3_week")
    if a:
        if acc.rank_place and acc.rank_place <= 3:
            _award(db, operator, a, current_user, progress_value=acc.rank_place)
        else:
            _update_progress_only(db, operator.id, a, acc.rank_place or 0)

    a = achievements.get("quality_star")
    if a:
        if row.quality_score >= a.condition_value:
            _award(db, operator, a, current_user, progress_value=row.quality_score)
        else:
            _update_progress_only(db, operator.id, a, row.quality_score)

    a = achievements.get("calls_master")
    if a and "calls" in acc.nomination_wins:
        _award(db, operator, a, current_user, progress_value=row.calls_per_hour_score)

    a = achievements.get("efficiency_top")
    if a and "efficiency" in acc.nomination_wins:
        _award(db, operator, a, current_user, progress_value=row.efficiency_score)

    a = achievements.get("no_late_3_weeks")
    if a:
        streak = _consecutive_no_late_weeks(db, operator.id, row.week_end)
        if streak >= a.condition_value:
            _award(db, operator, a, current_user, progress_value=streak)
        else:
            _update_progress_only(db, operator.id, a, streak)

    a = achievements.get("legend_team")
    if a:
        total = operator.total_earned or 0
        if total >= a.condition_value:
            _award(db, operator, a, current_user, progress_value=total)
        else:
            _update_progress_only(db, operator.id, a, total)


def check_test_score_achievement(db: Session, operator: Operator, score_percent: float, current_user: User | None = None) -> None:
    """Вызывается из tests/service.py::finish_attempt после подсчёта результата."""
    a = db.scalar(select(Achievement).where(Achievement.code == "test_master", Achievement.is_active.is_(True)))
    if not a:
        return
    if score_percent >= a.condition_value:
        _award(db, operator, a, current_user, progress_value=score_percent)
    else:
        _update_progress_only(db, operator.id, a, score_percent)


def grant_manual(db: Session, operator: Operator, achievement: Achievement, current_user: User, comment: str | None = None) -> OperatorAchievement:
    """Ручная выдача бейджа (admin/manager) — единственный способ закрыть
    условия без объективного триггера в данных, например `helper`."""
    state = _award(db, operator, achievement, current_user)
    if state is None:
        state = _get_or_create_state(db, operator.id, achievement)
    return state


def get_operator_achievements_payload(db: Session, operator: Operator) -> dict:
    """Общий формат для GET /achievements/me, /achievements/operator/{id} и
    /cabinet/me (ТЗ 5.7/7.5): полученные достижения отдельно от тех, что
    ещё в процессе, с прогрессом по каждому."""
    achievements = {a.id: a for a in db.scalars(select(Achievement).where(Achievement.is_active.is_(True)))}
    states = list(db.scalars(select(OperatorAchievement).where(OperatorAchievement.operator_id == operator.id)))
    states_by_achievement = {s.achievement_id: s for s in states}

    completed: list[dict] = []
    in_progress: list[dict] = []
    for achievement_id, achievement in achievements.items():
        state = states_by_achievement.get(achievement_id)
        row = {
            "achievement": achievement,
            "progress_value": state.progress_value if state else 0,
            "is_completed": state.is_completed if state else False,
            "times_awarded": state.times_awarded if state else 0,
            "completed_at": state.completed_at if state else None,
            "last_awarded_at": state.last_awarded_at if state else None,
        }
        (completed if row["is_completed"] else in_progress).append(row)
    return {"completed": completed, "in_progress": in_progress}
