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
    # Google Cloud Translation
    google_cloud_translation_api_key: str = os.environ.get("GOOGLE_CLOUD_TRANSLATION_API_KEY", "")
    google_translate_url: str = os.environ.get("GOOGLE_TRANSLATE_URL", "https://translation.googleapis.com/language/translate/v2")
    google_maps_api_key: str = os.environ.get("GOOGLE_MAPS_API_KEY", "")
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
    email_queue_workers: int = int(os.environ.get("EMAIL_QUEUE_WORKERS", "1") or 1)
    email_queue_max_size: int = int(os.environ.get("EMAIL_QUEUE_MAX_SIZE", "1000") or 1000)
    notification_scheduler_enabled: bool = os.environ.get("NOTIFICATION_SCHEDULER_ENABLED", "true").lower() == "true"
    notification_scheduler_interval_minutes: int = int(
        os.environ.get("NOTIFICATION_SCHEDULER_INTERVAL_MINUTES", "15") or 15
    )
    shift_reminder_hours_ahead: int = int(os.environ.get("SHIFT_REMINDER_HOURS_AHEAD", "24") or 24)

    # Task evidence object storage (CARECLIQV2-230)
    # Provider: supabase (default) | s3 | azure — or set *_ENABLED flags below
    evidence_storage_provider: str = os.environ.get("EVIDENCE_STORAGE_PROVIDER", "supabase")
    evidence_storage_s3_enabled: bool = os.environ.get("EVIDENCE_STORAGE_S3_ENABLED", "false").lower() == "true"
    evidence_storage_azure_enabled: bool = os.environ.get("EVIDENCE_STORAGE_AZURE_ENABLED", "false").lower() == "true"
    evidence_storage_bucket: str = os.environ.get("EVIDENCE_STORAGE_BUCKET", "session-evidence")
    # AWS S3
    evidence_s3_bucket: str = os.environ.get("EVIDENCE_AWS_S3_BUCKET", "")
    evidence_s3_endpoint_url: str = os.environ.get("EVIDENCE_S3_ENDPOINT_URL", "")
    aws_access_key_id: str = os.environ.get("AWS_ACCESS_KEY_ID", "")
    aws_secret_access_key: str = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
    aws_s3_region: str = os.environ.get("AWS_S3_REGION", "ap-southeast-2")
    # Azure Blob
    evidence_azure_container: str = os.environ.get("EVIDENCE_AZURE_CONTAINER", "")
    azure_storage_connection_string: str = os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "")

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
