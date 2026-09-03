"""
Демонстрационные данные для локального запуска.

Создаёт группы, персонал и операторов, заполняет две недели показателями
и закрывает первую из них, чтобы рейтинг, история и бейджи были непустыми.

Запуск:  python -m scripts.seed_demo
"""
from __future__ import annotations

import asyncio
import random
from datetime import date, timedelta

from sqlalchemy import select

from app.core.security import hash_password
from app.db.init_db import create_schema, seed_reference_data
from app.db.session import SessionLocal, engine
from app.models.contest import OperatorWeekMetric
from app.models.enums import Role
from app.models.user import Group, User
from app.services import coins as coins_service
from app.services import weekly as weekly_service

OPERATOR_NAMES = [
    "Айгерим Сериковна Абдиева",
    "Данияр Маратович Ахметов",
    "Жанна Ерлановна Бекова",
    "Тимур Асхатович Дюсенов",
    "Мадина Кайратовна Ержанова",
    "Арман Болатович Исаев",
    "Салтанат Нурлановна Каримова",
    "Ерлан Талгатович Мухтаров",
    "Асель Данияровна Нурпеисова",
    "Руслан Алиевич Оспанов",
    "Динара Ануаровна Сагындык",
    "Нурлан Жомартович Тлеуберди",
]

GROUPS = [("G1", "Группа 1 - дневная смена"), ("G2", "Группа 2 - ночная смена")]


async def _ensure_user(session, *, login: str, name: str, role: Role, group_id=None) -> User:
    user = await session.scalar(select(User).where(User.login == login))
    if user is not None:
        return user
    user = User(
        login=login,
        full_name=name,
        role=role,
        group_id=group_id,
        hashed_password=hash_password("demo12345"),
        hired_on=date.today() - timedelta(days=random.randint(60, 900)),
    )
    session.add(user)
    await session.flush()
    if role == Role.OPERATOR:
        await coins_service.get_account(session, user.id)
    return user


def _random_metrics(rng: random.Random, strong: bool) -> dict[str, float]:
    """Правдоподобный набор показателей за неделю."""
    return {
        "hours_worked": round(rng.uniform(32, 46), 1),
        "overtime": round(rng.uniform(0, 10), 1),
        "quality": round(rng.uniform(88 if strong else 72, 100), 1),
        "efficiency": round(rng.uniform(85 if strong else 65, 100), 1),
        "calls_per_hour": round(rng.uniform(9 if strong else 6, 15), 1),
        "driver_gratitudes": float(rng.randint(0, 7)),
        "lateness": float(rng.choice([0, 0, 0, 1, 2]) if not strong else rng.choice([0, 0, 1])),
        "forbidden_sites": float(rng.choice([0, 0, 0, 1]) if not strong else 0),
    }


async def main() -> None:
    rng = random.Random(20260601)

    await create_schema()
    async with SessionLocal() as session:
        await seed_reference_data(session)

        groups: list[Group] = []
        for code, name in GROUPS:
            group = await session.scalar(select(Group).where(Group.code == code))
            if group is None:
                group = Group(code=code, name=name)
                session.add(group)
                await session.flush()
            groups.append(group)

        head = await _ensure_user(
            session, login="head", name="Ольга Викторовна Ким", role=Role.HEAD
        )
        supervisors = [
            await _ensure_user(
                session,
                login=f"sv{index + 1}",
                name=name,
                role=Role.SUPERVISOR,
                group_id=group.id,
            )
            for index, (group, name) in enumerate(
                zip(groups, ["Алексей Петрович Ким", "Гульмира Сериковна Ли"], strict=False)
            )
        ]
        for group, supervisor in zip(groups, supervisors, strict=False):
            group.supervisor_id = supervisor.id

        operators = [
            await _ensure_user(
                session,
                login=f"op{index + 1:02d}",
                name=name,
                role=Role.OPERATOR,
                group_id=groups[index % len(groups)].id,
            )
            for index, name in enumerate(OPERATOR_NAMES)
        ]
        await session.commit()

        today = date.today()
        weeks = [
            await weekly_service.get_or_create_week(session, today - timedelta(days=14)),
            await weekly_service.get_or_create_week(session, today - timedelta(days=7)),
            await weekly_service.get_or_create_week(session, today),
        ]
        await session.commit()

        for week in weeks:
            existing = await session.scalar(
                select(OperatorWeekMetric.id).where(OperatorWeekMetric.week_id == week.id)
            )
            if existing is not None:
                continue
            for position, operator in enumerate(operators):
                values = _random_metrics(rng, strong=position < 4)
                for code, value in values.items():
                    session.add(
                        OperatorWeekMetric(
                            week_id=week.id,
                            user_id=operator.id,
                            metric_code=code,
                            value=value,
                            source="demo",
                        )
                    )
        await session.commit()

        # Две прошедшие недели закрываем, текущую оставляем открытой.
        for week in weeks[:2]:
            report = await weekly_service.close_week(session, week, actor_id=head.id)
            await session.commit()
            print(
                f"Неделя {report.week_label}: участников {report.participants}, "
                f"начислено {report.coins_awarded} коинов, "
                f"номинаций {report.nominations_awarded}, бейджей {report.badges_awarded}"
            )

        print("\nУчётные записи (пароль demo12345):")
        print("  head        - руководитель")
        print("  sv1, sv2    - супервайзеры")
        print("  op01..op12  - операторы")
        print("  admin       - администратор (пароль из BOOTSTRAP_ADMIN_PASSWORD)")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
