"""
ВРЕМЕННЫЙ маршрут разового импорта операторов (13 человек на тестирование).

Зачем: на бесплатном Render нет доступа к Shell, поэтому массовое создание
через CLI-скрипт недоступно. Этот эндпоинт делает то же самое по клику
администратора и после использования УДАЛЯЕТСЯ отдельным коммитом.

Безопасность:
  - только роль admin;
  - обязателен секретный токен подтверждения (?token=...), иначе 403;
  - идемпотентность: операторы с уже существующим логином/почтой пропускаются,
    повторный вызов не плодит дубликаты;
  - данные операторов зашиты в файл (не во внешнем xlsx), группы создаются
    при отсутствии; логин — из почты до "@", пароль — случайный временный,
    оператор обязан сменить его при первом входе (must_change_password).

Использование (под админом, в браузере):
  GET  /api/users/temp-import-operators?token=СЕКРЕТ            → предпросмотр (ничего не пишет)
  POST /api/users/temp-import-operators?token=СЕКРЕТ&apply=1    → создать аккаунты
Ответ содержит список логин/пароль — сохраните его сразу, пароли больше не показываются.
"""
from __future__ import annotations

import re
import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, hash_password
from app.database.db import get_db
from app.models.entities import AuditLog, Group, Operator, User

router = APIRouter(prefix="/users", tags=["users-temp-import"])

# Токен подтверждения. Меняйте перед использованием; без совпадения — 403.
CONFIRM_TOKEN = "puls-import-2026"

# 13 операторов на тестирование (ФИО, почта, группа).
OPERATORS: list[dict] = [
    {"full_name": "Нуршова Айша Канагаткызы", "email": "nurshova_aisha_co@yandextaxi.kz", "group": "Пахриддинов Динмухамад"},
    {"full_name": "Садык Аяжан Аканкызы", "email": "sadyk_ayazhan_co@yandextaxi.kz", "group": "Пахриддинов Динмухамад"},
    {"full_name": "Нурлан Анель Нуржанкызы", "email": "nurlan_anel_co@yandextaxi.kz", "group": "Пахриддинов Динмухамад"},
    {"full_name": "Зинелгабиден Алнур", "email": "zinelgabiden_alnur_co@yandextaxi.kz", "group": "Пахриддинов Динмухамад"},
    {"full_name": "Атагельдиева Акнур Галымжанкызы", "email": "atageldieva_aknur_co@yandextaxi.kz", "group": "Пахриддинов Динмухамад"},
    {"full_name": "Арман Асет Арманулы", "email": "arman_aset_co@yandextaxi.kz", "group": "Кастек Гаухар"},
    {"full_name": "Кенжебек Данияр Бахтиярулы", "email": "kenjebek_daniar_co@yandextaxi.kz", "group": "Кастек Гаухар"},
    {"full_name": "Нурмуш Аружан Бауржанкызы", "email": "nurmush_aruzhan_co@yandextaxi.kz", "group": "Кастек Гаухар"},
    {"full_name": "Ажибаева Арухан Адилханова", "email": "azhibayeava_arukhan_co@yandextaxi.kz", "group": "Кастек Гаухар"},
    {"full_name": "Келесбаева Турсынай Нурлановна", "email": "kelesbayeva_tursynai_co@yandextaxi.kz", "group": "Элекова Арайлым"},
    {"full_name": "Мамек Балауса Мейрханкызы", "email": "mamek_balausa_co@yandextaxi.kz", "group": "Элекова Арайлым"},
    {"full_name": "Аухадиев Зульфар Замирович", "email": "aukhadiev_zulfar_co@yandextaxi.kz", "group": "Элекова Арайлым"},
    {"full_name": "Жарылкасын Айша Кайраткызы", "email": "zharylkasyn_aisha_co@yandextaxi.kz", "group": "Элекова Арайлым"},
]

_PWD_ALPHABET = string.ascii_letters + string.digits


def _login_from_email(email: str) -> str:
    base = (email or "").split("@")[0].strip().lower()
    return re.sub(r"[^a-z0-9._]", "", base) or "operator"


def _gen_password(n: int = 12) -> str:
    return "".join(secrets.choice(_PWD_ALPHABET) for _ in range(n))


def _require_admin_and_token(current_user: User, token: str) -> None:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Только администратор")
    if token != CONFIRM_TOKEN:
        raise HTTPException(status_code=403, detail="Неверный токен подтверждения")


@router.get("/temp-import-operators")
def preview_import(
    token: str = Query(""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Предпросмотр: показывает, что будет создано, ничего не меняя."""
    _require_admin_and_token(current_user, token)
    existing_logins = {u for (u,) in db.execute(select(User.username)).all()}
    existing_emails = {e for (e,) in db.execute(select(User.email)).all() if e}
    plan = []
    for op in OPERATORS:
        login = _login_from_email(op["email"])
        exists = login in existing_logins or (op["email"] in existing_emails)
        plan.append({"full_name": op["full_name"], "login": login,
                     "group": op["group"], "status": "уже есть" if exists else "будет создан"})
    return {"mode": "preview", "total": len(OPERATORS),
            "to_create": sum(1 for p in plan if p["status"] == "будет создан"), "plan": plan}


@router.post("/temp-import-operators")
def apply_import(
    token: str = Query(""),
    apply: int = Query(0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Создание аккаунтов. apply=1 — реально писать; иначе только предпросмотр."""
    _require_admin_and_token(current_user, token)

    existing_logins = {u for (u,) in db.execute(select(User.username)).all()}
    existing_emails = {e for (e,) in db.execute(select(User.email)).all() if e}
    groups = {g.name: g for g in db.scalars(select(Group)).all()}

    created, skipped, credentials = [], [], []
    used = set(existing_logins)

    for op in OPERATORS:
        email = op["email"]
        if email and email in existing_emails:
            skipped.append({"full_name": op["full_name"], "reason": "почта уже есть"})
            continue
        base = _login_from_email(email)
        login = base
        n = 2
        while login in used:
            login = f"{base}{n}"
            n += 1

        if not apply:
            credentials.append({"full_name": op["full_name"], "login": login,
                                "password": "(будет сгенерирован при apply=1)", "group": op["group"]})
            used.add(login)
            continue

        # Группа: найти или создать
        group = groups.get(op["group"])
        if not group:
            group = Group(name=op["group"], status="active")
            db.add(group)
            db.flush()
            groups[op["group"]] = group

        password = _gen_password()
        operator = Operator(
            full_name=op["full_name"], group_id=group.id, group_name=group.name,
            participation_status="participating", employment_status="active",
            status="active", is_active=True, position="operator", email=email,
            current_balance=0, reserved_balance=0, total_earned=0, total_spent=0,
        )
        db.add(operator)
        db.flush()
        user = User(
            full_name=op["full_name"], username=login,
            password_hash=hash_password(password), role="operator",
            operator_id=operator.id, group_id=group.id, email=email,
            status="active", is_active=True, can_manage_operators=False,
            must_change_password=True,
        )
        db.add(user)
        db.flush()
        operator.user_id = user.id
        db.add(AuditLog(
            action="operator_temp_imported", entity_type="operator", entity_id=operator.id,
            details=f"Оператор {op['full_name']} создан временным импортом в группе {op['group']}",
            performed_by_user_id=current_user.id,
        ))
        used.add(login)
        created.append(login)
        credentials.append({"full_name": op["full_name"], "login": login,
                            "password": password, "group": op["group"]})

    if apply:
        db.commit()

    return {
        "mode": "apply" if apply else "preview",
        "created": len(created), "skipped": len(skipped),
        "skipped_detail": skipped,
        "credentials": credentials,
        "note": "Сохраните пароли сейчас — повторно они не показываются. "
                "Операторы обязаны сменить пароль при первом входе.",
    }
