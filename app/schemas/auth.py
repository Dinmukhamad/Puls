from __future__ import annotations

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    full_name: str
    username: str
    password: str = Field(min_length=8)
    role: str
    operator_id: int | None = None
    can_manage_operators: bool = False
    must_change_password: bool = False
    is_active: bool = True


class UserRead(BaseModel):
    id: int
    full_name: str
    username: str
    role: str
    operator_id: int | None
    can_manage_operators: bool = False
    must_change_password: bool = False
    is_active: bool

    model_config = {"from_attributes": True}


class AccountCredentialsUpdate(BaseModel):
    username: str | None = None
    current_password: str | None = None
    new_password: str | None = Field(default=None, min_length=8)
    repeat_password: str | None = None
