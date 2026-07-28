from __future__ import annotations

from datetime import timedelta


def test_zero_idle_timeout_does_not_log_out_on_refresh(make_client, db_session, monkeypatch):
    """SESSION_IDLE_TIMEOUT_MINUTES=0 должно означать «без таймаута простоя»,
    а не «протухать мгновенно».

    Раньше значение 0 приводило к 401 на первом же обновлении (логаут на
    каждом refresh). Значение > 0 по-прежнему завершает простаивающую сессию.
    """
    from app.core.config import get_settings
    from app.models import entities as m
    from app.models.entities import now_utc

    fresh = make_client()
    login = fresh.post(
        "/api/auth/login", json={"username": "admin", "password": "TestAdmin123!"}
    )
    assert login.status_code == 200, login.text
    session = db_session.query(m.UserSession).order_by(m.UserSession.id.desc()).first()
    assert session is not None

    settings = get_settings()

    # Положительный таймаут + давний last_seen -> сессия завершается (защита цела).
    session.last_seen_at = now_utc() - timedelta(hours=2)
    db_session.commit()
    monkeypatch.setattr(settings, "session_idle_timeout_minutes", 30)
    assert fresh.get("/api/dashboard").status_code == 401

    # Нулевой таймаут -> простой не учитывается, обновление работает.
    session.last_seen_at = now_utc() - timedelta(hours=2)
    db_session.commit()
    monkeypatch.setattr(settings, "session_idle_timeout_minutes", 0)
    assert fresh.get("/api/auth/me").status_code == 200
