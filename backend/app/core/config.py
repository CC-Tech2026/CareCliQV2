import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from pydantic import field_validator
from pydantic_settings import BaseSettings

_REPO_ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"

# Every field below reads via a plain os.environ.get(...) at class-definition
# time, evaluated once when this module is first imported — that only ever
# sees real shell-exported variables. pydantic-settings' own `env_file`
# loading (Config.env_file below) is a *separate* mechanism that only bridges
# the gap for fields whose Python attribute name matches their env var name
# case-insensitively (e.g. supabase_url <-> SUPABASE_URL); secret_key's env
# var is SESSION_SECRET, which doesn't match, so it silently fell through to
# the hardcoded default in any local run that hadn't manually exported
# SESSION_SECRET first. Loading .env into the real environment here, before
# any field default is evaluated, fixes that for every field, not just this
# one. Production is unaffected — Render injects real env vars directly.
#
# Skipped under pytest deliberately: this repo's .env points at the real
# hosted Supabase project. Several existing tests have unmocked network-call
# gaps that previously failed safely against an empty SUPABASE_URL default;
# auto-loading real production credentials here would turn that into tests
# silently reaching the live database instead. Tests that actually want a
# real database opt in explicitly via INTEGRATION_REAL_DB (see
# backend/tests/integration/), never via this file.
if "pytest" not in sys.modules:
    load_dotenv(_REPO_ROOT_ENV_FILE)


class Settings(BaseSettings):
    supabase_url: str = os.environ.get("SUPABASE_URL", "")
    supabase_anon_key: str = os.environ.get("SUPABASE_ANON_KEY", "")
    supabase_service_role_key: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    # Australian data residency: hosted projects must be in ap-southeast-2 (Sydney).
    supabase_region: str = os.environ.get("SUPABASE_REGION", "")
    supabase_access_token: str = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    supabase_region_check: str = os.environ.get("SUPABASE_REGION_CHECK", "enabled")
    openai_api_key: str = os.environ.get("OPENAI_API_KEY", "")
    
    @field_validator("supabase_url", "supabase_anon_key", "supabase_service_role_key", "openai_api_key", mode="before")
    @classmethod
    def strip_whitespace(cls, v):
        if isinstance(v, str):
            return v.strip()
        return v
    anthropic_api_key: str = os.environ.get("ANTHROPIC_API_KEY", "")
    # Chatbox ("Quill") — LangGraph agent tracing via LangSmith
    langsmith_api_key: str = os.environ.get("LANGSMITH_API_KEY", "")
    langsmith_project: str = os.environ.get("LANGSMITH_PROJECT", "carecliq-chatbox")
    langsmith_tracing_enabled: bool = os.environ.get("LANGSMITH_TRACING_ENABLED", "false").lower() == "true"
    # Chatbox LLM provider — "anthropic" (production default) or "openai" (for
    # testing when the Anthropic account has no credit balance).
    chatbox_llm_provider: str = os.environ.get("CHATBOX_LLM_PROVIDER", "anthropic")
    frontend_base_url: str = os.environ.get(
        "FRONTEND_BASE_URL",
        os.environ.get("FRONTEND_URL", os.environ.get("APP_BASE_URL", "http://localhost:3000")),
    )
    secret_key: str = os.environ.get("SESSION_SECRET", "changeme-in-production")

    @field_validator("secret_key")
    @classmethod
    def _require_real_secret_key(cls, v):
        # Every application JWT — including the organization_id claim that
        # OrgContextMiddleware trusts absolutely for tenant isolation — is signed
        # with this key. An unset, default, or short value means anyone who can
        # compute an HS256 signature can forge a token for any organisation, so
        # this must fail loudly at startup rather than silently accept a weak key.
        if not v or v == "changeme-in-production" or len(v) < 32:
            raise ValueError(
                "SESSION_SECRET is missing, using the placeholder default, or too short "
                "(need 32+ chars). Set a real generated value, e.g.: "
                "python -c \"import secrets; print(secrets.token_urlsafe(32))\""
            )
        return v

    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    reauth_token_expire_minutes: int = int(os.environ.get("REAUTH_TOKEN_EXPIRE_MINUTES", "10") or 10)
    auth_auto_confirm_email: bool = os.environ.get("AUTH_AUTO_CONFIRM_EMAIL", "false").lower() == "true"
    # Google Cloud Translation
    google_cloud_translation_api_key: str = os.environ.get("GOOGLE_CLOUD_TRANSLATION_API_KEY", "")
    google_translate_url: str = os.environ.get("GOOGLE_TRANSLATE_URL", "https://translation.googleapis.com/language/translate/v2")
    # Optional Speech-to-Text key; defaults to GOOGLE_CLOUD_TRANSLATION_API_KEY (same GCP project)
    google_cloud_speech_api_key: str = os.environ.get("GOOGLE_CLOUD_SPEECH_API_KEY", "")
    # Optional override for Speech recognize URL (v1). Discovery document URLs are ignored.
    google_speech_to_text_url: str = os.environ.get(
        "GOOGLE_SPEECH_TO_TEXT_URL",
        "https://speech.googleapis.com/v1/speech:recognize",
    )
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
    smtp_from_name: str = os.environ.get("SMTP_FROM_NAME", "CareCliQ")
    smtp_use_starttls: bool = os.environ.get("SMTP_USE_STARTTLS", "true").lower() == "true"
    email_queue_workers: int = int(os.environ.get("EMAIL_QUEUE_WORKERS", "1") or 1)
    email_queue_max_size: int = int(os.environ.get("EMAIL_QUEUE_MAX_SIZE", "1000") or 1000)
    # CareCliQ's own platform subscription billing (Stripe) — distinct from
    # NDIS participant funding in billing.py, which doesn't touch Stripe at all.
    stripe_secret_key: str = os.environ.get("STRIPE_SECRET_KEY", "")
    stripe_webhook_secret: str = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    notification_scheduler_enabled: bool = os.environ.get("NOTIFICATION_SCHEDULER_ENABLED", "true").lower() == "true"
    notification_scheduler_interval_minutes: int = int(
        os.environ.get("NOTIFICATION_SCHEDULER_INTERVAL_MINUTES", "15") or 15
    )
    shift_reminder_hours_ahead: int = int(os.environ.get("SHIFT_REMINDER_HOURS_AHEAD", "24") or 24)
    shift_reminder_minutes_first: int = int(os.environ.get("SHIFT_REMINDER_MINUTES_FIRST", "60") or 60)
    shift_reminder_minutes_second: int = int(os.environ.get("SHIFT_REMINDER_MINUTES_SECOND", "30") or 30)
    expo_push_enabled: bool = os.environ.get("EXPO_PUSH_ENABLED", "false").lower() == "true"
    expo_access_token: str = os.environ.get("EXPO_ACCESS_TOKEN", "")
    firebase_enabled: bool = os.environ.get("FIREBASE_ENABLED", "false").lower() == "true"
    firebase_credentials_json: str = os.environ.get("FIREBASE_CREDENTIALS_JSON", "")
    firebase_credentials_path: str = os.environ.get("FIREBASE_CREDENTIALS_PATH", "")

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
        env_file = str(_REPO_ROOT_ENV_FILE)
        extra = "ignore"


settings = Settings()
