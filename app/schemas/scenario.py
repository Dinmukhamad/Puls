"""Only observations and persisted appeal identifiers are accepted from a client."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ScenarioAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    step: int = Field(ge=0, le=99)
    answer: int = Field(ge=0, le=5)


class ScenarioDispatchCheck(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    driver_id: str = Field(min_length=1, max_length=80)
    license_number: str = Field(min_length=1, max_length=80)
    brand: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=80)
    year: int = Field(ge=1980, le=2100)
    color: str = Field(min_length=1, max_length=80)
    employment: str = Field(min_length=1, max_length=100)
    park: str = Field(min_length=1, max_length=100)
    city: str = Field(min_length=1, max_length=100)
    classification_result: Literal["not_confirmed", "confirmed"]


class ScenarioCrmCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")
    appeal_id: int = Field(gt=0)
