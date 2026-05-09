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

    # ---- Better Auth ----
    # Set in production. Used for issuer pinning and as the base for
    # computing `better_auth_jwks_url` / `better_auth_issuer` when those
    # aren't set explicitly.
    #
    #   BETTER_AUTH_URL=https://myetal.app          # prod
    #   BETTER_AUTH_URL=http://localhost:3000        # dev (default)
    better_auth_url: str = "http://localhost:3000"

    # Shared signing/encryption secret used by Better Auth on the Next.js
    # side. Mirrored here so the API process can refuse to boot in prod
    # without it (BA itself enforces a 32-char minimum at first request,
    # which is too late — we want fail-fast at process start). Empty
    # string in dev / test is allowed.
    better_auth_secret: SecretStr = SecretStr("")

    # JWKS endpoint URL. Empty default = computed from `better_auth_url`
    # (`{better_auth_url}/api/auth/jwks`, post-Phase-3). The verifier
    # reads `settings.better_auth_jwks_url` directly so the override path
    # is explicit-set wins.
    better_auth_jwks_url: str = ""

    # Expected `iss` claim on Better Auth JWTs. Empty default = use
    # `better_auth_url`. Override only when running BA behind a proxy
    # that rewrites the issuer (rare).
    better_auth_issuer: str = ""

    # ---- Email (Resend) ----
    # Required for password-reset / email-verification transactional
    # mail. Empty in dev / test = email send is skipped with a warning
    # log; the auth flows still succeed.
    resend_api_key: SecretStr = SecretStr("")
    email_from: str = "MyEtAl <noreply@myetal.app>"

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

    @model_validator(mode="after")
    def _better_auth_defaults(self) -> "Settings":
        """Fill in computed Better Auth defaults from `better_auth_url`.

        Allows env contracts to specify only `BETTER_AUTH_URL` for the
        common case; explicit JWKS / issuer overrides still win.
        """
        if not self.better_auth_jwks_url and self.better_auth_url:
            # Mount path is `/api/auth` post-Phase-3. Override
            # BETTER_AUTH_JWKS_URL in env if you need to pin elsewhere.
            self.better_auth_jwks_url = (
                self.better_auth_url.rstrip("/") + "/api/auth/jwks"
            )
        if not self.better_auth_issuer and self.better_auth_url:
            self.better_auth_issuer = self.better_auth_url
        return self

    @model_validator(mode="after")
    def _better_auth_secret_min_length_in_prod(self) -> "Settings":
        """Better Auth requires a 32+ char secret. Fail fast in prod."""
        if self.env == "dev":
            return self
        secret = self.better_auth_secret.get_secret_value()
        if not secret:
            raise RuntimeError(
                "BETTER_AUTH_SECRET must be set when ENV is not 'dev'"
            )
        if len(secret) < 32:
            raise RuntimeError(
                "BETTER_AUTH_SECRET must be at least 32 characters "
                "(generate one with `openssl rand -base64 32`)"
            )
        return self


settings = Settings()
