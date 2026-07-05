from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.modules.operator_levels.schemas import OperatorLevelBadge


class UserCreateRequest(BaseModel):
    full_name: str
    login: str
    email: str | None = None
    phone: str | None = None
    role: str
    group_id: int | None = None
    password: str = Field(min_length=8)
    confirm_password: str | None = None
    status: str = "active"


class UserUpdateRequest(BaseModel):
    full_name: str | None = None
    login: str | None = None
    email: str | None = None
    phone: str | None = None
    group_id: int | None = None
    status: str | None = None
    is_active: bool | None = None


class UserChangeRoleRequest(BaseModel):
    role: str
    reason: str


class UserResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=8)
    must_change_password: bool = True


class UserReadOut(BaseModel):
    id: int
    full_name: str
    login: str
    username: str
    email: str | None = None
    phone: str | None = None
    role: str
    group_id: int | None = None
    group_name: str | None = None
    operator_id: int | None = None
    level: OperatorLevelBadge | None = None
    status: str
    is_active: bool
    must_change_password: bool
    can_manage_operators: bool
    created_at: datetime
    rate: float | None = None
    tenure_days: int | None = None
    start_date: str | None = None


class UserListOut(BaseModel):
    items: list[UserReadOut]
    total: int
    page: int
    limit: int
