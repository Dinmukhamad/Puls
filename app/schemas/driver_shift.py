import json
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ScenarioLevel(StrictModel):
    name: str = Field(min_length=1, max_length=50)
    threshold: int = Field(ge=0, le=1000000)
    benefits: str = Field(min_length=1, max_length=400)


class ScenarioTariff(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9_-]{1,40}$")
    name: str = Field(min_length=1, max_length=60)
    available: bool = True
    reason: str = Field(default="", max_length=200)


class SupportStep(StrictModel):
    question: str = Field(min_length=5, max_length=600)
    options: list[str] = Field(min_length=2, max_length=4)
    correct: int = Field(ge=0, le=3)
    explanation: str = Field(min_length=5, max_length=600)

    @model_validator(mode="after")
    def valid_options(self):
        if self.correct >= len(self.options) or any(
            not 1 <= len(x.strip()) <= 160 for x in self.options
        ):
            raise ValueError("Проверьте варианты ответа и правильный ответ")
        return self


class DriverScenario(StrictModel):
    title: str = Field(default="Смена в Алматы", min_length=1, max_length=100)
    required_park: str = Field(default="itaxi", max_length=64)
    target_orders: int = Field(default=3, ge=1, le=10)
    fare: int = Field(default=1960, ge=100, le=100000)
    service_percent: float = Field(default=13.76, ge=0, le=40, allow_inf_nan=False)
    service_tax_percent: float = Field(default=16, ge=0, le=30, allow_inf_nan=False)
    wait_per_minute: int = Field(default=30, ge=0, le=1000)
    initial_balance: int = Field(default=0, ge=0, le=1000000)
    initial_points: int = Field(default=1485, ge=0, le=1000000)
    priority_base: int = Field(default=27, ge=0, le=100)
    priority_complete: int = Field(default=1, ge=0, le=10)
    priority_missed: int = Field(default=4, ge=0, le=30)
    priority_cancelled: int = Field(default=3, ge=0, le=30)
    offer_seconds: int = Field(default=30, ge=10, le=120)
    require_photo: bool = True
    require_documents: bool = True
    require_support: bool = True
    route_event: bool = True
    ratings: list[int] = Field(default=[0, 0, 2, 0, 148], min_length=5, max_length=5)
    levels: list[ScenarioLevel] = Field(
        default=[
            ScenarioLevel(name="Базовый", threshold=0, benefits="Доступ к учебным заказам"),
            ScenarioLevel(
                name="Эксперт",
                threshold=1000,
                benefits="Дополнительный приоритет и учебные предложения",
            ),
            ScenarioLevel(name="Профи", threshold=10000, benefits="Повышенный учебный приоритет"),
            ScenarioLevel(name="Чемпион", threshold=20000, benefits="Учебная скидка на комиссию"),
            ScenarioLevel(
                name="Гранд", threshold=50000, benefits="Все преимущества учебной программы"
            ),
        ],
        min_length=1,
        max_length=10,
    )
    tariffs: list[ScenarioTariff] = Field(
        default=[
            ScenarioTariff(id="economy", name="Эконом"),
            ScenarioTariff(id="comfort", name="Комфорт"),
            ScenarioTariff(
                id="comfort-plus",
                name="Комфорт+",
                available=False,
                reason="Учебный автомобиль не соответствует этой категории",
            ),
            ScenarioTariff(id="intercity", name="Межгород"),
            ScenarioTariff(
                id="kids",
                name="Детский",
                available=False,
                reason="Добавьте сведения о детском кресле в учебный профиль",
            ),
        ],
        min_length=1,
        max_length=20,
    )
    support_steps: list[SupportStep] = Field(
        default=[
            SupportStep(
                question="Водитель сообщает, что выплата не поступила. Что проверить сначала?",
                options=[
                    "Историю денег и статус выплаты",
                    "Сразу повторить вывод",
                    "Поменять автомобиль",
                ],
                correct=0,
                explanation=(
                    "Откройте Деньги → История транзакций → Выплата. Повторный вывод "
                    "не объясняет состояние первого запроса."
                ),
            ),
            SupportStep(
                question="Какую информацию приложить к учебному обращению?",
                options=[
                    "Пароль и код входа",
                    "Сумму, время и статус операции",
                    "Номер карты целиком",
                ],
                correct=1,
                explanation=(
                    "Для этого учебного кейса нужны сумма, время и статус выплаты. "
                    "Пароль, код входа и реквизиты не запрашиваются."
                ),
            ),
            SupportStep(
                question=(
                    "Поддержка подтвердила завершение учебной выплаты. Что сделать "
                    "после возврата?"
                ),
                options=[
                    "Проверить обновлённый статус в Деньгах",
                    "Повторить тот же вывод",
                    "Удалить профиль",
                ],
                correct=0,
                explanation=(
                    "Вернитесь в симулятор и откройте операцию: её статус должен "
                    "обновиться. Это завершает учебное обращение."
                ),
            ),
        ],
        min_length=1,
        max_length=10,
    )

    @model_validator(mode="after")
    def consistent(self):
        if any(x < 0 or x > 10000 for x in self.ratings) or not sum(self.ratings):
            raise ValueError("Введите количество оценок от 1 до 5 звёзд")
        if self.levels[0].threshold != 0 or any(
            a.threshold >= b.threshold for a, b in zip(self.levels, self.levels[1:], strict=False)
        ):
            raise ValueError("Первый уровень начинается с 0, остальные пороги возрастают")
        if len({x.id for x in self.tariffs}) != len(self.tariffs) or not any(
            x.available for x in self.tariffs
        ):
            raise ValueError("Тарифы должны иметь разные идентификаторы и хотя бы один доступный")
        return self


class ShiftStart(StrictModel):
    id: UUID
    mode: Literal["free", "assessment"]


class ShiftAction(StrictModel):
    request_id: UUID
    action: Literal[
        "visit",
        "setting",
        "tariff",
        "payment",
        "car_add",
        "car_select",
        "photo_step",
        "photo_submit",
        "photo_restart",
        "doc_sign",
        "provider",
        "wallet",
        "promo",
        "intercity_create",
        "intercity_book",
        "rental",
        "refuel",
        "learning",
        "work_mode",
        "online",
        "offline",
        "hint",
        "finish",
        "passenger",
        "route_change",
        "level_restore",
        "intercity_cancel",
    ]
    values: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def bounded(self):
        if len(json.dumps(self.values, ensure_ascii=False)) > 5000:
            raise ValueError("Слишком большой запрос")
        return self


class SupportCreate(StrictModel):
    id: UUID
    topic: Literal["payment", "passenger", "account"]
