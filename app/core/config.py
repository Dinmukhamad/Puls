from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Puls — платформа геймификации операторов"
    app_env: str = "development"  # set to 'production' in Railway
    api_prefix: str = "/api"

    # PostgreSQL — обязателен на проде, SQLite для локалки
    database_url: str = "sqlite:///./pulse.db"

    # JWT
    jwt_secret_key: str = "change-me-in-env"
    jwt_algorithm: str = "HS256"
    # 0 = бессрочная сессия (токен без exp, сессия без expires_at). >0 — срок в минутах.
    access_token_expire_minutes: int = 0
    # 0 = idle-таймаут выключен (не разлогинивать за бездействие). >0 — минуты бездействия.
    session_idle_timeout_minutes: int = 0

    # CORS
    cors_origins: str = "*"
    trusted_proxy_ips: str = ""
    # Доверять X-Forwarded-For безусловно (для PaaS вроде Render/Heroku/Railway,
    # где приложение всегда за платформенным прокси, а его IP не фиксирован).
    # По умолчанию выключено: без прокси доверять заголовку нельзя (спуфинг).
    trust_forwarded_for: bool = False
    csrf_enforced: bool = False
    release_id: str = "development"
    missions_replay_enabled: bool = True
    mission_attempt_stale_hours: int = 24

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

    # Cookie auth settings (Блок 3 ТЗ)
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

    @property
    def trusted_proxy_ip_list(self) -> set[str]:
        return {value.strip() for value in self.trusted_proxy_ips.split(",") if value.strip()}

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
        # Render не выставляет APP_ENV=production сам, но задаёт RENDER=true и
        # RENDER_SERVICE_ID. Без детекта проверки безопасности молча пропускались.
        is_render = bool(os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID"))
        if "production" not in env_values and not is_railway and not is_render:
            return

        problems = []
        if (
            self.jwt_secret_key
            in (
                "change-me-in-env",
                "замените-на-случайную-строку-минимум-32-символа",
                # Плейсхолдер из .env.example: он длиннее 32 символов, поэтому
                # без явного блоклиста прошёл бы проверку длины.
                "dev-secret-key-change-in-production-at-least-32-chars",
            )
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
        if not self.csrf_enforced:
            problems.append("CSRF_ENFORCED must be true in production")

        if problems:
            raise RuntimeError("FATAL: unsafe production configuration: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()

