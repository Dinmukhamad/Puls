from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    full_name: str
    username: str
    password: str = Field(min_length=8)
    role: str
    operator_id: Optional[int] = None
    can_manage_operators: bool = False
    is_active: bool = True


class UserRead(BaseModel):
    id: int
    full_name: str
    username: str
    role: str
    operator_id: Optional[int]
    can_manage_operators: bool = False
    is_active: bool

    model_config = {"from_attributes": True}


class AccountCredentialsUpdate(BaseModel):
    username: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = Field(default=None, min_length=8)
    repeat_password: Optional[str] = None
