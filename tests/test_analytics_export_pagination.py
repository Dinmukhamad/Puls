from __future__ import annotations

from datetime import date
from io import BytesIO

import pytest
from openpyxl import load_workbook
from sqlalchemy import delete, func, select

from app.modules.analytics.cache import cache_clear_all
from tests.conftest import make_operator


@pytest.fixture(autouse=True)
def _cleanup(db_session):
    from app.models import entities as m

    baseline = db_session.scalar(select(func.max(m.Operator.id))) or 0
    yield
    ids = list(db_session.scalars(select(m.Operator.id).where(m.Operator.id > baseline)))
    if ids:
        db_session.execute(delete(m.PeriodReport).where(m.PeriodReport.operator_id.in_(ids)))
        db_session.execute(delete(m.OperatorDailyMetric).where(m.OperatorDailyMetric.operator_id.in_(ids)))
        db_session.execute(delete(m.Operator).where(m.Operator.id.in_(ids)))
        db_session.commit()
    cache_clear_all()


def _metric(db, operator, calls):
    from app.models import entities as m

    db.add(m.OperatorDailyMetric(
        operator_id=operator.id, operator_name=operator.full_name,
        metric_date=date(2036, 1, 15), calls_count=calls,
        quality_sum=90, quality_count=1, quality_avg=90,
        worked_hours=8, base_hours=8, efficiency=4,
    ))
    db.commit()
    cache_clear_all()


def test_operator_pagination_sorting_and_filtered_xlsx(client, db_session):
    first = make_operator(db_session, full_name="Export Alpha")
    second = make_operator(db_session, full_name="Export Beta")
    _metric(db_session, first, 10)
    _metric(db_session, second, 20)
    params = {
        "start_date": "2036-01-15", "end_date": "2036-01-15",
        "operator_query": "Export", "only_with_data": "true",
        "page": 1, "page_size": 1, "sort_by": "calls_total", "sort_order": "desc",
    }
    response = client.get("/api/analytics/operators", params=params)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 2
    assert payload["items"][0]["calls_total"] == 20

    export = client.get("/api/analytics/export.xlsx", params=params)
    assert export.status_code == 200, export.text
    sheet = load_workbook(BytesIO(export.content)).active
    assert sheet["A8"].value == "Оператор"
    names = {sheet.cell(row=index, column=1).value for index in range(9, sheet.max_row + 1)}
    assert {first.full_name, second.full_name} <= names


def test_management_dashboard_includes_previous_period(client, db_session):
    operator = make_operator(db_session, full_name="Previous metric")
    _metric(db_session, operator, 20)
    response = client.get(
        "/api/analytics/management-dashboard",
        params={"start_date": "2036-01-15", "end_date": "2036-01-15"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["previous_period"] == {"start": "2036-01-14", "end": "2036-01-14"}
    assert "metric_definitions" in payload
