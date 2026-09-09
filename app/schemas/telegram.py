from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.user import PhoneMixin


class TelegramPassword(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(min_length=1, max_length=128)


class DriverPhone(PhoneMixin):
    model_config = ConfigDict(extra="forbid")
    phone: str = Field(min_length=8, max_length=40)

    @field_validator("phone")
    @classmethod
    def required_phone(cls, value):
        if not value:
            raise ValueError("Укажите номер телефона")
        return value


class DriverCode(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(pattern=r"^[0-9]{6}$")


class TelegramChat(BaseModel):
    id: int = Field(strict=True)
    type: str


class TelegramSender(BaseModel):
    id: int = Field(strict=True, gt=0)
    is_bot: bool = False
    username: str | None = Field(default=None, max_length=64)


class TelegramMessage(BaseModel):
    message_id: int | None = None
    chat: TelegramChat
    sender: TelegramSender | None = Field(default=None, alias="from")
    text: str | None = Field(default=None, max_length=4096)


class TelegramCallback(BaseModel):
    id: str = Field(max_length=256)
    sender: TelegramSender = Field(alias="from")
    message: TelegramMessage | None = None
    data: str | None = Field(default=None, max_length=64)


class TelegramUpdate(BaseModel):
    update_id: int
    message: TelegramMessage | None = None
    callback_query: TelegramCallback | None = None
