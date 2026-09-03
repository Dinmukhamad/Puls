"""Конфигурация приложения (12-factor: всё через переменные окружения)."""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
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
