from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Puls — платформа геймификации операторов"
    app_env: str = "development"  # set to 'production' in Railway
    api_prefix: str = "/api"

    # PostgreSQL вЂ” РѕР±СЏР·Р°С‚РµР»РµРЅ РЅР° РїСЂРѕРґРµ, SQLite РґР»СЏ Р»РѕРєР°Р»РєРё
    database_url: str = "sqlite:///./pulse.db"

    # JWT
    jwt_secret_key: str = "change-me-in-env"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 43200  # 30 days

    # CORS
    cors_origins: str = "*"

    # РўР°Р±Р»РёС†С‹ Рё seed
    auto_create_tables: bool = True
    auto_seed: bool = True

    # Seed admin вЂ” Р±РµСЂС‘Рј РёР· Railway env, РЅРёРєРѕРіРґР° РЅРµ С…Р°СЂРґРєРѕРґРёРј
    seed_admin_username: str = "admin"
    seed_admin_password: str = ""          # РћР‘РЇР—РђРўР•Р›Р¬РќРћ Р·Р°РґР°С‚СЊ РІ Railway
    seed_admin_fullname: str = "Администратор"

    # Seed supervisor/manager (РѕРїС†РёРѕРЅР°Р»СЊРЅРѕ)
    seed_supervisor_username: str = "supervisor"
    seed_supervisor_password: str = ""
    seed_manager_username: str = "manager"
    seed_manager_password: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Cookie auth settings (Р‘Р»РѕРє 3 РўР—)
    auth_cookie_name: str = "pulse_access_token"
    auth_cookie_secure: bool = False   # True in production
    auth_cookie_samesite: str = "lax"
    auth_cookie_domain: str = ""

    # Demo data
    enable_demo_data: bool = True

    # Автоматический еженедельный расчёт коинов (ТЗ 3.2): пн 09:00 Asia/Almaty
    enable_weekly_accrual_cron: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def check_production_safety(self) -> None:
        """Raise on startup if dangerous defaults are set in production."""
        import os

        env_values = {
            (self.app_env or "").lower(),
            os.getenv("APP_ENV", "").lower(),
            os.getenv("ENVIRONMENT", "").lower(),
            os.getenv("RAILWAY_ENVIRONMENT", "").lower(),
        }
        is_railway = bool(os.getenv("RAILWAY_PROJECT_ID") or os.getenv("RAILWAY_SERVICE_ID"))
        if "production" not in env_values and not is_railway:
            return

        problems = []
        if (
            self.jwt_secret_key
            in ("change-me-in-env", "Р·Р°РјРµРЅРёС‚Рµ-РЅР°-СЃР»СѓС‡Р°Р№РЅСѓСЋ-СЃС‚СЂРѕРєСѓ-РјРёРЅРёРјСѓРј-32-СЃРёРјРІРѕР»Р°")
            or len(self.jwt_secret_key) < 32
        ):
            problems.append("JWT_SECRET_KEY must be a non-default secret with at least 32 characters")
        if self.database_url.startswith("sqlite"):
            problems.append("DATABASE_URL must point to PostgreSQL in production")
        if self.cors_origins.strip() == "*":
            problems.append("CORS_ORIGINS must be explicit in production")
        if not self.auth_cookie_secure:
            problems.append("AUTH_COOKIE_SECURE must be true in production")
        if self.auto_create_tables:
            problems.append("AUTO_CREATE_TABLES must be false in production; use Alembic migrations")
        if self.enable_demo_data:
            problems.append("ENABLE_DEMO_DATA must be false in production")

        if problems:
            raise RuntimeError("FATAL: unsafe production configuration: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()

