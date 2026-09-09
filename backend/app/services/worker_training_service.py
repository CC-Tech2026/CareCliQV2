"""Worker training & certification — CARECLIQV2-289."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4
from urllib.parse import urlsplit

from fastapi import HTTPException

from .notification_service import _notify_office_staff, notify_worker
from .supabase_client import get_supabase_admin
from .training_cover_service import validate_cover, with_cover_url
from .training_material_service import validate_material_path, with_material_url

logger = logging.getLogger(__name__)


def require_available_module(organization_id: str, module_id: str) -> dict[str, Any]:
    result = (get_supabase_admin().table("training_modules").select("*")
              .eq("id", module_id).eq("organization_id", organization_id)
              .eq("is_active", True).maybe_single().execute())
    if not result.data:
        raise HTTPException(status_code=404, detail="Training module not found.")
    if result.data.get("is_locked"):
        raise HTTPException(status_code=423, detail="This module is being updated. Please try again when it is unlocked.")
    return result.data


def locked_module_ids(organization_id: str) -> set[str]:
    try:
        rows = (get_supabase_admin().table("training_modules").select("id")
                .eq("organization_id", organization_id).eq("is_locked", True).execute())
    except Exception as exc:
        # Older databases have no maintenance state until migration 182 runs.
        if _is_missing_schema(exc):
            return set()
        raise
    return {str(row["id"]) for row in (rows.data or [])}


def list_shared_resources(organization_id: str) -> list[dict[str, Any]]:
    if not organization_id:
        raise HTTPException(status_code=403, detail="Organization membership required.")
    result = (get_supabase_admin().table("onboarding_stage_resources")
              .select("id, name, category, resource_type, file_size_bytes")
              .eq("org_id", organization_id).order("name").execute())
    return result.data or []


def shared_resource_url(organization_id: str, resource_id: str) -> dict[str, str]:
    if not organization_id:
        raise HTTPException(status_code=403, detail="Organization membership required.")
    db = get_supabase_admin()
    result = (db.table("onboarding_stage_resources").select("file_key")
              .eq("org_id", organization_id).eq("id", resource_id).maybe_single().execute())
    if not result.data or not result.data.get("file_key"):
        raise HTTPException(status_code=404, detail="Resource file not found.")
    signed = db.storage.from_("onboarding-resources").create_signed_url(result.data["file_key"], 300)
    url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")
    if not url:
        raise HTTPException(status_code=502, detail="Could not open this resource. Please try again.")
    return {"url": url}


def manage_training_resource(
    organization_id: str, module_id: str, payload: dict[str, Any] | None,
    resource_id: str | None = None,
) -> dict[str, Any]:
    """Manage materials only after verifying ownership of the parent module."""
    db = get_supabase_admin()
    module = (db.table("training_modules").select("id")
              .eq("organization_id", organization_id).eq("id", module_id)
              .maybe_single().execute())
    if not module.data:
        raise HTTPException(status_code=404, detail="Training module not found.")
    if payload is None:
        result = (db.table("training_resources").delete()
                  .eq("module_id", module_id).eq("id", resource_id).execute())
        if not result.data:
            raise HTTPException(status_code=404, detail="Material not found.")
        return {"ok": True}
    title = str(payload.get("title") or "").strip()
    url = str(payload.get("external_url") or "").strip()
    try:
        parsed = urlsplit(url)
        valid_url = parsed.scheme in ("http", "https") and bool(parsed.hostname)
    except ValueError:
        valid_url = False
    storage_path = payload.get("storage_path") or None
    if storage_path:
        validate_material_path(organization_id, module_id, storage_path, payload.get("resource_type"))
    if not title or (not valid_url and not storage_path):
        raise HTTPException(status_code=422, detail="A title and valid HTTP(S) material URL are required.")
    if payload.get("resource_type") not in ("video", "pdf", "external_link"):
        raise HTTPException(status_code=422, detail="Unsupported material type.")
    if payload.get("sort_order", 0) < 0:
        raise HTTPException(status_code=422, detail="Material position cannot be negative.")
    record = {"title": title, "external_url": None if storage_path else url, "storage_path": storage_path,
              "resource_type": payload["resource_type"], "sort_order": payload.get("sort_order", 0)}
    if resource_id:
        result = (db.table("training_resources").update(record)
                  .eq("module_id", module_id).eq("id", resource_id).execute())
        if not result.data:
            raise HTTPException(status_code=404, detail="Material not found.")
        return with_material_url(result.data[0])
    record.update({"id": str(uuid4()), "module_id": module_id})
    db.table("training_resources").insert(record).execute()
    return with_material_url(record)

EXPIRING_DAYS = 60


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def credential_display_status(expiry_date: str | None, stored: str | None = None) -> str:
    if stored in {"pending_review", "rejected"}:
        return stored
    if not expiry_date:
        return stored or "valid"
    expiry = date.fromisoformat(str(expiry_date)[:10])
    today = date.today()
    if expiry < today:
        return "expired"
    if (expiry - today).days <= EXPIRING_DAYS:
        return "expiring"
    return "valid"


def list_worker_certifications(user_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("credentials")
            .select("*")
            .eq("user_id", user_id)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise

    enriched = []
    for row in rows:
        status = credential_display_status(row.get("expiry_date"), row.get("status"))
        enriched.append({**row, "display_status": status})

    def sort_key(item: dict[str, Any]) -> tuple:
        status = item.get("display_status")
        expiry = item.get("expiry_date") or "9999-12-31"
        priority = 0 if status == "expired" else 1
        return (priority, expiry)

    enriched.sort(key=sort_key)
    return enriched


def list_training_modules(organization_id: str) -> list[dict[str, Any]]:
    try:
        mod_resp = (
            get_supabase_admin()
            .table("training_modules")
            .select("*")
            .eq("organization_id", organization_id)
            .eq("is_active", True)
            .order("title")
            .execute()
        )
        modules = mod_resp.data or []
        if not modules:
            return []
        ids = [m["id"] for m in modules]
        res_resp = (
            get_supabase_admin()
            .table("training_resources")
            .select("*")
            .in_("module_id", ids)
            .order("sort_order")
            .execute()
        )
        by_module: dict[str, list] = {}
        for res in res_resp.data or []:
            by_module.setdefault(str(res["module_id"]), []).append(with_material_url(res))
        for mod in modules:
            mod["resources"] = by_module.get(str(mod["id"]), [])
            with_cover_url(mod)
        return modules
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def mark_training_complete(
    worker_id: str,
    organization_id: str,
    module_id: str,
    completed_at: date,
    note: str | None = None,
    acknowledged: bool = False,
) -> dict[str, Any]:
    if not acknowledged:
        raise HTTPException(
            status_code=422,
            detail="You must tick the acknowledgment box confirming you completed this training before submitting.",
        )
    module = require_available_module(organization_id, module_id)
    if module.get("requires_certification"):
        raise HTTPException(status_code=422, detail="Upload certification evidence for this module instead.")
    now = datetime.now(timezone.utc).isoformat()
    record = {
        "id": str(uuid4()),
        "worker_id": worker_id,
        "module_id": module_id,
        "organization_id": organization_id,
        "completed_at": completed_at.isoformat(),
        "note": note,
        "status": "awaiting_confirmation",
        "acknowledged": True,
        "acknowledged_at": now,
    }
    try:
        get_supabase_admin().table("worker_training_completions").upsert(
            record,
            on_conflict="worker_id,module_id",
        ).execute()
    except Exception as exc:
        if "under maintenance" in str(exc).lower():
            raise HTTPException(status_code=423, detail="This module is being updated. Please try again when it is unlocked.") from exc
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Training service unavailable.") from exc
        raise

    import asyncio

    async def _notify():
        await _notify_office_staff(
            org_id=organization_id,
            title="Training completion to review",
            message=f"A worker marked a training module complete on {completed_at.isoformat()}.",
            reference_key=f"training_completion:{record['id']}",
            event="training_completion_review",
        )

    try:
        asyncio.get_event_loop().create_task(_notify())
    except Exception:
        pass
    return record


def create_training_request(
    worker_id: str,
    organization_id: str,
    request_text: str,
    reason: str,
    urgent: bool = False,
) -> dict[str, Any]:
    if not request_text.strip() or not reason.strip():
        raise HTTPException(status_code=422, detail="Request and reason are required.")
    record = {
        "id": str(uuid4()),
        "worker_id": worker_id,
        "organization_id": organization_id,
        "request_text": request_text.strip(),
        "reason": reason.strip(),
        "urgent": urgent,
        "status": "pending",
    }
    try:
        get_supabase_admin().table("worker_training_requests").insert(record).execute()
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Training service unavailable.") from exc
        raise

    import asyncio

    async def _notify():
        await _notify_office_staff(
            org_id=organization_id,
            title="Training request" + (" (urgent)" if urgent else ""),
            message=request_text.strip(),
            reference_key=f"training_request:{record['id']}",
            severity="high" if urgent else "medium",
            event="training_request",
        )

    try:
        asyncio.get_event_loop().create_task(_notify())
    except Exception:
        pass
    return record


def list_training_requests(worker_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("worker_training_requests")
            .select("*")
            .eq("worker_id", worker_id)
            .order("created_at", desc=True)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def list_training_history(worker_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("worker_training_completions")
            .select("*, training_modules(title)")
            .eq("worker_id", worker_id)
            .order("completed_at", desc=True)
            .order("created_at", desc=True)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


async def review_training_completion(
    completion_id: str,
    coordinator_id: str,
    organization_id: str,
    *,
    approved: bool,
    rejection_reason: str | None = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    status = "confirmed" if approved else "rejected"
    try:
        resp = (
            get_supabase_admin()
            .table("worker_training_completions")
            .select("*")
            .eq("id", completion_id)
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Training service unavailable.") from exc
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Completion not found.")

    get_supabase_admin().table("worker_training_completions").update({
        "status": status,
        "reviewed_by": coordinator_id,
        "reviewed_at": now,
        "rejection_reason": rejection_reason if not approved else None,
    }).eq("id", completion_id).execute()

    await notify_worker(
        user_id=str(row["worker_id"]),
        org_id=organization_id,
        event="training_request_update",
        title="Training completion reviewed",
        message="Your training completion was confirmed." if approved else (
            f"Your training completion was declined. {rejection_reason or ''}".strip()
        ),
        reference_key=f"training_completion_review:{completion_id}",
        severity="medium",
    )
    return {**row, "status": status, "reviewed_at": now}


def create_training_module(
    organization_id: str,
    created_by: str,
    title: str,
    description: str | None = None,
    linked_credential_type: str | None = None,
    requires_certification: bool = False,
    auto_assign_on_hire: bool = False,
    cover_color: str | None = None,
    cover_path: str | None = None,
) -> dict[str, Any]:
    if not title.strip():
        raise HTTPException(status_code=422, detail="Title is required.")
    record = {
        "id": str(uuid4()),
        "organization_id": organization_id,
        "title": title.strip(),
        "description": description,
        "linked_credential_type": linked_credential_type,
        "requires_certification": requires_certification,
        "auto_assign_on_hire": auto_assign_on_hire,
        "created_by": created_by,
        "is_active": True,
    }
    validate_cover(organization_id, {"cover_color": cover_color, "cover_path": cover_path})
    record.update({"cover_color": cover_color, "cover_path": cover_path})
    try:
        get_supabase_admin().table("training_modules").insert(record).execute()
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Training service unavailable.") from exc
        raise
    record["resources"] = []
    return with_cover_url(record)


def update_training_module(
    organization_id: str,
    module_id: str,
    updates: dict[str, Any],
) -> dict[str, Any]:
    validate_cover(organization_id, updates)
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update.")
    if "title" in updates:
        if not (updates["title"] or "").strip():
            raise HTTPException(status_code=422, detail="Title is required.")
        updates["title"] = updates["title"].strip()
    existing = (
        get_supabase_admin()
        .table("training_modules")
        .select("id")
        .eq("id", module_id)
        .eq("organization_id", organization_id)
        .maybe_single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Training module not found.")
    resp = (
        get_supabase_admin()
        .table("training_modules")
        .update(updates)
        .eq("id", module_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    return with_cover_url((resp.data or [{}])[0])


def assign_mandatory_modules_on_hire(
    worker_id: str,
    organization_id: str,
    invited_by: str | None,
) -> list[dict[str, Any]]:
    """Auto-assign every module the org has flagged auto_assign_on_hire, at the
    moment a new hire accepts their invite — so mandatory induction (e.g. NDIS
    Worker Orientation) doesn't depend on a coordinator remembering to assign
    it. Reuses recommend_training_module so this gets the same due-date and
    notification behaviour as an ad-hoc coordinator assignment."""
    try:
        result = (
            get_supabase_admin()
            .table("training_modules")
            .select("id, title")
            .eq("organization_id", organization_id)
            .eq("auto_assign_on_hire", True)
            .eq("is_active", True)
            .execute()
        )
        modules = result.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise

    assigned = []
    for module in modules:
        try:
            assigned.append(
                recommend_training_module(
                    worker_id=worker_id,
                    coordinator_id=invited_by or worker_id,
                    organization_id=organization_id,
                    training_module_id=module["id"],
                    title=module["title"],
                )
            )
        except Exception as exc:
            logger.warning("Mandatory module auto-assign failed for worker %s module %s: %s", worker_id, module.get("id"), exc)
    return assigned


TRAINING_DEADLINE_DAYS = 7


def recommend_training_module(
    worker_id: str,
    coordinator_id: str,
    organization_id: str,
    training_module_id: str,
    title: str,
    related_incident_id: Optional[str] = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    record = {
        "id": str(uuid4()),
        "worker_id": worker_id,
        "coordinator_id": coordinator_id,
        "organization_id": organization_id,
        "training_module_id": training_module_id,
        "title": title,
        "recommended_at": now.isoformat(),
        "due_at": (now + timedelta(days=TRAINING_DEADLINE_DAYS)).isoformat(),
    }
    if related_incident_id:
        record["related_incident_id"] = related_incident_id
    try:
        get_supabase_admin().table("worker_training_recommendations").insert(record).execute()
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Training service unavailable.") from exc
        raise

    import asyncio

    async def _notify():
        await notify_worker(
            user_id=worker_id,
            org_id=organization_id,
            event="training_recommended",
            title="New training assigned",
            message=(
                f'Your coordinator assigned you training: "{title}". '
                f"This is mandatory and must be completed within {TRAINING_DEADLINE_DAYS} days, "
                "or further rostering may be postponed until it's done."
            ),
            reference_key=f"training_recommendation:{record['id']}",
            severity="medium",
        )

    try:
        asyncio.get_event_loop().create_task(_notify())
    except Exception:
        pass
    return record


def dismiss_training_recommendation(recommendation_id: str, organization_id: str) -> None:
    get_supabase_admin().table("worker_training_recommendations").update({
        "dismissed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", recommendation_id).eq("organization_id", organization_id).execute()


def start_training_module(worker_id: str, organization_id: str, training_module_id: str) -> dict[str, Any]:
    """Log that a worker opened an assigned training module. Idempotent — only
    the first open is recorded, so the timestamp reflects genuine start time."""
    require_available_module(organization_id, training_module_id)
    now = datetime.now(timezone.utc).isoformat()
    try:
        resp = (
            get_supabase_admin()
            .table("worker_training_recommendations")
            .select("id, started_at")
            .eq("worker_id", worker_id)
            .eq("organization_id", organization_id)
            .eq("training_module_id", training_module_id)
            .is_("dismissed_at", "null")
            .order("recommended_at", desc=True)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
    except Exception as exc:
        if _is_missing_schema(exc):
            return {"started_at": None}
        raise
    if not row:
        return {"started_at": None}
    if row.get("started_at"):
        return {"started_at": row["started_at"]}
    get_supabase_admin().table("worker_training_recommendations").update({
        "started_at": now,
    }).eq("id", row["id"]).execute()
    return {"started_at": now}


def _overdue_module_ids(worker_id: str, organization_id: str) -> set[str]:
    """Module IDs assigned to this worker whose 7-day deadline has passed
    without a confirmed (or pending review) completion on file."""
    now = datetime.now(timezone.utc).isoformat()
    try:
        recs = (
            get_supabase_admin()
            .table("worker_training_recommendations")
            .select("training_module_id, due_at")
            .eq("worker_id", worker_id)
            .eq("organization_id", organization_id)
            .is_("dismissed_at", "null")
            .lt("due_at", now)
            .execute()
        )
        overdue_ids = {r["training_module_id"] for r in (recs.data or []) if r.get("training_module_id")}
    except Exception as exc:
        if _is_missing_schema(exc):
            return set()
        raise
    if not overdue_ids:
        return set()

    try:
        completions = (
            get_supabase_admin()
            .table("worker_training_completions")
            .select("module_id, status")
            .eq("worker_id", worker_id)
            .eq("organization_id", organization_id)
            .in_("module_id", list(overdue_ids))
            .execute()
        )
        done_ids = {
            c["module_id"] for c in (completions.data or [])
            if c.get("status") in ("confirmed", "awaiting_confirmation")
        }
    except Exception as exc:
        if _is_missing_schema(exc):
            done_ids = set()
        else:
            raise
    return overdue_ids - done_ids - locked_module_ids(organization_id)


def is_training_overdue(worker_id: str, organization_id: str) -> bool:
    return bool(_overdue_module_ids(worker_id, organization_id))


def team_training_overdue_map(organization_id: str) -> dict[str, bool]:
    """Per-worker overdue flag for coordinator team views / roster gating."""
    now = datetime.now(timezone.utc).isoformat()
    try:
        recs = (
            get_supabase_admin()
            .table("worker_training_recommendations")
            .select("worker_id, training_module_id, due_at")
            .eq("organization_id", organization_id)
            .is_("dismissed_at", "null")
            .lt("due_at", now)
            .execute()
        )
        rows = recs.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return {}
        raise
    if not rows:
        return {}

    module_ids = {r["training_module_id"] for r in rows if r.get("training_module_id")}
    try:
        completions = (
            get_supabase_admin()
            .table("worker_training_completions")
            .select("worker_id, module_id, status")
            .eq("organization_id", organization_id)
            .in_("module_id", list(module_ids))
            .execute()
        )
        done_pairs = {
            (c["worker_id"], c["module_id"]) for c in (completions.data or [])
            if c.get("status") in ("confirmed", "awaiting_confirmation")
        }
    except Exception as exc:
        if _is_missing_schema(exc):
            done_pairs = set()
        else:
            raise

    locked_ids = locked_module_ids(organization_id)
    overdue: dict[str, bool] = {}
    for r in rows:
        if str(r.get("training_module_id")) in locked_ids:
            continue
        pair = (r["worker_id"], r.get("training_module_id"))
        if pair not in done_pairs:
            overdue[str(r["worker_id"])] = True
    return overdue


def list_worker_recommendations(worker_id: str, organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("worker_training_recommendations")
            .select("*")
            .eq("worker_id", worker_id)
            .eq("organization_id", organization_id)
            .is_("dismissed_at", "null")
            .order("recommended_at", desc=True)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def list_pending_completions(organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("worker_training_completions")
            .select("*, training_modules(title), users!worker_training_completions_worker_id_fkey(full_name)")
            .eq("organization_id", organization_id)
            .eq("status", "awaiting_confirmation")
            .order("completed_at", desc=True)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def team_training_summary(organization_id: str) -> dict[str, dict[str, int]]:
    """Per-worker counts: assigned (active recs), completed (confirmed), pending (awaiting review)."""
    summary: dict[str, dict[str, int]] = {}

    def bump(worker_id: str, key: str):
        entry = summary.setdefault(str(worker_id), {"assigned": 0, "completed": 0, "pending_review": 0})
        entry[key] += 1

    try:
        recs = (
            get_supabase_admin()
            .table("worker_training_recommendations")
            .select("worker_id")
            .eq("organization_id", organization_id)
            .is_("dismissed_at", "null")
            .execute()
        )
        for r in recs.data or []:
            bump(r["worker_id"], "assigned")
    except Exception as exc:
        if not _is_missing_schema(exc):
            raise

    try:
        completions = (
            get_supabase_admin()
            .table("worker_training_completions")
            .select("worker_id, status")
            .eq("organization_id", organization_id)
            .execute()
        )
        for c in completions.data or []:
            if c.get("status") == "confirmed":
                bump(c["worker_id"], "completed")
            elif c.get("status") == "awaiting_confirmation":
                bump(c["worker_id"], "pending_review")
    except Exception as exc:
        if not _is_missing_schema(exc):
            raise

    return summary


async def action_training_request(
    request_id: str,
    coordinator_id: str,
    organization_id: str,
    *,
    approved: bool,
    response: str | None = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    status = "approved" if approved else "declined"
    try:
        resp = (
            get_supabase_admin()
            .table("worker_training_requests")
            .select("*")
            .eq("id", request_id)
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Training service unavailable.") from exc
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Request not found.")

    get_supabase_admin().table("worker_training_requests").update({
        "status": status,
        "coordinator_response": response,
        "actioned_at": now,
        "actioned_by": coordinator_id,
    }).eq("id", request_id).execute()

    await notify_worker(
        user_id=str(row["worker_id"]),
        org_id=organization_id,
        event="training_request_update",
        title=f"Training request {status}",
        message=response or f"Your training request was {status}.",
        reference_key=f"training_request:{request_id}:{status}",
        severity="medium",
    )
    return {**row, "status": status, "actioned_at": now}
