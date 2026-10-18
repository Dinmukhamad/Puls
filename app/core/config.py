"""Конфигурация приложения (12-factor: всё через переменные окружения)."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- приложение ---
    APP_NAME: str = "Gamification API"
    APP_VERSION: str = "1.0.0"
    API_V1_PREFIX: str = "/api/v1"
    DEBUG: bool = False
    TIMEZONE: str = "Asia/Almaty"

    # --- база данных ---
    # SQLite по умолчанию; для прода: postgresql+asyncpg://user:pass@host/db
    DATABASE_URL: str = "sqlite+aiosqlite:///./gamification.db"
    DB_ECHO: bool = False

    # --- безопасность ---
    SECRET_KEY: str = "CHANGE_ME_IN_PRODUCTION_openssl_rand_hex_32"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_TTL_MINUTES: int = 60
    REFRESH_TOKEN_TTL_DAYS: int = 30
    PASSWORD_MIN_LENGTH: int = 8
    # Единственный аккаунт разработчика; назначается на сервере, не через роли в UI.
    DEVELOPER_LOGIN: str = "admin"

    # --- Telegram: только вход в Driver Simulator ---
    TELEGRAM_BOT_TOKEN: SecretStr = SecretStr("")
    TELEGRAM_BOT_USERNAME: str = ""
    TELEGRAM_WEBHOOK_URL: str = ""
    DRIVER_APP_URL: str = "https://gamification-web.onrender.com/simulator"
    DRIVER_DEVICE_DAYS: int = Field(default=30, ge=1, le=90)
    # Поставщики заменяются настройками сервера, ключи в браузер не передаются.
    DRIVER_ROUTING_URL: str = "https://routing.openstreetmap.de"
    DRIVER_GEOCODING_URL: str = "https://photon.komoot.io"

    # --- озвучка учебного водителя: ключи используются только сервером ---
    GOOGLE_TTS_API_KEY: SecretStr = SecretStr("")
    GOOGLE_TTS_VOICE: str = Field(
        default="ru-RU-Chirp3-HD-Charon", pattern=r"^ru-RU-[A-Za-z0-9-]{1,80}$"
    )
    AZURE_SPEECH_KEY: SecretStr = SecretStr("")
    # Пустой регион отключает Azure. Только имя региона, без URL/пути.
    AZURE_SPEECH_REGION: str = Field(default="", pattern=r"^(?:[a-z][a-z0-9]{1,40})?$")
    AZURE_TTS_VOICE: str = Field(
        default="ru-RU-DmitryNeural", pattern=r"^ru-RU-[A-Za-z0-9-]{1,80}$"
    )
    #: API-ключ сервисного аккаунта Yandex Cloud с ролью ai.speechkit-tts.user.
    YANDEX_SPEECHKIT_API_KEY: SecretStr = SecretStr("")
    #: Каталог нужен только для IAM-токена; с API-ключом его можно не задавать.
    YANDEX_FOLDER_ID: str = Field(default="", pattern=r"^(?:[a-z0-9]{1,50})?$")

    # --- ИИ в голосовом тренажёре (Claude) ---
    #: Ключ Anthropic API. Пустой ключ отключает ИИ: водитель отвечает по ключевым словам,
    #: звонки из конструктора оценивает наставник.
    ANTHROPIC_API_KEY: SecretStr = SecretStr("")
    VOICE_AI_MODEL: str = Field(default="claude-haiku-5-5", pattern=r"^claude-[a-z0-9-]{1,40}$")
    #: Потолок расходов на ИИ за календарный месяц (UTC), в долларах. Сверх него — без ИИ.
    VOICE_AI_MONTHLY_BUDGET_USD: float = Field(default=5.0, ge=0, le=10000)

    # --- CORS ---
    #: Задаётся списком через запятую: "https://app.example.com,https://admin.example.com"
    #: либо "*" для всех источников. NoDecode отключает разбор значения как JSON:
    #: без него pydantic-settings падает на строке вида "*" ещё до валидатора.
    CORS_ORIGINS: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["*"])

    # --- планировщик еженедельного пересчёта (п. 5 «Автоматизация») ---
    SCHEDULER_ENABLED: bool = True
    # По умолчанию: понедельник 03:00 — закрываем прошедшую неделю.
    WEEKLY_CLOSE_CRON_DAY_OF_WEEK: str = "mon"
    WEEKLY_CLOSE_CRON_HOUR: int = 3
    WEEKLY_CLOSE_CRON_MINUTE: int = 0

    # --- первичная инициализация ---
    #: Создавать схему при старте. В промышленной среде выключается:
    #: таблицы раскатываются миграциями Alembic.
    AUTO_CREATE_SCHEMA: bool = True
    #: Досоздавать справочники (показатели, номинации, бейджи, каталог магазина)
    #: и учётную запись администратора. Уже настроенные записи не трогаются.
    SEED_REFERENCE_DATA: bool = True
    BOOTSTRAP_ADMIN_LOGIN: str = "admin"
    BOOTSTRAP_ADMIN_PASSWORD: str = "admin12345"
    BOOTSTRAP_ADMIN_NAME: str = "Системный администратор"
    #: Одноразовый согласованный план восстановления владельцев прежних команд.
    #: Пустое значение отключает обслуживание; после выполнения защищён журналом аудита.
    PULS_SUPERVISOR_TEAM_REPAIR_PLAN: str = ""

    # --- пагинация ---
    DEFAULT_PAGE_SIZE: int = 50
    MAX_PAGE_SIZE: int = 500

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        """Разбирает список источников как из строки с запятыми, так и из JSON-массива."""
        if not isinstance(v, str):
            return v
        raw = v.strip()
        if raw.startswith("["):
            # Совместимость с JSON-форматом: CORS_ORIGINS='["https://a","https://b"]'
            try:
                return json.loads(raw)
            except ValueError:
                pass
        return [item.strip() for item in raw.split(",") if item.strip()]

    @field_validator("DATABASE_URL")
    @classmethod
    def _normalize_database_url(cls, v: str) -> str:
        """
        Приводит строку подключения к виду, понятному асинхронному драйверу.

        Хостинги (Render, Heroku, Railway) отдают DATABASE_URL в формате
        ``postgres://`` или ``postgresql://`` без указания драйвера и с
        параметром ``sslmode``, которого asyncpg не понимает.
        """
        for prefix in ("postgresql+asyncpg://", "postgresql+psycopg://"):
            if v.startswith(prefix):
                return v
        for legacy in ("postgresql://", "postgres://"):
            if v.startswith(legacy):
                v = "postgresql+asyncpg://" + v[len(legacy) :]
                break
        if v.startswith("postgresql+asyncpg://"):
            # psycopg-шный sslmode у asyncpg называется ssl.
            v = v.replace("?sslmode=", "?ssl=").replace("&sslmode=", "&ssl=")
        return v

    @property
    def is_sqlite(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
