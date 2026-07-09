from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class NotificationRead(BaseModel):
    id: int
    type: str
    title: str
    body: str
    link: str | None
    is_read: bool
    created_at: datetime
    read_at: datetime | None

    model_config = {"from_attributes": True}


class NotificationListResponse(BaseModel):
    items: list[NotificationRead]
    total: int
    unread_count: int
