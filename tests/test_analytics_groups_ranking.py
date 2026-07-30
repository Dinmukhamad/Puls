from __future__ import annotations

from app.modules.analytics.calculators import (
    OperatorAnalyticsRow,
    classify_risk,
    compute_groups_comparison,
)
from app.modules.reports.period_calculator import OperatorPeriodMetrics


def _row(name, group, points):
    m = OperatorPeriodMetrics(
        full_name=name, name_key=name.lower(),
        quality_avg=90, quality_calls_count=5,
        total_hours=8, base_hours=8, calls_total=96, kvz=12,
        call_time_hours=4, efficiency_percent=50,
        penalty_minutes=0, penalty_sum=0,
        final_points=points, has_any_period_data=True,
    )
    return OperatorAnalyticsRow(
        full_name=name, name_key=name.lower(), group_name=group,
        metrics=m, risk_status=classify_risk(m),
    )


def test_groups_ranked_by_average_not_sum():
    """ТЗ §5: маленькая сильная группа должна опережать большую слабую.

    Big: 5 операторов по 80 баллов (сумма 400, среднее 80).
    Small: 2 оператора по 120 баллов (сумма 240, среднее 120).
    По сумме победила бы Big — это и был баг. По среднему первой идёт Small.
    """
    rows = (
        [_row(f"B{i}", "Big", 80) for i in range(5)]
        + [_row(f"S{i}", "Small", 120) for i in range(2)]
    )
    out = compute_groups_comparison(rows)

    assert out[0]["group_name"] == "Small"
    assert out[0]["avg_final_points"] == 120
    assert out[1]["group_name"] == "Big"
    assert out[1]["avg_final_points"] == 80
    # сумма по-прежнему доступна как вторичный показатель
    assert out[1]["final_points_sum"] == 400
    # маленькая группа помечена как менее надёжная (мало операторов)
    assert out[0]["ranking_reliable"] is False
    assert out[1]["ranking_reliable"] is True
