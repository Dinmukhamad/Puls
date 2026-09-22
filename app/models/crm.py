"""Persistent shared training CRM, isolated from production requests."""

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class CrmCategory(Base):
    __tablename__ = "crm_categories"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    parent_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    label: Mapped[str] = mapped_column(String(160))
    hint: Mapped[str] = mapped_column(Text, default="")
    # Defaults are shipped with the application; additions are shared by all users.


class CrmInstruction(Base):
    __tablename__ = "crm_instructions"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    title: Mapped[str] = mapped_column(String(180))
    body: Mapped[str] = mapped_column(Text)
    steps: Mapped[list] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(default=1)
    updated_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))


class CrmAppeal(Base, TimestampMixin):
    __tablename__ = "crm_appeals"
    __table_args__ = (UniqueConstraint("author_id", "request_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[str] = mapped_column(String(36))
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    author_name: Mapped[str] = mapped_column(String(255))
    channel: Mapped[str] = mapped_column(String(12))
    phone: Mapped[str] = mapped_column(String(40), index=True)
    license_number: Mapped[str] = mapped_column(String(80))
    driver_id: Mapped[str] = mapped_column(String(80), default="")
    contacted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    park: Mapped[str] = mapped_column(String(100), index=True)
    city: Mapped[str] = mapped_column(String(100))
    category_ids: Mapped[list] = mapped_column(JSON)
    category_labels: Mapped[list] = mapped_column(JSON)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    comment: Mapped[str] = mapped_column(Text, default="")
    is_ticket: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="recorded", index=True)


class CrmAttachment(Base):
    __tablename__ = "crm_attachments"
    id: Mapped[int] = mapped_column(primary_key=True)
    appeal_id: Mapped[int] = mapped_column(ForeignKey("crm_appeals.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    mime: Mapped[str] = mapped_column(String(80))
    size: Mapped[int]
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
