from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.models.entities import Operator, ShopItem, User, WeeklyResult
from app.services.coins import add_transaction, points_to_coins
from app.services.rating import recalculate_period_ranks


def seed_database(db: Session) -> None:
    settings = get_settings()
    if not db.scalar(select(User).where(User.username == settings.seed_admin_username)):
        db.add(
            User(
                full_name="Администратор",
                username=settings.seed_admin_username,
                password_hash=hash_password(settings.seed_admin_password),
                role="admin",
            )
        )

    if db.scalar(select(Operator).limit(1)):
        db.commit()
        return

    supervisor = User(
        full_name="Супервайзер демо",
        username="supervisor",
        password_hash=hash_password("supervisor123"),
        role="supervisor",
    )
    manager = User(
        full_name="Менеджер демо",
        username="manager",
        password_hash=hash_password("manager123"),
        role="manager",
    )
    db.add_all([supervisor, manager])

    operators = [
        Operator(full_name="Гарри Поттер", group_name="Гриффиндор"),
        Operator(full_name="Гермиона Грейнджер", group_name="Гриффиндор"),
        Operator(full_name="Драко Малфой", group_name="Слизерин"),
        Operator(full_name="Полумна Лавгуд", group_name="Когтевран"),
    ]
    db.add_all(operators)
    db.flush()

    for index, operator in enumerate(operators, start=1):
        user = User(
            full_name=operator.full_name,
            username=f"operator{index}",
            password_hash=hash_password("operator123"),
            role="operator",
            operator_id=operator.id,
        )
        db.add(user)
        db.flush()
        operator.user_id = user.id

    db.add_all(
        [
            ShopItem(title="Дополнительный выходной", description="Один согласованный день отдыха", price=40),
            ShopItem(title="Сертификат", description="Подарочный сертификат", price=25),
            ShopItem(title="Обед за счет компании", description="Компенсация обеда", price=15),
        ]
    )

    week_start = date(2026, 6, 1)
    week_end = date(2026, 6, 7)
    demo_scores = [92.5, 88.0, 75.5, 81.0]
    for operator, points in zip(operators, demo_scores):
        coins = points_to_coins(points)
        result = WeeklyResult(
            operator_id=operator.id,
            week_start=week_start,
            week_end=week_end,
            contest_points=points,
            coins_earned=coins,
            hours_score=18,
            overtime_score=6,
            quality_score=points,
            efficiency_score=points * 0.9,
            calls_per_hour_score=points * 0.8,
            final_score=points,
        )
        db.add(result)
        add_transaction(db, operator, coins, "weekly_accrual", "Начисление коинов за демо-неделю")

    recalculate_period_ranks(db, week_start, week_end)
    db.commit()
