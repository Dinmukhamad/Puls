from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Puls — Operator Performance Platform"
    api_prefix: str = "/api"

    # PostgreSQL — обязателен на проде, SQLite для локалки
    database_url: str = "sqlite:///./puls.db"

    # JWT
    jwt_secret_key: str = "change-me-in-env"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 720  # 12 часов

    # CORS
    cors_origins: str = "*"

    # Таблицы и seed
    auto_create_tables: bool = True
    auto_seed: bool = True

    # Seed admin — берём из Railway env, никогда не хардкодим
    seed_admin_username: str = "admin"
    seed_admin_password: str = ""          # ОБЯЗАТЕЛЬНО задать в Railway
    seed_admin_fullname: str = "Администратор"

    # Seed supervisor/manager (опционально)
    seed_supervisor_username: str = "supervisor"
    seed_supervisor_password: str = ""
    seed_manager_username: str = "manager"
    seed_manager_password: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> List[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
