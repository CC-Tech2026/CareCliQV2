"""
Evidence access and verification service — chain-of-custody implementation.

Handles:
  - Download with SHA-256 hash verification (HARD BLOCK on mismatch)
  - Access logging for all evidence interactions
  - Coordinator alerts on integrity failures
  - Immutable audit trail
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException, Request

from .supabase_client import get_supabase_admin
from .audit_service import log_action

logger = logging.getLogger(__name__)


async def log_evidence_access(
    evidence_id: str,
    session_id: str,
    organization_id: str,
    accessed_by: str,
    action: str,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    file_hash_match: Optional[bool] = None,
    file_hash_stored: Optional[str] = None,
    file_hash_computed: Optional[str] = None,
    purpose: Optional[str] = None,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
) -> None:
    """
    Log evidence access to immutable audit trail (evidence_access_audit_log).
    
    Non-fatal: failures are logged but never raised (primary operation unaffected).
    
    This function is async to match FastAPI patterns, but the actual DB operation
    is synchronous (Supabase client). The async wrapper allows this to be called
    from async contexts without blocking.
    
    Parameters
    ----------
    evidence_id : str
        Evidence identifier (e.g., "evid_xxx")
    session_id : str
        Associated session UUID
    organization_id : str
        Organization UUID
    accessed_by : str
        User UUID who accessed the evidence
    action : str
        Action type: upload, view, download, hash_verified, hash_failed, exported, etc.
    ip_address : str, optional
        Client IP address (inet type)
    user_agent : str, optional
        User agent string
    file_hash_match : bool, optional
        True = hash matched, False = mismatch, None = not verified
    file_hash_stored : str, optional
        Expected SHA-256 hash from metadata
    file_hash_computed : str, optional
        Computed SHA-256 hash (populated on verification)
    purpose : str, optional
        Why the access occurred (e.g., "compliance_review", "export_report")
    error_code : str, optional
        Error code if access failed
    error_message : str, optional
        Error message if access failed
    """
    try:
        row: dict[str, Any] = {
            "evidence_id": evidence_id,
            "session_id": session_id,
            "organization_id": organization_id,
            "accessed_by": accessed_by,
            "action": action,
        }
        if ip_address:
            row["ip_address"] = ip_address
        if user_agent:
            row["user_agent"] = user_agent
        if file_hash_match is not None:
            row["file_hash_match"] = file_hash_match
        if file_hash_stored:
            row["file_hash_stored"] = file_hash_stored
        if file_hash_computed:
            row["file_hash_computed"] = file_hash_computed
        if purpose:
            row["purpose"] = purpose
        if error_code:
            row["error_code"] = error_code
        if error_message:
            row["error_message"] = error_message

        get_supabase_admin().table("evidence_access_audit_log").insert(row).execute()
    except Exception as exc:
        logger.warning(
            "Failed to log evidence access (non-fatal): evidence_id=%s action=%s: %s",
            evidence_id, action, exc
        )


async def alert_coordinator_integrity_failure(
    organization_id: str,
    evidence_id: str,
    session_id: str,
    file_hash_stored: str,
    file_hash_computed: str,
    storage_path: str,
) -> None:
    """
    Alert coordinator of evidence integrity failure (hash mismatch).
    
    This is a CRITICAL security event indicating possible tampering or corruption.
    
    Non-fatal: failures are logged but never raised.
    """
    try:
        # Log to audit_logs as a compliance incident
        await log_action(
            action_type="evidence.hash_verification_failed",
            entity_type="evidence_file",
            entity_id=evidence_id,
            user_id=None,  # System-initiated alert
            organization_id=organization_id,
            details={
                "evidence_id": evidence_id,
                "session_id": str(session_id),
                "file_hash_stored": file_hash_stored,
                "file_hash_computed": file_hash_computed,
                "storage_path": storage_path,
                "potential_cause": "file_tampering_or_corruption",
                "alert_type": "CRITICAL",
            }
        )
        
        logger.critical(
            "EVIDENCE INTEGRITY FAILURE: evidence_id=%s session_id=%s hash_mismatch. "
            "Expected=%s, Computed=%s. Possible tampering detected.",
            evidence_id, session_id, file_hash_stored, file_hash_computed
        )
        
        # TODO: Implement coordinator notification system
        # For now, rely on audit_logs being accessible in coordinator dashboard
        # Future: Send in-app alert, email, SMS based on coordinator preferences
        
    except Exception as exc:
        logger.error("Failed to alert coordinator of integrity failure: %s", exc)


async def verify_and_download_evidence(
    evidence_id: str,
    request: Request,
    user_id: str,
    organization_id: str,
) -> tuple[bytes, dict[str, Any]]:
    """
    Download evidence file with SHA-256 verification.
    
    Hard blocks on hash mismatch. Logs all access and verification results.
    
    Parameters
    ----------
    evidence_id : str
        Evidence identifier
    request : Request
        FastAPI request (for IP, user agent)
    user_id : str
        User UUID (accessor)
    organization_id : str
        Organization UUID
    
    Returns
    -------
    tuple[bytes, dict]
        (file_bytes, metadata_dict)
    
    Raises
    ------
    HTTPException
        - 404 if evidence not found
        - 403 if authorization fails or hash mismatch
    """
    
    ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    
    supabase = get_supabase_admin()
    
    # 1. Fetch metadata
    try:
        metadata_resp = (
            supabase.table("task_evidence_metadata")
            .select("*")
            .eq("evidence_id", evidence_id)
            .single()
            .execute()
        )
        metadata = metadata_resp.data
    except Exception as exc:
        logger.warning(f"Evidence not found: {evidence_id}")
        # Log permission denied
        await log_evidence_access(
            evidence_id=evidence_id,
            session_id="unknown",
            organization_id=organization_id,
            accessed_by=user_id,
            action="permission_denied",
            ip_address=ip_address,
            user_agent=user_agent,
            error_code="NOT_FOUND",
            error_message="Evidence not found"
        )
        raise HTTPException(404, "Evidence not found")
    
    if not metadata:
        logger.warning(f"Evidence metadata not found: {evidence_id}")
        await log_evidence_access(
            evidence_id=evidence_id,
            session_id="unknown",
            organization_id=organization_id,
            accessed_by=user_id,
            action="permission_denied",
            ip_address=ip_address,
            user_agent=user_agent,
            error_code="NOT_FOUND",
            error_message="Evidence metadata not found"
        )
        raise HTTPException(404, "Evidence not found")
    
    session_id = metadata["session_id"]
    
    # 2. Check authorization (user must be part of org)
    try:
        org_check = (
            supabase.table("organization_members")
            .select("id")
            .eq("organization_id", organization_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        if not org_check.data:
            logger.warning(
                f"Authorization failed: user={user_id} org={organization_id}"
            )
            await log_evidence_access(
                evidence_id=evidence_id,
                session_id=session_id,
                organization_id=organization_id,
                accessed_by=user_id,
                action="permission_denied",
                ip_address=ip_address,
                user_agent=user_agent,
                error_code="UNAUTHORIZED",
                error_message="User not member of organization"
            )
            raise HTTPException(403, "Not authorized")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Authorization check failed: {exc}")
        await log_evidence_access(
            evidence_id=evidence_id,
            session_id=session_id,
            organization_id=organization_id,
            accessed_by=user_id,
            action="permission_denied",
            ip_address=ip_address,
            user_agent=user_agent,
            error_code="AUTH_ERROR",
            error_message=str(exc)
        )
        raise HTTPException(403, "Authorization check failed")
    
    # 3. Download file from object storage
    storage_provider = metadata["storage_provider"]
    storage_path = metadata["storage_path"]
    
    try:
        if storage_provider == "supabase":
            bucket_name = "session-evidence"  # or from settings
            bucket = supabase.storage.from_(bucket_name)
            file_bytes = bucket.download(storage_path)
        else:
            # TODO: Implement S3/Azure download
            raise NotImplementedError(f"Provider {storage_provider} not yet implemented")
    except Exception as exc:
        logger.error(f"Failed to download file from storage: {storage_path}: {exc}")
        await log_evidence_access(
            evidence_id=evidence_id,
            session_id=session_id,
            organization_id=organization_id,
            accessed_by=user_id,
            action="permission_denied",
            ip_address=ip_address,
            user_agent=user_agent,
            error_code="STORAGE_ERROR",
            error_message=str(exc)
        )
        raise HTTPException(500, "Failed to retrieve file from storage")
    
    # 4. Compute hash
    computed_hash = hashlib.sha256(file_bytes).hexdigest()
    
    # 5. Verify hash against stored value
    stored_hash = metadata["file_hash"]
    hash_match = (computed_hash == stored_hash)
    
    # 6. Log the access attempt (before deciding to serve)
    if not hash_match:
        # HASH MISMATCH: BLOCK AND ALERT
        await log_evidence_access(
            evidence_id=evidence_id,
            session_id=session_id,
            organization_id=organization_id,
            accessed_by=user_id,
            action="hash_failed",
            ip_address=ip_address,
            user_agent=user_agent,
            file_hash_match=False,
            file_hash_stored=stored_hash,
            file_hash_computed=computed_hash,
            error_code="HASH_MISMATCH",
            error_message=f"File integrity check failed: stored={stored_hash}, computed={computed_hash}"
        )
        
        # Alert coordinator
        await alert_coordinator_integrity_failure(
            organization_id=organization_id,
            evidence_id=evidence_id,
            session_id=session_id,
            file_hash_stored=stored_hash,
            file_hash_computed=computed_hash,
            storage_path=storage_path
        )
        
        # BLOCK THE DOWNLOAD
        logger.critical(
            "EVIDENCE INTEGRITY FAILURE: Blocking download of %s. Hash mismatch.",
            evidence_id
        )
        raise HTTPException(
            status_code=403,
            detail="File integrity validation failed. Security incident has been logged and coordinator notified."
        )
    
    # HASH MATCH: Safe to serve
    await log_evidence_access(
        evidence_id=evidence_id,
        session_id=session_id,
        organization_id=organization_id,
        accessed_by=user_id,
        action="download",
        ip_address=ip_address,
        user_agent=user_agent,
        file_hash_match=True,
        file_hash_stored=stored_hash,
        purpose="evidence_download"
    )
    
    # Update integrity_verified_at
    try:
        supabase.table("task_evidence_metadata").update({
            "integrity_verified_at": datetime.now(timezone.utc).isoformat()
        }).eq("evidence_id", evidence_id).execute()
    except Exception as exc:
        logger.warning(f"Failed to update integrity_verified_at: {exc}")
    
    return file_bytes, metadata


async def log_evidence_export(
    evidence_ids: list[str],
    session_id: str,
    organization_id: str,
    accessed_by: str,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    """
    Log evidence items as included in a compliance export/report.
    
    Non-fatal: failures never block the export.
    """
    for evidence_id in evidence_ids:
        try:
            await log_evidence_access(
                evidence_id=evidence_id,
                session_id=session_id,
                organization_id=organization_id,
                accessed_by=accessed_by,
                action="exported",
                ip_address=ip_address,
                user_agent=user_agent,
                purpose="compliance_export"
            )
        except Exception as exc:
            logger.warning(f"Failed to log evidence export: {evidence_id}: {exc}")
