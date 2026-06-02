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
        os.environ.get("FRONTEND_URL", os.environ.get("APP_BASE_URL", "http://localhost:3000")),
    )
    secret_key: str = os.environ.get("SESSION_SECRET", "changeme-in-production")
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    reauth_token_expire_minutes: int = int(os.environ.get("REAUTH_TOKEN_EXPIRE_MINUTES", "10") or 10)
    auth_auto_confirm_email: bool = os.environ.get("AUTH_AUTO_CONFIRM_EMAIL", "false").lower() == "true"
    # AES-256 GCM PII encryption (Privacy Act 2026)
    # Set PII_ENCRYPTION_ENABLED=true and PII_ENCRYPTION_KEY=<32-byte base64> to activate.
    # Generate a key: python3 -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"
    pii_encryption_enabled: bool = os.environ.get("PII_ENCRYPTION_ENABLED", "false").lower() == "true"
    pii_encryption_key: str = os.environ.get("PII_ENCRYPTION_KEY", "")
    # Outbound email. For Google Workspace/Gmail use smtp.gmail.com + an App Password.
    email_enabled: bool = os.environ.get("EMAIL_ENABLED", "false").lower() == "true"
    smtp_host: str = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    smtp_port: int = int(os.environ.get("SMTP_PORT", "587") or 587)
    smtp_username: str = os.environ.get("SMTP_USERNAME", "")
    smtp_password: str = os.environ.get("SMTP_PASSWORD", "")
    smtp_from_email: str = os.environ.get("SMTP_FROM_EMAIL", os.environ.get("SMTP_USERNAME", ""))
    smtp_from_name: str = os.environ.get("SMTP_FROM_NAME", "CareScribe")
    smtp_use_starttls: bool = os.environ.get("SMTP_USE_STARTTLS", "true").lower() == "true"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
