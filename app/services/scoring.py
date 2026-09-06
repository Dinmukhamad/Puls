"""
Перевод показателей недели в баллы конкурса.

Чистые функции без обращения к БД: это позволяет покрыть правила расчёта
юнит-тестами и переиспользовать их для предварительного просмотра итогов
до закрытия недели.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from app.models.contest import MetricDefinition
from app.models.enums import MetricDirection, MetricKind


@dataclass(slots=True)
class MetricScore:
    """Результат по одному показателю - основа прогресс-бара в кабинете (п. 4.1.2)."""

    code: str
    title: str
    unit: str | None
    kind: MetricKind
    value: float | None
    target: float
    #: Доля выполнения плана, 0..1 (для антипоказателей не заполняется).
    completion: float | None
    points: float
    max_points: float
    #: Штрафные баллы, вычитаемые из суммы (только для антипоказателей).
    penalty: float

    def as_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "title": self.title,
            "unit": self.unit,
            "kind": str(self.kind),
            "value": self.value,
            "target": self.target,
            "completion": self.completion,
            "points": self.points,
            "max_points": self.max_points,
            "penalty": self.penalty,
        }


@dataclass(slots=True)
class WeekScore:
    """Итог оператора за неделю до перевода в коины."""

    base_points: float
    penalty_points: float
    final_points: float
    metrics: list[MetricScore] = field(default_factory=list)


def _completion(definition: MetricDefinition, value: float) -> float:
    """Доля выполнения плана по показателю в диапазоне 0..1."""
    target = definition.target_value
    if target <= 0:
        return 1.0 if value > 0 else 0.0

    if definition.direction == MetricDirection.HIGHER_IS_BETTER:
        ratio = value / target
    else:
        # Чем меньше значение, тем лучше: план перевыполнен при value <= target.
        ratio = 1.0 if value <= 0 else min(1.0, target / value)

    if not definition.allow_overachievement:
        ratio = min(ratio, 1.0)
    return max(0.0, min(ratio, 1.0))


def score_metric(definition: MetricDefinition, value: float | None) -> MetricScore:
    """Считает баллы (или штраф) по одному показателю."""
    if value is None:
        return MetricScore(
            code=definition.code,
            title=definition.title,
            unit=definition.unit,
            kind=definition.kind,
            value=None,
            target=definition.target_value,
            completion=None,
            points=0.0,
            max_points=definition.max_points,
            penalty=0.0,
        )
    if not math.isfinite(value):
        raise ValueError("Значение показателя должно быть конечным числом")
    if definition.kind == MetricKind.ANTI:
        penalty = max(0.0, value) * definition.penalty_per_unit
        return MetricScore(
            code=definition.code,
            title=definition.title,
            unit=definition.unit,
            kind=MetricKind.ANTI,
            value=value,
            target=0.0,
            completion=0.0,
            points=0.0,
            max_points=0.0,
            penalty=round(penalty, 2),
        )

    completion = _completion(definition, value)
    points = completion * definition.max_points
    return MetricScore(
        code=definition.code,
        title=definition.title,
        unit=definition.unit,
        kind=MetricKind.POSITIVE,
        value=value,
        target=definition.target_value,
        completion=round(completion, 4),
        points=round(points, 2),
        max_points=definition.max_points,
        penalty=0.0,
    )


def score_week(definitions: list[MetricDefinition], values: dict[str, float | None]) -> WeekScore:
    """
    Считает итоговый балл оператора за неделю.

    Порядок соответствует п. 3.1 ТЗ: сначала складываются баллы по показателям,
    затем вычитаются антипоказатели, и только после этого результат переводится
    в коины. Итог не опускается ниже нуля.
    """
    scores = [score_metric(d, values.get(d.code)) for d in definitions]
    base = sum(s.points for s in scores)
    penalty = sum(s.penalty for s in scores)
    final = max(0.0, base - penalty)
    return WeekScore(
        base_points=round(base, 2),
        penalty_points=round(penalty, 2),
        final_points=round(final, 2),
        metrics=scores,
    )


def points_to_coins(final_points: float, points_per_coin: float) -> int:
    """
    Переводит баллы в коины по курсу «N баллов = 1 коин» (п. 3.1, шаг 4 п. 7).

    Округление вниз: недобранные до целого коина баллы не начисляются, чтобы
    сумма начислений никогда не превышала заработанное.
    """
    if points_per_coin <= 0:
        raise ValueError("Курс перевода должен быть положительным")
    return max(0, math.floor(final_points / points_per_coin))
