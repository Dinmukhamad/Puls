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
from app.db.guards import guard_statements
from app.db.session import engine
from app.models import (
    BadgeDefinition,
    MetricDefinition,
    NominationDefinition,
    ShopItem,
    User,
)
from app.models.enums import BadgeRule, MetricDirection, MetricKind, Role
from app.services.progress import seed_progress_levels
from app.services.rules import get_rules

logger = logging.getLogger(__name__)

DEFAULT_METRICS: tuple[dict, ...] = (
    {
        "code": "hours_worked",
        "title": "Выработка часов",
        "unit": "ч",
        "target_value": 40.0,
        "max_points": 25.0,
        "sort_order": 10,
    },
    {
        "code": "overtime",
        "title": "Переработки",
        "unit": "ч",
        "target_value": 8.0,
        "max_points": 10.0,
        "sort_order": 20,
    },
    {
        "code": "quality",
        "title": "Качество работы",
        "unit": "%",
        "target_value": 100.0,
        "max_points": 25.0,
        "allow_overachievement": False,
        "sort_order": 30,
    },
    {
        "code": "efficiency",
        "title": "Эффективность",
        "unit": "%",
        "target_value": 100.0,
        "max_points": 20.0,
        "allow_overachievement": False,
        "sort_order": 40,
    },
    {
        "code": "calls_per_hour",
        "title": "Количество звонков в час",
        "unit": "шт/ч",
        "target_value": 12.0,
        "max_points": 15.0,
        "sort_order": 50,
    },
    {
        "code": "driver_gratitudes",
        "title": "Благодарности от водителей",
        "unit": "шт",
        "target_value": 5.0,
        "max_points": 5.0,
        "sort_order": 60,
    },
    {
        "code": "lateness",
        "title": "Опоздания",
        "unit": "шт",
        "kind": MetricKind.ANTI,
        "direction": MetricDirection.LOWER_IS_BETTER,
        "penalty_per_unit": 5.0,
        "max_points": 0.0,
        "sort_order": 90,
        "description": "Антипоказатель: снижает итоговый балл до перевода в коины",
    },
    {
        "code": "forbidden_sites",
        "title": "Посещение посторонних сайтов",
        "unit": "шт",
        "kind": MetricKind.ANTI,
        "direction": MetricDirection.LOWER_IS_BETTER,
        "penalty_per_unit": 3.0,
        "max_points": 0.0,
        "sort_order": 91,
        "description": "Антипоказатель: снижает итоговый балл до перевода в коины",
    },
)


DEFAULT_NOMINATIONS: tuple[dict, ...] = (
    {
        "code": "best_calls",
        "title": "Лучший по звонкам",
        "metric_code": "calls_per_hour",
        "sort_order": 10,
    },
    {
        "code": "best_quality",
        "title": "Лучшее качество",
        "metric_code": "quality",
        "sort_order": 20,
    },
    {
        "code": "best_progress",
        "title": "Лучший прогресс недели",
        "metric_code": "__progress__",
        "min_value": 0.01,
        "sort_order": 30,
        "description": "Наибольший прирост итогового балла к прошлой неделе",
    },
    {
        "code": "no_lateness",
        "title": "Без опозданий",
        "metric_code": "lateness",
        "require_zero": True,
        "sort_order": 40,
    },
    {
        "code": "top_gratitudes",
        "title": "Больше всего благодарностей от водителей",
        "metric_code": "driver_gratitudes",
        "min_value": 1.0,
        "sort_order": 50,
    },
    {
        "code": "top_efficiency",
        "title": "Топ по эффективности",
        "metric_code": "efficiency",
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
        "price": 30,
        "description": "Бейдж и упоминание в общем чате команды",
        "sort_order": 20,
    },
    {
        "code": "early_shift_access",
        "title": "Ранний доступ к аукциону смен",
        "price": 80,
        "description": "Выбор смены на 30 минут раньше других",
        "sort_order": 30,
    },
    {
        "code": "extra_break",
        "title": "Дополнительный перерыв (+15 мин)",
        "price": 80,
        "description": "Согласовывается с руководителем",
        "sort_order": 40,
    },
    {
        "code": "coffee_card",
        "title": "Сертификат на кофе",
        "price": 120,
        "description": "Подарочная карта в кофейню",
        "sort_order": 50,
    },
    {
        "code": "team_pizza",
        "title": "Корпоративная пицца",
        "price": 180,
        "description": "Пицца для вас и двух коллег на смене",
        "sort_order": 60,
    },
    {
        "code": "merch",
        "title": "Мерч компании",
        "price": 200,
        "description": "Кружка, худи, блокнот, термокружка, шоппер",
        "sort_order": 70,
    },
    {
        "code": "company_lunch",
        "title": "Обед за счёт компании",
        "price": 300,
        "description": "Оплаченный обед или сертификат на питание",
        "sort_order": 80,
    },
    {
        "code": "marketplace_card",
        "title": "Сертификат маркетплейс",
        "price": 400,
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
        "description": "Две недели подряд с качеством не ниже 95 %",
        "icon": "star",
        "rule_type": BadgeRule.METRIC_THRESHOLD_STREAK,
        "rule_params": {"metric": "quality", "gte": 95, "weeks": 2},
        "sort_order": 30,
    },
    {
        "code": "driver_favourite",
        "title": "Любимец водителей",
        "description": "20 благодарностей от водителей суммарно",
        "icon": "heart",
        "rule_type": BadgeRule.METRIC_TOTAL,
        "rule_params": {"metric": "driver_gratitudes", "gte": 20},
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
        for statement in guard_statements(conn.dialect.name):
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
