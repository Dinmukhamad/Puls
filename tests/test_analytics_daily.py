from __future__ import annotations

import uuid
from datetime import date, timedelta


def _group(db, prefix):
    from app.models import entities as m

    g = m.Group(name=f"{prefix}-{uuid.uuid4().hex[:8]}", status="active")
    db.add(g)
    db.flush()
    return g


def _operator(db, name, group_id):
    from app.models import entities as m

    op = m.Operator(
        full_name=name, group_name="", group_id=group_id,
        participation_status="participating", employment_status="active",
        is_active=True, current_balance=0,
    )
    db.add(op)
    db.flush()
    return op


def _metric(db, op, day, **kw):
    from app.models import entities as m

    row = m.OperatorDailyMetric(
        operator_id=op.id, operator_name=op.full_name, group_id=op.group_id,
        metric_date=day,
        calls_count=kw.get("calls", 0), quality_sum=kw.get("quality_sum", 0),
        quality_count=kw.get("quality_count", 0), base_hours=kw.get("base_hours", 0),
        efficiency=kw.get("efficiency", 0), penalty_minutes=kw.get("penalty", 0),
        worked_hours=kw.get("worked", 0),
    )
    db.add(row)
    db.flush()
    return row


def _seed(db):
    """Изолированный посев: уникальные группы, свои операторы, день 1 с данными."""
    d1 = date(2026, 7, 1)
    g1 = _group(db, "Гр-A")
    g2 = _group(db, "Гр-B")
    op1 = _operator(db, "Алиса", g1.id)
    op2 = _operator(db, "Борис", g1.id)
    op3 = _operator(db, "Виктор", g2.id)
    _metric(db, op1, d1, calls=10, quality_sum=170, quality_count=2, base_hours=1, efficiency=0.5, worked=1)
    _metric(db, op2, d1, calls=5, quality_sum=80, quality_count=1, base_hours=1, efficiency=0.25, worked=1)
    _metric(db, op3, d1, calls=100, quality_sum=50, quality_count=1, base_hours=2, worked=2)
    # день 2 намеренно пропущен (разрыв)
    db.commit()
    return d1, g1, g2, op1


def test_daily_dynamics_sums_not_average_of_averages(db_session):
    """AC-16: kvz/quality по суммам; AC-17: пропущенный день — разрыв."""
    from app.modules.analytics import service
    from app.modules.analytics.schemas import DailyDynamicsResponse

    d1, g1, _g2, _op1 = _seed(db_session)
    d2 = d1 + timedelta(days=1)

    resp = service.daily_dynamics(db_session, d1, d2, "quality", group_id=g1.id)
    DailyDynamicsResponse(**resp)

    assert resp["data_source"] == "operator_daily_metrics"
    assert resp["scope"]["kind"] == "group" and resp["scope"]["group_id"] == g1.id
    assert resp["operators_with_data"] == 2

    by_date = {i["date"]: i for i in resp["items"]}
    day1 = by_date[str(d1)]
    assert day1["has_data"] is True
    assert round(day1["quality"], 2) == 83.33   # (170+80)/(2+1), НЕ (85+80)/2
    assert day1["kvz"] == 7.5                    # (10+5)/(1+1)
    assert day1["calls"] == 15
    day2 = by_date[str(d2)]
    assert day2["has_data"] is False and day2["value"] is None
    assert str(d2) in resp["missing_dates"] and str(d1) in resp["covered_dates"]


def test_daily_dynamics_scope_isolates_group(db_session):
    """AC-15: один scope для всех метрик; другая группа не подмешивается."""
    from app.modules.analytics import service

    d1, _g1, g2, _op1 = _seed(db_session)
    resp = service.daily_dynamics(db_session, d1, d1, "calls", group_id=g2.id)
    assert resp["items"][0]["calls"] == 100
    assert resp["operators_with_data"] == 1


def test_daily_dynamics_empty_period_is_not_failure(db_session):
    """AC-14/AC-18: без Excel не падает; нет данных ≠ красный ноль."""
    from app.modules.analytics import service

    far = date(2000, 1, 1)
    resp = service.daily_dynamics(db_session, far, far + timedelta(days=2), "quality", group_id=None)
    assert resp["empty_reason"] is not None
    assert all(i["has_data"] is False and i["value"] is None for i in resp["items"])
    assert resp["data_source"] == "operator_daily_metrics"


def test_daily_grid_cells_have_value_and_count(db_session):
    """AC-13: недельная сетка качества — значение + число оценок."""
    from app.modules.analytics import service
    from app.modules.analytics.schemas import DailyGridResponse

    d1, g1, _g2, op1 = _seed(db_session)
    resp = service.daily_grid(db_session, d1, "quality", group_id=g1.id)
    DailyGridResponse(**resp)

    assert resp["week_start"] == str(d1)
    assert len(resp["dates"]) == 7
    assert resp["legend"]["target"] == 85.0
    op_alisa = next(o for o in resp["operators"] if o["operator_id"] == op1.id)
    cell = op_alisa["values"][str(d1)]
    assert cell["value"] == 85.0 and cell["count"] == 2
    assert str(d1 + timedelta(days=1)) not in op_alisa["values"]  # разрыв


def test_heatmap_is_db_backed_same_shape(db_session):
    """AC-14: heatmap из БД (без Excel), совместимый формат."""
    from app.modules.analytics import service

    d1, g1, _g2, _op1 = _seed(db_session)
    resp = service.heatmap(db_session, d1, d1, "quality", group_id=g1.id)
    assert set(resp.keys()) == {"dates", "operators", "metric"}
    assert resp["dates"] == [str(d1)]
    names = {o["full_name"] for o in resp["operators"]}
    assert names == {"Алиса", "Борис"}
    alisa = next(o for o in resp["operators"] if o["full_name"] == "Алиса")
    assert alisa["values"][str(d1)] == 85.0
