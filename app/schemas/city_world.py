"""City ownership and supervisor assignments, never coin balances."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Named(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=40)

    @field_validator("name", mode="before")
    @classmethod
    def clean_name(cls, value):
        if not isinstance(value, str):
            raise ValueError("Название должно быть текстом")
        value = value.strip()
        if any(ord(c) < 32 or c in "<>" for c in value):
            raise ValueError("Название не должно содержать разметку или управляющие символы")
        return value


class DistrictInput(Named):
    id: str = Field(pattern=r"^(support|sales)-team-[1-9][0-9]?$", max_length=32)
    supervisor_id: int | None = Field(default=None, gt=0)
    # Compatibility with older editors. An explicit supervisor makes these read-only.
    group_ids: list[int] = Field(default_factory=list, max_length=100)
    #: The pilot switch: operators of this district may build and contribute with coins. A form that
    #: does not know it yet sends nothing, and the saved value stays.
    construction: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def ignore_derived_groups(cls, value):
        if isinstance(value, dict) and "supervisor_id" in value:
            return {**value, "group_ids": []}
        return value


class DepartmentInput(Named):
    id: Literal["support", "sales"]
    head_id: int | None = Field(default=None, gt=0)
    districts: list[DistrictInput] = Field(min_length=3, max_length=12)


class WorldInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    cities: list[DepartmentInput] = Field(min_length=2, max_length=2)

    @model_validator(mode="after")
    def unique_areas(self):
        if {c.id for c in self.cities} != {"support", "sales"}:
            raise ValueError("Нужны оба города: support и sales")
        seen_districts, seen_groups = set(), set()
        for city in self.cities:
            for district in city.districts:
                if not district.id.startswith(city.id + "-team-") or district.id in seen_districts:
                    raise ValueError(
                        "Идентификаторы районов должны быть уникальны и принадлежать городу"
                    )
                seen_districts.add(district.id)
                groups = (
                    district.group_ids
                    if "supervisor_id" not in district.model_fields_set else []
                )
                for group in groups:
                    if group < 1 or group in seen_groups:
                        raise ValueError("Каждая группа может принадлежать только одному району")
                    seen_groups.add(group)
        return self
