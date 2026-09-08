"""Модели ORM. Импорт здесь регистрирует все таблицы в общей метадате."""
from app.db.base import Base
from app.models.access import AccessPolicy, AccessRule
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
from app.models.driver import DriverProfile, DriverSettings
from app.models.enums import (
    BadgeRule,
    MetricDirection,
    MetricKind,
    Role,
    ShopRequestStatus,
    TxType,
    WeekStatus,
)
from app.models.games import Raffle, RaffleEntry, WheelConfig, WheelSpin
from app.models.learning import LearningAttempt, LearningAward, LearningContent
from app.models.progress import Notification, XpAccount, XpEntry, XpLevel
from app.models.session import LoginSession
from app.models.settings import AuditLog, GamificationSettings
from app.models.shop import ShopItem, ShopRequest
from app.models.user import CoinAccount, Group, User

__all__ = [
    "AccessPolicy",
    "AccessRule",
    "AuditLog",
    "BadgeDefinition",
    "BadgeRule",
    "Base",
    "CoinAccount",
    "CoinTransaction",
    "ContestWeek",
    "DriverProfile",
    "DriverSettings",
    "GamificationSettings",
    "Group",
    "LearningAttempt",
    "LearningAward",
    "LearningContent",
    "LoginSession",
    "MetricDefinition",
    "MetricDirection",
    "MetricKind",
    "NominationDefinition",
    "NominationWinner",
    "Notification",
    "OperatorWeekMetric",
    "OperatorWeekResult",
    "Raffle",
    "RaffleEntry",
    "Role",
    "ShopItem",
    "ShopRequest",
    "ShopRequestStatus",
    "TxType",
    "User",
    "UserBadge",
    "WeekStatus",
    "WheelConfig",
    "WheelSpin",
    "XpAccount",
    "XpEntry",
    "XpLevel",
]
