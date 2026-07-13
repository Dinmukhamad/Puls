"""Add shop categories and a useful default operator catalog.

Revision ID: 0030_shop_catalog
Revises: 0029_raffles
Create Date: 2026-07-14
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0030_shop_catalog"
down_revision = "0029_raffles"
branch_labels = None
depends_on = None

MIGRATION_ITEMS = (
    ("Кофе или чай за счёт компании", "Один напиток в рабочую смену. Получение согласовывается с руководителем.", "quick", 60, 0, 2),
    ("Выбор музыки на смену", "Выберите спокойный плейлист для общей рабочей зоны на одну смену.", "quick", 40, 0, 1),
    ("Дополнительные 15 минут перерыва", "Дополнительное время отдыха в выбранную смену по согласованию с руководителем.", "workday", 90, 0, 1),
    ("Приоритет выбора рабочего места", "Выберите свободное рабочее место первым на одну смену.", "workday", 120, 0, 1),
    ("Статус «Звезда команды»", "Бейдж в профиле и упоминание результата в командной сводке недели.", "recognition", 100, 0, 1),
    ("Благодарность коллеге", "Публичная благодарность выбранному коллеге в командной сводке.", "recognition", 50, 0, 2),
    ("Фирменная кружка Puls", "Фирменная кружка для рабочего места. Выдаётся при наличии на складе.", "gifts", 180, 30, 1),
    ("Обед за счёт компании", "Оплаченный обед или сертификат на питание в пределах установленного лимита.", "gifts", 250, 0, 1),
    ("Пицца для команды", "Пицца для вашей смены: отличный повод отметить общий результат.", "gifts", 300, 0, 1),
    ("Подарочный сертификат", "Сертификат маркетплейса или магазина из доступного списка компании.", "gifts", 500, 0, 1),
)


def upgrade() -> None:
    op.add_column(
        "shop_items",
        sa.Column("category", sa.String(length=32), nullable=False, server_default="other"),
    )
    op.create_index("ix_shop_items_category", "shop_items", ["category"])

    connection = op.get_bind()
    for title, description, category, price, stock_limit, operator_limit in MIGRATION_ITEMS:
        exists = connection.execute(
            sa.text("SELECT 1 FROM shop_items WHERE title = :title LIMIT 1"),
            {"title": title},
        ).scalar()
        if exists:
            connection.execute(
                sa.text("UPDATE shop_items SET category = :category WHERE title = :title AND category = 'other'"),
                {"title": title, "category": category},
            )
            continue
        connection.execute(
            sa.text(
                """
                INSERT INTO shop_items
                    (title, description, category, price, is_active, stock_limit,
                     purchase_limit_per_operator, created_at)
                VALUES
                    (:title, :description, :category, :price, true, :stock_limit,
                     :purchase_limit_per_operator, CURRENT_TIMESTAMP)
                """
            ),
            {
                "title": title,
                "description": description,
                "category": category,
                "price": price,
                "stock_limit": stock_limit,
                "purchase_limit_per_operator": operator_limit,
            },
        )


def downgrade() -> None:
    op.drop_index("ix_shop_items_category", table_name="shop_items")
    op.drop_column("shop_items", "category")
