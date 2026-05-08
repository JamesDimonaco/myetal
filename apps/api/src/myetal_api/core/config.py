from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET_PLACEHOLDER = "dev-secret-change-me-PLEASE-do-not-use-in-prod-XXXXXXXX"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "dev"
    secret_key: SecretStr = SecretStr(DEV_SECRET_PLACEHOLDER)
    database_url: str = "postgresql+asyncpg://myetal:myetal@localhost:5432/myetal"

    # public_base_url: where the WEB app lives (used in QR codes and OAuth post-flow redirects)
    public_base_url: str = "http://localhost:3000"
    # public_api_url: where THIS api is reachable from the OAuth provider (callback URL base)
    public_api_url: str = "http://localhost:8000"

    # ORCID
    orcid_client_id: str = ""
    orcid_client_secret: SecretStr = SecretStr("")
    orcid_use_sandbox: bool = True

    # Google
    google_client_id: str = ""
    google_client_secret: SecretStr = SecretStr("")

    # GitHub
    github_client_id: str = ""
    github_client_secret: SecretStr = SecretStr("")

    # Observability — Sentry. Empty DSN = disabled (default for dev / test).
    sentry_dsn: str = ""
    sentry_traces_sample_rate: float = 0.1

    # CORS — list of allowed origins (exact match). Default empty = no CORS.
    # Pydantic-settings parses comma-separated env var into list[str], e.g.
    #   CORS_ORIGINS=https://myetal.app,https://www.myetal.app
    cors_origins: list[str] = []

    # Admin allowlist — emails (case-insensitive) that may access the
    # /admin/* endpoints (take-down queue + share tombstoning). Empty in
    # dev = nobody is admin; set this in prod env.
    #   ADMIN_EMAILS=james@example.com,ops@example.com
    admin_emails: list[str] = []

    # ---- Better Auth — Phase 0 spike (do not use in any non-spike code path) ----
    # URL the FastAPI side fetches the JWKS document from. The spike mounts
    # Better Auth at /api/ba-auth on Next.js, so the dev default points
    # there. Empty default keeps test/CI envs that never hit the spike
    # route from blowing up at import time.
    better_auth_jwks_url: str = ""

    # Telegram — for instant push notifications on user feedback submissions.
    # Both must be set for Telegram delivery; if either is empty the notification
    # is skipped with a warning log.
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # Cloudflare R2 — S3-compatible object storage for PDF uploads (PR-C,
    # feedback-round-2 §1). Empty defaults so the test env doesn't need
    # them; the r2_client fails fast at first use if a real call is
    # attempted without credentials.
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: SecretStr = SecretStr("")
    r2_bucket: str = "myetal-uploads"
    r2_endpoint: str = ""
    r2_public_url: str = ""

    @field_validator("cors_origins", "admin_emails", mode="before")
    @classmethod
    def _split_csv_origins(cls, v: object) -> object:
        # pydantic-settings hands list/JSON straight through; only split bare strings
        if isinstance(v, str):
            return [item.strip() for item in v.split(",") if item.strip()]
        return v

    @model_validator(mode="after")
    def reject_dev_secret_in_prod(self) -> "Settings":
        if self.env != "dev" and self.secret_key.get_secret_value() == DEV_SECRET_PLACEHOLDER:
            raise RuntimeError("SECRET_KEY must be set to a real value when ENV is not 'dev'")
        return self


settings = Settings()
