"""Пользователи, группы и коин-счета."""
from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.developer import is_developer
from app.db.base import Base, TimestampMixin
from app.models.enums import ROLE_LEVEL, Role

if TYPE_CHECKING:
    from app.models.badge import UserBadge
    from app.models.coin import CoinTransaction


class Group(Base, TimestampMixin):
    """Группа операторов, закреплённая за супервайзером."""

    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    #: use_alter разрывает цикл groups -> users -> groups при создании схемы.
    supervisor_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", use_alter=True), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    supervisor: Mapped[User | None] = relationship(
        "User", foreign_keys=[supervisor_id], back_populates="supervised_groups"
    )
    members: Mapped[list[User]] = relationship(
        "User", foreign_keys="User.group_id", back_populates="group"
    )


class User(Base, TimestampMixin):
    """Участник системы. Оператор, супервайзер, руководитель или администратор."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    login: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    full_name: Mapped[str] = mapped_column(String(255), index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(String(32), default=Role.OPERATOR, index=True)
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey("groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    hired_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    group: Mapped[Group | None] = relationship(
        "Group", foreign_keys=[group_id], back_populates="members"
    )
    supervised_groups: Mapped[list[Group]] = relationship(
        "Group", foreign_keys="Group.supervisor_id", back_populates="supervisor"
    )
    account: Mapped[CoinAccount] = relationship(
        "CoinAccount",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    transactions: Mapped[list[CoinTransaction]] = relationship(
        "CoinTransaction",
        foreign_keys="CoinTransaction.user_id",
        back_populates="user",
    )
    badges: Mapped[list[UserBadge]] = relationship(
        "UserBadge", back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def is_developer(self) -> bool:
        return is_developer(self)

    @property
    def role_level(self) -> int:
        return ROLE_LEVEL[Role(self.role)]

    def has_role_at_least(self, role: Role) -> bool:
        return self.role_level >= ROLE_LEVEL[role]

    @property
    def is_staff(self) -> bool:
        """Супервайзер и выше — доступ к административной панели."""
        return self.has_role_at_least(Role.SUPERVISOR)


class CoinAccount(Base, TimestampMixin):
    """
    Денормализованный счёт оператора.

    Источник истины — журнал ``coin_transactions``; счёт хранит агрегаты,
    чтобы не пересчитывать сумму по всей истории на каждый запрос.
    Инварианты: ``balance >= 0``, ``0 <= reserved <= balance``.
    """

    __tablename__ = "coin_accounts"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    balance: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reserved: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_earned: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_spent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    user: Mapped[User] = relationship("User", back_populates="account")

    @property
    def available(self) -> int:
        """Коины, доступные к трате: баланс за вычетом резерва под заявки."""
        return self.balance - self.reserved
