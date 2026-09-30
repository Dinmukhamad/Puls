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


class CrmCar(BaseModel):
    """The car as CRM «Автомобиль» edits it."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    brand: str = Field(max_length=40)
    model: str = Field(max_length=40)
    color: str = Field(max_length=30)
    year: int
    plate: str = Field(max_length=12)
    callsign: str = Field(max_length=20)
    vin: str = Field(default="", max_length=20)
    body: str = Field(default="", max_length=30)
    sts: str = Field(default="", max_length=20)
    owner: str = Field(default="Водитель", max_length=40)
    status: str = Field(default="Работает", max_length=30)
    transmission: str = Field(default="Автоматическая", max_length=30)
    fuel: str = Field(default="Бензин", max_length=30)
    tariffs: list[Annotated[str, Field(max_length=30)]] = Field(max_length=20)
    wrap: bool = False
    lightbox: bool = False


class CrmCarInput(RequestInput):
    car: CrmCar


class SmzInput(RequestInput):
    last_name: str = Field(max_length=60)
    first_name: str = Field(max_length=60)
    middle_name: str = Field(default="", max_length=60)
    address: str = Field(max_length=200)
    iin: str = Field(max_length=20)
    rule: str = Field(max_length=60)
    account_limit: int = Field(ge=-1_000_000, le=1_000_000)


class LimitInput(RequestInput):
    enabled: bool


class RuleInput(RequestInput):
    rule: str = Field(max_length=60)
    reason: str = Field(default="", max_length=200)


class RegisterCar(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    brand: str = Field(min_length=1, max_length=40)
    model: str = Field(min_length=1, max_length=40)
    color: str = Field(min_length=1, max_length=30)
    year: int = Field(ge=1980, le=2030)
    plate: str = Field(max_length=12)


class RegisterInput(RequestInput):
    park: str = Field(max_length=40)
    profession: str = Field(max_length=60)
    self_employed: bool
    last_name: str = Field(max_length=60)
    first_name: str = Field(max_length=60)
    middle_name: str = Field(default="", max_length=60)
    phone: str = Field(max_length=20)
    iin: str = Field(max_length=20)
    address: str = Field(default="", max_length=200)
    license: str = Field(default="", max_length=20)
    license_issued: str = Field(default="", max_length=10)
    license_expires: str = Field(default="", max_length=10)
    # A walking courier has no car.
    car: RegisterCar | None = None
