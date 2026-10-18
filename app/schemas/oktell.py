"""Discriminated action inputs reject fields unrelated to the chosen action."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator


class RequestInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: UUID


class LoginInput(RequestInput):
    action: Literal["login"]
    login: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=100)


class SimpleInput(RequestInput):
    action: Literal["join", "leave", "logout", "resume", "call_end", "reset", "answer"]


class OfficeStatusInput(RequestInput):
    action: Literal["office_status"]
    status: Literal["available", "forward", "dnd"]
    number: str | None = Field(default=None, min_length=3, max_length=20)

    @model_validator(mode="after")
    def forwarding_number(self):
        if (self.status == "forward") != (self.number is not None):
            raise ValueError("Номер нужен только для переадресации")
        if self.number is not None and not self.number.isdigit():
            raise ValueError("Учебный внутренний номер должен содержать только цифры")
        return self


class CenterModeInput(RequestInput):
    action: Literal["center_mode"]
    mode: Literal["automatic", "manual"]


class PauseInput(RequestInput):
    action: Literal["pause"]
    reason: Literal["technical", "callback", "training", "break"]


class PhoneSettingsInput(RequestInput):
    action: Literal["phone_settings"]
    web_phone: StrictBool
    auto_answer: StrictBool


class CallStartInput(RequestInput):
    action: Literal["call_start"]
    contact_id: str = Field(min_length=1, max_length=40)


class DialInput(RequestInput):
    """Digits typed into «имя или номер»: the service explains a wrong park code or number."""

    action: Literal["dial"]
    number: str = Field(min_length=1, max_length=24)


class VoiceLanguageInput(RequestInput):
    """The language drivers speak in the operator's training calls."""

    action: Literal["voice_language"]
    language: Literal["ru", "kk"]


class RingRetry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attempt_id: int = Field(ge=1)
    turn: int = Field(ge=0, le=100)


class RingInput(RequestInput):
    """A driver's call reaches the operator; «Повторить момент» names the call to ring again."""

    action: Literal["ring"]
    retry: RingRetry | None = None


class MessageInput(RequestInput):
    action: Literal["message"]
    contact_id: str = Field(min_length=1, max_length=40)
    text: str = Field(min_length=1, max_length=2000)


class CallCommentInput(RequestInput):
    action: Literal["call_comment"]
    call_id: UUID
    comment: str = Field(min_length=1, max_length=2000)
    tags: list[Annotated[str, Field(min_length=1, max_length=40)]] = Field(
        default_factory=list, max_length=8
    )

    @field_validator("tags")
    @classmethod
    def unique_tags(cls, value):
        return list(dict.fromkeys(value))


ActionInput = Annotated[
    LoginInput
    | SimpleInput
    | OfficeStatusInput
    | CenterModeInput
    | PauseInput
    | PhoneSettingsInput
    | CallStartInput
    | DialInput
    | VoiceLanguageInput
    | RingInput
    | MessageInput
    | CallCommentInput,
    Field(discriminator="action"),
]
