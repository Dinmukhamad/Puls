"""
Wheel of WOW — движок правил выдачи токенов (ТЗ разделы 8.3, 8.4, 8.7, 10, 11).

Главный принцип (ТЗ п.21): колесо НЕ пересчитывает аналитику. Оно читает
готовые данные (тесты → факт/результат, PeriodReport → качество/опоздания/
эффективность/рейтинг) и лишь решает, выдать ли токен.

Инварианты:
  * на каждую проверку пишется запись в wheel_rule_evaluation_logs — и при
    выдаче, и при отказе (ТЗ п.8.7, Acceptance #15/#20);
  * дубли невозможны: уникальный индекс uq_wheel_token_source
    (operator, campaign, rule, source_module, source_entity_id) — ТЗ п.9;
  * лимит max_tokens_per_period соблюдается подсчётом ранее выданных токенов
    по правилу в окне периода;
  * токен не создаётся, если оператор неактивен или колесо выключено.

Публичные функции notify_* открывают СВОЮ сессию, коммитят и глотают ошибки —
их вызывают из роутеров ПОСЛЕ основного commit, чтобы сбой колеса никогда не
ломал сохранение теста/отчёта.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.datetime_utils import local_day_bounds_utc, now_utc
from app.database.db import SessionLocal
from app.models.entities import (
    Operator,
    PeriodReport,
    Test,
    TestAttempt,
    WheelCampaign,
    WheelEligibilityRule,
    WheelRuleEvaluationLog,
    WheelTicket,
)

logger = logging.getLogger(__name__)

TICKET_AVAILABLE = "available"
TICKET_CANCELLED = "cancelled"


# ── Настройки колеса ─────────────────────────────────────────────────────────

def get_setting(db: Session, key: str, default: str | None = None) -> str | None:
    from app.models.entities import WheelSetting
    row = db.scalars(select(WheelSetting).where(WheelSetting.key == key)).first()
    return row.value if row else default


def wheel_enabled(db: Session) -> bool:
    return (get_setting(db, "wheel_enabled", "true") or "true").lower() != "false"


# ── Активная кампания ────────────────────────────────────────────────────────

def _active_campaign(db: Session) -> WheelCampaign | None:
    # Дублирует логику wheel.active_campaign без импорта, чтобы избежать цикла.
    from app.core.datetime_utils import now_local
    today = now_local().date()
    for c in db.scalars(
        select(WheelCampaign).where(WheelCampaign.is_active.is_(True)).order_by(WheelCampaign.id.desc())
    ):
        if c.start_date and today < c.start_date:
            continue
        if c.end_date and today > c.end_date:
            continue
        return c
    return None


# ── Сравнение метрики с порогом ──────────────────────────────────────────────

def compare(op: str, value: float, threshold: float, threshold_max: float | None = None) -> bool:
    if op == "gte":
        return value >= threshold
    if op == "lte":
        return value <= threshold
    if op == "eq":
        return value == threshold
    if op == "between":
        hi = threshold_max if threshold_max is not None else threshold
        return threshold <= value <= hi
    if op == "is_true":
        return bool(value)
    return False


# ── Окна периодов для подсчёта лимита токенов ────────────────────────────────

def _period_window_utc(period_type: str, ref: date | None = None) -> tuple:
    """Возвращает (start_utc, end_utc) для подсчёта выданных токенов за период."""
    day_start, day_end = local_day_bounds_utc(ref)
    if period_type == "daily":
        return day_start, day_end
    if period_type == "weekly":
        return day_start - timedelta(days=6), day_end
    if period_type == "monthly":
        return day_start - timedelta(days=29), day_end
    # period / прочее — берём широкое окно (эффективно «без окна»), лимит всё
    # равно доп. страхуется уникальным индексом источника.
    return day_start - timedelta(days=3650), day_end


def _tokens_issued_for_rule(db: Session, operator_id: int, rule: WheelEligibilityRule, ref: date | None) -> int:
    start, end = _period_window_utc(rule.period_type, ref)
    return db.scalar(
        select(func.count(WheelTicket.id)).where(
            WheelTicket.operator_id == operator_id,
            WheelTicket.rule_id == rule.id,
            WheelTicket.status != TICKET_CANCELLED,
            WheelTicket.created_at >= start,
            WheelTicket.created_at <= end,
        )
    ) or 0


# ── Журнал проверок ──────────────────────────────────────────────────────────

def _log(db, *, operator_id, campaign_id, rule, source_module, source_entity_id,
         period_start, period_end, metric_value, is_eligible, reason, created_token_id=None) -> None:
    db.add(WheelRuleEvaluationLog(
        operator_id=operator_id,
        campaign_id=campaign_id,
        rule_id=rule.id if rule else None,
        source_module=source_module or (rule.source_module if rule else ""),
        source_entity_id=source_entity_id,
        period_start=period_start,
        period_end=period_end,
        metric_value=metric_value,
        operator=rule.operator if rule else "",
        threshold_value=rule.threshold_value if rule else None,
        is_eligible=is_eligible,
        reason=reason,
        created_token_id=created_token_id,
    ))


# ── Создание токена с проверкой всех ограничений ─────────────────────────────

def create_spin_token_if_allowed(
    db: Session,
    *,
    operator: Operator,
    campaign: WheelCampaign,
    rule: WheelEligibilityRule,
    source_entity_id: int | None,
    metric_value: float,
    period_start: date | None = None,
    period_end: date | None = None,
    reason_ok: str | None = None,
) -> WheelTicket | None:
    """
    Возвращает выданный токен или None. Всегда пишет строку в журнал проверок.
    Не коммитит — это делает вызывающий (notify_* или тест).
    """
    ref = period_end or (now_utc().date())

    # 1. Колесо включено?
    if not wheel_enabled(db):
        _log(db, operator_id=operator.id, campaign_id=campaign.id, rule=rule,
             source_module=rule.source_module, source_entity_id=source_entity_id,
             period_start=period_start, period_end=period_end, metric_value=metric_value,
             is_eligible=False, reason="Колесо выключено настройкой wheel_enabled")
        return None

    # 2. Оператор активен и участвует?
    if not _operator_eligible(operator):
        _log(db, operator_id=operator.id, campaign_id=campaign.id, rule=rule,
             source_module=rule.source_module, source_entity_id=source_entity_id,
             period_start=period_start, period_end=period_end, metric_value=metric_value,
             is_eligible=False, reason="Оператор неактивен / не участвует в геймификации")
        return None

    # 3. Лимит токенов за период по этому правилу
    if rule.max_tokens_per_period and _tokens_issued_for_rule(db, operator.id, rule, ref) >= rule.max_tokens_per_period:
        _log(db, operator_id=operator.id, campaign_id=campaign.id, rule=rule,
             source_module=rule.source_module, source_entity_id=source_entity_id,
             period_start=period_start, period_end=period_end, metric_value=metric_value,
             is_eligible=False, reason=f"Достигнут лимит {rule.max_tokens_per_period} токен(ов) за период {rule.period_type}")
        return None

    # 4. Создаём токен. Дубль по источнику отсекается уникальным индексом.
    reason_text = reason_ok or f"{rule.title}"
    ttl_hours = rule.token_ttl_hours or 24
    ticket = WheelTicket(
        operator_id=operator.id,
        campaign_id=campaign.id,
        rule_id=rule.id,
        reason_type=rule.rule_type,
        reason_text=reason_text.strip(),
        source_type=rule.source_module,
        source_id=source_entity_id,
        source_module=rule.source_module,
        source_entity_id=source_entity_id,
        source_period_start=period_start,
        source_period_end=period_end,
        status=TICKET_AVAILABLE,
        expires_at=now_utc() + timedelta(hours=ttl_hours),
    )
    db.add(ticket)
    try:
        db.flush()  # тут сработает уникальный индекс, если токен уже выдавался
    except IntegrityError:
        db.rollback()
        _log(db, operator_id=operator.id, campaign_id=campaign.id, rule=rule,
             source_module=rule.source_module, source_entity_id=source_entity_id,
             period_start=period_start, period_end=period_end, metric_value=metric_value,
             is_eligible=False, reason="Токен за этот источник уже выдавался (дубль отсечён)")
        return None

    _log(db, operator_id=operator.id, campaign_id=campaign.id, rule=rule,
         source_module=rule.source_module, source_entity_id=source_entity_id,
         period_start=period_start, period_end=period_end, metric_value=metric_value,
         is_eligible=True, reason=reason_text.strip(), created_token_id=ticket.id)
    _touch_daily_state(db, operator.id)
    return ticket


def _operator_eligible(operator: Operator) -> bool:
    if not operator or not getattr(operator, "is_active", True):
        return False
    if getattr(operator, "employment_status", "active") not in ("active", None):
        return False
    if getattr(operator, "participation_status", "participating") not in ("participating", None):
        return False
    return True


# ── Дневное состояние (ТЗ 8.8) ───────────────────────────────────────────────

def _touch_daily_state(db: Session, operator_id: int) -> None:
    """Пересчитывает денормализованные счётчики токенов оператора за сегодня."""
    from app.core.datetime_utils import now_local
    from app.models.entities import WheelOperatorDailyState
    today = now_local().date()
    day_start, day_end = local_day_bounds_utc(today)

    def _count(status_):
        return db.scalar(
            select(func.count(WheelTicket.id)).where(
                WheelTicket.operator_id == operator_id,
                WheelTicket.status == status_,
                WheelTicket.created_at >= day_start,
                WheelTicket.created_at <= day_end,
            )
        ) or 0

    state = db.scalars(
        select(WheelOperatorDailyState).where(
            WheelOperatorDailyState.operator_id == operator_id,
            WheelOperatorDailyState.date == today,
        )
    ).first()
    if not state:
        state = WheelOperatorDailyState(operator_id=operator_id, date=today)
        db.add(state)
    state.active_tokens_count = _count(TICKET_AVAILABLE)
    state.used_tokens_count = _count("used")
    state.expired_tokens_count = _count("expired")


# ── Извлечение метрики из источников (ТЗ 4, 10) ──────────────────────────────

def _period_report_values(report: PeriodReport) -> dict:
    base = report.base_hours or 0
    work_hours_percent = (report.total_hours / base * 100) if base else 0
    return {
        "quality_avg": report.quality_avg or 0,
        "quality_score": report.quality_avg or 0,
        "efficiency_percent": report.efficiency_percent or 0,
        "kvz": report.kvz or 0,
        "calls_total": report.calls_total or 0,
        "work_hours_percent": work_hours_percent,
        "late_minutes": report.penalty_minutes or 0,
        "violations_count": report.penalty_points or 0,
        "final_points": report.final_points or 0,
        "total_score": report.final_points or 0,
    }


def _resolve_metric(values: dict, rule: WheelEligibilityRule) -> float | None:
    key = rule.metric_key or rule.rule_type
    if key in values:
        return float(values[key])
    return None


# ── Хуки (ТЗ раздел 11) ──────────────────────────────────────────────────────

def evaluate_after_test_attempt(db: Session, test_attempt_id: int) -> list[WheelTicket]:
    """ТЗ 11.1 — вызывать после сохранения результата теста."""
    attempt = db.get(TestAttempt, test_attempt_id)
    if not attempt or attempt.status != "finished":
        return []
    operator = db.get(Operator, attempt.operator_id)
    test = db.get(Test, attempt.test_id)
    if not operator or not test:
        return []
    campaign = _active_campaign(db)
    if not campaign:
        return []

    issued: list[WheelTicket] = []
    rules = db.scalars(
        select(WheelEligibilityRule).where(
            WheelEligibilityRule.campaign_id == campaign.id,
            WheelEligibilityRule.source_module == "tests",
            WheelEligibilityRule.is_active.is_(True),
        ).order_by(WheelEligibilityRule.priority.desc())
    ).all()

    for rule in rules:
        if rule.rule_type == "simulation_passed":
            # В текущей модели данных тест не различает «симуляцию» (нет
            # категории). Правило понимается движком, но источника нет —
            # честно фиксируем это в журнале, не выдумывая подсистему.
            _log(db, operator_id=operator.id, campaign_id=campaign.id, rule=rule,
                 source_module="tests", source_entity_id=attempt.id,
                 period_start=None, period_end=None, metric_value=None,
                 is_eligible=False, reason="Источник данных для симуляций не настроен в системе")
            continue

        if rule.rule_type == "test_passed":
            metric = 1.0 if attempt.score_percent >= (test.passing_percent or 0) else 0.0
            ok = compare("is_true", metric, 0)
        else:  # test_score (и производные по метрике score_percent)
            metric = float(attempt.score_percent or 0)
            ok = compare(rule.operator, metric, rule.threshold_value, rule.threshold_value_max)

        if not ok:
            _log(db, operator_id=operator.id, campaign_id=campaign.id, rule=rule,
                 source_module="tests", source_entity_id=attempt.id,
                 period_start=None, period_end=None, metric_value=metric,
                 is_eligible=False, reason=f"Условие не выполнено ({metric})")
            continue

        ticket = create_spin_token_if_allowed(
            db, operator=operator, campaign=campaign, rule=rule,
            source_entity_id=attempt.id, metric_value=metric,
            reason_ok=f"{rule.title}: тест пройден на {int(metric)}%" if rule.rule_type != "test_passed" else f"{rule.title}: тест пройден",
        )
        if ticket:
            issued.append(ticket)
    return issued


def evaluate_after_period_report(db: Session, period_report_id: int) -> list[WheelTicket]:
    """ТЗ 11.2 — вызывать после создания/пересчёта PeriodReport."""
    report = db.get(PeriodReport, period_report_id)
    if not report:
        return []
    operator = db.get(Operator, report.operator_id)
    if not operator:
        return []
    campaign = _active_campaign(db)
    if not campaign:
        return []

    values = _period_report_values(report)
    issued: list[WheelTicket] = []
    rules = db.scalars(
        select(WheelEligibilityRule).where(
            WheelEligibilityRule.campaign_id == campaign.id,
            WheelEligibilityRule.source_module.in_(("analytics", "period_reports", "rating")),
            WheelEligibilityRule.is_active.is_(True),
        ).order_by(WheelEligibilityRule.priority.desc())
    ).all()

    for rule in rules:
        metric = _resolve_metric(values, rule)
        if metric is None:
            _log(db, operator_id=operator.id, campaign_id=campaign.id, rule=rule,
                 source_module=rule.source_module, source_entity_id=report.id,
                 period_start=report.period_start, period_end=report.period_end,
                 metric_value=None, is_eligible=False,
                 reason=f"Метрика '{rule.metric_key or rule.rule_type}' недоступна в PeriodReport")
            continue

        ok = compare(rule.operator, metric, rule.threshold_value, rule.threshold_value_max)
        if not ok:
            _log(db, operator_id=operator.id, campaign_id=campaign.id, rule=rule,
                 source_module=rule.source_module, source_entity_id=report.id,
                 period_start=report.period_start, period_end=report.period_end,
                 metric_value=metric, is_eligible=False,
                 reason=f"Условие не выполнено ({round(metric, 2)})")
            continue

        ticket = create_spin_token_if_allowed(
            db, operator=operator, campaign=campaign, rule=rule,
            source_entity_id=report.id, metric_value=metric,
            period_start=report.period_start, period_end=report.period_end,
            reason_ok=f"{rule.title} ({round(metric, 2)})",
        )
        if ticket:
            issued.append(ticket)
    return issued


def evaluate_after_mission_completed(db: Session, mission_progress_id: int) -> list[WheelTicket]:
    """
    ТЗ 11.3 — вызывать после выполнения миссии.
    В текущей модели данных модуля миссий нет; метод сохранён по контракту ТЗ и
    безопасно ничего не делает, пока сущность миссий не появится.
    """
    logger.info("evaluate_after_mission_completed: модуль миссий не реализован (mission_progress_id=%s)", mission_progress_id)
    return []


def evaluate_for_operator(db: Session, operator_id: int, campaign_id: int | None = None,
                          period_start: date | None = None, period_end: date | None = None) -> list[WheelTicket]:
    """
    ТЗ 10 — сводная проверка по последнему PeriodReport оператора. Полезна для
    ручного «пересчитать правила» из админки.
    """
    stmt = select(PeriodReport).where(PeriodReport.operator_id == operator_id)
    if period_start:
        stmt = stmt.where(PeriodReport.period_start == period_start)
    if period_end:
        stmt = stmt.where(PeriodReport.period_end == period_end)
    report = db.scalars(stmt.order_by(PeriodReport.created_at.desc(), PeriodReport.id.desc())).first()
    if not report:
        return []
    return evaluate_after_period_report(db, report.id)


# ── Обёртки для роутеров: своя сессия + commit + подавление ошибок ───────────

def notify_test_attempt_finished(test_attempt_id: int) -> None:
    _run_isolated(lambda db: evaluate_after_test_attempt(db, test_attempt_id),
                  f"test_attempt_id={test_attempt_id}")


def notify_period_report_saved(period_report_id: int) -> None:
    _run_isolated(lambda db: evaluate_after_period_report(db, period_report_id),
                  f"period_report_id={period_report_id}")


def _run_isolated(fn, ctx: str) -> None:
    db = SessionLocal()
    try:
        fn(db)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Wheel eligibility hook упал (%s) — сохранение основного объекта не затронуто", ctx)
    finally:
        db.close()
