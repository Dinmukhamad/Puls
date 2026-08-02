from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from fastapi import HTTPException
from openpyxl import Workbook

from app.core.datetime_utils import business_today
from app.core.security import AccessScopeKind, hash_password, require_group_scope
from app.models.entities import User, UserSession
from app.modules.auth.credentials import change_password, change_username
from app.modules.auth.rate_limit import LoginRateLimiter
from app.modules.reports.xlsx_validation import validate_xlsx_archive


def _user(role: str, *, group_id: int | None = None) -> User:
    return User(
        full_name="Scope test",
        username=f"scope_{role}_{group_id}",
        password_hash="unused",
        role=role,
        group_id=group_id,
        is_active=True,
    )


def test_supervisor_without_group_is_denied_before_business_query(db_session):
    with pytest.raises(HTTPException) as exc:
        require_group_scope(db_session, _user("supervisor"))
    assert exc.value.status_code == 403


def test_access_scope_is_explicit_for_admin_and_supervisor(db_session):
    assert require_group_scope(db_session, _user("admin")).kind == AccessScopeKind.UNRESTRICTED
    scope = require_group_scope(db_session, _user("supervisor", group_id=42))
    assert scope.kind == AccessScopeKind.GROUP
    assert scope.group_id == 42


def test_login_rate_limit_uses_account_and_ip_keys():
    limiter = LoginRateLimiter(threshold=2, ip_threshold=2, maximum_delay=10)
    limiter.failure("Operator", "10.0.0.1", now=100)
    limiter.failure("Operator", "10.0.0.1", now=100)
    assert limiter.retry_after("operator", "10.0.0.99", now=100) == 1
    assert limiter.retry_after("someone", "10.0.0.1", now=100) == 1
    limiter.success("operator", "10.0.0.1", now=100)
    # Аккаунт разблокирован, но IP — нет: иначе любой обладатель валидной
    # учётки сбрасывал бы IP-лимит и продолжал перебор чужого пароля.
    assert limiter.retry_after("operator", "10.0.0.99", now=100) == 0
    assert limiter.retry_after("someone", "10.0.0.1", now=100) == 1


def test_ip_threshold_is_looser_than_account_threshold():
    """Коллеги за общим NAT делят один IP — пара опечаток не должна запирать офис."""
    limiter = LoginRateLimiter(threshold=2, maximum_delay=10)
    assert limiter.ip_threshold > limiter.threshold
    limiter.failure("alice", "10.0.0.1", now=100)
    limiter.failure("bob", "10.0.0.1", now=100)
    limiter.failure("carol", "10.0.0.1", now=100)
    # Каждый аккаунт ошибся лишь раз, общий IP ещё не набрал свой порог.
    assert limiter.retry_after("dave", "10.0.0.1", now=100) == 0


def test_failed_logins_do_not_grow_memory_forever():
    """Перебор случайных логинов раньше надувал словарь до OOM."""
    limiter = LoginRateLimiter(threshold=2, maximum_delay=10, window=60)
    for index in range(500):
        limiter.failure(f"ghost-{index}", f"10.1.{index // 256}.{index % 256}", now=100)
    assert limiter.entry_count() > 0

    # Окно прошло, новых попыток от старых ключей не было — записи истекают.
    limiter.failure("someone", "10.9.9.9", now=100 + 61 + 11)
    assert limiter.entry_count() <= 2, (
        f"протухшие записи не вычищены: {limiter.entry_count()}"
    )


def test_entry_count_is_capped_even_within_the_window():
    """Всплеск уникальных ключей внутри окна не должен переполнять память."""
    limiter = LoginRateLimiter(threshold=2, maximum_delay=10, window=3600, max_entries=50)
    for index in range(400):
        limiter.failure(f"ghost-{index}", f"10.2.{index // 256}.{index % 256}", now=100 + index)
    assert limiter.entry_count() <= 50


def test_business_today_uses_almaty_boundary():
    assert business_today(datetime(2026, 7, 26, 20, 0, tzinfo=UTC)).isoformat() == "2026-07-27"


def test_xlsx_validator_rejects_non_zip_and_incomplete_container():
    with pytest.raises(ValueError, match="XLSX"):
        validate_xlsx_archive(b"not an archive", "Report")

    stream = BytesIO()
    with ZipFile(stream, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
    with pytest.raises(ValueError, match="структура"):
        validate_xlsx_archive(stream.getvalue(), "Report")


def test_xlsx_validator_accepts_small_real_workbook():
    workbook = Workbook()
    workbook.active.append(["ФИО", "01.07.2026"])
    workbook.active.append(["Тестовый Оператор", 95])
    stream = BytesIO()
    workbook.save(stream)
    workbook.close()
    validate_xlsx_archive(stream.getvalue(), "Report")


def test_canonical_credentials_revoke_every_active_session(db_session):
    password = "Current123!"
    suffix = uuid4().hex[:10]
    user = User(
        full_name="Credential test",
        username=f"credential_{suffix}",
        password_hash=hash_password(password),
        role="operator",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    first = UserSession(
        session_id=f"session_{suffix}",
        user_id=user.id,
        status="active",
    )
    db_session.add(first)
    db_session.flush()

    previous, current = change_username(
        db_session,
        user,
        current_password=password,
        new_username=f"renamed.{suffix}",
    )
    assert previous.startswith("credential_")
    assert current.startswith("renamed.")
    assert first.status == "revoked"

    second = UserSession(
        session_id=f"session_password_{suffix}",
        user_id=user.id,
        status="active",
    )
    db_session.add(second)
    db_session.flush()
    change_password(
        db_session,
        user,
        current_password=password,
        new_password="Changed123!",
        confirmation="Changed123!",
    )
    assert second.status == "revoked"
