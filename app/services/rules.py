"""Доступ к настройкам геймификации и запись в журнал аудита."""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.settings import SETTINGS_SINGLETON_ID, AuditLog, GamificationSettings

audit_ip: ContextVar[str | None] = ContextVar("audit_ip", default=None)


async def get_rules(session: AsyncSession) -> GamificationSettings:
    """Возвращает строку настроек, создавая её со значениями по умолчанию."""
    rules = await session.scalar(
        select(GamificationSettings).where(GamificationSettings.id == SETTINGS_SINGLETON_ID)
    )
    if rules is None:
        rules = GamificationSettings(id=SETTINGS_SINGLETON_ID)
        session.add(rules)
        await session.flush()
    return rules


async def write_audit(
    session: AsyncSession,
    *,
    actor_id: int | None,
    action: str,
    entity_type: str,
    entity_id: str | int | None = None,
    payload: dict[str, Any] | None = None,
    comment: str | None = None,
) -> AuditLog:
    """Фиксирует действие персонала. Записи журнала не редактируются."""
    entry = AuditLog(
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=None if entity_id is None else str(entity_id),
        payload=payload,
        comment=comment,
        ip_address=audit_ip.get(),
    )
    session.add(entry)
    await session.flush()
    return entry
