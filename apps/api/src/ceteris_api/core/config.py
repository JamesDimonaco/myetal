from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET_PLACEHOLDER = "dev-secret-change-me-PLEASE-do-not-use-in-prod-XXXXXXXX"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "dev"
    secret_key: SecretStr = SecretStr(DEV_SECRET_PLACEHOLDER)
    database_url: str = "postgresql+asyncpg://ceteris:ceteris@localhost:5432/ceteris"
    public_base_url: str = "http://localhost:3000"

    @model_validator(mode="after")
    def reject_dev_secret_in_prod(self) -> "Settings":
        if self.env != "dev" and self.secret_key.get_secret_value() == DEV_SECRET_PLACEHOLDER:
            raise RuntimeError("SECRET_KEY must be set to a real value when ENV is not 'dev'")
        return self


settings = Settings()
