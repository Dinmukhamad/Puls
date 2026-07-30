from __future__ import annotations

from app.modules.analytics.calculators import (
    OperatorAnalyticsRow,
    classify_risk,
    compute_management_dashboard,
)
from app.modules.reports.period_calculator import OperatorPeriodMetrics


def _row(
    name: str,
    group: str,
    *,
    quality: float = 90,
    kvz: float = 12,
    efficiency: float = 60,
    penalty_minutes: float = 0,
    final_points: float = 100,
    with_data: bool = True,
) -> OperatorAnalyticsRow:
    metrics = OperatorPeriodMetrics(
        full_name=name,
        name_key=name.lower(),
        quality_avg=quality,
        quality_calls_count=5 if with_data else 0,
        total_hours=8 if with_data else 0,
        base_hours=8 if with_data else 0,
        calls_total=kvz * 8 if with_data else 0,
        kvz=kvz if with_data else 0,
        call_time_hours=efficiency / 100 * 8 if with_data else 0,
        efficiency_percent=efficiency if with_data else 0,
        penalty_minutes=penalty_minutes if with_data else 0,
        penalty_sum=penalty_minutes * 50 if with_data else 0,
        final_points=final_points if with_data else 0,
        has_any_period_data=with_data,
    )
    return OperatorAnalyticsRow(
        full_name=name,
        name_key=name.lower(),
        group_name=group,
        metrics=metrics,
        risk_status=classify_risk(metrics),
    )


def test_management_dashboard_prioritizes_critical_operators():
    dashboard = compute_management_dashboard([
        _row("Stable", "North", final_points=140),
        _row("Critical", "South", quality=60, kvz=6, efficiency=35, penalty_minutes=25),
    ])

    priority = dashboard["priority_operators"][0]
    assert priority["full_name"] == "Critical"
    assert priority["status"] == "critical"
    assert {issue["metric"] for issue in priority["issues"]} >= {"quality", "kvz", "efficiency", "penalty"}
    assert dashboard["team_health"]["status"] == "watch"
    assert dashboard["risk_distribution"] == {
        "stable": 1,
        "watch": 0,
        "critical": 1,
        "no_data": 0,
    }


def test_management_dashboard_surfaces_missing_data_and_group_coverage():
    dashboard = compute_management_dashboard([
        _row("Measured", "Alpha"),
        _row("Missing", "Alpha", with_data=False),
    ])

    missing = next(item for item in dashboard["priority_operators"] if item["full_name"] == "Missing")
    group = dashboard["groups"][0]
    assert missing["status"] == "no_data"
    assert missing["issues"][0]["metric"] == "data"
    assert group["coverage_percent"] == 50
    assert dashboard["team_health"]["data_coverage_percent"] == 50
    assert dashboard["team_health"]["quality_coverage_percent"] == 50
    # Context bar (ТЗ §2): готовый X из Y, без пересчёта на фронте.
    assert dashboard["team_health"]["operators_with_data"] == 1
    assert dashboard["team_health"]["operators_count"] == 2


def test_management_dashboard_orders_weak_groups_and_period_leaders():
    dashboard = compute_management_dashboard([
        _row("Leader", "Strong", final_points=180),
        _row("Second", "Strong", final_points=120),
        _row("Lagging", "Weak", quality=72, kvz=8.5, efficiency=42, final_points=40),
    ])

    assert dashboard["groups"][0]["group_name"] == "Weak"
    assert dashboard["groups"][0]["status"] == "watch"
    assert dashboard["top_performers"][0]["full_name"] == "Leader"
    assert dashboard["metric_cards"][0]["key"] == "quality"
