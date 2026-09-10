from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.driver import DriverGeoPoint, DriverLocation
from app.schemas.driver_shift import StrictModel


class RoutePoint(DriverGeoPoint):
    label: str = Field(min_length=1, max_length=160)


class RoutePrepare(StrictModel):
    pickup: RoutePoint
    destination: RoutePoint
    mode: Literal["real", "virtual", "demo"] = "real"
    transport: Literal["car", "foot"] = "car"
    location: DriverLocation | None = None


class AddressSearch(StrictModel):
    query: str = Field(min_length=3, max_length=160)
    near: DriverGeoPoint | None = None


class PositionUpdate(StrictModel):
    location: DriverLocation | None = None


class DemoControl(StrictModel):
    request_id: UUID
    action: Literal["pause", "resume", "advance"]
    meters: int = Field(default=100, ge=1, le=1000)


class DestinationChange(StrictModel):
    request_id: UUID
    destination: RoutePoint
    location: DriverLocation | None = None
