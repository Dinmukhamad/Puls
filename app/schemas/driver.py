from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


class DriverPark(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=100)
    commission: float = Field(ge=0, le=100, allow_inf_nan=False)


class DriverParksInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parks: list[DriverPark] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def unique_parks(self):
        if len({park.id for park in self.parks}) != len(self.parks):
            raise ValueError("Идентификаторы парков должны отличаться")
        if len({park.name.casefold() for park in self.parks}) != len(self.parks):
            raise ValueError("Названия парков должны отличаться")
        return self


class DriverAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["taxi", "services", "park", "enter"]
    park_id: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def park_selection(self):
        if (self.action == "park") != (self.park_id is not None):
            raise ValueError("Укажите парк только для действия выбора парка")
        return self


class DriverGeoPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False, strict=True)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False, strict=True)


class DriverLocation(DriverGeoPoint):
    accuracy: float = Field(ge=0, le=100000, allow_inf_nan=False, strict=True)
    captured_at: AwareDatetime


class DriverOrderCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    id: UUID
    origin: str = Field(min_length=3, max_length=160)
    destination: str = Field(min_length=3, max_length=160)
    location: DriverLocation | None = None
    pickup: DriverGeoPoint | None = None
    route_id: UUID | None = None

    @model_validator(mode="after")
    def different_addresses(self):
        self.origin = " ".join(self.origin.split())
        self.destination = " ".join(self.destination.split())
        if min(len(self.origin), len(self.destination)) < 3:
            raise ValueError("Введите адреса подачи и назначения")
        if self.origin.casefold() == self.destination.casefold():
            raise ValueError("Адреса подачи и назначения должны отличаться")
        return self


class DriverOrderAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    action: Literal["offer", "accept", "arrive", "start_trip", "finish", "pay", "cancel", "missed"]
    location: DriverLocation | None = None
