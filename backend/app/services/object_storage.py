"""
CARECLIQV2-230 — Pluggable object storage for task evidence media.

Provider resolution (first match wins):
  1. EVIDENCE_STORAGE_PROVIDER=supabase|s3|azure
  2. EVIDENCE_STORAGE_S3_ENABLED=true
  3. EVIDENCE_STORAGE_AZURE_ENABLED=true
  4. default: supabase
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional, Protocol

from ..core.config import settings

logger = logging.getLogger(__name__)

EVIDENCE_SIGNED_URL_SECONDS = 60 * 60 * 24 * 7


@dataclass(frozen=True)
class StoredObject:
    storage_path: str
    file_url: Optional[str]
    provider: str


class EvidenceStorageBackend(Protocol):
    provider: str

    def upload(self, storage_path: str, data: bytes, mime_type: str) -> StoredObject: ...

    def signed_url(self, storage_path: str) -> Optional[str]: ...

    def download(self, storage_path: str) -> bytes: ...


def resolve_evidence_storage_provider() -> str:
    explicit = (settings.evidence_storage_provider or os.environ.get("EVIDENCE_STORAGE_PROVIDER", "")).strip().lower()
    if explicit in ("s3", "aws", "aws_s3"):
        return "s3"
    if explicit in ("azure", "azure_blob", "blob"):
        return "azure"

    if settings.evidence_storage_s3_enabled or os.environ.get("EVIDENCE_STORAGE_S3_ENABLED", "").lower() == "true":
        return "s3"
    if settings.evidence_storage_azure_enabled or os.environ.get("EVIDENCE_STORAGE_AZURE_ENABLED", "").lower() == "true":
        return "azure"
    if explicit in ("supabase", "local", ""):
        return "supabase"
    return "supabase"


def _supabase_signed_url(bucket, path: str) -> Optional[str]:
    try:
        signed = bucket.create_signed_url(path, EVIDENCE_SIGNED_URL_SECONDS)
        if isinstance(signed, dict):
            return (
                signed.get("signedURL")
                or signed.get("signed_url")
                or signed.get("signedUrl")
                or (signed.get("data") or {}).get("signedUrl")
                or (signed.get("data") or {}).get("signedURL")
            )
    except Exception as exc:
        logger.warning("Supabase signed URL failed for %s: %s", path, exc)
    try:
        public_url = bucket.get_public_url(path)
        return str(public_url) if public_url else None
    except Exception:
        return None


class SupabaseEvidenceStorage:
    provider = "supabase"

    def __init__(self) -> None:
        from .supabase_client import get_supabase_admin

        self._bucket_name = settings.evidence_storage_bucket or "session-evidence"
        self._client = get_supabase_admin()
        self._bucket = self._client.storage.from_(self._bucket_name)

    def upload(self, storage_path: str, data: bytes, mime_type: str) -> StoredObject:
        self._bucket.upload(
            storage_path,
            data,
            {"content-type": mime_type, "upsert": "true"},
        )
        return StoredObject(
            storage_path=storage_path,
            file_url=self.signed_url(storage_path),
            provider=self.provider,
        )

    def signed_url(self, storage_path: str) -> Optional[str]:
        return _supabase_signed_url(self._bucket, storage_path)

    def download(self, storage_path: str) -> bytes:
        return self._bucket.download(storage_path)


class S3EvidenceStorage:
    provider = "s3"

    def __init__(self) -> None:
        try:
            import boto3
        except ImportError as exc:
            raise RuntimeError(
                "EVIDENCE_STORAGE_S3_ENABLED is true but boto3 is not installed. "
                "Run: uv pip install boto3"
            ) from exc

        bucket = settings.evidence_s3_bucket or os.environ.get("EVIDENCE_AWS_S3_BUCKET", "")
        if not bucket:
            raise RuntimeError("EVIDENCE_AWS_S3_BUCKET is required when S3 evidence storage is enabled")

        region = settings.aws_s3_region or os.environ.get("AWS_S3_REGION", "ap-southeast-2")
        endpoint = settings.evidence_s3_endpoint_url or os.environ.get("EVIDENCE_S3_ENDPOINT_URL") or None

        session = boto3.session.Session(
            aws_access_key_id=settings.aws_access_key_id or os.environ.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=settings.aws_secret_access_key or os.environ.get("AWS_SECRET_ACCESS_KEY"),
            region_name=region,
        )
        self._bucket = bucket
        self._client = session.client("s3", endpoint_url=endpoint)

    def upload(self, storage_path: str, data: bytes, mime_type: str) -> StoredObject:
        self._client.put_object(
            Bucket=self._bucket,
            Key=storage_path,
            Body=data,
            ContentType=mime_type,
        )
        return StoredObject(
            storage_path=storage_path,
            file_url=self.signed_url(storage_path),
            provider=self.provider,
        )

    def signed_url(self, storage_path: str) -> Optional[str]:
        try:
            return self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": storage_path},
                ExpiresIn=EVIDENCE_SIGNED_URL_SECONDS,
            )
        except Exception as exc:
            logger.warning("S3 presigned URL failed for %s: %s", storage_path, exc)
            return None

    def download(self, storage_path: str) -> bytes:
        response = self._client.get_object(Bucket=self._bucket, Key=storage_path)
        return response["Body"].read()


class AzureEvidenceStorage:
    provider = "azure"

    @staticmethod
    def _parse_connection_string(connection_string: str) -> tuple[str, str]:
        parts: dict[str, str] = {}
        for segment in connection_string.split(";"):
            if "=" in segment:
                key, value = segment.split("=", 1)
                parts[key.strip()] = value.strip()
        return parts.get("AccountName", ""), parts.get("AccountKey", "")

    def __init__(self) -> None:
        connection_string = (
            settings.azure_storage_connection_string
            or os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "")
        )
        container = settings.evidence_azure_container or os.environ.get("EVIDENCE_AZURE_CONTAINER", "")

        if not connection_string:
            raise RuntimeError(
                "AZURE_STORAGE_CONNECTION_STRING is required when Azure evidence storage is enabled"
            )
        if not container:
            raise RuntimeError("EVIDENCE_AZURE_CONTAINER is required when Azure evidence storage is enabled")

        try:
            from azure.storage.blob import BlobServiceClient, ContentSettings, generate_blob_sas, BlobSasPermissions
        except ImportError as exc:
            raise RuntimeError(
                "EVIDENCE_STORAGE_AZURE_ENABLED is true but azure-storage-blob is not installed. "
                "Run: uv pip install azure-storage-blob"
            ) from exc

        self._service = BlobServiceClient.from_connection_string(connection_string)
        self._container = container
        self._container_client = self._service.get_container_client(container)
        self._account_name, self._account_key = self._parse_connection_string(connection_string)
        self._generate_blob_sas = generate_blob_sas
        self._BlobSasPermissions = BlobSasPermissions
        self._ContentSettings = ContentSettings

        try:
            self._container_client.create_container()
        except Exception:
            pass

    def upload(self, storage_path: str, data: bytes, mime_type: str) -> StoredObject:
        blob = self._container_client.get_blob_client(storage_path)
        blob.upload_blob(
            data,
            overwrite=True,
            content_settings=self._ContentSettings(content_type=mime_type),
        )
        return StoredObject(
            storage_path=storage_path,
            file_url=self.signed_url(storage_path),
            provider=self.provider,
        )

    def signed_url(self, storage_path: str) -> Optional[str]:
        try:
            blob = self._container_client.get_blob_client(storage_path)
            if not self._account_name or not self._account_key:
                return blob.url

            sas = self._generate_blob_sas(
                account_name=self._account_name,
                container_name=self._container,
                blob_name=storage_path,
                account_key=self._account_key,
                permission=self._BlobSasPermissions(read=True),
                expiry=datetime.now(timezone.utc) + timedelta(seconds=EVIDENCE_SIGNED_URL_SECONDS),
            )
            return f"{blob.url}?{sas}"
        except Exception as exc:
            logger.warning("Azure SAS URL failed for %s: %s", storage_path, exc)
            return None

    def download(self, storage_path: str) -> bytes:
        blob = self._container_client.get_blob_client(storage_path)
        return blob.download_blob().readall()


_backends: dict[str, EvidenceStorageBackend] = {}


def get_evidence_storage_backend() -> EvidenceStorageBackend:
    provider = resolve_evidence_storage_provider()
    cached = _backends.get(provider)
    if cached is not None:
        return cached

    if provider == "s3":
        backend: EvidenceStorageBackend = S3EvidenceStorage()
    elif provider == "azure":
        backend = AzureEvidenceStorage()
    else:
        backend = SupabaseEvidenceStorage()

    _backends[provider] = backend
    logger.info("Evidence storage provider active: %s", provider)
    return backend


def upload_evidence_bytes(storage_path: str, data: bytes, mime_type: str) -> StoredObject:
    return get_evidence_storage_backend().upload(storage_path, data, mime_type)


def reset_evidence_storage_cache() -> None:
    """Clear cached backend — for tests and config hot-reload."""
    _backends.clear()
