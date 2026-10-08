from functools import lru_cache
from typing import Literal

# pyrefly: ignore [missing-import]
from pydantic import field_validator, model_validator
# pyrefly: ignore [missing-import]
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_SECRETS = {"", "change-me", "replace-with-long-random-string", "dev-secret-change-me"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "FinTrack"
    environment: Literal["development", "test", "production"] = "development"
    debug: bool = False
    log_level: str = "INFO"
    api_prefix: str = "/api/v1"

    database_url: str = "sqlite:///./fintrack_dev.db"
    redis_url: str = "redis://localhost:6379/0"
    # "redis" in deployed environments; "memory" keeps tests and local runs dependency-free.
    cache_backend: Literal["redis", "memory"] = "memory"

    secret_key: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_issuer: str = "fintrack"
    jwt_audience: str = "fintrack-api"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 7
    refresh_cookie_name: str = "fintrack_refresh"
    cookie_secure: bool = False

    cors_origins: str = "http://localhost:5173,http://localhost:8080"

    trust_proxy_headers: bool = False  # enable only when the API is reachable solely through the bundled proxy
    rate_limit_per_minute: int = 300
    auth_rate_limit_per_minute: int = 10

    max_upload_bytes: int = 5 * 1024 * 1024
    max_import_rows: int = 10_000

    # Google sign-in: the OAuth 2.0 Web client ID from Google Cloud Console. Empty disables the feature.
    google_client_id: str = ""

    ws_auth_timeout_seconds: float = 10.0

    # Outgoing webhooks. "celery" in deployed environments (retries via beat); "thread" delivers in-process
    # for dependency-free local runs; "inline" is synchronous (tests); "off" records deliveries without sending.
    webhook_dispatch: Literal["celery", "thread", "inline", "off"] = "thread"
    webhook_timeout_seconds: float = 10.0
    webhook_max_attempts: int = 6
    webhook_max_endpoints_per_user: int = 10
    webhook_disable_after_failures: int = 15
    # Allow targets on private/loopback networks. Never enable in production: it re-opens SSRF.
    webhook_allow_private_targets: bool = False

    # Any OpenAI-compatible API. Empty base URL = OpenAI, unless the key is a Groq key (gsk_...), in which
    # case Groq's endpoint is used. Set LLM_BASE_URL explicitly for other providers.
    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_model: str = "gpt-4o"
    llm_timeout_seconds: float = 45.0
    insights_cache_seconds: int = 6 * 3600
    dashboard_cache_seconds: int = 300

    @field_validator("database_url")
    @classmethod
    def normalize_db_url(cls, v: str) -> str:
        # Managed Postgres providers hand out postgres:// URLs; SQLAlchemy wants an explicit driver.
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://"):]
        if v.startswith("postgresql://"):
            v = "postgresql+psycopg://" + v[len("postgresql://"):]
        return v

    @model_validator(mode="after")
    def check_production_secrets(self):
        if self.environment == "production":
            if self.secret_key in INSECURE_SECRETS or len(self.secret_key) < 32:
                raise ValueError("SECRET_KEY must be set to a random value of at least 32 characters in production")
            if self.database_url.startswith("sqlite"):
                raise ValueError("Production requires PostgreSQL (DATABASE_URL)")
            if self.webhook_allow_private_targets:
                raise ValueError("WEBHOOK_ALLOW_PRIVATE_TARGETS must be false in production")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
