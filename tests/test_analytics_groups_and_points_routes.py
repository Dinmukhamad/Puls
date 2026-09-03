"""Маршруты /analytics/groups-comparison и /analytics/points.

Оба были удалены коммитом bea87ed вместе с ещё восемнадцатью: экран
руководителя тогда собрали в один /dashboard вместо тринадцати блоков и
полутора десятков запросов. Расчёты при этом остались:
compute_groups_comparison продолжал вызываться внутри /dashboard, а
compute_points_analysis не вызывался вообще — до него не дотягивался ни
один маршрут.

Здесь проверяются не коды ответа, а свойства расчёта, ради которых эти
маршруты и нужны:
  · среднее качество группы взвешено по числу оценённых звонков — иначе
    оператор с одной оценкой весит столько же, сколько оператор с девятью;
  · ranking_reliable снимается на группе меньше трёх человек;
  · отсутствие данных приходит как null, а не как ноль;
  · подушевая дельта к прошлому периоду есть только здесь: /dashboard
    считает изменение только на уровне общих показателей.
"""
from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import delete, func, select

from app.modules.analytics.cache import cache_clear_all
from tests.conftest import make_operator
from tests.test_coin_rules_and_group_scope import _login, _make_role_user

# Период вынесен далеко в будущее, чтобы не пересекаться с данными других
# тестов: кеш аналитики общий, а выборка идёт по диапазону дат.
PERIOD = {"start_date": "2037-03-01", "end_date": "2037-03-31"}
PREV = {"start_date": "2037-01-29", "end_date": "2037-02-28"}


@pytest.fixture(autouse=True)
def _cleanup(db_session):
    from app.models import entities as m

    baseline = db_session.scalar(select(func.max(m.Operator.id))) or 0
    cache_clear_all()
    yield
    ids = list(db_session.scalars(select(m.Operator.id).where(m.Operator.id > baseline)))
    if ids:
        db_session.execute(delete(m.PeriodReport).where(m.PeriodReport.operator_id.in_(ids)))
        db_session.execute(delete(m.Operator).where(m.Operator.id.in_(ids)))
        db_session.commit()
    cache_clear_all()


def _report(db, operator, *, start: str, end: str, quality: float, quality_calls: int,
            calls: float = 100.0, base_hours: float = 40.0, final: float = 50.0,
            call_time: float = 20.0, penalty: float = 0.0):
    from app.models import entities as m

    db.add(m.PeriodReport(
        operator_id=operator.id,
        period_start=date.fromisoformat(start),
        period_end=date.fromisoformat(end),
        quality_avg=quality,
        quality_calls_count=quality_calls,
        total_hours=base_hours,
        base_hours=base_hours,
        calls_total=calls,
        kvz=calls / base_hours if base_hours else 0,
        call_time_hours=call_time,
        efficiency_percent=call_time / base_hours * 100 if base_hours else 0,
        penalty_sum=penalty,
        penalty_minutes=penalty / 50 if penalty else 0,
        penalty_points=penalty / 50 if penalty else 0,
        final_points=final,
    ))
    db.commit()
    cache_clear_all()


def _group(db, operator, name: str):
    operator.group_name = name
    db.commit()
    cache_clear_all()


# ── Сравнение групп ──────────────────────────────────────────────────────

@pytest.mark.parametrize("endpoint", ["/api/analytics/groups-comparison", "/api/analytics/points"])
def test_route_is_reachable(client, endpoint):
    """Маршрут доходит до сервиса, а не отбивается как несуществующий.

    По одному коду ответа этого не понять: без загруженных отчётов аналитика
    тоже отвечает 404. Различает их текст — «Нет загруженных данных» против
    «API endpoint not found».
    """
    response = client.get(endpoint, params=PERIOD)
    assert response.status_code != 405, "маршрут зарегистрирован не на GET"
    if response.status_code == 404:
        assert "endpoint not found" not in response.text, f"{endpoint} не проложен"


def test_group_quality_is_weighted_by_assessed_calls(client, db_session):
    """Среднее качество группы взвешено по числу оценённых звонков.

    Наивное среднее из 100 и 50 дало бы 75. Взвешенное по одной и девяти
    оценкам даёт (100*1 + 50*9) / 10 = 55. Разница принципиальная: иначе
    один случайно оценённый звонок перевешивал бы девять реальных.
    """
    few = make_operator(db_session, full_name="Вес Мало")
    many = make_operator(db_session, full_name="Вес Много")
    for op in (few, many):
        _group(db_session, op, "Группа веса")
    _report(db_session, few, start=PERIOD["start_date"], end=PERIOD["end_date"],
            quality=100.0, quality_calls=1)
    _report(db_session, many, start=PERIOD["start_date"], end=PERIOD["end_date"],
            quality=50.0, quality_calls=9)

    response = client.get("/api/analytics/groups-comparison", params=PERIOD)
    assert response.status_code == 200, response.text
    item = next(x for x in response.json()["items"] if x["group_name"] == "Группа веса")

    assert item["avg_quality"] == pytest.approx(55.0), (
        f"качество {item['avg_quality']}: похоже на наивное среднее вместо взвешенного"
    )
    assert item["operators_count"] == 2


def test_small_group_is_marked_unreliable_for_ranking(client, db_session):
    """Группа меньше трёх человек помечается как ненадёжная для ранжирования."""
    small = [make_operator(db_session, full_name=f"Малая {i}") for i in range(2)]
    for op in small:
        _group(db_session, op, "Малая группа")
        _report(db_session, op, start=PERIOD["start_date"], end=PERIOD["end_date"],
                quality=80.0, quality_calls=5)

    items = client.get("/api/analytics/groups-comparison", params=PERIOD).json()["items"]
    assert next(x for x in items if x["group_name"] == "Малая группа")["ranking_reliable"] is False

    third = make_operator(db_session, full_name="Малая 3")
    _group(db_session, third, "Малая группа")
    _report(db_session, third, start=PERIOD["start_date"], end=PERIOD["end_date"],
            quality=80.0, quality_calls=5)

    items = client.get("/api/analytics/groups-comparison", params=PERIOD).json()["items"]
    assert next(x for x in items if x["group_name"] == "Малая группа")["ranking_reliable"] is True


def test_group_without_quality_reports_null_not_zero(client, db_session):
    """Группа без оценок качества отдаёт null, а не ноль.

    Ноль означал бы «оценили и поставили ноль» — это разные вещи, и
    Definition of Done требует их различать.
    """
    op = make_operator(db_session, full_name="Без оценок")
    _group(db_session, op, "Группа без качества")
    _report(db_session, op, start=PERIOD["start_date"], end=PERIOD["end_date"],
            quality=0.0, quality_calls=0, calls=10.0)

    items = client.get("/api/analytics/groups-comparison", params=PERIOD).json()["items"]
    item = next(x for x in items if x["group_name"] == "Группа без качества")
    assert item["avg_quality"] is None, "отсутствие оценок выдано за ноль"
    assert item["operators_no_quality"] == 1


# ── Разбор баллов ────────────────────────────────────────────────────────

def test_points_reports_delta_against_previous_period(client, db_session):
    """Подушевая дельта к прошлому периоду — то, чего нет больше нигде.

    /dashboard считает изменение только на уровне общих показателей, а
    вопрос «почему у этого человека изменился счёт» закрывает только этот
    расчёт.
    """
    op = make_operator(db_session, full_name="Дельта Оператор")
    _report(db_session, op, start=PREV["start_date"], end=PREV["end_date"],
            quality=70.0, quality_calls=10, final=40.0)
    _report(db_session, op, start=PERIOD["start_date"], end=PERIOD["end_date"],
            quality=90.0, quality_calls=10, final=60.0)

    response = client.get("/api/analytics/points", params={**PERIOD, "operator_query": "Дельта"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) >= {"summary", "operators", "top_growth", "top_decline"}

    row = next(x for x in body["operators"] if "Дельта" in x["full_name"])
    assert row["previous_final_points"] == pytest.approx(40.0)
    assert row["delta_final_points"] == pytest.approx(20.0)
    assert row["delta_quality"] == pytest.approx(20.0)
    assert body["summary"]["has_previous_period"] is True


def test_points_missing_metrics_are_null_not_zero(client, db_session):
    """Без оценок и без базовых часов качество, КВЗ и эффективность — null."""
    op = make_operator(db_session, full_name="Пустой Оператор")
    _report(db_session, op, start=PERIOD["start_date"], end=PERIOD["end_date"],
            quality=0.0, quality_calls=0, calls=5.0, base_hours=0.0, call_time=0.0)

    body = client.get("/api/analytics/points", params={**PERIOD, "operator_query": "Пустой"}).json()
    row = next(x for x in body["operators"] if "Пустой" in x["full_name"])
    for field in ("quality", "kvz", "efficiency"):
        assert row[field] is None, f"{field} выдан за ноль вместо отсутствия данных"


# ── Доступ ───────────────────────────────────────────────────────────────

def test_operator_is_denied_on_both_routes(db_session, make_client):
    """Оператору аналитика закрыта и на новых маршрутах тоже.

    Проверка на бэкенде, а не только скрытием пункта меню: маршрут,
    добавленный мимо _require_analytics_access, открыл бы данные всем.
    """
    _user, pwd = _make_role_user(db_session, role="operator")
    op_client = _login(make_client, _user.username, pwd)
    for endpoint in ("/api/analytics/groups-comparison", "/api/analytics/points"):
        response = op_client.get(endpoint, params=PERIOD)
        assert response.status_code == 403, f"{endpoint} -> {response.status_code}, ожидали 403"


@pytest.mark.parametrize("endpoint", ["/api/analytics/groups-comparison", "/api/analytics/points"])
def test_inverted_date_range_is_rejected(client, endpoint):
    response = client.get(endpoint, params={"start_date": "2037-03-31", "end_date": "2037-03-01"})
    assert response.status_code == 400, response.text
