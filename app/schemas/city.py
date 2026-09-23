from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.city import TEMPLATES


class MissionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=3, max_length=140)
    description: str = Field(min_length=5, max_length=2000)
    pulsar: str = Field(min_length=5, max_length=1200)
    target: int = Field(ge=1, le=100)
    xp: int = Field(ge=0, le=1000)
    coins: int = Field(ge=0, le=1000)
    enabled: bool
    prerequisite: str | None = Field(max_length=40)


class SettingsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    missions: dict[str, MissionInput]

    @model_validator(mode="after")
    def valid_curriculum(self):
        if set(self.missions) != set(TEMPLATES):
            raise ValueError("Сохраните все миссии текущей главы")
        for key, mission in self.missions.items():
            if key in ("welcome", "driver_profile") and mission.target != 1:
                raise ValueError("Для знакомства и профиля цель равна одному действию")
            if key == "welcome" and (mission.coins or mission.prerequisite):
                raise ValueError("Знакомство не выдаёт коины и не требует других миссий")
            visited = {key}
            parent = mission.prerequisite
            while parent:
                if parent not in self.missions or parent in visited:
                    raise ValueError("Маршрут не должен содержать циклы или неизвестные миссии")
                visited.add(parent)
                parent = self.missions[parent].prerequisite
        return self


class ClaimInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
