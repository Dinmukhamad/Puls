"""Юнит-тесты правил перевода показателей в баллы и коины (п. 3.1)."""
from __future__ import annotations

import pytest

from app.models.contest import MetricDefinition
from app.models.enums import MetricDirection, MetricKind
from app.services.scoring import points_to_coins, score_metric, score_week


def positive(code: str, target: float, max_points: float, **kwargs) -> MetricDefinition:
    return MetricDefinition(
        code=code,
        title=code,
        kind=MetricKind.POSITIVE,
        direction=MetricDirection.HIGHER_IS_BETTER,
        target_value=target,
        max_points=max_points,
        penalty_per_unit=0.0,
        allow_overachievement=kwargs.get("allow_overachievement", True),
    )


def anti(code: str, penalty: float) -> MetricDefinition:
    return MetricDefinition(
        code=code,
        title=code,
        kind=MetricKind.ANTI,
        direction=MetricDirection.LOWER_IS_BETTER,
        target_value=0.0,
        max_points=0.0,
        penalty_per_unit=penalty,
    )


def test_full_plan_gives_max_points() -> None:
    score = score_metric(positive("quality", 100, 25), 100)
    assert score.points == 25
    assert score.completion == 1.0


def test_partial_plan_is_proportional() -> None:
    score = score_metric(positive("hours", 40, 25), 20)
    assert score.points == 12.5
    assert score.completion == 0.5


def test_overachievement_is_capped_at_max_points() -> None:
    score = score_metric(positive("calls", 12, 15), 30)
    assert score.points == 15


def test_anti_metric_produces_penalty_not_points() -> None:
    score = score_metric(anti("lateness", 5), 3)
    assert score.points == 0
    assert score.penalty == 15


def test_penalties_are_subtracted_before_conversion() -> None:
    definitions = [positive("quality", 100, 50), anti("lateness", 5)]
    score = score_week(definitions, {"quality": 100, "lateness": 2})
    assert score.base_points == 50
    assert score.penalty_points == 10
    assert score.final_points == 40


def test_final_points_never_go_negative() -> None:
    definitions = [positive("quality", 100, 10), anti("lateness", 5)]
    score = score_week(definitions, {"quality": 20, "lateness": 10})
    assert score.final_points == 0


def test_missing_metric_counts_as_zero() -> None:
    score = score_week([positive("quality", 100, 25)], {})
    assert score.final_points == 0


@pytest.mark.parametrize(
    ("points", "rate", "expected"),
    [(100, 5, 20), (0, 5, 0), (4.9, 5, 0), (9.9, 5, 1), (37, 5, 7)],
)
def test_points_to_coins_rounds_down(points: float, rate: float, expected: int) -> None:
    assert points_to_coins(points, rate) == expected


def test_zero_rate_is_rejected() -> None:
    with pytest.raises(ValueError):
        points_to_coins(10, 0)


def test_lower_is_better_metric_rewards_small_values() -> None:
    definition = positive("aht", 300, 20)
    definition.direction = MetricDirection.LOWER_IS_BETTER
    assert score_metric(definition, 150).points == 20
    assert score_metric(definition, 600).points == 10
