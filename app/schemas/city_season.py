"""What heads and administrators send about the city's seasons."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Period = Literal["week", "2weeks", "month", "2months", "3months"]


class ScheduleInput(BaseModel):
    """A period with the date of the next reset, or neither: the city is not reset by itself."""

    model_config = ConfigDict(extra="forbid")
    period: Period | None = None
    ends_at: datetime | None = None
    revision: int = Field(ge=1)

    @model_validator(mode="after")
    def both_or_neither(self):
        if (self.period is None) != (self.ends_at is None):
            raise ValueError("Укажите и срок, и дату сброса, или уберите расписание")
        return self


class ResetInput(BaseModel):
    """The season being ended, so a repeated press never ends the next one."""

    model_config = ConfigDict(extra="forbid")
    number: int = Field(ge=1)
