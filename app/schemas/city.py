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


class BuildInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item: str = Field(min_length=1, max_length=40)


class QuestAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answer: int = Field(ge=0, le=5)


class ProjectInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    key: str = Field(max_length=40)
    name: str = Field(min_length=3, max_length=60)
    cost: int = Field(ge=10, le=1_000_000)


class EconomyInput(BaseModel):
    """The game's numbers; every building, kind of work and quarter must be given."""

    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    prices: dict[str, int]
    points: dict[str, int]
    projects: list[ProjectInput]
    quest_coins: int = Field(ge=0, le=1000)

    @model_validator(mode="after")
    def complete(self):
        from app.services.city import BUILDINGS
        from app.services.city_group import POINTS, PROJECTS

        if set(self.prices) != set(BUILDINGS):
            raise ValueError("Укажите цену каждой постройки")
        if any(not 1 <= v <= 100_000 for v in self.prices.values()):
            raise ValueError("Цена постройки — от 1 до 100 000 коинов")
        if set(self.points) != set(POINTS):
            raise ValueError("Укажите очки за каждый вид работы")
        if any(not 0 <= v <= 1000 for v in self.points.values()):
            raise ValueError("Очки за работу — от 0 до 1000")
        if [p.key for p in self.projects] != [p["key"] for p in PROJECTS]:
            raise ValueError("Кварталы нельзя добавлять, удалять или менять местами")
        return self
