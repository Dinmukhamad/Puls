from __future__ import annotations

from datetime import date

from tests.conftest import make_operator


def test_available_periods_include_daily_metrics_without_period_report(client, db_session):
    """Fresh uploads invalidate PeriodReport but analytics stays discoverable."""
    from app.models import entities as m

    operator = make_operator(db_session, full_name="Analytics period operator")
    db_session.add_all([
        m.OperatorDailyMetric(
            operator_id=operator.id,
            operator_name=operator.full_name,
            metric_date=date(2034, 4, 3),
            calls_count=10,
        ),
        m.OperatorDailyMetric(
            operator_id=operator.id,
            operator_name=operator.full_name,
            metric_date=date(2034, 4, 18),
            calls_count=12,
        ),
    ])
    db_session.commit()

    response = client.get("/api/analytics/available-periods")

    assert response.status_code == 200, response.text
    assert {
        "start_date": "2034-04-03",
        "end_date": "2034-04-18",
        "label": "03.04.2034 – 18.04.2034",
    } in response.json()["items"]
