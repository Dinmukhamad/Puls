"""Списочные эндпоинты не должны делать запрос «на каждую строку».

Пока данных мало, N+1 незаметен: он проявляется на проде, где операторов
десятки, а история — тысячи строк. Проверяем не абсолютное число запросов
(оно зависит от набора данных и ленивой инициализации), а его ПРИРОСТ при
добавлении операторов: у списка без N+1 прирост близок к нулю.
"""
from __future__ import annotations

import pytest
from sqlalchemy import event

from app.database.db import engine
from tests.conftest import make_operator

ADDED_OPERATORS = 12


class _QueryCounter:
    def __init__(self) -> None:
        self.count = 0

    def __enter__(self):
        def before(conn, cursor, statement, params, context, executemany):
            self.count += 1

        self._before = before
        event.listen(engine, "before_cursor_execute", before)
        return self

    def __exit__(self, *exc):
        event.remove(engine, "before_cursor_execute", self._before)


def _add_operators_with_accounts(db_session, prefix: str, count: int) -> None:
    from app.core.security import hash_password
    from app.models import entities as m

    for i in range(count):
        op = make_operator(db_session, full_name=f"{prefix} {i:02d}")
        db_session.add(m.User(
            full_name=op.full_name,
            username=f"{prefix.lower().replace(' ', '_')}_{op.id}",
            password_hash=hash_password("BudgetPass123!"),
            role="operator",
            operator_id=op.id,
            is_active=True,
        ))
    db_session.commit()


def _queries_for(client, path: str) -> int:
    client.get(path)  # прогрев: ленивая инициализация не должна считаться
    with _QueryCounter() as counter:
        response = client.get(path)
    assert response.status_code == 200, response.text
    return counter.count


# Допуск на строку: сколько запросов на одного нового оператора считается
# приемлемым. 0 — идеал; небольшой запас оставлен под точечные чтения,
# которые пока не пакетируются. Возврат выброшенных N+1 (аккаунт оператора,
# строки наград, повторный расчёт метрик) даёт 1..6 запросов на строку.
PER_ROW_ALLOWANCE = [
    ("/api/users?limit=200", 0.4),
    ("/api/dashboard/operators", 0.4),
    ("/api/dashboard/admin-summary", 0.4),
]


@pytest.mark.parametrize("path,per_row", PER_ROW_ALLOWANCE,
                         ids=[p.split("?")[0] for p, _ in PER_ROW_ALLOWANCE])
def test_list_endpoint_does_not_query_per_row(client, db_session, path, per_row):
    before = _queries_for(client, path)
    _add_operators_with_accounts(db_session, f"Прирост {path[-8:]}", ADDED_OPERATORS)
    after = _queries_for(client, path)

    growth = after - before
    limit = ADDED_OPERATORS * per_row
    assert growth <= limit, (
        f"{path}: +{ADDED_OPERATORS} операторов дали +{growth} SQL-запросов "
        f"({before} → {after}, допуск {limit:.0f}) — похоже, вернулся N+1"
    )


def test_operators_list_growth_is_bounded(client, db_session):
    """/api/operators читает уровень поштучно, но не аккаунт и не награды."""
    before = _queries_for(client, "/api/operators")
    _add_operators_with_accounts(db_session, "Прирост Операторов", ADDED_OPERATORS)
    after = _queries_for(client, "/api/operators")

    growth = after - before
    # 3 запроса на оператора — текущий честный минимум (назначение уровня,
    # период-отчёт, средний балл тестов). До оптимизации было 8.
    assert growth <= ADDED_OPERATORS * 3, (
        f"/api/operators: +{ADDED_OPERATORS} операторов дали +{growth} запросов "
        f"({before} → {after}) — вернулся N+1 сверх ожидаемых трёх чтений"
    )
