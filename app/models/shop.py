"""Магазин бонусов и заявки операторов (п. 4.3, 4.4.4)."""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import ShopRequestStatus

if TYPE_CHECKING:
    from app.models.user import User


class ShopItem(Base, TimestampMixin):
    """Позиция каталога бонусов."""

    __tablename__ = "shop_items"
    __table_args__ = (CheckConstraint("price > 0", name="price_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    price: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    #: Общий лимит выдач за всё время. NULL - без ограничения.
    stock_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Лимит на одного оператора в течение месяца. NULL - без ограничения.
    per_user_monthly_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Требуется ли согласование супервайзера. Оставлено настраиваемым:
    #: часть бонусов (например, бейдж «Звезда недели») может выдаваться сразу.
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)

    requests: Mapped[list[ShopRequest]] = relationship("ShopRequest", back_populates="item")


class ShopRequest(Base, TimestampMixin):
    """
    Заявка оператора на бонус.

    Жизненный цикл (п. 4.3.2): ``new`` (коины зарезервированы) ->
    ``approved`` (коины списаны) -> ``fulfilled`` (бонус выдан),
    либо ``rejected`` / ``cancelled`` со снятием резерва.
    """

    __tablename__ = "shop_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    item_id: Mapped[int] = mapped_column(
        ForeignKey("shop_items.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    #: Цена фиксируется в момент подачи: последующее изменение прайса
    #: не влияет на уже поданные заявки.
    price: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[ShopRequestStatus] = mapped_column(
        String(16), default=ShopRequestStatus.NEW, nullable=False, index=True
    )
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    decision_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    fulfilled_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    item: Mapped[ShopItem] = relationship("ShopItem", back_populates="requests")
    user: Mapped[User] = relationship("User", foreign_keys=[user_id])
    decided_by: Mapped[User | None] = relationship("User", foreign_keys=[decided_by_id])
    fulfilled_by: Mapped[User | None] = relationship("User", foreign_keys=[fulfilled_by_id])

    @property
    def is_open(self) -> bool:
        return self.status == ShopRequestStatus.NEW
