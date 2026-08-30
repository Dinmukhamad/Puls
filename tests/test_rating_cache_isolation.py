"""Кеш рейтинга не должен переносить состояние одного запроса в другой.

rating_rows() кеширует список словарей на 60 секунд, а вызывающие его
эндпоинты дописывают в эти же словари признаки конкретного запроса
(is_current_user в /rating, служебный _local_rank в «Гонке баллов»).
Если кеш отдаёт сами объекты, пометка «это вы» переживает запрос и
попадает следующему пользователю, а внутренние ключи утекают в ответ API.
"""
from __future__ import annotations

from app.modules.rating.service import rating_cache_invalidate, rating_rows


def _seed_two_rated_operators(db):
    from datetime import date

    from app.models import entities as m
    from tests.conftest import make_operator

    op_a = make_operator(db, full_name="Рейтинг Первый")
    op_b = make_operator(db, full_name="Рейтинг Второй")
    for op, points in ((op_a, 150.0), (op_b, 120.0)):
        db.add(m.PeriodReport(
            operator_id=op.id,
            period_start=date(2026, 6, 1),
            period_end=date(2026, 6, 30),
            quality_avg=90.0,
            quality_calls_count=5,
            total_hours=160.0,
            base_hours=150.0,
            calls_total=1500,
            kvz=10.0,
            call_time_hours=75.0,
            efficiency_percent=50.0,
            final_points=points,
            coins_awarded=10,
        ))
    db.commit()
    rating_cache_invalidate()
    return op_a, op_b


def test_marking_current_user_does_not_leak_into_next_request(db_session):
    """Пометка «это вы» одного оператора не должна остаться в кеше для другого."""
    from app.modules.rating.service import rating_overview

    op_a, op_b = _seed_two_rated_operators(db_session)

    first = rating_overview(db_session, op_a, None, None)
    marked_for_a = {r["operator_id"] for r in first["items"] if r.get("is_current_user")}
    assert marked_for_a == {op_a.id}

    # Второй пользователь читает рейтинг из того же кеша.
    second = rating_overview(db_session, op_b, None, None)
    marked_for_b = {r["operator_id"] for r in second["items"] if r.get("is_current_user")}
    assert marked_for_b == {op_b.id}

    # И первый ответ не должен задним числом «переехать» на второго оператора.
    still_marked_for_a = {r["operator_id"] for r in first["items"] if r.get("is_current_user")}
    assert still_marked_for_a == {op_a.id}, (
        "ответ, уже отданный первому пользователю, изменился после запроса второго — "
        "кеш рейтинга отдаёт общие изменяемые объекты"
    )


def test_race_view_does_not_pollute_cached_rows(db_session):
    """Служебные ключи «Гонки баллов» не должны попадать в кешированные строки."""
    from app.modules.rating.service import race

    op_a, _op_b = _seed_two_rated_operators(db_session)

    race(db_session, op_a, None, "all")
    rows = rating_rows(db_session)

    leaked = [key for row in rows for key in row if key.startswith("_")]
    assert not leaked, f"внутренние ключи утекли в кеш рейтинга: {sorted(set(leaked))}"


def test_cached_rows_are_isolated_from_caller_mutation(db_session):
    """Мутация полученного списка не должна портить кеш для следующих читателей."""
    _seed_two_rated_operators(db_session)

    first = rating_rows(db_session)
    first[0]["operator_name"] = "ИСПОРЧЕНО"
    first[0]["injected_key"] = True

    second = rating_rows(db_session)
    assert second[0]["operator_name"] != "ИСПОРЧЕНО"
    assert "injected_key" not in second[0]
