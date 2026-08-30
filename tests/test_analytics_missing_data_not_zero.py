"""Отсутствие данных не должно превращаться в ноль (ТЗ: «не смешивать
отсутствие данных, реальный нулевой результат и ошибку расчёта»).

Golden-тесты индекса «Здоровье команды»: оператор без оценок качества и
оператор с реальным качеством 0 — это разные ситуации, и health_score у них
обязан отличаться. Иначе выборочная оценка качества (её ставят не каждому
и не каждый день) занижает здоровье команды и уводит операторов в «critical»
без единого фактического нарушения.
"""
from __future__ import annotations

from app.modules.analytics.calculators import (
    OperatorAnalyticsRow,
    _operator_health_snapshot,
    compute_management_dashboard,
)
from app.modules.reports.period_calculator import OperatorPeriodMetrics


def _metrics(**overrides) -> OperatorPeriodMetrics:
    """Оператор, отработавший период с хорошими показателями."""
    m = OperatorPeriodMetrics(full_name="Оператор Тест", name_key="operator test")
    m.quality_avg = 90.0
    m.quality_calls_count = 4
    m.total_hours = 160.0
    m.base_hours = 150.0
    m.calls_total = 1500
    m.kvz = 10.0
    m.call_time_hours = 75.0
    m.efficiency_percent = 50.0
    m.penalty_sum = 0.0
    m.penalty_minutes = 0.0
    m.penalty_points = 0.0
    m.final_points = 150.0
    m.has_any_period_data = True
    for key, value in overrides.items():
        setattr(m, key, value)
    return m


def _row(metrics: OperatorPeriodMetrics, name: str = "Оператор Тест") -> OperatorAnalyticsRow:
    return OperatorAnalyticsRow(
        full_name=name,
        name_key=name.lower(),
        operator_id=1,
        group_id=1,
        group_name="Группа 1",
        participation_status="participating",
        metrics=metrics,
    )


def test_missing_quality_is_not_scored_as_zero_quality():
    """Нет оценок качества ≠ качество 0."""
    no_quality = _operator_health_snapshot(_row(_metrics(quality_avg=0.0, quality_calls_count=0)))
    real_zero = _operator_health_snapshot(_row(_metrics(quality_avg=0.0, quality_calls_count=4)))

    assert no_quality["health_score"] > real_zero["health_score"], (
        "оператор без оценок качества получил такой же (или худший) балл здоровья, "
        "как оператор с реально нулевым качеством"
    )
    # Отсутствие данных отражается честно — отдельной severity, а не нулём.
    assert any(i["metric"] == "quality" and i["severity"] == "no_data" for i in no_quality["issues"])


def test_health_score_ignores_unmeasured_components():
    """Компонент без данных исключается из среднего, а не занижает его нулём."""
    full = _operator_health_snapshot(_row(_metrics()))
    without_quality = _operator_health_snapshot(
        _row(_metrics(quality_avg=0.0, quality_calls_count=0))
    )
    # Остальные компоненты у обоих на целевом уровне → здоровье не должно просесть.
    assert without_quality["health_score"] == full["health_score"]


def test_health_snapshot_reports_its_own_basis():
    """Пользователь должен понимать, из чего собран индекс."""
    snapshot = _operator_health_snapshot(_row(_metrics(quality_avg=0.0, quality_calls_count=0)))
    assert "health_components" in snapshot
    measured = {c["metric"] for c in snapshot["health_components"] if c["measured"]}
    unmeasured = {c["metric"] for c in snapshot["health_components"] if not c["measured"]}
    assert "quality" in unmeasured
    assert {"kvz", "efficiency", "penalty"} <= measured


def test_missing_base_hours_does_not_zero_kvz_and_efficiency():
    """Нет базы часов → КВЗ и эффективность неизвестны, а не равны нулю."""
    m = _metrics(base_hours=0.0, kvz=0.0, efficiency_percent=0.0)
    snapshot = _operator_health_snapshot(_row(m))
    unmeasured = {c["metric"] for c in snapshot["health_components"] if not c["measured"]}
    assert {"kvz", "efficiency"} <= unmeasured


def test_team_health_not_dragged_down_by_unmeasured_quality():
    """Команда без выборочных оценок качества не должна выглядеть «критической»."""
    rows = [
        _row(_metrics(quality_avg=0.0, quality_calls_count=0), name=f"Оператор {i}")
        for i in range(5)
    ]
    result = compute_management_dashboard(rows)
    assert result["team_health"]["score"] >= 85
    assert result["team_health"]["status"] != "critical"
    # При этом факт неполноты данных остаётся видимым.
    assert result["team_health"]["quality_coverage_percent"] == 0


def test_team_health_still_reacts_to_real_bad_numbers():
    """Регрессия в обратную сторону: реальные плохие метрики по-прежнему критичны."""
    rows = [
        _row(
            _metrics(quality_avg=40.0, kvz=2.0, efficiency_percent=10.0,
                     penalty_minutes=60.0, penalty_points=300.0),
            name=f"Оператор {i}",
        )
        for i in range(5)
    ]
    result = compute_management_dashboard(rows)
    assert result["team_health"]["status"] == "critical"
    assert result["team_health"]["score"] < 70
