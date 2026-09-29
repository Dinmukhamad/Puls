from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class RequestInput(BaseModel):
    """Every change carries its own id, so a repeated click or a retry acts once."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: UUID


class DetailsInput(RequestInput):
    provider: str = Field(max_length=60)


class CarInput(RequestInput):
    tariffs: list[str] = Field(max_length=20)
    wrap: bool
    lightbox: bool = False


class CodeInput(RequestInput):
    driver: str = Field(max_length=40)


class InventoryInput(RequestInput):
    park: str = Field(max_length=40)
    type: str = Field(max_length=20)
    code: str = Field(max_length=20)
    number: str = Field(max_length=40)


class TicketInput(RequestInput):
    park: str = Field(max_length=40)
    kind: Literal["text", "call"] = "text"
    private: bool
    theme: str = Field(max_length=80)
    subtheme: str = Field(max_length=120)
    license: str = Field(default="", max_length=40)
    text: str = Field(max_length=2000)
    # Only the file names: the training support keeps no files.
    files: list[Annotated[str, Field(max_length=120)]] = Field(default_factory=list, max_length=8)


class AnswerInput(RequestInput):
    option: str = Field(max_length=20)
