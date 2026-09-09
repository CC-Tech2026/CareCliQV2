"""Bug reports — see backend/app/api/bug_reports.py for the submission
endpoint (any staff member, scoped to their own org) and
backend/app/api/admin.py for the Super Admin listing/status endpoints that
read across every org. Mirrors operational_feedback_service.py's shape,
minus the fields (category, resolution_notes) this simpler v1 doesn't need.

Attachments (photos/short screen recordings of the bug) reuse the same
pluggable object storage already backing shift evidence
(object_storage.py) — no new bucket/provider setup needed. Deliberately
lighter-weight than evidence_upload_service.py: no chain-of-custody
metadata table, since this isn't participant-safety data."""

from __future__ import annotations

import base64
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from . import jira_service
from .object_storage import upload_evidence_bytes
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

VALID_SEVERITIES = {"low", "medium", "urgent"}

MAX_ATTACHMENTS = 3
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_VIDEO_BYTES = 20 * 1024 * 1024

ALLOWED_IMAGE_MIME = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_VIDEO_MIME = {"video/mp4", "video/webm", "video/quicktime"}

_EXT_BY_MIME = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
}

_DATA_URL_RE = re.compile(r"^data:[^;]+;base64,", re.IGNORECASE)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _decode_base64_payload(raw: str) -> bytes:
    text = (raw or "").strip()
    text = _DATA_URL_RE.sub("", text)
    try:
        return base64.b64decode(text, validate=False)
    except Exception as exc:
        raise ValueError("Invalid base64 file data") from exc


def _process_attachments(
    organization_id: str | None, report_id: str, attachments: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Validates and uploads each attachment, returning the metadata to
    store on the bug_reports row. Raises ValueError on anything invalid —
    the caller treats that as a 400, distinct from an upload/storage
    failure, which is a 500 (see bug_reports.py)."""
    if len(attachments) > MAX_ATTACHMENTS:
        raise ValueError(f"Attach at most {MAX_ATTACHMENTS} files.")

    stored: list[dict[str, Any]] = []
    for i, item in enumerate(attachments):
        mime_type = str(item.get("mime_type") or "").split(";")[0].strip().lower()
        is_image = mime_type in ALLOWED_IMAGE_MIME
        is_video = mime_type in ALLOWED_VIDEO_MIME
        if not is_image and not is_video:
            raise ValueError(f"Unsupported file type: {mime_type or 'unknown'}")

        raw_bytes = _decode_base64_payload(str(item.get("data") or ""))
        if len(raw_bytes) == 0:
            raise ValueError("Empty file.")
        max_bytes = MAX_IMAGE_BYTES if is_image else MAX_VIDEO_BYTES
        if len(raw_bytes) > max_bytes:
            raise ValueError(f"File exceeds {max_bytes // (1024 * 1024)} MB limit.")

        ext = _EXT_BY_MIME.get(mime_type, "bin")
        storage_path = f"{organization_id or 'internal'}/bug-reports/{report_id}/{i}-{uuid.uuid4().hex[:8]}.{ext}"
        stored_object = upload_evidence_bytes(storage_path, raw_bytes, mime_type)
        stored.append(
            {
                "storage_path": stored_object.storage_path,
                "mime_type": mime_type,
                "file_size_bytes": len(raw_bytes),
            }
        )
    return stored


def _organization_display_name(organization_id: str | None) -> str:
    """Jira's Reporter field only accepts a real Jira user account — it
    can't hold an org name as text, so instead the org goes at the front
    of the ticket title/description (see create_bug_report below).

    None means a Super Admin filed this as "Internal" — not on behalf of
    any provider (see 190_bug_reports_nullable_org.sql) — so there's no
    org row to look up at all."""
    if organization_id is None:
        return "Internal — Master Portal"
    try:
        result = (
            get_supabase_admin()
            .table("organizations")
            .select("organization_name, name")
            .eq("organization_id", organization_id)
            .maybe_single()
            .execute()
        )
        org = result.data if result else None
        return (org or {}).get("organization_name") or (org or {}).get("name") or "Unknown organisation"
    except Exception as exc:
        logger.warning("Could not resolve organisation name for %s: %s", organization_id, exc)
        return "Unknown organisation"


async def create_bug_report(
    organization_id: str | None,
    reporter_id: str,
    description: str,
    page_url: str | None,
    attachments: list[dict[str, Any]] | None = None,
    severity: str = "low",
) -> dict[str, Any]:
    if severity not in VALID_SEVERITIES:
        raise ValueError(f"Invalid severity: {severity}")
    description = description.strip()
    now = _now_iso()
    payload = {
        "organization_id": organization_id,
        "reporter_id": reporter_id,
        "description": description,
        "page_url": (page_url or "").strip() or None,
        "status": "open",
        "severity": severity,
        "created_at": now,
        "updated_at": now,
    }
    try:
        resp = get_supabase_admin().table("bug_reports").insert(payload).execute()
    except Exception as exc:
        # The base report must still save even before the migration adding
        # this column has run — same "never let an optional field block
        # the core submission" reasoning as attachments/Jira below, just
        # applied one step earlier since severity is on the base insert.
        if "severity" in str(exc).lower() and "column" in str(exc).lower():
            logger.warning("bug_reports.severity column missing — saving without it: %s", exc)
            payload.pop("severity")
            resp = get_supabase_admin().table("bug_reports").insert(payload).execute()
        else:
            raise
    row = resp.data[0]

    if attachments:
        # Validation/upload errors raise ValueError (400) — deliberately
        # not swallowed, since a rejected attachment is something the
        # submitter should be told about and can fix.
        stored = _process_attachments(organization_id, row["id"], attachments)
        # Saving that upload onto the row is a separate, later failure
        # mode: the file(s) are already sitting in storage by this point,
        # so losing this link (e.g. a pending migration) must degrade,
        # not turn an otherwise-successful submission into a 500 — same
        # reasoning as the Jira-link step below.
        try:
            update_resp = (
                get_supabase_admin()
                .table("bug_reports")
                .update({"attachments": stored})
                .eq("id", row["id"])
                .execute()
            )
            row = update_resp.data[0]
        except Exception as exc:
            logger.warning("Could not save attachments onto bug_reports %s: %s", row["id"], exc)

    # Best-effort — Jira being unconfigured or unreachable must never fail
    # the submission itself, which has already been saved above.
    org_name = _organization_display_name(organization_id)
    attachment_note = f"\n\nAttachments: {len(row.get('attachments') or [])}" if row.get("attachments") else ""
    issue_key = await jira_service.create_issue(
        summary=f"[{org_name}] {description[:80]}",
        description=f"Reported by organisation: {org_name}\nPage: {page_url or 'unknown'}\n\n{description}{attachment_note}",
        severity=row.get("severity", severity),
    )
    if issue_key:
        # A real Jira ticket already exists at this point — saving its key
        # back to our row is itself best-effort. Losing this link (e.g. the
        # migration adding this column hasn't run yet) must never turn into
        # a 500 for a submission that has already fully saved and already
        # has a real Jira ticket sitting there.
        try:
            update_resp = (
                get_supabase_admin()
                .table("bug_reports")
                .update({"jira_issue_key": issue_key})
                .eq("id", row["id"])
                .execute()
            )
            row = update_resp.data[0]
        except Exception as exc:
            logger.warning("Could not save jira_issue_key=%s onto bug_reports %s: %s", issue_key, row["id"], exc)

    return row
