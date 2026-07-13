"""
Seed — создаём начальные данные при первом старте.
Пароли берутся ТОЛЬКО из переменных окружения.
"""
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.models.entities import Group, Operator, User, WeeklyResult
from app.services.coins import add_transaction, points_to_coins
from app.services.rating import recalculate_period_ranks


def _make_user(
    db: Session,
    username: str,
    password: str,
    full_name: str,
    role: str,
    operator_id: int | None = None,
) -> User | None:
    """Создаёт пользователя если не существует и пароль задан."""
    if not password:
        return None
    existing = db.scalar(select(User).where(User.username == username))
    if existing:
        return existing
    user = User(
        full_name=full_name,
        username=username,
        password_hash=hash_password(password),
        role=role,
        operator_id=operator_id,
    )
    db.add(user)
    db.flush()
    return user


def seed_database(db: Session) -> None:
    settings = get_settings()

    # ── Admin ──────────────────────────────────────────────────
    if not settings.seed_admin_password:
        print("[seed] WARNING: SEED_ADMIN_PASSWORD не задан, admin не создан!")
    else:
        _make_user(
            db,
            username=settings.seed_admin_username,
            password=settings.seed_admin_password,
            full_name=settings.seed_admin_fullname,
            role="admin",
        )

    # ── Supervisor / Manager (опционально) ─────────────────────
    if settings.seed_supervisor_password:
        _make_user(
            db,
            username=settings.seed_supervisor_username,
            password=settings.seed_supervisor_password,
            full_name="Супервайзер",
            role="supervisor",
        )

    if settings.seed_manager_password:
        _make_user(
            db,
            username=settings.seed_manager_username,
            password=settings.seed_manager_password,
            full_name="Руководитель",
            role="manager",
        )

    # ── Демо-данные только в dev режиме ───────────────────────
    if not settings.enable_demo_data:
        db.commit()
        return

    # ── Если операторы уже есть — выходим ─────────────────────
    if db.scalar(select(Operator).limit(1)):
        db.commit()
        return

    # ── Демо-операторы ─────────────────────────────────────────
    group_map = {}
    for group_name in ("Группа 1", "Группа 2", "Группа 3"):
        group = db.scalar(select(Group).where(Group.name == group_name))
        if not group:
            group = Group(name=group_name, status="active")
            db.add(group)
            db.flush()
        group_map[group_name] = group

    demo_operators = [
        Operator(full_name="Иванов Алексей",   group_id=group_map["Группа 1"].id, group_name="Группа 1", participation_status="participating", employment_status="active", position="operator"),
        Operator(full_name="Петрова Мария",    group_id=group_map["Группа 1"].id, group_name="Группа 1", participation_status="participating", employment_status="active", position="operator"),
        Operator(full_name="Сидоров Дмитрий",  group_id=group_map["Группа 2"].id, group_name="Группа 2", participation_status="participating", employment_status="active", position="operator"),
        Operator(full_name="Козлова Анна",     group_id=group_map["Группа 2"].id, group_name="Группа 2", participation_status="participating", employment_status="active", position="chat_manager"),
        Operator(full_name="Новиков Сергей",   group_id=group_map["Группа 3"].id, group_name="Группа 3", participation_status="participating", employment_status="active", position="operator"),
        Operator(full_name="Морозова Елена",   group_id=group_map["Группа 3"].id, group_name="Группа 3", participation_status="participating", employment_status="active", position="chat_manager"),
    ]
    db.add_all(demo_operators)
    db.flush()

    # Пользователи для демо-операторов (пароль operator123)
    for i, op in enumerate(demo_operators, start=1):
        user = User(
            full_name=op.full_name,
            username=f"operator{i}",
            password_hash=hash_password("operator123"),
            role="operator",
            operator_id=op.id,
        )
        db.add(user)
        db.flush()
        op.user_id = user.id

    # ── Демо-результаты за прошлую неделю ─────────────────────
    week_start = date(2026, 6, 16)
    week_end   = date(2026, 6, 22)
    demo_scores = [92.5, 88.0, 75.5, 81.0, 69.0, 95.0]

    for op, points in zip(demo_operators, demo_scores, strict=False):
        coins = points_to_coins(points, db)
        result = WeeklyResult(
            operator_id=op.id,
            week_start=week_start,
            week_end=week_end,
            contest_points=points,
            coins_earned=coins,
            hours_score=18.0,
            overtime_score=5.0,
            quality_score=points * 0.9,
            efficiency_score=points * 0.85,
            calls_per_hour_score=points * 0.75,
            final_score=points,
        )
        db.add(result)
        add_transaction(db, op, coins, "weekly_accrual", "Начисление коинов за демо-неделю")

    recalculate_period_ranks(db, week_start, week_end)
    db.commit()
    print("[seed] Demo data created successfully")
