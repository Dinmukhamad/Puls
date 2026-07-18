"""Idempotent draft blueprint from TZ_Puls_Coin_Economy_and_Prize_Store v1.0.

The catalog is deliberately created as inactive and the season as draft:
the specification requires management approval before real prize issuance.
Test reward rules are active, but affect only tests explicitly configured with
reward_mode="economy".
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import EconomySeason, RewardRule, ShopItem, ShopItemPrice

START_SEASON_CODE = "puls-start-2026"

TEST_REWARD_RULES = (
    ("score_80_89", "Тест 80–89%", 40, 80),
    ("score_90_99", "Тест 90–99%", 60, 90),
    ("score_100", "Идеальный результат теста", 100, 100),
    ("score_improved", "Улучшение результата теста", 20, None),
)

# code, title, start price, regular price, category, prize_type, issue policy
STARTER_CATALOG = (
    ("chocolate", "Шоколад", 250, 350, "quick", "physical", "Выдача ответственным сотрудником при наличии."),
    ("drink", "Напиток или энергетик", 300, 400, "quick", "physical", "Выдача ответственным сотрудником при наличии."),
    ("coffee", "Кофе", 300, 400, "quick", "physical", "Сертификат или напиток из согласованного списка."),
    ("snacks", "Набор снеков", 350, 500, "quick", "physical", "Выдача ответственным сотрудником при наличии."),
    ("puls-stickers", "Стикерпак Puls", 350, 450, "recognition", "physical", "Выдача ответственным сотрудником при наличии."),
    ("wheel-extra-spin", "Дополнительное вращение колеса", 400, 500, "quick", "digital", "Билет добавляется в Wheel of WOW автоматически."),
    ("notebook-pen", "Блокнот и ручка", 400, 550, "gifts", "physical", "Выдача ответственным сотрудником при наличии."),
    ("coffee-certificate", "Сертификат на кофе", 500, 650, "quick", "digital", "Код отправляется в кабинет после подтверждения."),
    ("lunch-certificate", "Сертификат на обед", 650, 850, "gifts", "digital", "Код отправляется в кабинет после подтверждения."),
    ("mobile-topup", "Пополнение мобильного баланса", 700, 950, "gifts", "digital", "Номер и оператор связи подтверждаются ответственным сотрудником."),
    ("puls-mug", "Фирменная кружка Puls", 750, 950, "gifts", "physical", "Выдача ответственным сотрудником при наличии."),
    ("water-bottle", "Бутылка для воды", 800, 1000, "gifts", "physical", "Выдача ответственным сотрудником при наличии."),
    ("ride-promo", "Промокод на поездку", 900, 1200, "gifts", "digital", "Промокод отправляется в кабинет после подтверждения."),
    ("small-store-certificate", "Небольшой сертификат магазина", 1000, 1300, "gifts", "digital", "Код отправляется в кабинет после подтверждения."),
    ("puls-shirt", "Футболка или фирменный мерч", 1200, 1600, "gifts", "physical", "Размер и наличие подтверждаются перед выдачей."),
    ("powerbank", "Пауэрбанк", 1500, 2200, "gifts", "physical", "Выдача ответственным сотрудником при наличии."),
    ("wireless-mouse", "Беспроводная мышь", 1600, 2300, "gifts", "physical", "Выдача ответственным сотрудником при наличии."),
    ("store-certificate", "Сертификат магазина", 1800, 2500, "gifts", "digital", "Код отправляется в кабинет после подтверждения."),
    ("wireless-headphones", "Беспроводные наушники", 2000, 3000, "gifts", "physical", "Выдача ответственным сотрудником при наличии."),
    ("break-time-choice", "Выбор времени одного перерыва", 400, 400, "workday", "privilege", "Только из доступных интервалов с подтверждением супервайзера."),
    ("rare-profile-badge", "Редкая рамка или бейдж профиля", 650, 650, "recognition", "digital", "Выдаётся автоматически после подтверждения заказа."),
    ("workplace-choice", "Выбор рабочего места на смену", 500, 500, "workday", "privilege", "Только если это не нарушает организацию линии."),
    ("shift-choice", "Выбор смены из доступных вариантов", 1000, 1000, "workday", "privilege", "Не отменяет утверждённый график и нормы."),
)


def ensure_economy_blueprint(db: Session) -> None:
    season = db.scalar(select(EconomySeason).where(EconomySeason.code == START_SEASON_CODE))
    if season is None:
        season = EconomySeason(
            code=START_SEASON_CODE,
            name="Стартовый сезон Puls 2026",
            status="draft",
            starts_at=datetime(2026, 7, 17),
            ends_at=datetime(2026, 8, 28),
            notification_at=datetime(2026, 8, 14),
            config_json={
                "requires_management_approval": True,
                "target_first_purchase_days": 7,
                "target_expensive_prize_days": 14,
                "coins_expire": False,
            },
        )
        db.add(season)
        db.flush()

    for source_code, name, amount, threshold in TEST_REWARD_RULES:
        existing = db.scalar(
            select(RewardRule).where(
                RewardRule.season_id.is_(None),
                RewardRule.source_type == "test",
                RewardRule.source_code == source_code,
            )
        )
        if existing is None:
            db.add(
                RewardRule(
                    source_type="test",
                    source_code=source_code,
                    name=name,
                    amount=amount,
                    threshold=threshold,
                    period="all_time",
                    period_limit=1,
                    active=True,
                )
            )

    for code, title, start_price, regular_price, category, prize_type, policy in STARTER_CATALOG:
        item = db.scalar(select(ShopItem).where(ShopItem.code == code))
        if item is None:
            item = ShopItem(
                code=code,
                title=title,
                description=policy,
                category=category,
                prize_type=prize_type,
                issue_policy=policy,
                issue_days=3 if prize_type == "digital" else 14,
                price=regular_price,
                is_active=False,
                purchase_limit_per_operator=1,
            )
            db.add(item)
            db.flush()
        price = db.scalar(
            select(ShopItemPrice).where(
                ShopItemPrice.shop_item_id == item.id,
                ShopItemPrice.season_id == season.id,
            )
        )
        if price is None:
            db.add(
                ShopItemPrice(
                    shop_item_id=item.id,
                    season_id=season.id,
                    coin_price=start_price,
                    active=True,
                )
            )

    db.flush()
