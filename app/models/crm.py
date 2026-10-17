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

from app.db.base import Base, TimestampMixin, utcnow


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
    revision: Mapped[int] = mapped_column(default=1)
    # A saved training record keeps its task binding; business status remains independent.
    training_task: Mapped[str | None] = mapped_column(String(40), nullable=True)
    last_edit_request_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class CrmAttachment(Base):
    __tablename__ = "crm_attachments"
    id: Mapped[int] = mapped_column(primary_key=True)
    appeal_id: Mapped[int] = mapped_column(ForeignKey("crm_appeals.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    mime: Mapped[str] = mapped_column(String(80))
    size: Mapped[int]
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)


class CrmTicket(Base):
    __tablename__ = "crm_tickets"
    id: Mapped[int] = mapped_column(primary_key=True)
    appeal_id: Mapped[int] = mapped_column(ForeignKey("crm_appeals.id"), unique=True)
    status: Mapped[str] = mapped_column(String(30), default="new")
    revision: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CrmTicketEvent(Base):
    __tablename__ = "crm_ticket_events"
    __table_args__ = (UniqueConstraint("ticket_id", "request_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("crm_tickets.id"), index=True)
    request_id: Mapped[str] = mapped_column(String(36))
    action: Mapped[str] = mapped_column(String(30))
    author_name: Mapped[str] = mapped_column(String(255))
    comment: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CrmCourseCapture(Base):
    __tablename__ = "crm_course_captures"
    __table_args__ = (UniqueConstraint("user_id", "task_key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    task_key: Mapped[str] = mapped_column(String(40))
    driver_id: Mapped[str] = mapped_column(String(80))
    incoming_phone: Mapped[str] = mapped_column(String(40))
    digest: Mapped[str] = mapped_column(String(64))
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CrmTicketAttachment(Base):
    __tablename__ = "crm_ticket_attachments"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("crm_ticket_events.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    mime: Mapped[str] = mapped_column(String(80))
    size: Mapped[int]
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
