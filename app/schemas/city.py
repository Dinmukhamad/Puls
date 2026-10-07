from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.city import TARGET_LIMITS, TEMPLATES


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
            if key == "scenario_business_park" and mission.target != 1:
                raise ValueError("Для сценария цель равна одному успешному прохождению")
            if key == "scenario_business_park" and (mission.xp or mission.prerequisite):
                raise ValueError("Сценарий не выдаёт XP и доступен без других миссий")
            if mission.prerequisite == "scenario_business_park":
                raise ValueError("Общие миссии не могут зависеть от сценария только для ТП")
            if key in TARGET_LIMITS and mission.target > TARGET_LIMITS[key]:
                raise ValueError(
                    f"В миссии «{mission.title}» можно решить не больше "
                    f"{TARGET_LIMITS[key]} звонков"
                )
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
    """The game's numbers; every building, kind of work and quarter must be given.

    District prices are optional, so a form that does not know them yet keeps the saved ones.
    """

    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    prices: dict[str, int]
    points: dict[str, int]
    projects: list[ProjectInput]
    quest_coins: int = Field(ge=0, le=1000)
    estate: dict[str, list[int]] | None = None
    land: list[int] | None = None
    district: dict[str, list[int]] | None = None
    hq: list[int] | None = None

    @model_validator(mode="after")
    def complete(self):
        from app.services.city import BUILDINGS
        from app.services.city_estate import (
            HQ_STEPS,
            LAND_PRICES,
            PLOT_FAMILIES,
            PLOT_PRICES,
            PROJECT_COSTS,
        )
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
        for given, default, label in (
            (self.estate, PLOT_PRICES, "постройки района"),
            (self.district, PROJECT_COSTS, "общего проекта"),
        ):
            if given is None:
                continue
            if set(given) != set(default) or any(
                len(given[k]) != len(v) for k, v in default.items()
            ):
                raise ValueError(f"Укажите цену каждой ступени {label}")
            for key, levels in given.items():
                # A park gathering itself from squares is free unless the head sets a fee.
                gathered = default is PLOT_PRICES and PLOT_FAMILIES[key].get("squares")
                lowest = 0 if gathered else 1
                if not lowest <= levels[0] <= 100_000 or any(
                    not 1 <= v <= 100_000 for v in levels[1:]
                ):
                    raise ValueError("Цена ступени — от 1 до 100 000 коинов")
        if self.land is not None and (
            len(self.land) != len(LAND_PRICES) or any(not 0 <= v <= 100_000 for v in self.land)
        ):
            raise ValueError("Укажите цену участка каждого пояса — от 0 до 100 000 коинов")
        if self.hq is not None and (
            len(self.hq) != len(HQ_STEPS)
            or any(not 1 <= v <= 1000 for v in self.hq)
            or any(a >= b for a, b in zip(self.hq, self.hq[1:], strict=False))
        ):
            raise ValueError("Ступени штаба — по возрастанию, от 1 до 1000 построенных проектов")
        return self


class SituationInput(BaseModel):
    """One daily situation: who speaks, what happened, the options and the right one."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(pattern=r"^[a-z0-9-]{1,40}$")
    speaker: str = Field(default="", max_length=60)
    text: str = Field(min_length=5, max_length=1000)
    options: list[str] = Field(min_length=2, max_length=6)
    correct: int = Field(ge=0, le=5)
    explanation: str = Field(default="", max_length=1000)
    enabled: bool = True

    @model_validator(mode="after")
    def valid(self):
        self.options = [o.strip() for o in self.options]
        if any(not o or len(o) > 300 for o in self.options):
            raise ValueError("Вариант ответа — от 1 до 300 символов")
        if len(set(self.options)) != len(self.options):
            raise ValueError("Варианты ответа не должны повторяться")
        if self.correct >= len(self.options):
            raise ValueError("Отметьте верный вариант среди имеющихся")
        return self


class SituationsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    items: list[SituationInput] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def enough(self):
        from app.services.city_quests import SLOTS

        if len({item.id for item in self.items}) != len(self.items):
            raise ValueError("У каждой ситуации должен быть свой номер")
        if sum(item.enabled for item in self.items) < SLOTS:
            raise ValueError(f"Включите хотя бы {SLOTS} ситуации: столько заданий в день")
        return self
