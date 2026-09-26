"""City performance telemetry, kept 90 days to tune the 3D city quality tiers (TZ §8.4)."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.models.telemetry import CityPerfReport

RETENTION_DAYS = 90


async def purge_old_reports(session: AsyncSession) -> int:
    """Deletes reports older than the retention period; returns how many were removed."""
    cutoff = utcnow() - timedelta(days=RETENTION_DAYS)
    result = await session.execute(delete(CityPerfReport).where(CityPerfReport.created_at < cutoff))
    await session.commit()
    return result.rowcount or 0
