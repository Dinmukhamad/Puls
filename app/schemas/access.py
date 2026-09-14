from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AccessChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    section: str = Field(min_length=1, max_length=64)
    effect: Literal["allow", "deny", "inherit"]


class AccessPreview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    target_type: Literal["all", "role", "group", "user"]
    target_ids: list[Annotated[str, Field(min_length=1, max_length=20)]] = Field(
        min_length=1, max_length=200
    )
    changes: list[AccessChange] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def unique_targets(self):
        if len(set(self.target_ids)) != len(self.target_ids):
            raise ValueError("Получатели не должны повторяться")
        if len({change.section for change in self.changes}) != len(self.changes):
            raise ValueError("Разделы не должны повторяться")
        if self.target_type == "all" and self.target_ids != ["*"]:
            raise ValueError("Для общего правила используйте единственный получатель *")
        return self


class AccessUpdate(AccessPreview):
    changes: list[AccessChange] = Field(min_length=1, max_length=30)
