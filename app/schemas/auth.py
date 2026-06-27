from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserCreate(BaseModel):
    full_name: str
    username: str
    password: str = Field(min_length=8)
    role: str
    operator_id: Optional[int] = None
    is_active: bool = True


class UserRead(BaseModel):
    id: int
    full_name: str
    username: str
    role: str
    operator_id: Optional[int]
    is_active: bool

    model_config = {"from_attributes": True}
