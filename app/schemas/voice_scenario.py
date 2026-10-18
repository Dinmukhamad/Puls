"""The scenario editor's content: drafts may be unfinished, publication checks them (services)."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Keyword = Annotated[str, Field(max_length=80)]


def Text(limit):
    return Field(default="", max_length=limit)


def Keywords():
    return Field(default_factory=list, max_length=40)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ScenarioReply(Strict):
    keywords: list[Keyword] = Keywords()
    driver: str = Text(600)
    # Empty while the author has not chosen yet; publication requires a step or "end".
    next: str = Field(default="end", pattern=r"^(?:|end|s\d{1,3})$")


class ScenarioStep(Strict):
    id: str = Field(pattern=r"^s\d{1,3}$")
    name: str = Text(80)
    replies: list[ScenarioReply] = Field(default_factory=list, max_length=12)
    fallback: str = Text(600)


class ScenarioForbidden(Strict):
    keywords: list[Keyword] = Keywords()
    text: str = Text(200)
    driver: str = Text(600)


class ScenarioDriver(Strict):
    name: str = Text(80)
    phone: str = Text(30)
    park: str = Text(80)


class ScenarioContent(Strict):
    title: str = Text(140)
    description: str = Text(1000)
    language: Literal["ru", "kk"] = "ru"
    minutes: int = Field(default=5, ge=1, le=30)
    driver: ScenarioDriver = Field(default_factory=ScenarioDriver)
    notes: str = Text(1500)
    solution: str = Text(2000)
    opening: str = Text(600)
    steps: list[ScenarioStep] = Field(default_factory=list, max_length=30)
    forbidden: list[ScenarioForbidden] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def tidy(self):
        # Empty keyword fields left in the editor are dropped, never matched.
        for step in self.steps:
            for option in step.replies:
                option.keywords = [k for k in option.keywords if k]
        for item in self.forbidden:
            item.keywords = [k for k in item.keywords if k]
        if len({step.id for step in self.steps}) != len(self.steps):
            raise ValueError("Номера шагов повторяются")
        return self


class ScenarioSave(Strict):
    draft_version: int = Field(ge=1)
    content: ScenarioContent


class ScenarioPublish(Strict):
    draft_version: int = Field(ge=1)


class ScenarioTest(Strict):
    content: ScenarioContent
    answers: list[Annotated[str, Field(min_length=1, max_length=4000)]] = Field(
        default_factory=list, max_length=30
    )
