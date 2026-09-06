"""Схемы пользователей, групп и аутентификации."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.core.config import settings
from app.models.enums import Role
from app.schemas.common import ORMModel


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Время жизни access-токена в секундах")


class RefreshRequest(BaseModel):
    refresh_token: str


class GroupBrief(ORMModel):
    id: int
    code: str
    name: str


class UserBrief(ORMModel):
    id: int
    full_name: str
    group: GroupBrief | None = None


class UserOut(ORMModel):
    id: int
    login: str
    email: str | None = None
    full_name: str
    role: Role
    is_active: bool
    is_developer: bool = False
    hired_on: date | None = None
    group: GroupBrief | None = None


class PasswordMixin(BaseModel):
    password: str

    @field_validator("password")
    @classmethod
    def _check_length(cls, value: str) -> str:
        if len(value) < settings.PASSWORD_MIN_LENGTH:
            raise ValueError(
                f"Пароль должен содержать не менее {settings.PASSWORD_MIN_LENGTH} символов"
            )
        return value


class UserCreate(PasswordMixin):
    login: str = Field(min_length=3, max_length=150)
    full_name: str = Field(min_length=3, max_length=255)
    email: EmailStr | None = None
    role: Role = Role.OPERATOR
    group_id: int | None = Field(default=None, gt=0)
    hired_on: date | None = None

    @field_validator("login", "full_name", mode="before")
    @classmethod
    def _trim_text(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value


class UserUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    full_name: str | None = Field(default=None, min_length=3, max_length=255)
    email: EmailStr | None = None
    role: Role | None = None
    group_id: int | None = Field(default=None, gt=0)
    is_active: bool | None = None
    hired_on: date | None = None

    @model_validator(mode="after")
    def _required_fields_not_null(self) -> UserUpdate:
        for name in ("full_name", "role", "is_active"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError("ФИО, роль и статус не могут быть пустыми")
        return self


class PasswordChange(PasswordMixin):
    current_password: str


class PasswordReset(PasswordMixin):
    """Сброс пароля оператора администратором."""


class GroupCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    supervisor_id: int | None = Field(default=None, gt=0)


class GroupUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=255)
    supervisor_id: int | None = Field(default=None, gt=0)
    is_active: bool | None = None

    @model_validator(mode="after")
    def _required_fields_not_null(self) -> GroupUpdate:
        for name in ("name", "is_active"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError("Название и статус группы не могут быть пустыми")
        return self


class GroupOut(ORMModel):
    id: int
    code: str
    name: str
    is_active: bool
    supervisor: UserBrief | None = None
    member_count: int = 0
    operator_count: int = 0
