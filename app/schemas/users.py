from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.operator_levels import OperatorLevelBadge


class UserCreateRequest(BaseModel):
    full_name: str
    login: str
    email: Optional[str] = None
    phone: Optional[str] = None
    role: str
    group_id: Optional[int] = None
    password: str = Field(min_length=8)
    confirm_password: Optional[str] = None
    status: str = "active"


class UserUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    login: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    group_id: Optional[int] = None
    status: Optional[str] = None
    is_active: Optional[bool] = None


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
    email: Optional[str] = None
    phone: Optional[str] = None
    role: str
    group_id: Optional[int] = None
    group_name: Optional[str] = None
    operator_id: Optional[int] = None
    level: Optional[OperatorLevelBadge] = None
    status: str
    is_active: bool
    must_change_password: bool
    can_manage_operators: bool
    created_at: datetime
    rate: Optional[float] = None
    tenure_days: Optional[int] = None
    start_date: Optional[str] = None


class UserListOut(BaseModel):
    items: list[UserReadOut]
    total: int
    page: int
    limit: int
