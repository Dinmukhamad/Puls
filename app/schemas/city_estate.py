"""Requests that change district land: the client names the plot and building, never the price."""

from pydantic import BaseModel, ConfigDict, Field, model_validator

KEY = r"^[A-Za-z0-9_-]{8,64}$"


class Keyed(BaseModel):
    model_config = ConfigDict(extra="forbid")
    #: The idempotency key of one user action: a repeat returns the first result.
    key: str = Field(pattern=KEY)


class Plot(BaseModel):
    """A plot of the district's land: its block, column and row (app/data/city_land.json)."""

    block: int = Field(ge=1, le=99)
    col: int = Field(ge=0, le=199)
    row: int = Field(ge=0, le=99)


class PurchaseInput(Keyed, Plot):
    #: What stands on the plot: a square or a house; parks gather themselves from squares.
    family: str = Field(pattern=r"^[a-z]{2,16}$")
    economy_revision: int = Field(ge=0)


class UpgradeInput(Keyed):
    version: int = Field(ge=1)
    economy_revision: int = Field(ge=0)


class PlaceInput(Keyed, Plot):
    """A building from the inventory onto free plots; a big park may turn (1: 2 × 3)."""

    version: int = Field(ge=1)
    rotation: int = Field(default=0, ge=0, le=3)


class ProjectInput(Keyed):
    district_id: str = Field(pattern=r"^(support|sales)-team-[1-9][0-9]?$", max_length=32)
    family: str = Field(pattern=r"^[a-z]{2,16}$")
    economy_revision: int = Field(ge=0)
    #: An upgrade of a public building, or a new one on the public square (module 0) at (u, v).
    target_id: int | None = Field(default=None, ge=1)
    module: int | None = Field(default=None, ge=0, le=19)
    u: int | None = Field(default=None, ge=0, le=11)
    v: int | None = Field(default=None, ge=0, le=11)
    rotation: int = Field(default=0, ge=0, le=3)

    @model_validator(mode="after")
    def place_or_target(self):
        place = (self.module, self.u, self.v)
        if self.target_id is None and None in place:
            raise ValueError("Укажите место проекта на общественной земле")
        if self.target_id is not None and place != (None, None, None):
            raise ValueError("Улучшение строится на месте постройки")
        return self


class ContributionInput(Keyed):
    amount: int = Field(ge=1, le=100_000)
    #: The operator agreed to give less if less is left to collect.
    up_to: bool = False


class CancelInput(Keyed):
    pass


# ---- the administrators' test city (app/services/city_sandbox.py) --------------------------------

#: A district of the test city by the id of the real one it copies.
SANDBOX_DISTRICT = r"^(support|sales)-team-[1-3]$"


class SandboxPlotInput(Plot):
    """A square or a house on a free plot of a test district, for free."""

    model_config = ConfigDict(extra="forbid")
    district_id: str = Field(pattern=SANDBOX_DISTRICT, max_length=32)
    family: str = Field(pattern=r"^[a-z]{2,16}$")


class LevelInput(BaseModel):
    """Any stage of a test building, up or down."""

    model_config = ConfigDict(extra="forbid")
    level: int = Field(ge=1, le=9)


class SandboxDistrictInput(BaseModel):
    """The open band and the headquarters' stage of a test district; what is left out stays."""

    model_config = ConfigDict(extra="forbid")
    open_band: int | None = Field(default=None, ge=1, le=9)
    hq_level: int | None = Field(default=None, ge=1, le=9)


class SandboxProjectInput(BaseModel):
    """A shared project of a test district: the next stage of `target_id`, or new at (u, v)."""

    model_config = ConfigDict(extra="forbid")
    district_id: str = Field(pattern=SANDBOX_DISTRICT, max_length=32)
    family: str = Field(pattern=r"^[a-z]{2,16}$")
    target_id: int | None = Field(default=None, ge=1)
    u: int | None = Field(default=None, ge=0, le=11)
    v: int | None = Field(default=None, ge=0, le=11)
    rotation: int = Field(default=0, ge=0, le=3)

    @model_validator(mode="after")
    def place_or_target(self):
        if self.target_id is None and None in (self.u, self.v):
            raise ValueError("Укажите место проекта на общественной площади")
        if self.target_id is not None and (self.u, self.v) != (None, None):
            raise ValueError("Улучшение строится на месте постройки")
        return self
