from app.core.config import settings, _REPO_ROOT_ENV_FILE
print("Loading .env from:", _REPO_ROOT_ENV_FILE)
print("File exists:", _REPO_ROOT_ENV_FILE.exists())
print("evidence_storage_provider (from settings):", repr(settings.evidence_storage_provider))
print("evidence_storage_s3_enabled (from settings):", settings.evidence_storage_s3_enabled)
print("evidence_s3_bucket set:", bool(settings.evidence_s3_bucket), "len:", len(settings.evidence_s3_bucket))
print("aws_access_key_id set:", bool(settings.aws_access_key_id), "len:", len(settings.aws_access_key_id))
print("aws_s3_region:", repr(settings.aws_s3_region))
import os
print("raw os.environ EVIDENCE_STORAGE_PROVIDER:", repr(os.environ.get("EVIDENCE_STORAGE_PROVIDER")))
