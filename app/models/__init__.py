"""Модели ORM. Импорт здесь регистрирует все таблицы в общей метадате."""

from app.db.base import Base
from app.models.access import AccessPolicy, AccessRule
from app.models.badge import BadgeDefinition, UserBadge
from app.models.city import CityAward, CitySettings
from app.models.coin import CoinTransaction
from app.models.contest import (
    ContestWeek,
    MetricDefinition,
    NominationDefinition,
    NominationWinner,
    OperatorWeekMetric,
    OperatorWeekResult,
)
from app.models.crm import CrmAppeal, CrmAttachment, CrmCategory, CrmInstruction
from app.models.driver import DriverOrder, DriverProfile, DriverSettings
from app.models.driver_auth import DriverDevice, TelegramLink
from app.models.driver_navigation import DriverMapRate, DriverNavigation, DriverRouteDraft
from app.models.driver_shift import DriverShift, DriverSupportCase
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
from app.models.progress import Notification, ProgressLevel
from app.models.session import LoginSession
from app.models.settings import AuditLog, GamificationSettings
from app.models.shop import ShopItem, ShopRequest
from app.models.user import CoinAccount, Group, User
from app.models.work_sites_access import WorkSitesAccess

__all__ = [
    "AccessPolicy",
    "AccessRule",
    "AuditLog",
    "BadgeDefinition",
    "BadgeRule",
    "Base",
    "CityAward",
    "CitySettings",
    "CoinAccount",
    "CoinTransaction",
    "ContestWeek",
    "CrmAppeal",
    "CrmAttachment",
    "CrmCategory",
    "CrmInstruction",
    "DriverDevice",
    "DriverMapRate",
    "DriverNavigation",
    "DriverOrder",
    "DriverProfile",
    "DriverRouteDraft",
    "DriverSettings",
    "DriverShift",
    "DriverSupportCase",
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
    "ProgressLevel",
    "Raffle",
    "RaffleEntry",
    "Role",
    "ShopItem",
    "ShopRequest",
    "ShopRequestStatus",
    "TelegramLink",
    "TxType",
    "User",
    "UserBadge",
    "WeekStatus",
    "WheelConfig",
    "WheelSpin",
    "WorkSitesAccess",
]
