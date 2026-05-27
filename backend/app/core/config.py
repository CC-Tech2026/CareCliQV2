import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    supabase_url: str = os.environ.get("SUPABASE_URL", "")
    supabase_anon_key: str = os.environ.get("SUPABASE_ANON_KEY", "")
    supabase_service_role_key: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    openai_api_key: str = os.environ.get("OPENAI_API_KEY", "")
    anthropic_api_key: str = os.environ.get("ANTHROPIC_API_KEY", "")
    frontend_base_url: str = os.environ.get(
        "FRONTEND_BASE_URL",
        os.environ.get("APP_BASE_URL", "http://localhost:3000"),
    )
    secret_key: str = os.environ.get("SESSION_SECRET", "changeme-in-production")
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    # AES-256 GCM PII encryption (Privacy Act 2026)
    # Set PII_ENCRYPTION_ENABLED=true and PII_ENCRYPTION_KEY=<32-byte base64> to activate.
    # Generate a key: python3 -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"
    pii_encryption_enabled: bool = os.environ.get("PII_ENCRYPTION_ENABLED", "false").lower() == "true"
    pii_encryption_key: str = os.environ.get("PII_ENCRYPTION_KEY", "")

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
