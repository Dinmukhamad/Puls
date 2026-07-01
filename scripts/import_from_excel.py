"""
Импорт операторов из Данные_операторов.xlsx.

Логика:
  - Колонка 1: ФИО
  - Колонка 2: старая ставка — ИГНОРИРУЕТСЯ
  - Колонка 3: ставка (0.5 / 0.75 / 1.0)
  - Колонка 4: дата выхода на линию (start_date)
  - Колонка 5: супервайзер → имя группы
  - Колонка 6: email

Группы создаются по именам супервайзеров:
  Кастек Гаухар, Пахриддинов Динмухамад, Элекова Арайлым
  (Сабыр Азана → группа Пахриддинов Динмухамад)

Операторы с будущей датой (> сегодня) → дата = 2026-07-01
Стаж считается от start_date до сегодня.

Запуск:
  DATABASE_URL=postgresql://... python scripts/import_from_excel.py --file Данные_операторов.xlsx
  DATABASE_URL=postgresql://... python scripts/import_from_excel.py --file Данные_операторов.xlsx --apply
"""
from __future__ import annotations

import argparse
import os
import re
import secrets
import string
import sys
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Optional

import openpyxl
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session, sessionmaker

# ── путь к проекту ──────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from app.core.security import hash_password
from app.models.entities import Group, Operator, User


TODAY = date(2026, 7, 1)

# Маппинг супервайзера → группа
SUPERVISOR_GROUP_MAP = {
    "Кастек Гаухар":          "Кастек Гаухар",
    "Пахриддинов Динмухамад": "Пахриддинов Динмухамад",
    "Элекова Арайлым":        "Элекова Арайлым",
    "Сабыр Азана":            "Пахриддинов Динмухамад",  # нет отдельной группы
}

GROUPS_TO_CREATE = ["Кастек Гаухар", "Пахриддинов Динмухамад", "Элекова Арайлым"]


@dataclass
class ExcelRow:
    full_name: str
    rate: float
    start_date: date
    group_name: str
    email: str
    row_num: int


def _normalize(name: str) -> str:
    """Нормализация ФИО для сравнения — нижний регистр, одиночные пробелы."""
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def _gen_username(full_name: str, existing_usernames: set[str]) -> str:
    """Генерирует логин из ФИО транслитерацией."""
    TRANSLIT = {
        'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh',
        'з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o',
        'п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts',
        'ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu',
        'я':'ya','ғ':'g','қ':'k','ң':'n','ү':'u','ұ':'u','һ':'h','ә':'a',
        'і':'i','ө':'o',
    }
    parts = full_name.strip().split()
    if not parts:
        return "operator_" + secrets.token_hex(4)
    # Фамилия + первая буква имени
    surname = "".join(TRANSLIT.get(c.lower(), c.lower()) for c in parts[0]
                      if c.isalpha() or c.isspace())
    first_init = ""
    if len(parts) > 1:
        first_init = "".join(TRANSLIT.get(c.lower(), c.lower())
                              for c in parts[1][:1] if c.isalpha())
    base = re.sub(r"[^a-z0-9]", "_", f"user_{surname}_{first_init}").strip("_")
    base = re.sub(r"_+", "_", base)[:40]
    username = base
    counter = 2
    while username in existing_usernames:
        username = f"{base}_{counter}"
        counter += 1
    return username


def _gen_password() -> str:
    alphabet = string.ascii_letters + string.digits
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(12))
        if (any(c.isupper() for c in pwd) and
                any(c.islower() for c in pwd) and
                any(c.isdigit() for c in pwd)):
            return pwd


def read_excel(path: str) -> list[ExcelRow]:
    wb = openpyxl.load_workbook(path)
    ws = wb.active
    rows = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            continue  # заголовок
        full_name, _old_rate, rate, start_dt, supervisor, email = row

        # Пропускаем пустые строки
        if not full_name or not str(full_name).strip():
            continue

        full_name = str(full_name).strip()

        # Ставка из колонки 3
        try:
            rate = float(rate) if rate else None
        except (TypeError, ValueError):
            rate = None

        # Дата выхода на линию
        if isinstance(start_dt, datetime):
            start_date = start_dt.date()
        elif isinstance(start_dt, date):
            start_date = start_dt
        else:
            start_date = None

        # Будущая дата → сегодня
        if start_date and start_date > TODAY:
            start_date = TODAY

        # Группа по супервайзеру
        supervisor = str(supervisor).strip() if supervisor else ""
        group_name = SUPERVISOR_GROUP_MAP.get(supervisor, "Пахриддинов Динмухамад")

        email = str(email).strip() if email else ""

        rows.append(ExcelRow(
            full_name=full_name,
            rate=rate,
            start_date=start_date,
            group_name=group_name,
            email=email,
            row_num=i + 1,
        ))
    return rows


def run(excel_path: str, apply: bool) -> None:
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        print("ERROR: DATABASE_URL не задан")
        sys.exit(1)

    # Railway даёт postgres://, SQLAlchemy требует postgresql://
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+psycopg2://", 1)
    elif db_url.startswith("postgresql://") and "+psycopg" not in db_url:
        db_url = db_url.replace("postgresql://", "postgresql+psycopg2://", 1)

    engine = create_engine(db_url, pool_pre_ping=True)
    SessionLocal = sessionmaker(bind=engine)
    db: Session = SessionLocal()

    rows = read_excel(excel_path)
    print(f"\nФайл: {excel_path}")
    print(f"Строк данных: {len(rows)}")
    print(f"Режим: {'ЗАПИСЬ В БД' if apply else 'DRY-RUN (только проверка)'}\n")

    # ── Шаг 1: Группы ──────────────────────────────────────────────────────
    existing_groups: dict[str, Group] = {
        g.name: g for g in db.scalars(select(Group))
    }
    groups_to_make = [n for n in GROUPS_TO_CREATE if n not in existing_groups]

    if groups_to_make:
        print(f"Будут созданы группы: {', '.join(groups_to_make)}")
    else:
        print(f"Все группы уже существуют: {', '.join(GROUPS_TO_CREATE)}")

    if apply:
        for gname in groups_to_make:
            g = Group(name=gname, status="active")
            db.add(g)
        if groups_to_make:
            db.flush()
        # Перечитываем
        existing_groups = {g.name: g for g in db.scalars(select(Group))}

    # ── Шаг 2: Операторы ───────────────────────────────────────────────────
    existing_operators = list(db.scalars(select(Operator)))
    op_by_email = {(o.email or "").lower(): o for o in existing_operators if o.email}
    op_by_name  = {_normalize(o.full_name): o for o in existing_operators}

    existing_users = list(db.scalars(select(User)))
    existing_usernames = {u.username for u in existing_users}
    user_by_op_id = {u.operator_id: u for u in existing_users if u.operator_id}

    created_ops, updated_ops, skipped = 0, 0, 0
    credentials = []  # [(full_name, username, password)]

    print("\n" + "─" * 70)
    print(f"{'#':>3}  {'ФИО':<35} {'Группа':<25} {'Ставка':>6}  {'Стаж':<15}  Действие")
    print("─" * 70)

    for row in rows:
        # Стаж
        tenure_str = "—"
        if row.start_date:
            days = (TODAY - row.start_date).days
            if days < 0:
                days = 0
            months = days // 30
            rem_days = days % 30
            if months > 0:
                tenure_str = f"{months}м {rem_days}д" if rem_days else f"{months}м"
            else:
                tenure_str = f"{days}д"

        # Найти существующего оператора
        existing_op: Optional[Operator] = (
            op_by_email.get(row.email.lower()) or
            op_by_name.get(_normalize(row.full_name))
        )

        group_obj = existing_groups.get(row.group_name)
        group_id   = group_obj.id if group_obj else None
        group_name = row.group_name

        if existing_op:
            action = "ОБНОВЛЕНИЕ"
            print(f"{row.row_num:>3}  {row.full_name:<35} {row.group_name:<25} {str(row.rate):>6}  {tenure_str:<15}  {action}")

            if apply:
                existing_op.full_name   = row.full_name
                existing_op.email       = row.email or existing_op.email
                existing_op.rate        = Decimal(str(row.rate)) if row.rate else existing_op.rate
                existing_op.start_date  = row.start_date or existing_op.start_date
                existing_op.group_id    = group_id or existing_op.group_id
                existing_op.group_name  = group_name

                # Обновляем связанного пользователя
                linked_user = user_by_op_id.get(existing_op.id)
                if linked_user:
                    linked_user.full_name = row.full_name
                    linked_user.email     = row.email or linked_user.email
                    linked_user.group_id  = group_id or linked_user.group_id

            updated_ops += 1

        else:
            action = "СОЗДАНИЕ"
            print(f"{row.row_num:>3}  {row.full_name:<35} {row.group_name:<25} {str(row.rate):>6}  {tenure_str:<15}  {action}")

            if apply:
                op = Operator(
                    full_name            = row.full_name,
                    email                = row.email or None,
                    group_id             = group_id,
                    group_name           = group_name,
                    rate                 = Decimal(str(row.rate)) if row.rate else None,
                    start_date           = row.start_date,
                    participation_status = "participating",
                    employment_status    = "active",
                    status               = "active",
                    is_active            = True,
                    position             = "operator",
                )
                db.add(op)
                db.flush()

                # Создаём учётную запись
                username = _gen_username(row.full_name, existing_usernames)
                password = _gen_password()
                existing_usernames.add(username)

                user = User(
                    full_name           = row.full_name,
                    username            = username,
                    password_hash       = hash_password(password),
                    role                = "operator",
                    operator_id         = op.id,
                    group_id            = group_id,
                    email               = row.email or None,
                    status              = "active",
                    is_active           = True,
                    must_change_password= True,
                )
                db.add(user)
                db.flush()
                op.user_id = user.id

                # Обновляем локальные индексы
                if row.email:
                    op_by_email[row.email.lower()] = op
                op_by_name[_normalize(row.full_name)] = op
                user_by_op_id[op.id] = user

                credentials.append((row.full_name, username, password))

            created_ops += 1

    print("─" * 70)
    print(f"\nИтого: создать {created_ops}, обновить {updated_ops}, пропустить {skipped}")

    if apply:
        db.commit()
        print("\n✓ Данные записаны в БД")

        # Сохраняем учётные данные
        if credentials:
            out_dir = PROJECT_ROOT / "secure_outputs"
            out_dir.mkdir(exist_ok=True)
            cred_file = out_dir / f"credentials_{TODAY.strftime('%Y%m%d')}.txt"
            with open(cred_file, "w", encoding="utf-8") as f:
                f.write(f"Импорт операторов {TODAY}\n")
                f.write("=" * 60 + "\n")
                for name, uname, pwd in credentials:
                    f.write(f"{name}\n  Логин: {uname}\n  Пароль: {pwd}\n\n")
            print(f"Учётные данные сохранены: {cred_file}")
    else:
        print("\n(Dry-run — ничего не записано. Добавьте --apply для реальной записи.)")

    db.close()


def main():
    parser = argparse.ArgumentParser(description="Импорт операторов из Excel")
    parser.add_argument("--file", required=True, help="Путь к xlsx-файлу")
    parser.add_argument("--apply", action="store_true", help="Реально записать в БД")
    args = parser.parse_args()
    run(args.file, args.apply)


if __name__ == "__main__":
    main()
