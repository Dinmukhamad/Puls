"""Модели ORM. Импорт здесь регистрирует все таблицы в общей метадате."""
from app.db.base import Base
from app.models.badge import BadgeDefinition, UserBadge
from app.models.coin import CoinTransaction
from app.models.contest import (
    ContestWeek,
    MetricDefinition,
    NominationDefinition,
    NominationWinner,
    OperatorWeekMetric,
    OperatorWeekResult,
)
from app.models.enums import (
    BadgeRule,
    MetricDirection,
    MetricKind,
    Role,
    ShopRequestStatus,
    TxType,
    WeekStatus,
)
from app.models.settings import AuditLog, GamificationSettings
from app.models.shop import ShopItem, ShopRequest
from app.models.user import CoinAccount, Group, User

__all__ = [
    "AuditLog",
    "BadgeDefinition",
    "BadgeRule",
    "Base",
    "CoinAccount",
    "CoinTransaction",
    "ContestWeek",
    "GamificationSettings",
    "Group",
    "MetricDefinition",
    "MetricDirection",
    "MetricKind",
    "NominationDefinition",
    "NominationWinner",
    "OperatorWeekMetric",
    "OperatorWeekResult",
    "Role",
    "ShopItem",
    "ShopRequest",
    "ShopRequestStatus",
    "TxType",
    "User",
    "UserBadge",
    "WeekStatus",
]
