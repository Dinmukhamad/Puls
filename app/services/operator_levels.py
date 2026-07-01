from __future__ import annotations

import json
from datetime import date, datetime
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.entities import (
    Operator,
    OperatorLevel,
    OperatorLevelAssignment,
    OperatorLevelHistory,
    OperatorLevelRule,
    PeriodReport,
    TestAttempt,
    User,
    now_utc,
)


DEFAULT_LEVELS = [
    {
        "code": "trainee",
        "name": "Стажёр",
        "description": "Адаптация и обучение",
        "color": "#64748B",
        "icon": "seedling",
        "sort_order": 10,
        "rules": [("tenure_days", "between", 0, 7)],
    },
    {
        "code": "newbie",
        "name": "Новичок",
        "description": "Первые стабильные результаты на линии",
        "color": "#0EA5E9",
        "icon": "sparkles",
        "sort_order": 20,
        "rules": [
            ("tenure_days", "between", 8, 30),
            ("quality", "gte", 70, None),
            ("penalty_minutes", "lte", None, 20),
        ],
    },
    {
        "code": "operator",
        "name": "Оператор",
        "description": "Основной рабочий уровень",
        "color": "#2563EB",
        "icon": "badge-check",
        "sort_order": 30,
        "rules": [
            ("tenure_days", "gte", 30, None),
            ("quality", "gte", 80, None),
            ("kvz", "gte", 8, None),
            ("efficiency", "gte", 45, None),
            ("penalty_minutes", "lte", None, 10),
        ],
    },
    {
        "code": "pro",
        "name": "Профи",
        "description": "Стабильно сильный оператор",
        "color": "#A855F7",
        "icon": "crown",
        "sort_order": 40,
        "rules": [
            ("tenure_days", "gte", 30, None),
            ("quality", "gte", 90, None),
            ("kvz", "gte", 10, None),
            ("efficiency", "gte", 50, None),
            ("penalty_minutes", "lte", None, 5),
            ("final_points", "gte", 150, None),
        ],
    },
]

METRIC_LABELS = {
    "tenure_days": "Стаж",
    "quality": "Качество",
    "kvz": "КВЗ",
    "efficiency": "Эффективность",
    "penalty_minutes": "Штрафы",
    "final_points": "Итоговые баллы",
    "test_percent": "Результат тестов",
}


def ensure_default_levels(db: Session) -> None:
    if db.scalar(select(func.count(OperatorLevel.id))) or 0:
        return
    for item in DEFAULT_LEVELS:
        level = OperatorLevel(
            code=item["code"],
            name=item["name"],
            description=item["description"],
            color=item["color"],
            icon=item["icon"],
            sort_order=item["sort_order"],
            is_active=True,
        )
        db.add(level)
        db.flush()
        for metric_code, operator, value_min, value_max in item["rules"]:
            db.add(OperatorLevelRule(
                level_id=level.id,
                metric_code=metric_code,
                operator=operator,
                value_min=value_min,
                value_max=value_max,
                is_required=True,
            ))


def level_badge(level: Optional[OperatorLevel]) -> dict:
    if not level:
        return {
            "id": None,
            "code": "trainee",
            "name": "Стажёр",
            "color": "#64748B",
            "icon": "seedling",
            "sort_order": 10,
        }
    return {
        "id": level.id,
        "code": level.code,
        "name": level.name,
        "color": level.color,
        "icon": level.icon,
        "sort_order": level.sort_order,
    }


def _operator_tenure_days(operator: Operator, as_of: Optional[date]) -> int:
    end = as_of or date.today()
    start = operator.start_date or operator.created_at.date()
    return max(0, (end - start).days)


def _period_report(db: Session, operator_id: int, start: Optional[date], end: Optional[date]) -> Optional[PeriodReport]:
    stmt = select(PeriodReport).where(PeriodReport.operator_id == operator_id)
    if start and end:
        stmt = stmt.where(PeriodReport.period_start == start, PeriodReport.period_end == end)
    return db.scalar(stmt.order_by(PeriodReport.period_end.desc(), PeriodReport.created_at.desc()).limit(1))


def _test_percent(db: Session, operator_id: int, start: Optional[date], end: Optional[date]) -> float:
    stmt = select(func.avg(TestAttempt.score_percent)).where(
        TestAttempt.operator_id == operator_id,
        TestAttempt.status == "finished",
    )
    if start:
        stmt = stmt.where(func.date(TestAttempt.finished_at) >= start)
    if end:
        stmt = stmt.where(func.date(TestAttempt.finished_at) <= end)
    value = db.scalar(stmt)
    return round(float(value or 0), 2)


def operator_level_metrics(
    db: Session,
    operator: Operator,
    period_start: Optional[date] = None,
    period_end: Optional[date] = None,
    include_tests: bool = True,
) -> tuple[dict, Optional[PeriodReport]]:
    report = _period_report(db, operator.id, period_start, period_end)
    as_of = period_end or (report.period_end if report else date.today())
    metrics = {
        "tenure_days": _operator_tenure_days(operator, as_of),
        "quality": round(report.quality_avg or 0, 2) if report else 0,
        "kvz": round(report.kvz or 0, 2) if report else 0,
        "efficiency": round(report.efficiency_percent or 0, 2) if report else 0,
        "penalty_minutes": round(report.penalty_minutes or 0, 2) if report else 0,
        "final_points": round(report.final_points or 0, 2) if report else 0,
    }
    if include_tests:
        metrics["test_percent"] = _test_percent(db, operator.id, period_start, period_end)
    return metrics, report


def _rule_ok(rule: OperatorLevelRule, current: Optional[float]) -> bool:
    value = float(current or 0)
    if rule.operator == "gte":
        return rule.value_min is None or value >= rule.value_min
    if rule.operator == "lte":
        return rule.value_max is None or value <= rule.value_max
    if rule.operator == "eq":
        return rule.value_min is not None and value == rule.value_min
    if rule.operator == "between":
        lo_ok = rule.value_min is None or value >= rule.value_min
        hi_ok = rule.value_max is None or value <= rule.value_max
        return lo_ok and hi_ok
    return False


def rule_gap(rule: OperatorLevelRule, metrics: dict) -> dict:
    current = metrics.get(rule.metric_code, 0)
    ok = _rule_ok(rule, current)
    return {
        "metric_code": rule.metric_code,
        "label": METRIC_LABELS.get(rule.metric_code, rule.metric_code),
        "operator": rule.operator,
        "required_min": rule.value_min,
        "required_max": rule.value_max,
        "current": current,
        "ok": ok,
    }


def level_matches(level: OperatorLevel, metrics: dict) -> bool:
    required_rules = [r for r in level.rules if r.is_required]
    return all(_rule_ok(rule, metrics.get(rule.metric_code, 0)) for rule in required_rules)


def active_levels(db: Session) -> list[OperatorLevel]:
    return list(db.scalars(
        select(OperatorLevel)
        .options(selectinload(OperatorLevel.rules))
        .where(OperatorLevel.is_active.is_(True))
        .order_by(OperatorLevel.sort_order.asc(), OperatorLevel.id.asc())
    ))


def calculate_auto_level(
    db: Session,
    operator: Operator,
    period_start: Optional[date] = None,
    period_end: Optional[date] = None,
) -> tuple[Optional[OperatorLevel], dict, Optional[PeriodReport]]:
    levels = active_levels(db)
    metrics, report = operator_level_metrics(db, operator, period_start, period_end)
    for level in sorted(levels, key=lambda lvl: (lvl.sort_order, lvl.id), reverse=True):
        if level_matches(level, metrics):
            return level, metrics, report
    return (levels[0] if levels else None), metrics, report


def _assignment(db: Session, operator_id: int) -> Optional[OperatorLevelAssignment]:
    return db.scalar(select(OperatorLevelAssignment).where(OperatorLevelAssignment.operator_id == operator_id))


def assign_auto_level(
    db: Session,
    operator: Operator,
    actor: Optional[User] = None,
    period_start: Optional[date] = None,
    period_end: Optional[date] = None,
    force: bool = False,
) -> OperatorLevelAssignment:
    current = _assignment(db, operator.id)
    if current and current.is_manual and not force:
        return current

    new_level, metrics, report = calculate_auto_level(db, operator, period_start, period_end)
    if not new_level:
        raise RuntimeError("Operator levels are not configured")

    old_level_id = current.level_id if current else None
    if not current:
        current = OperatorLevelAssignment(operator_id=operator.id, level_id=new_level.id)
        db.add(current)

    current.level_id = new_level.id
    current.assignment_type = "auto"
    current.is_manual = False
    current.manual_reason = None
    current.manual_comment = None
    current.assigned_by = actor.id if actor else None
    current.assigned_at = now_utc()
    current.updated_at = now_utc()
    current.calculated_from = period_start or (report.period_start if report else None)
    current.calculated_to = period_end or (report.period_end if report else None)

    if old_level_id != new_level.id:
        db.add(OperatorLevelHistory(
            operator_id=operator.id,
            old_level_id=old_level_id,
            new_level_id=new_level.id,
            change_type="auto",
            reason="automatic_recalculation",
            comment="Автоматический расчёт уровня",
            changed_by=actor.id if actor else None,
            metadata_json=json.dumps({"metrics": metrics}, ensure_ascii=False),
        ))
    return current


def assign_manual_level(
    db: Session,
    operator: Operator,
    level: OperatorLevel,
    actor: User,
    reason: str,
    comment: str = "",
) -> OperatorLevelAssignment:
    current = _assignment(db, operator.id)
    old_level_id = current.level_id if current else None
    if not current:
        current = OperatorLevelAssignment(operator_id=operator.id, level_id=level.id)
        db.add(current)

    current.level_id = level.id
    current.assignment_type = "manual"
    current.is_manual = True
    current.manual_reason = reason.strip()
    current.manual_comment = (comment or "").strip()
    current.assigned_by = actor.id
    current.assigned_at = now_utc()
    current.updated_at = now_utc()

    db.add(OperatorLevelHistory(
        operator_id=operator.id,
        old_level_id=old_level_id,
        new_level_id=level.id,
        change_type="manual",
        reason=current.manual_reason,
        comment=current.manual_comment,
        changed_by=actor.id,
    ))
    return current


def operator_level_summary(
    db: Session,
    operator: Operator,
    period_start: Optional[date] = None,
    period_end: Optional[date] = None,
) -> dict:
    assignment = _assignment(db, operator.id)
    levels = active_levels(db)
    metrics, report = operator_level_metrics(db, operator, period_start, period_end)

    if assignment and assignment.is_manual:
        level = db.get(OperatorLevel, assignment.level_id)
        assignment_type = "manual"
    else:
        level, metrics, report = calculate_auto_level(db, operator, period_start, period_end)
        assignment_type = "auto"

    if not level and levels:
        level = levels[0]

    higher_levels = [lvl for lvl in levels if level and lvl.sort_order > level.sort_order]
    next_level = higher_levels[0] if higher_levels else None
    gaps = [rule_gap(rule, metrics) for rule in (next_level.rules if next_level else [])]

    return {
        "operator_id": operator.id,
        "assignment_type": assignment_type,
        "is_manual": bool(assignment and assignment.is_manual),
        "level": level_badge(level),
        "next_level": level_badge(next_level) if next_level else None,
        "metrics": metrics,
        "gaps": gaps,
        "calculated_from": (period_start or (report.period_start if report else None)),
        "calculated_to": (period_end or (report.period_end if report else None)),
        "manual_reason": assignment.manual_reason if assignment else None,
        "manual_comment": assignment.manual_comment if assignment else None,
        "assigned_at": assignment.assigned_at if assignment else None,
    }


def operator_level_badge(db: Session, operator: Operator) -> dict:
    return operator_level_summary(db, operator)["level"]


def level_history_rows(db: Session, operator_id: Optional[int] = None, limit: int = 100) -> list[dict]:
    stmt = (
        select(OperatorLevelHistory)
        .order_by(OperatorLevelHistory.changed_at.desc())
        .limit(limit)
    )
    if operator_id:
        stmt = stmt.where(OperatorLevelHistory.operator_id == operator_id)

    rows = []
    for item in db.scalars(stmt):
        operator = db.get(Operator, item.operator_id)
        changed_by = db.get(User, item.changed_by) if item.changed_by else None
        metadata = None
        if item.metadata_json:
            try:
                metadata = json.loads(item.metadata_json)
            except json.JSONDecodeError:
                metadata = None
        rows.append({
            "id": item.id,
            "operator_id": item.operator_id,
            "operator_name": operator.full_name if operator else None,
            "old_level": level_badge(item.old_level) if item.old_level else None,
            "new_level": level_badge(item.new_level) if item.new_level else None,
            "change_type": item.change_type,
            "reason": item.reason,
            "comment": item.comment,
            "changed_by_name": changed_by.full_name if changed_by else "Система",
            "changed_at": item.changed_at,
            "metadata": metadata,
        })
    return rows
