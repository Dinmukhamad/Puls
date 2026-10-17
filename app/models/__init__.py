"""Модели ORM. Импорт здесь регистрирует все таблицы в общей метадате."""

from app.db.base import Base
from app.models.access import AccessPolicy, AccessRule
from app.models.avatar import UserAvatar
from app.models.badge import BadgeDefinition, UserBadge
from app.models.city import (
    CityAward,
    CityBuild,
    CityEconomy,
    CityQuest,
    CitySettings,
    CitySituations,
    CityWorld,
)
from app.models.city_estate import (
    CityCell,
    CityContribution,
    CityDistrictState,
    CityEvent,
    CityObject,
    CityOperation,
    CityProject,
)
from app.models.city_season import CitySeason
from app.models.coin import CoinTransaction
from app.models.contest import (
    ContestMonth,
    ContestWeek,
    MetricDefinition,
    MonthNominationWinner,
    NominationDefinition,
    NominationWinner,
    OperatorDayMetric,
    OperatorMonthResult,
    OperatorWeekMetric,
    OperatorWeekResult,
)
from app.models.crm import CrmAppeal, CrmAttachment, CrmCategory, CrmInstruction
from app.models.crm_draft import CrmDraft, CrmDraftAttachment
from app.models.crm_training import CrmTrainingAttempt, CrmTrainingCheck
from app.models.dispatch import DispatchEvent
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
from app.models.oktell import OktellEvent
from app.models.progress import Notification, ProgressLevel
from app.models.scenario import ScenarioAttempt
from app.models.session import LoginSession
from app.models.settings import AuditLog, GamificationSettings
from app.models.shop import ShopItem, ShopRequest
from app.models.telemetry import CityPerfReport
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
    "CityBuild",
    "CityCell",
    "CityContribution",
    "CityDistrictState",
    "CityEconomy",
    "CityEvent",
    "CityObject",
    "CityOperation",
    "CityPerfReport",
    "CityProject",
    "CityQuest",
    "CitySeason",
    "CitySettings",
    "CitySituations",
    "CityWorld",
    "CoinAccount",
    "CoinTransaction",
    "ContestMonth",
    "ContestWeek",
    "CrmAppeal",
    "CrmAttachment",
    "CrmCategory",
    "CrmDraft",
    "CrmDraftAttachment",
    "CrmInstruction",
    "CrmTrainingAttempt",
    "CrmTrainingCheck",
    "DispatchEvent",
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
    "MonthNominationWinner",
    "NominationDefinition",
    "NominationWinner",
    "Notification",
    "OktellEvent",
    "OperatorDayMetric",
    "OperatorMonthResult",
    "OperatorWeekMetric",
    "OperatorWeekResult",
    "ProgressLevel",
    "Raffle",
    "RaffleEntry",
    "Role",
    "ScenarioAttempt",
    "ShopItem",
    "ShopRequest",
    "ShopRequestStatus",
    "TelegramLink",
    "TxType",
    "User",
    "UserAvatar",
    "UserBadge",
    "WeekStatus",
    "WheelConfig",
    "WheelSpin",
    "WorkSitesAccess",
]
