"""admin_stats считает выданные за миссии коины без запроса на каждую награду.

Раньше на каждую транзакцию награды делался db.get(MissionAttempt, ...) —
по запросу к БД на каждую выданную награду. Теперь связка attempt -> mission
берётся одним запросом. Тест закрепляет поведение расчёта: и без фильтра по
миссии, и с фильтром, включая транзакции-сироты.
"""
from __future__ import annotations

import pytest
from sqlalchemy import delete, func, select

from app.models import entities as m
from app.modules.missions.service import admin_stats
from tests.conftest import make_operator


@pytest.fixture()
def _cleanup(db_session):
    """Убирает за собой только то, что создал этот тест.

    Общий прогон делит одну БД: сносить все mission_reward-транзакции нельзя —
    это разрушило бы данные соседних тестов.
    """
    baseline_op = db_session.scalar(select(func.max(m.Operator.id))) or 0
    baseline_mission = db_session.scalar(select(func.max(m.Mission.id))) or 0
    baseline_tx = db_session.scalar(select(func.max(m.CoinTransaction.id))) or 0
    yield
    attempt_ids = list(db_session.scalars(
        select(m.MissionAttempt.id).where(m.MissionAttempt.mission_id > baseline_mission)
    ))
    db_session.execute(
        delete(m.CoinTransaction).where(m.CoinTransaction.id > baseline_tx)
    )
    if attempt_ids:
        db_session.execute(
            delete(m.MissionEvent).where(m.MissionEvent.attempt_id.in_(attempt_ids))
        )
        db_session.execute(
            delete(m.MissionAttempt).where(m.MissionAttempt.id.in_(attempt_ids))
        )
    db_session.execute(delete(m.Mission).where(m.Mission.id > baseline_mission))
    db_session.execute(delete(m.Operator).where(m.Operator.id > baseline_op))
    db_session.commit()


def _mission(db, code: str) -> m.Mission:
    mission = m.Mission(code=code, title=f"Миссия {code}", is_active=True)
    db.add(mission)
    db.commit()
    return mission


def _attempt(db, mission, operator) -> m.MissionAttempt:
    attempt = m.MissionAttempt(
        mission_id=mission.id, operator_id=operator.id, status="completed",
        mission_version=1, attempt_number=1,
        idempotency_key=f"test-{mission.code}-{operator.id}",
        demo_code_seed="seed", demo_code_hash="hash",
    )
    db.add(attempt)
    db.commit()
    return attempt


def _reward(db, operator, attempt_id, amount: int) -> None:
    db.add(m.CoinTransaction(
        operator_id=operator.id, amount=amount, type="mission_reward",
        source_type="mission_reward", source_id=attempt_id,
        comment="test reward",
    ))
    db.commit()


def test_awarded_coins_respect_the_mission_filter(db_session, _cleanup):
    # Общий итог считается от базовой линии: в общей БД уже есть награды
    # от соседних тестов.
    before = admin_stats(db_session)["awarded_coins"]
    operator = make_operator(db_session, full_name="Награждённый")
    first = _mission(db_session, "stats-a")
    second = _mission(db_session, "stats-b")
    _reward(db_session, operator, _attempt(db_session, first, operator).id, 100)
    _reward(db_session, operator, _attempt(db_session, second, operator).id, 40)

    assert admin_stats(db_session)["awarded_coins"] - before == 140
    # Фильтр по миссии отсекает чужие награды целиком, поэтому здесь точные числа.
    assert admin_stats(db_session, "stats-a")["awarded_coins"] == 100
    assert admin_stats(db_session, "stats-b")["awarded_coins"] == 40


def test_orphan_reward_counts_only_without_filter(db_session, _cleanup):
    """Транзакция, чья попытка удалена, попадает в общий итог, но не в
    итог по конкретной миссии — так было и до оптимизации."""
    before = admin_stats(db_session)["awarded_coins"]
    operator = make_operator(db_session, full_name="Сирота")
    mission = _mission(db_session, "stats-c")
    _reward(db_session, operator, _attempt(db_session, mission, operator).id, 10)
    _reward(db_session, operator, 9_999_999, 7)     # попытки с таким id нет

    assert admin_stats(db_session)["awarded_coins"] - before == 17
    assert admin_stats(db_session, "stats-c")["awarded_coins"] == 10
