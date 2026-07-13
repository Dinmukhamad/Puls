"""Default operator rewards for the Puls shop."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import ShopItem


DEFAULT_SHOP_ITEMS = (
    {
        "title": "Кофе или чай за счёт компании",
        "description": "Один напиток в рабочую смену. Получение согласовывается с руководителем.",
        "category": "quick",
        "price": 60,
        "purchase_limit_per_operator": 2,
    },
    {
        "title": "Выбор музыки на смену",
        "description": "Выберите спокойный плейлист для общей рабочей зоны на одну смену.",
        "category": "quick",
        "price": 40,
        "purchase_limit_per_operator": 1,
    },
    {
        "title": "Дополнительные 15 минут перерыва",
        "description": "Дополнительное время отдыха в выбранную смену по согласованию с руководителем.",
        "category": "workday",
        "price": 90,
        "purchase_limit_per_operator": 1,
    },
    {
        "title": "Приоритет выбора рабочего места",
        "description": "Выберите свободное рабочее место первым на одну смену.",
        "category": "workday",
        "price": 120,
        "purchase_limit_per_operator": 1,
    },
    {
        "title": "Статус «Звезда команды»",
        "description": "Бейдж в профиле и упоминание результата в командной сводке недели.",
        "category": "recognition",
        "price": 100,
        "purchase_limit_per_operator": 1,
    },
    {
        "title": "Благодарность коллеге",
        "description": "Публичная благодарность выбранному коллеге в командной сводке.",
        "category": "recognition",
        "price": 50,
        "purchase_limit_per_operator": 2,
    },
    {
        "title": "Фирменная кружка Puls",
        "description": "Фирменная кружка для рабочего места. Выдаётся при наличии на складе.",
        "category": "gifts",
        "price": 180,
        "stock_limit": 30,
        "purchase_limit_per_operator": 1,
    },
    {
        "title": "Обед за счёт компании",
        "description": "Оплаченный обед или сертификат на питание в пределах установленного лимита.",
        "category": "gifts",
        "price": 250,
        "purchase_limit_per_operator": 1,
    },
    {
        "title": "Пицца для команды",
        "description": "Пицца для вашей смены: отличный повод отметить общий результат.",
        "category": "gifts",
        "price": 300,
        "purchase_limit_per_operator": 1,
    },
    {
        "title": "Подарочный сертификат",
        "description": "Сертификат маркетплейса или магазина из доступного списка компании.",
        "category": "gifts",
        "price": 500,
        "purchase_limit_per_operator": 1,
    },
)


def ensure_default_shop(db: Session) -> None:
    """Create missing defaults and classify known legacy rewards."""
    existing = {item.title: item for item in db.scalars(select(ShopItem)).all()}
    for payload in DEFAULT_SHOP_ITEMS:
        item = existing.get(payload["title"])
        if item is None:
            db.add(ShopItem(**payload))
        elif item.category == "other":
            item.category = payload["category"]

