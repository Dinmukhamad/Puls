"""
Создание схемы, защита журнала от изменений и справочники по умолчанию.

Значения справочников соответствуют п. 3.2, 4.2.3 и 4.3.1 ТЗ; после первого
запуска их можно менять через админ-панель.
"""

from __future__ import annotations

import logging

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_password
from app.db.base import Base
from app.db.city_guards import city_guard_statements
from app.db.guards import guard_statements
from app.db.session import engine
from app.models import (
    BadgeDefinition,
    MetricDefinition,
    NominationDefinition,
    ShopItem,
    User,
)
from app.models.enums import ALL_CHANNELS, BadgeRule, Channel, MetricDirection, MetricKind, Role
from app.services.progress import seed_progress_levels
from app.services.rules import get_rules

logger = logging.getLogger(__name__)

#: The chat operators' quality (docs/CHANNELS.md): the chat KPI's thresholds (80–85 % — 5,
#: 86–89 % — 10, 90–93 % — 15, 94–96 % — 20, 97–100 % — 25 points) on 75 of the week's 100: ×3.
#: The other 25 are the chats' norm of hours, as on the line.
CHAT_QUALITY: dict = {
    "code": "chat_quality",
    "title": "Качество чатов",
    "unit": "%",
    "target_value": 97.0,
    "max_points": 75.0,
    "allow_overachievement": False,
    "sort_order": 15,
    "channel": Channel.CHAT,
    "bands": [
        {"from": 80, "points": 15}, {"from": 86, "points": 30}, {"from": 90, "points": 45},
        {"from": 94, "points": 60}, {"from": 97, "points": 75},
    ],
    "description": "Пороги из KPI чатов (80–85 % — 5, 86–89 % — 10, 90–93 % — 15, 94–96 % — 20, "
    "97–100 % — 25 баллов), приведены к 75 баллам недели: ×3. Ещё 25 — норма часов.",
}
#: Overtime in both channels: a bonus over the 100 points once the norm of hours is met.
OVERTIME_NOTE = (
    "Бонус сверх 100 баллов: когда норма часов выполнена, каждый час сверх нормы даёт 1,25 балла, "
    "с 8 ч — 10 баллов (40 % баллов за часы)."
)
CHAT_METRICS: tuple[dict, ...] = (
    {
        "code": "chat_hours_norm",
        "title": "Норма часов в чатах",
        "unit": "%",
        "target_value": 100.0,
        "max_points": 25.0,
        "allow_overachievement": False,
        "sort_order": 16,
        "channel": Channel.CHAT,
        "description": "Часы в чатах, тренинги, тех. сбои и офлайн-активность против нормы часов "
        "из отчёта СЗоВ",
    },
    {
        "code": "chat_overtime",
        "title": "Переработки в чатах",
        "unit": "ч",
        "target_value": 8.0,
        "max_points": 10.0,
        "sort_order": 17,
        "channel": Channel.CHAT,
        "bonus_for": "chat_hours_norm",
        "bonus_share": 0.4,
        "description": OVERTIME_NOTE,
    },
    {
        "code": "chat_response_time",
        "title": "Среднее время ответа в чатах",
        "unit": "сек",
        "direction": MetricDirection.LOWER_IS_BETTER,
        "target_value": 120.0,
        "max_points": 0.0,
        "allow_overachievement": False,
        "sort_order": 18,
        "channel": Channel.CHAT,
        "description": "Среднее по дням из отчёта СЗоВ, меньше — лучше. Без баллов, пока их не "
        "зададут в настройках.",
    },
    {
        "code": "chats_per_hour",
        "title": "Чатов в час",
        "unit": "шт/ч",
        "target_value": 10.0,
        "max_points": 0.0,
        "sort_order": 19,
        "channel": Channel.CHAT,
        "description": "Чаты из отчёта СЗоВ на час в чатах (без тренингов, тех. сбоев и офлайна). "
        "Без баллов, пока их не зададут в настройках.",
    },
)

DEFAULT_METRICS: tuple[dict, ...] = (
    {
        "code": "hours_norm",
        "title": "Выполнение нормы часов",
        "unit": "%",
        "target_value": 100.0,
        "max_points": 25.0,
        "allow_overachievement": False,
        "sort_order": 1,
        "description": "Часы на линии, тренинги, тех. сбои и офлайн-активность против нормы часов "
        "оператора из отчёта СЗоВ",
    },
    {
        # Replaced by the norm of hours from the SZoV reports; kept switched off for older data.
        "code": "hours_worked",
        "title": "Выработка часов",
        "unit": "ч",
        "target_value": 40.0,
        "max_points": 25.0,
        "sort_order": 10,
        "is_active": False,
    },
    {
        "code": "overtime",
        "title": "Переработки",
        "unit": "ч",
        "target_value": 8.0,
        "max_points": 10.0,
        "sort_order": 20,
        "bonus_for": "hours_norm",
        "bonus_share": 0.4,
        "description": OVERTIME_NOTE,
    },
    {
        "code": "quality",
        "title": "Качество звонков",
        "unit": "%",
        "target_value": 100.0,
        "max_points": 30.0,
        "allow_overachievement": False,
        "sort_order": 30,
    },
    {
        "code": "efficiency",
        "title": "Эффективность",
        "unit": "%",
        "target_value": 100.0,
        "max_points": 25.0,
        "allow_overachievement": False,
        "sort_order": 40,
    },
    {
        "code": "calls_per_hour",
        "title": "Количество звонков в час",
        "unit": "шт/ч",
        "target_value": 12.0,
        "max_points": 20.0,
        "sort_order": 50,
    },
    {
        # Not counted for now; kept switched off.
        "code": "driver_gratitudes",
        "title": "Благодарности от водителей",
        "unit": "шт",
        "target_value": 5.0,
        "max_points": 5.0,
        "sort_order": 60,
        "is_active": False,
    },
    {
        "code": "lateness",
        "title": "Опоздания",
        "unit": "шт",
        "kind": MetricKind.ANTI,
        "direction": MetricDirection.LOWER_IS_BETTER,
        "penalty_per_unit": 0.0,
        "max_points": 0.0,
        "target_value": 0.0,
        "sort_order": 90,
        "description": "Антипоказатель: каждое опоздание - прямой штраф в коинах",
        "channel": ALL_CHANNELS,
    },
    {
        "code": "forbidden_sites",
        "title": "Посещение посторонних сайтов",
        "unit": "шт",
        "kind": MetricKind.ANTI,
        "direction": MetricDirection.LOWER_IS_BETTER,
        "penalty_per_unit": 0.0,
        "max_points": 0.0,
        "target_value": 0.0,
        "sort_order": 91,
        "description": "Антипоказатель: каждый сайт - прямой штраф в коинах (правила начисления)",
        "channel": ALL_CHANNELS,
    },
    CHAT_QUALITY,
    *CHAT_METRICS,
)


DEFAULT_NOMINATIONS: tuple[dict, ...] = (
    {
        "code": "best_calls",
        "title": "Лучший по звонкам",
        "metric_code": "calls_per_hour",
        "channel": Channel.LINE,
        "sort_order": 10,
    },
    {
        "code": "best_quality",
        "title": "Лучшее качество звонков",
        "metric_code": "quality",
        "channel": Channel.LINE,
        "sort_order": 20,
    },
    {
        "code": "best_chat_quality",
        "title": "Лучшее качество чатов",
        "metric_code": "chat_quality",
        "channel": Channel.CHAT,
        "sort_order": 21,
    },
    {
        "code": "fastest_chat_reply",
        "title": "Самый быстрый ответ в чатах",
        "metric_code": "chat_response_time",
        "direction": MetricDirection.LOWER_IS_BETTER,
        "channel": Channel.CHAT,
        "sort_order": 22,
    },
    {
        "code": "best_progress",
        "title": "Лучший прогресс · линия",
        "metric_code": "__progress__",
        "min_value": 0.01,
        "channel": Channel.LINE,
        "sort_order": 30,
        "description": "Наибольший прирост итогового балла к прошлому периоду",
    },
    {
        "code": "best_progress_chat",
        "title": "Лучший прогресс · чаты",
        "metric_code": "__progress__",
        "min_value": 0.01,
        "channel": Channel.CHAT,
        "sort_order": 31,
        "description": "Наибольший прирост итогового балла к прошлому периоду",
    },
    {
        "code": "no_lateness",
        "title": "Без опозданий · линия",
        "metric_code": "lateness",
        "require_zero": True,
        "channel": Channel.LINE,
        "sort_order": 40,
    },
    {
        "code": "no_lateness_chat",
        "title": "Без опозданий · чаты",
        "metric_code": "lateness",
        "require_zero": True,
        "channel": Channel.CHAT,
        "sort_order": 41,
    },
    {
        # Gratitude is not counted for now.
        "code": "top_gratitudes",
        "title": "Больше всего благодарностей от водителей",
        "metric_code": "driver_gratitudes",
        "min_value": 1.0,
        "channel": Channel.LINE,
        "is_active": False,
        "sort_order": 50,
    },
    {
        "code": "top_efficiency",
        "title": "Топ по эффективности",
        "metric_code": "efficiency",
        "channel": Channel.LINE,
        "sort_order": 60,
    },
)


DEFAULT_SHOP_ITEMS: tuple[dict, ...] = (
    {
        "code": "raffle_ticket",
        "title": "Участие в розыгрыше",
        "price": 50,
        "description": "1 билет в ежемесячный розыгрыш крупного приза",
        "sort_order": 10,
    },
    {
        "code": "star_of_week",
        "title": "Статус «Звезда недели»",
        "price": 150,
        "description": "Бейдж и упоминание в общем чате команды",
        "sort_order": 20,
    },
    {
        "code": "early_shift_access",
        "title": "Ранний доступ к аукциону смен",
        "price": 400,
        "description": "Выбор смены на 30 минут раньше других",
        "sort_order": 30,
    },
    {
        "code": "extra_break",
        "title": "Дополнительный перерыв (+15 мин)",
        "price": 250,
        "description": "Согласовывается с руководителем",
        "sort_order": 40,
    },
    {
        "code": "coffee_card",
        "title": "Сертификат на кофе",
        "price": 300,
        "cost_tenge": 1500,
        "monthly_stock": 8,
        "description": "Подарочная карта в кофейню",
        "sort_order": 50,
    },
    {
        "code": "team_pizza",
        "title": "Корпоративная пицца",
        "price": 1600,
        "cost_tenge": 8000,
        "monthly_stock": 1,
        "description": "Пицца для вас и двух коллег на смене",
        "sort_order": 60,
    },
    {
        "code": "merch",
        "title": "Мерч компании",
        "price": 1000,
        "cost_tenge": 5000,
        "monthly_stock": 2,
        "description": "Кружка, худи, блокнот, термокружка, шоппер",
        "sort_order": 70,
    },
    {
        "code": "company_lunch",
        "title": "Обед за счёт компании",
        "price": 600,
        "cost_tenge": 3000,
        "monthly_stock": 4,
        "description": "Оплаченный обед или сертификат на питание",
        "sort_order": 80,
    },
    {
        "code": "marketplace_card",
        "title": "Сертификат маркетплейс",
        "price": 1000,
        "cost_tenge": 5000,
        "monthly_stock": 1,
        "description": "Подарочная карта Kaspi, Wildberries и др.",
        "sort_order": 90,
    },
)


DEFAULT_BADGES: tuple[dict, ...] = (
    {
        "code": "learning_three",
        "title": "Учусь и применяю",
        "description": "Успешно пройдите три разных учебных задания",
        "icon": "star",
        "rule_type": BadgeRule.LEARNING_COUNT,
        "rule_params": {"gte": 3},
        "coins_reward": 50,
        "sort_order": 5,
    },
    {
        "code": "top3_week",
        "title": "Топ-3 недели",
        "description": "Попадание в тройку лидеров по итогам недели",
        "icon": "medal",
        "rule_type": BadgeRule.TOP_RANK,
        "rule_params": {"max_rank": 3},
        "sort_order": 10,
    },
    {
        "code": "no_lateness_3w",
        "coins_reward": 50,
        "title": "Без опозданий 3 недели",
        "description": "Три закрытые недели подряд без единого опоздания",
        "icon": "clock",
        "rule_type": BadgeRule.ZERO_METRIC_STREAK,
        "rule_params": {"metric": "lateness", "weeks": 3},
        "sort_order": 20,
    },
    {
        "code": "quality_star",
        "coins_reward": 75,
        "title": "Звезда качества",
        "description": "Две недели подряд с качеством не ниже 95 % — звонков или чатов",
        "icon": "star",
        "rule_type": BadgeRule.METRIC_THRESHOLD_STREAK,
        "rule_params": {"metric": "quality", "chat_metric": "chat_quality", "gte": 95, "weeks": 2},
        "sort_order": 30,
    },
    {
        "code": "driver_favourite",
        "title": "Любимец водителей",
        "description": "20 благодарностей от водителей суммарно",
        "icon": "heart",
        "rule_type": BadgeRule.METRIC_TOTAL,
        "rule_params": {"metric": "driver_gratitudes", "gte": 20},
        # Gratitude is not counted for now.
        "is_active": False,
        "sort_order": 40,
    },
    {
        "code": "team_legend",
        "title": "Легенда команды",
        "description": "500 коинов, заработанных за всё время",
        "icon": "crown",
        "rule_type": BadgeRule.TOTAL_EARNED,
        "rule_params": {"gte": 500},
        "sort_order": 50,
    },
    {
        "code": "nominee_x5",
        "title": "Пятикратный номинант",
        "description": "Пять побед в номинациях недели",
        "icon": "trophy",
        "rule_type": BadgeRule.NOMINATION_COUNT,
        "rule_params": {"gte": 5},
        "sort_order": 60,
    },
)


async def create_schema() -> None:
    """
    Создаёт таблицы и защиту журналов. Идемпотентно.

    Используется для локального запуска и тестов; в промышленной среде схема
    раскатывается миграциями Alembic (``AUTO_CREATE_SCHEMA=false``).
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for statement in guard_statements(conn.dialect.name) + city_guard_statements(
            conn.dialect.name
        ):
            await conn.execute(text(statement))


async def seed_reference_data(session: AsyncSession) -> dict[str, int]:
    """
    Наполняет справочники значениями из ТЗ, не трогая уже настроенные записи.

    Возвращает количество созданных объектов по типам.
    """
    await seed_progress_levels(session)
    created = {
        "metrics": 0,
        "nominations": 0,
        "shop_items": 0,
        "badges": 0,
        "users": 0,
    }

    async def ensure(model, rows: tuple[dict, ...], counter: str) -> None:
        existing = set(await session.scalars(select(model.code)))
        for row in rows:
            if row["code"] in existing:
                continue
            session.add(model(**row))
            created[counter] += 1

    await ensure(MetricDefinition, DEFAULT_METRICS, "metrics")
    await ensure(NominationDefinition, DEFAULT_NOMINATIONS, "nominations")
    await ensure(ShopItem, DEFAULT_SHOP_ITEMS, "shop_items")
    await ensure(BadgeDefinition, DEFAULT_BADGES, "badges")

    await get_rules(session)

    admin_exists = await session.scalar(
        select(User.id).where(User.login == settings.BOOTSTRAP_ADMIN_LOGIN)
    )
    if admin_exists is None:
        session.add(
            User(
                login=settings.BOOTSTRAP_ADMIN_LOGIN,
                full_name=settings.BOOTSTRAP_ADMIN_NAME,
                role=Role.ADMIN,
                hashed_password=hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD),
            )
        )
        created["users"] += 1
        logger.warning(
            "Создана учётная запись администратора '%s'. Смените пароль после первого входа.",
            settings.BOOTSTRAP_ADMIN_LOGIN,
        )

    await session.commit()
    return created
