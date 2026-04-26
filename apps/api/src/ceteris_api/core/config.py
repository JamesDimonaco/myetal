from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET_PLACEHOLDER = "dev-secret-change-me-PLEASE-do-not-use-in-prod-XXXXXXXX"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "dev"
    secret_key: SecretStr = SecretStr(DEV_SECRET_PLACEHOLDER)
    database_url: str = "postgresql+asyncpg://ceteris:ceteris@localhost:5432/ceteris"

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

    @model_validator(mode="after")
    def reject_dev_secret_in_prod(self) -> "Settings":
        if self.env != "dev" and self.secret_key.get_secret_value() == DEV_SECRET_PLACEHOLDER:
            raise RuntimeError("SECRET_KEY must be set to a real value when ENV is not 'dev'")
        return self


settings = Settings()
