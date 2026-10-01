"""Requests that change district land: the client names the place and building, never the price."""

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

KEY = r"^[A-Za-z0-9_-]{8,64}$"


class Keyed(BaseModel):
    model_config = ConfigDict(extra="forbid")
    #: The idempotency key of one user action: a repeat returns the first result.
    key: str = Field(pattern=KEY)


class Place(BaseModel):
    module: int = Field(ge=0, le=19)
    u: int = Field(ge=0, le=11)
    v: int = Field(ge=0, le=11)
    rotation: int = Field(default=0, ge=0, le=3)


class PurchaseInput(Keyed, Place):
    family: str = Field(pattern=r"^[a-z]{2,16}$")
    economy_revision: int = Field(ge=0)


class UpgradeInput(Keyed):
    version: int = Field(ge=1)
    economy_revision: int = Field(ge=0)


class MoveInput(Keyed, Place):
    version: int = Field(ge=1)


class StoreInput(Keyed):
    version: int = Field(ge=1)


class MergeInput(Keyed):
    ids: list[int] = Field(min_length=6, max_length=6)
    economy_revision: int = Field(ge=0)

    @field_validator("ids")
    @classmethod
    def distinct(cls, value):
        if len(set(value)) != 6:
            raise ValueError("Нужны шесть разных скверов")
        return value


class ProjectInput(Keyed):
    district_id: str = Field(pattern=r"^(support|sales)-team-[1-9][0-9]?$", max_length=32)
    family: str = Field(pattern=r"^[a-z]{2,16}$")
    economy_revision: int = Field(ge=0)
    #: An upgrade of a public building, or a new one at (module, u, v).
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
