"""Private, durable drafts for the training CRM (never production requests)."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, LargeBinary, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class CrmDraft(Base):
    __tablename__ = "crm_drafts"
    __table_args__ = (UniqueConstraint("user_id", "scope"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    scope: Mapped[str] = mapped_column(String(40))
    draft_key: Mapped[str] = mapped_column(String(36), unique=True)
    revision: Mapped[int] = mapped_column(default=1)
    form: Mapped[dict] = mapped_column(JSON, default=dict)
    appeal_id: Mapped[int | None] = mapped_column(ForeignKey("crm_appeals.id"), nullable=True)
    remove_appeal_attachment_ids: Mapped[list] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class CrmDraftAttachment(Base):
    __tablename__ = "crm_draft_attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    draft_id: Mapped[int] = mapped_column(
        ForeignKey("crm_drafts.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    mime: Mapped[str] = mapped_column(String(80))
    size: Mapped[int]
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
