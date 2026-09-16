from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.driver_shift import DriverScenario


class LearningStep(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    speaker: str = Field(default="", max_length=100)
    text: str = Field(min_length=1, max_length=4000)
    options: list[str] = Field(min_length=2, max_length=6)
    correct: int = Field(ge=0, le=5)
    explanation: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def valid_options(self):
        self.options = [value.strip() for value in self.options]
        if any(not value or len(value) > 1000 for value in self.options):
            raise ValueError("Ответ должен содержать от 1 до 1000 символов")
        if len(set(self.options)) != len(self.options):
            raise ValueError("Варианты ответов должны отличаться")
        if self.correct >= len(self.options):
            raise ValueError("Выберите правильный ответ")
        return self


class ContentInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    kind: Literal["test", "mission", "simulator"]
    title: str = Field(min_length=1, max_length=180)
    description: str = Field(default="", max_length=4000)
    world: str = Field(default="Общее", min_length=1, max_length=80)
    difficulty: Literal["basic", "medium", "advanced"] = "basic"
    minutes: int = Field(default=10, ge=1, le=180)
    status: Literal["draft", "published", "archived"] = "draft"
    is_required: bool = False
    deadline: datetime | None = None
    allow_back: bool = True
    pass_percent: int = Field(default=80, ge=1, le=100)
    coins_reward: int = Field(default=0, ge=0, le=10000)
    steps: list[LearningStep] = Field(min_length=1, max_length=100)
    driver_config: DriverScenario | None = None

    @model_validator(mode="after")
    def driver_kind(self):
        if self.driver_config is not None and self.kind != "simulator":
            raise ValueError("Сценарий водителя доступен только симулятору")
        return self


class AssignmentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_ids: list[int] = Field(default_factory=list, max_length=500)
    all_operators: bool = False
    deadline: datetime | None = None

    @model_validator(mode="after")
    def targets(self):
        if self.all_operators == bool(self.user_ids) or any(x <= 0 for x in self.user_ids):
            raise ValueError("Выберите всех операторов или конкретных сотрудников")
        if self.deadline and self.deadline.tzinfo is None:
            raise ValueError("Укажите часовой пояс срока")
        self.user_ids = list(dict.fromkeys(self.user_ids))
        return self


class AnswerInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    step: int = Field(ge=0, le=99)
    answer: int = Field(ge=0, le=5)


class SimulatorAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal[
        "register",
        "verify",
        "photo",
        "mode",
        "route",
        "online",
        "accept",
        "skip",
        "arrive",
        "start_trip",
        "resolve",
        "finish_trip",
    ]
