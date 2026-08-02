from __future__ import annotations

from app.core.config import get_settings
from app.modules.auth.rate_limit import login_rate_limiter
from app.modules.auth.router import _client_ip


class _Headers(dict):
    def get(self, key, default=None):
        return super().get(key.lower(), default)


class _Client:
    def __init__(self, host: str) -> None:
        self.host = host


class _Req:
    def __init__(self, host: str, headers: dict) -> None:
        self.client = _Client(host)
        self.headers = _Headers({k.lower(): v for k, v in headers.items()})


def test_forwarded_ip_ignored_by_default(monkeypatch):
    """Без trust_forwarded_for X-Forwarded-For нельзя подделать: берём прямой IP."""
    settings = get_settings()
    monkeypatch.setattr(settings, "trust_forwarded_for", False)
    req = _Req("10.0.0.9", {"X-Forwarded-For": "203.0.113.7, 10.0.0.9"})
    assert _client_ip(req) == "10.0.0.9"


def test_forwarded_ip_used_when_trusted(monkeypatch):
    """С trust_forwarded_for (за PaaS-прокси) берём реальный IP клиента из XFF.

    Это чинит глобальную блокировку входа на Render: без разбора XFF все
    пользователи делили IP прокси, и лимит попыток срабатывал сразу на всех.
    """
    settings = get_settings()
    monkeypatch.setattr(settings, "trust_forwarded_for", True)
    req = _Req("10.0.0.9", {"X-Forwarded-For": "203.0.113.7, 10.0.0.9"})
    assert _client_ip(req) == "203.0.113.7"


def test_rate_limit_is_per_client_ip_behind_proxy(db_session, make_client, monkeypatch):
    """За прокси блокировка одного клиента по IP не должна блокировать другого."""
    settings = get_settings()
    monkeypatch.setattr(settings, "trust_forwarded_for", True)
    client = make_client()

    # Разные несуществующие аккаунты, чтобы сработала именно IP-блокировка,
    # а не аккаунтная. Порог IP вдвое выше аккаунтного (коллеги за общим NAT
    # делят адрес), поэтому попыток нужно больше.
    last = None
    for i in range(login_rate_limiter.ip_threshold + 1):
        last = client.post(
            "/api/auth/login",
            json={"username": f"ghostA{i}", "password": "bad"},
            headers={"X-Forwarded-For": "203.0.113.7"},
        )
    assert last.status_code == 429

    # Другой клиентский IP (B) не должен быть заблокирован блокировкой A.
    other = client.post(
        "/api/auth/login",
        json={"username": "ghostB", "password": "bad"},
        headers={"X-Forwarded-For": "198.51.100.42"},
    )
    assert other.status_code == 401
