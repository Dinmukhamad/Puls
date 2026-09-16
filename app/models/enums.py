"""Перечисления предметной области."""

from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    """Роли системы (п. 2 ТЗ)."""

    OPERATOR = "operator"  # Оператор
    TRAINER = "trainer"  # Обучение, без административной иерархии
    SUPERVISOR = "supervisor"  # Супервайзер
    HEAD = "head"  # Руководитель
    ADMIN = "admin"  # Администратор системы


#: Иерархия прав: чем больше число, тем шире доступ.
ROLE_LEVEL: dict[Role, int] = {
    Role.OPERATOR: 0,
    Role.TRAINER: 0,
    Role.SUPERVISOR: 1,
    Role.HEAD: 2,
    Role.ADMIN: 3,
}

USER_VISIBILITY: dict[Role, tuple[Role, ...]] = {
    Role.OPERATOR: (),
    Role.TRAINER: (Role.OPERATOR,),
    Role.SUPERVISOR: (Role.OPERATOR, Role.SUPERVISOR),
    Role.HEAD: (Role.OPERATOR, Role.TRAINER, Role.SUPERVISOR),
    Role.ADMIN: tuple(Role),
}


class TxType(StrEnum):
    """Типы операций с коинами (п. 3 ТЗ)."""

    WEEKLY_POINTS = "weekly_points"  # базовый перевод баллов конкурса
    RANK_BONUS = "rank_bonus"  # топ-3 недели
    NO_LATENESS_BONUS = "no_lateness_bonus"  # неделя без опозданий
    NO_SITES_BONUS = "no_sites_bonus"  # неделя без посторонних сайтов
    NOMINATION_BONUS = "nomination_bonus"  # номинация недели
    DRIVER_GRATITUDE = "driver_gratitude"  # благодарность от водителя
    MANUAL_CREDIT = "manual_credit"  # ручное начисление
    MANUAL_DEBIT = "manual_debit"  # ручное списание
    PURCHASE = "purchase"  # покупка бонуса (одобренная заявка)
    PURCHASE_REFUND = "purchase_refund"  # возврат по отменённой покупке
    CORRECTION = "correction"  # техническая корректировка
    LEARNING_REWARD = "learning_reward"  # награда за обучение
    GAME_REWARD = "game_reward"  # награда колеса или розыгрыша
    ACHIEVEMENT_REWARD = "achievement_reward"


#: Группировка типов для фильтра истории (п. 4.1.3).
TX_GROUPS: dict[str, tuple[TxType, ...]] = {
    "accrual": (
        TxType.WEEKLY_POINTS,
        TxType.RANK_BONUS,
        TxType.NO_LATENESS_BONUS,
        TxType.NO_SITES_BONUS,
        TxType.NOMINATION_BONUS,
        TxType.DRIVER_GRATITUDE,
        TxType.MANUAL_CREDIT,
        TxType.PURCHASE_REFUND,
        TxType.LEARNING_REWARD,
        TxType.GAME_REWARD,
        TxType.ACHIEVEMENT_REWARD,
    ),
    "writeoff": (TxType.MANUAL_DEBIT, TxType.CORRECTION),
    "purchase": (TxType.PURCHASE,),
}


class WeekStatus(StrEnum):
    OPEN = "open"  # неделя идёт, метрики собираются
    CALCULATED = "calculated"  # предварительный расчёт выполнен, коины не начислены
    CLOSED = "closed"  # неделя закрыта, коины начислены


class MetricKind(StrEnum):
    POSITIVE = "positive"  # показатель, повышающий балл
    ANTI = "anti"  # антипоказатель (п. 8 ТЗ)


class MetricDirection(StrEnum):
    HIGHER_IS_BETTER = "higher_is_better"
    LOWER_IS_BETTER = "lower_is_better"


class ShopRequestStatus(StrEnum):
    """Статусы заявки из магазина (п. 4.4.4)."""

    NEW = "new"  # новая, коины зарезервированы
    APPROVED = "approved"  # одобрена, коины списаны
    REJECTED = "rejected"  # отклонена, резерв снят
    FULFILLED = "fulfilled"  # бонус фактически выдан
    CANCELLED = "cancelled"  # отозвана самим оператором


#: Статусы, при которых коины оператора всё ещё удерживаются в резерве.
RESERVING_STATUSES = (ShopRequestStatus.NEW,)


class BadgeRule(StrEnum):
    """Типы правил выдачи бейджей (п. 4.1.4)."""

    TOP_RANK = "top_rank"  # место в рейтинге <= max_rank
    ZERO_METRIC_STREAK = "zero_metric_streak"  # N недель подряд с нулевым антипоказателем
    METRIC_THRESHOLD_STREAK = "metric_threshold_streak"  # N недель подряд metric >= gte
    METRIC_TOTAL = "metric_total"  # накопленная сумма метрики >= gte
    TOTAL_EARNED = "total_earned"  # всего начислено коинов >= gte
    NOMINATION_COUNT = "nomination_count"  # количество выигранных номинаций >= gte
    LEARNING_COUNT = "learning_count"  # успешно пройденные разные учебные задания
