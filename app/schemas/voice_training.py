"""Only learner utterances and observations cross the voice practice boundary."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class VoiceStart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scenario_key: Literal["phone_change"]
    persona: Literal["calm", "confused", "hurried", "irritated"] = "calm"
    language: Literal["ru", "kk"] = "ru"


class VoiceAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: UUID
    turn: int = Field(ge=0, le=100)
    text: str = Field(min_length=2, max_length=4000)


class VoiceInspection(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    system: Literal["dispatch", "oktell", "compare"]
    driver_id: str | None = Field(default=None, max_length=80)
    park_id: str | None = Field(default=None, max_length=80)
    incoming_phone: str | None = Field(default=None, max_length=40)
    registration_phone: str | None = Field(default=None, max_length=40)


class VoiceRetry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    turn: int = Field(ge=0, le=100)


class VoiceReview(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    comment: str = Field(min_length=3, max_length=2000)


class VoiceSpeechPreview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["yandex", "google", "azure"]
    persona: Literal["calm", "confused", "hurried", "irritated"] = "calm"
    language: Literal["ru", "kk"] = "ru"


class VoiceSpeechTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["yandex", "google", "azure"]
    turn: int = Field(ge=0, le=100)
