"""Вход не должен выдавать, существует ли логин.

Раньше проверка была `if not user or not verify_password(...)`: при
несуществующем логине bcrypt не считался вовсе, и ответ приходил на порядок
быстрее, чем при существующем. По этой разнице собирают список валидных
логинов перед перебором паролей.

Тест не меряет время (на CI это флаки), а проверяет причину: хеш сверяется
в обоих случаях.
"""
from __future__ import annotations

from app.core import security
from app.modules.auth import router as auth_router
from tests.conftest import ADMIN_CREDENTIALS


def _reset_limiter():
    auth_router.login_rate_limiter.__init__()


def test_password_hash_is_verified_even_for_unknown_user(make_client, monkeypatch):
    _reset_limiter()
    calls: list[str] = []
    original = security.verify_password

    def spy(password: str, password_hash: str) -> bool:
        calls.append(password_hash)
        return original(password, password_hash)

    monkeypatch.setattr(auth_router, "verify_password", spy)
    client = make_client()

    response = client.post(
        "/api/auth/login",
        json={"username": "no-such-user-at-all", "password": "whatever"},
    )
    assert response.status_code == 401
    assert calls, "verify_password не вызывался — несуществующий логин отвечает быстрее"
    assert calls[0] == security.dummy_password_hash()
    _reset_limiter()


def test_known_user_with_wrong_password_gives_same_answer(make_client):
    _reset_limiter()
    client = make_client()

    unknown = client.post(
        "/api/auth/login", json={"username": "definitely-missing", "password": "bad"}
    )
    known = client.post(
        "/api/auth/login",
        json={"username": ADMIN_CREDENTIALS["username"], "password": "wrong-password"},
    )
    # Ответ обязан быть неотличим: один код и одна формулировка.
    assert unknown.status_code == known.status_code == 401
    assert unknown.json()["detail"] == known.json()["detail"]
    _reset_limiter()


def test_dummy_hash_is_a_real_bcrypt_hash_that_never_matches():
    # Заглушка обязана быть настоящим bcrypt-хешем: на мусорной строке verify
    # упал бы с ошибкой формата и обработчик отдал бы 500 вместо 401.
    dummy = security.dummy_password_hash()
    assert dummy.startswith("$2")
    assert not security.verify_password("any-user-password", dummy)
    # Стоимость должна совпадать с обычными хешами — иначе разница во времени
    # возвращается, просто с другим знаком.
    assert dummy.split("$")[2] == security.hash_password("sample").split("$")[2]
