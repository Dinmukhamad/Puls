"""
АДМИНИСТРАТИВНАЯ УТИЛИТА — ручной разовый импорт операторов из Excel.

НЕ вызывается в рантайме приложения, НЕ запускается при деплое (отсутствует
в start.sh / Procfile / railpack.json). Предназначена для администратора,
который время от времени массово добавляет/обновляет операторов конкретной
группы из присланного xlsx-файла (ФИО, email, статус участия).

Пример запуска (dry-run — ничего не пишет в БД, только проверяет файл):

    python scripts/import_operators.py --file операторы.xlsx --group "Группа 7"

Реальная запись в БД:

    python scripts/import_operators.py --file операторы.xlsx --group "Группа 7" --apply

Скрипт:
  - находит группу по имени (--group) или создаёт её при --apply, если не существует;
  - для каждой строки Excel находит существующего оператора по email/ФИО или создаёт нового;
  - генерирует логин и временный пароль для новых аккаунтов (must_change_password=true);
  - сохраняет одноразовый CSV с доступами и JSON-отчёт в secure_outputs/
    (этот каталог не должен попадать в git — см. .gitignore).
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import random
import re
import secrets
import string
import sys
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from xml.etree import ElementTree as ET


HIGHER_ROLES = {"admin", "manager", "supervisor"}
SPECIAL_CHARS = "!@#$%&*?"


@dataclass
class OperatorRow:
    row_number: int
    full_name: str
    email: Optional[str]
    status_raw: str
    participation_status: str


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _column_index(cell_ref: str) -> int:
    match = re.match(r"([A-Z]+)", cell_ref.upper())
    if not match:
        return 0
    index = 0
    for char in match.group(1):
        index = index * 26 + (ord(char) - ord("A") + 1)
    return index - 1


def _read_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        stream = zf.open("xl/sharedStrings.xml")
    except KeyError:
        return []

    values: list[str] = []
    with stream:
        for _, elem in ET.iterparse(stream, events=("end",)):
            if _local_name(elem.tag) == "si":
                parts = [
                    node.text or ""
                    for node in elem.iter()
                    if _local_name(node.tag) == "t"
                ]
                values.append("".join(parts))
                elem.clear()
    return values


def _cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")

    if cell_type == "inlineStr":
        return "".join(
            node.text or ""
            for node in cell.iter()
            if _local_name(node.tag) == "t"
        ).strip()

    raw_value = ""
    for child in cell:
        if _local_name(child.tag) == "v":
            raw_value = child.text or ""
            break

    if cell_type == "s" and raw_value:
        try:
            return shared_strings[int(raw_value)].strip()
        except (IndexError, ValueError):
            return ""
    if cell_type == "b":
        return "TRUE" if raw_value == "1" else "FALSE"
    return raw_value.strip()


def read_xlsx_rows(path: Path) -> list[list[str]]:
    if not path.exists():
        raise FileNotFoundError(f"Excel-файл не найден: {path}")

    rows: list[list[str]] = []
    with zipfile.ZipFile(path) as zf:
        shared_strings = _read_shared_strings(zf)
        sheet_names = sorted(
            name for name in zf.namelist()
            if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")
        )
        if not sheet_names:
            raise ValueError("В xlsx не найден ни один лист")

        empty_after_data = 0
        with zf.open(sheet_names[0]) as stream:
            for _, elem in ET.iterparse(stream, events=("end",)):
                if _local_name(elem.tag) != "row":
                    continue

                values_by_col: dict[int, str] = {}
                for cell in elem:
                    if _local_name(cell.tag) != "c":
                        continue
                    values_by_col[_column_index(cell.attrib.get("r", "A"))] = _cell_value(cell, shared_strings)

                width = max(max(values_by_col.keys(), default=2) + 1, 3)
                row = [values_by_col.get(i, "").strip() for i in range(width)]

                if any(row):
                    rows.append(row)
                    empty_after_data = 0
                elif rows:
                    empty_after_data += 1
                    if empty_after_data >= 100:
                        break

                elem.clear()

    return rows


def _normalize_header(value: str) -> str:
    return re.sub(r"\s+", "", value.strip().lower().replace("ё", "е"))


def _find_header(headers: list[str], *needles: str) -> int:
    for index, header in enumerate(headers):
        if any(needle in header for needle in needles):
            return index
    raise ValueError(f"Не найдена колонка: {' / '.join(needles)}")


def _status_from_raw(value: str) -> tuple[str, Optional[str]]:
    raw = (value or "").strip().lower().replace("ё", "е")
    if not raw:
        return "participating", "Пустой статус участия: установлен статус 'Участвует'"
    if "не" in raw and ("уча" in raw or "учат" in raw):
        return "not_participating", None
    if "уча" in raw or "учат" in raw:
        return "participating", None
    return "participating", f"Неизвестный статус '{value}': установлен статус 'Участвует'"


def parse_operator_rows(xlsx_path: Path) -> tuple[list[OperatorRow], list[str], list[str]]:
    raw_rows = read_xlsx_rows(xlsx_path)
    if not raw_rows:
        raise ValueError("Excel-файл пустой")

    headers = [_normalize_header(value) for value in raw_rows[0]]
    fio_idx = _find_header(headers, "фио")
    email_idx = _find_header(headers, "почта", "email")
    status_idx = _find_header(headers, "учатсвует", "участвует", "неучаствует", "участ")

    rows: list[OperatorRow] = []
    warnings: list[str] = []
    errors: list[str] = []

    for offset, raw_row in enumerate(raw_rows[1:], start=2):
        full_name = raw_row[fio_idx].strip() if fio_idx < len(raw_row) else ""
        email = raw_row[email_idx].strip().lower() if email_idx < len(raw_row) else ""
        status_raw = raw_row[status_idx].strip() if status_idx < len(raw_row) else ""

        if not full_name:
            errors.append(f"Строка {offset}: нет ФИО, строка пропущена")
            continue

        participation_status, warning = _status_from_raw(status_raw)
        if warning:
            warnings.append(f"Строка {offset}: {warning}")

        rows.append(OperatorRow(
            row_number=offset,
            full_name=full_name,
            email=email or None,
            status_raw=status_raw,
            participation_status=participation_status,
        ))

    return rows, warnings, errors


TRANSLIT = {
    "а": "a", "ә": "a", "б": "b", "в": "v", "г": "g", "ғ": "g",
    "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i",
    "й": "i", "к": "k", "қ": "k", "л": "l", "м": "m", "н": "n",
    "ң": "n", "о": "o", "ө": "o", "п": "p", "р": "r", "с": "s",
    "т": "t", "у": "u", "ұ": "u", "ү": "u", "ф": "f", "х": "kh",
    "һ": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ы": "y", "і": "i", "э": "e", "ю": "yu", "я": "ya",
    "ъ": "", "ь": "",
}


def transliterate(value: str) -> str:
    result: list[str] = []
    for char in value.lower():
        result.append(TRANSLIT.get(char, char))
    return "".join(result)


def sanitize_login(value: str, allow_dot: bool = True) -> str:
    pattern = r"[^a-z0-9._]+" if allow_dot else r"[^a-z0-9_]+"
    cleaned = re.sub(pattern, "_", value.lower())
    cleaned = re.sub(r"_+", "_", cleaned).strip("._")
    return cleaned


def _login_prefix(group_name: str) -> str:
    """Префикс логина строится из названия группы (без жёсткой привязки к
    конкретной группе) — например 'Группа 7' -> 'group_7', 'VIP' -> 'vip'."""
    slug = sanitize_login(transliterate(group_name), allow_dot=False)
    return slug or "operator"


def login_base(row: OperatorRow, group_name: str, fallback_index: int) -> str:
    if row.email and "@" in row.email:
        base = sanitize_login(row.email.split("@", 1)[0])
        if base:
            return base

    prefix = _login_prefix(group_name)
    parts = [sanitize_login(transliterate(part), allow_dot=False) for part in row.full_name.split()]
    parts = [part for part in parts if part]
    if len(parts) >= 2:
        return f"{prefix}_{parts[0]}_{parts[1]}"
    if parts:
        return f"{prefix}_{parts[0]}"
    return f"{prefix}_operator_{fallback_index:03d}"


def unique_login(base: str, used_usernames: set[str]) -> str:
    candidate = base
    suffix = 2
    while candidate in used_usernames:
        candidate = f"{base}_{suffix}"
        suffix += 1
    used_usernames.add(candidate)
    return candidate


def generate_temp_password(username: str, used_passwords: set[str]) -> str:
    alphabet = string.ascii_letters + string.digits + SPECIAL_CHARS
    rng = random.SystemRandom()
    for _ in range(200):
        chars = [
            secrets.choice(string.ascii_uppercase),
            secrets.choice(string.ascii_lowercase),
            secrets.choice(string.digits),
            secrets.choice(SPECIAL_CHARS),
        ]
        chars.extend(secrets.choice(alphabet) for _ in range(8))
        rng.shuffle(chars)
        password = "".join(chars)
        if password != username and password not in used_passwords:
            used_passwords.add(password)
            return password
    raise RuntimeError("Не удалось сгенерировать уникальный временный пароль")


def _status_fields(participation_status: str) -> tuple[str, bool]:
    is_participating = participation_status == "participating"
    return ("active" if is_participating else "inactive", is_participating)


def _write_credentials(path: Path, credentials: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=["full_name", "username", "temporary_password", "email", "group", "participation_status"],
        )
        writer.writeheader()
        writer.writerows(credentials)


def _write_report(path: Path, report: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_") or "group"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ручной массовый импорт операторов из xlsx в указанную группу."
    )
    parser.add_argument("--file", required=True, help="Путь к Excel-файлу с операторами")
    parser.add_argument("--group", required=True, help="Название группы (создаётся при --apply, если не существует)")
    parser.add_argument("--apply", action="store_true", help="Записать изменения в БД (по умолчанию — dry-run)")
    parser.add_argument("--actor-user-id", type=int, default=None, help="ID пользователя для записи в audit log")
    parser.add_argument("--credentials-output", default="", help="Путь для CSV с одноразовыми доступами")
    parser.add_argument("--report-output", default="", help="Путь для JSON-отчёта об импорте")
    parser.add_argument("--allow-default-db", action="store_true", help="Разрешить запуск без переменной DATABASE_URL")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not os.getenv("DATABASE_URL") and not args.allow_default_db:
        print("DATABASE_URL не задан. Для production-импорта укажите Railway DATABASE_URL.", file=sys.stderr)
        return 2

    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))

    from sqlalchemy import func, select
    from app.core.security import hash_password
    from app.database.db import SessionLocal
    from app.models.entities import AuditLog, Group, Operator, User

    xlsx_path = Path(args.file).expanduser().resolve()
    rows, warnings, errors = parse_operator_rows(xlsx_path)
    now_stamp = datetime.now(timezone.utc).replace(tzinfo=None).strftime("%Y%m%d_%H%M%S")
    group_slug = _slug(args.group)

    credentials_path = Path(args.credentials_output) if args.credentials_output else root / "secure_outputs" / f"operator_credentials_{group_slug}_{now_stamp}.csv"
    report_path = Path(args.report_output) if args.report_output else root / "secure_outputs" / f"operator_import_report_{group_slug}_{now_stamp}.json"

    created_operators = 0
    updated_operators = 0
    created_accounts = 0
    updated_accounts = 0
    skipped_rows = len(errors)
    credentials: list[dict[str, str]] = []
    used_passwords: set[str] = set()

    db = SessionLocal()
    try:
        used_usernames = {
            username
            for (username,) in db.execute(select(User.username)).all()
            if username
        }

        group = db.scalar(select(Group).where(func.lower(Group.name) == args.group.lower()))
        group_created = group is None
        if group_created and args.apply:
            group = Group(name=args.group, status="active")
            db.add(group)
            db.flush()
            db.add(AuditLog(
                action="group_created",
                entity_type="group",
                entity_id=group.id,
                details=f"Группа {args.group} создана массовым импортом операторов",
                performed_by_user_id=args.actor_user_id,
            ))

        for fallback_index, row in enumerate(rows, start=1):
            operator = None
            if row.email:
                operator = db.scalar(select(Operator).where(func.lower(Operator.email) == row.email.lower()))
            if operator is None:
                operator = db.scalar(select(Operator).where(func.lower(Operator.full_name) == row.full_name.lower()))

            status_value, is_active = _status_fields(row.participation_status)

            if operator is None:
                created_operators += 1
                username = unique_login(login_base(row, args.group, fallback_index), used_usernames)
                temp_password = generate_temp_password(username, used_passwords)
                credentials.append({
                    "full_name": row.full_name,
                    "username": username,
                    "temporary_password": temp_password,
                    "email": row.email or "",
                    "group": args.group,
                    "participation_status": row.participation_status,
                })

                if args.apply:
                    operator = Operator(
                        full_name=row.full_name,
                        group_id=group.id if group else None,
                        group_name=args.group,
                        participation_status=row.participation_status,
                        employment_status="active",
                        status=status_value,
                        is_active=is_active,
                        position="operator",
                        email=row.email,
                        current_balance=0,
                        reserved_balance=0,
                        total_earned=0,
                        total_spent=0,
                    )
                    db.add(operator)
                    db.flush()

                    user = User(
                        full_name=row.full_name,
                        username=username,
                        password_hash=hash_password(temp_password),
                        role="operator",
                        operator_id=operator.id,
                        is_active=True,
                        must_change_password=True,
                    )
                    db.add(user)
                    db.flush()
                    operator.user_id = user.id
                    created_accounts += 1

                    db.add(AuditLog(
                        action="operator_bulk_imported",
                        entity_type="operator",
                        entity_id=operator.id,
                        details=f"Оператор {row.full_name} создан массовым импортом в группе {args.group}",
                        performed_by_user_id=args.actor_user_id,
                    ))
                else:
                    created_accounts += 1
                continue

            updated_operators += 1
            if args.apply:
                operator.group_id = group.id if group else operator.group_id
                operator.group_name = args.group
                operator.participation_status = row.participation_status
                operator.employment_status = "active"
                operator.status = status_value
                operator.is_active = is_active
                operator.position = operator.position or "operator"
                operator.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
                if row.email:
                    operator.email = row.email

                user = db.get(User, operator.user_id) if operator.user_id else None
                if user is None:
                    user = db.scalar(select(User).where(User.operator_id == operator.id))

                if user is None:
                    username = unique_login(login_base(row, args.group, fallback_index), used_usernames)
                    temp_password = generate_temp_password(username, used_passwords)
                    user = User(
                        full_name=operator.full_name,
                        username=username,
                        password_hash=hash_password(temp_password),
                        role="operator",
                        operator_id=operator.id,
                        is_active=True,
                        must_change_password=True,
                    )
                    db.add(user)
                    db.flush()
                    operator.user_id = user.id
                    created_accounts += 1
                    credentials.append({
                        "full_name": operator.full_name,
                        "username": username,
                        "temporary_password": temp_password,
                        "email": operator.email or "",
                        "group": args.group,
                        "participation_status": operator.participation_status,
                    })
                else:
                    user.full_name = operator.full_name
                    user.operator_id = operator.id
                    user.is_active = True
                    operator.user_id = user.id
                    if user.role not in HIGHER_ROLES and user.role != "operator":
                        user.role = "operator"
                        updated_accounts += 1

                db.add(AuditLog(
                    action="operator_bulk_import_updated",
                    entity_type="operator",
                    entity_id=operator.id,
                    details=f"Оператор {operator.full_name} обновлён массовым импортом в группе {args.group}",
                    performed_by_user_id=args.actor_user_id,
                ))

        report = {
            "mode": "apply" if args.apply else "dry-run",
            "source_file": str(xlsx_path),
            "group": args.group,
            "group_created": group_created,
            "rows_in_excel": len(rows),
            "created_operators": created_operators,
            "updated_operators": updated_operators,
            "created_accounts": created_accounts,
            "updated_accounts": updated_accounts,
            "skipped_rows": skipped_rows,
            "operators_without_email": sum(1 for row in rows if not row.email),
            "participating": sum(1 for row in rows if row.participation_status == "participating"),
            "not_participating": sum(1 for row in rows if row.participation_status == "not_participating"),
            "credentials_file": str(credentials_path) if args.apply and credentials else None,
            "report_file": str(report_path),
            "warnings": warnings,
            "errors": errors,
        }

        if args.apply:
            if credentials:
                _write_credentials(credentials_path, credentials)
            _write_report(report_path, report)
            db.commit()
        else:
            db.rollback()

        print(json.dumps(report, ensure_ascii=False, indent=2))
        if args.apply and credentials:
            print(f"Временные пароли сохранены только в CSV: {credentials_path}")
        elif not args.apply:
            print("Dry-run завершён. Для записи в БД повторите команду с --apply.")
        return 0

    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
