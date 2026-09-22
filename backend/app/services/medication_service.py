"""Medication management — prescribed medications, the approval/verification lifecycle, the
shift-level checklist (scheduled + PRN), the append-only administration ledger with structured
outcomes and time variance, and the org-wide register used by the Compliance Centre.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

ROUTES = {"oral", "topical", "injection", "inhaled", "sublingual", "rectal", "other"}
FREQUENCY_TYPES = {"scheduled", "prn"}
STATUSES = {"draft", "pending_verification", "active", "rejected", "ceased", "on_hold"}
# APINCH high-alert medicine categories (Medication Safety Standard). is_high_risk can be set
# manually by the verifier, or defaulted from a reference-list match — the manual flag always
# wins over any automatic suggestion.
HIGH_RISK_CATEGORIES = {
    "anti_infective", "potassium_electrolyte", "insulin",
    "narcotic_opioid", "chemotherapy", "anticoagulant", "other",
}

# The worker picks one of these five base actions when logging a dose. When the action is
# "given", the final outcome is classified automatically (given_on_time/given_late/
# given_early) from the logged timestamps against the org's tolerance — not self-typed by
# the worker under time pressure. The other actions map straight to their outcome.
# "administration_error" is deliberately a direct action, not a correction-only concept: a
# worker who catches their own mistake mid-administration logs it as one accurate row on the
# spot. A coordinator or later shift discovering someone else's error still goes through the
# corrects_administration_id path below — those are materially different events and the data
# needs to be able to tell them apart.
ADMINISTRATION_ACTIONS = {"given", "refused", "missed", "withheld", "administration_error"}
ADMINISTRATION_OUTCOMES = {
    "given_on_time", "given_late", "given_early", "refused", "missed", "withheld", "administration_error",
}
GIVEN_OUTCOMES = {"given_on_time", "given_late", "given_early"}
# Outcomes that always require reason_notes, regardless of which reason_code chip was picked.
NOTES_REQUIRED_OUTCOMES = {"refused", "missed", "withheld"}
DEFAULT_TOLERANCE_MINUTES = 30
ERROR_SUBTYPES = {"wrong_medication", "wrong_dose", "wrong_participant", "wrong_route", "other"}

REASON_CODES: dict[str, set[str]] = {
    "given_late": {"participant_asleep", "worker_delayed", "participant_off_site", "other"},
    "given_early": {"participant_requested", "schedule_conflict", "other"},
    "refused": {"verbal", "behavioural", "communication_device", "other"},
    "missed": {"participant_asleep", "worker_delayed", "participant_off_site", "other"},
    "withheld": {"clinical_direction", "other"},
}
# Only these statuses may move to "active" via a plain update_medication() PATCH (reactivating
# an already-verified, on-hold medication). From draft/pending_verification/rejected, "active"
# is only reachable through verify_medication() — that transition needs a named, timestamped
# approval, not a silent field edit.
REACTIVATABLE_STATUSES = {"on_hold"}

# How far before/after the scheduled time a dose counts as "due now" rather than
# "upcoming"/"overdue" — matches the escalation window described in the spec (default 30 min).
DUE_WINDOW_MINUTES = 30


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def list_medications(participant_id: str, organization_id: str, status: str | None = None) -> list[dict[str, Any]]:
    try:
        query = (
            get_supabase_admin()
            .table("medications")
            .select("*")
            .eq("participant_id", participant_id)
            .eq("organization_id", organization_id)
        )
        if status:
            query = query.eq("status", status)
        resp = query.order("status").order("name").execute()
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def get_medication(medication_id: str, organization_id: str) -> dict[str, Any]:
    resp = (
        get_supabase_admin()
        .table("medications")
        .select("*")
        .eq("id", medication_id)
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Medication not found.")
    return rows[0]


def _resolve_verification_document(photo_url: str, medication_id: str, organization_id: str) -> dict[str, Any] | None:
    """The photo-verification gate must confirm verification_photo_url actually corresponds to
    a real uploaded file for THIS medication, not just be a non-empty string — the two rows
    (medication_administrations, medication_documents) have never had a foreign key between
    them, only matching URL values. This is the resolve step; create_administration rejects the
    administration if it returns None."""
    try:
        resp = (
            get_supabase_admin()
            .table("medication_documents")
            .select("id")
            .eq("medication_id", medication_id)
            .eq("organization_id", organization_id)
            .eq("document_type", "verification_photo")
            .eq("file_url", photo_url)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema(exc):
            return None
        raise
    rows = resp.data or []
    return rows[0] if rows else None


def get_administration(administration_id: str, organization_id: str) -> dict[str, Any]:
    resp = (
        get_supabase_admin()
        .table("medication_administrations")
        .select("*")
        .eq("id", administration_id)
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Administration record not found.")
    return rows[0]


def create_medication(
    participant_id: str,
    organization_id: str,
    created_by: str,
    *,
    name: str,
    strength: str | None,
    route: str,
    dosage: str | None,
    frequency_type: str,
    scheduled_times: list[str] | None,
    prescriber_name: str | None,
    prescriber_contact: str | None,
    start_date: str | None,
    end_date: str | None,
    is_prn: bool,
    prn_max_per_day: int | None,
    source_document_id: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    if not name.strip():
        raise HTTPException(status_code=422, detail="Medication name is required.")
    if route not in ROUTES:
        raise HTTPException(status_code=422, detail=f"Invalid route. Must be one of: {', '.join(sorted(ROUTES))}.")
    if frequency_type not in FREQUENCY_TYPES:
        raise HTTPException(status_code=422, detail="frequency_type must be 'scheduled' or 'prn'.")
    if frequency_type == "prn" and not is_prn:
        is_prn = True
    initial_status = status or "pending_verification"
    if initial_status not in {"draft", "pending_verification"}:
        raise HTTPException(status_code=422, detail="New medications can only be saved as draft or submitted for verification.")

    payload = {
        "id": str(uuid4()),
        "participant_id": participant_id,
        "organization_id": organization_id,
        "name": name.strip(),
        "strength": strength,
        "route": route,
        "dosage": dosage,
        "frequency_type": frequency_type,
        "scheduled_times": scheduled_times or [],
        "prescriber_name": prescriber_name,
        "prescriber_contact": prescriber_contact,
        "end_date": end_date,
        "is_prn": is_prn,
        "prn_max_per_day": prn_max_per_day,
        # Drafts and pending records stay off worker shift checklists; only
        # verify_medication() can make a new medication active.
        "status": initial_status,
        "source_document_id": source_document_id,
        "created_by": created_by,
        "updated_by": created_by,
    }
    # start_date is NOT NULL DEFAULT CURRENT_DATE — omit the key entirely when not given so
    # the DB default applies, rather than sending an explicit null that violates the constraint.
    if start_date:
        payload["start_date"] = start_date
    try:
        result = get_supabase_admin().table("medications").insert(payload).execute()
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Medication service unavailable.") from exc
        raise
    medication = result.data[0] if result.data else payload
    _record_status_change(medication["id"], organization_id, None, initial_status, created_by, "Created")
    return medication


def _record_status_change(
    medication_id: str,
    organization_id: str,
    from_status: str | None,
    to_status: str,
    changed_by: str,
    reason: str | None = None,
) -> None:
    try:
        get_supabase_admin().table("medication_status_history").insert({
            "medication_id": medication_id,
            "organization_id": organization_id,
            "from_status": from_status,
            "to_status": to_status,
            "changed_by": changed_by,
            "reason": reason,
        }).execute()
    except Exception as exc:
        if not _is_missing_schema(exc):
            logger.warning("Could not record medication status history for %s: %s", medication_id, exc)


def _find_affected_shifts_today(participant_id: str, organization_id: str) -> list[dict[str, Any]]:
    """Shifts for this participant that are currently in progress, or still scheduled to
    start later today — the set of shifts a mid-shift medication status change needs to
    reach, per the Shift Content Synchronization spec."""
    from ..core.timezone import app_day_bounds_utc, app_today, participant_timezone

    supabase = get_supabase_admin()
    tz = participant_timezone(participant_id, organization_id=organization_id)
    _, day_end = app_day_bounds_utc(app_today(tz), tz)
    shifts: dict[str, dict[str, Any]] = {}
    try:
        upcoming = (
            supabase.table("shifts")
            .select("id, worker_id, status, scheduled_start")
            .eq("participant_id", participant_id)
            .eq("organization_id", organization_id)
            .gte("scheduled_start", datetime.now(timezone.utc).isoformat())
            .lt("scheduled_start", day_end)
            .neq("status", "completed")
            .execute()
        )
        for row in upcoming.data or []:
            shifts[row["id"]] = row
        in_progress = (
            supabase.table("shifts")
            .select("id, worker_id, status, scheduled_start")
            .eq("participant_id", participant_id)
            .eq("organization_id", organization_id)
            .eq("status", "in_progress")
            .execute()
        )
        for row in in_progress.data or []:
            shifts[row["id"]] = row
    except Exception as exc:
        if not _is_missing_schema(exc):
            logger.warning("Could not look up today's shifts for participant %s: %s", participant_id, exc)
    return list(shifts.values())


# Statuses that must never reach a worker — a transition INTO one of these while a shift is
# already rostered/in-progress needs an immediate push, not just "the next read excludes it."
_MID_SHIFT_ALERT_STATUSES = {"on_hold", "rejected", "ceased"}


def _propagate_mid_shift_status_change(
    medication_id: str,
    participant_id: str,
    organization_id: str,
    to_status: str,
    medication_name: str,
) -> None:
    if to_status not in _MID_SHIFT_ALERT_STATUSES or not participant_id:
        return
    shifts = _find_affected_shifts_today(participant_id, organization_id)
    if not shifts:
        return

    from .shift_content_resolution_service import log_shift_content_resolution

    for shift in shifts:
        log_shift_content_resolution(
            shift_id=str(shift.get("id") or ""),
            participant_id=participant_id,
            organization_id=organization_id,
            checkpoint="mid_shift_change",
            excluded_medications=[{"medication_id": medication_id, "status": to_status}],
        )

    import asyncio

    from .notification_service import notify_worker

    async def _notify_all() -> None:
        for shift in shifts:
            worker_id = shift.get("worker_id")
            if not worker_id:
                continue
            in_progress = shift.get("status") == "in_progress"
            try:
                await notify_worker(
                    user_id=worker_id,
                    org_id=organization_id,
                    event="medication_alert",
                    alert_type="medication_status_changed_mid_shift",
                    title=f"Medication update: {medication_name}",
                    message=(
                        f"{medication_name} is now {to_status.replace('_', ' ')}. "
                        + (
                            "It's being removed from your active checklist for this shift."
                            if in_progress
                            else "It will not appear on your upcoming shift's checklist."
                        )
                    ),
                    reference_key=f"medication:status_change:{medication_id}:{shift['id']}:{to_status}",
                    severity="high",
                    shift_id=str(shift.get("id") or ""),
                )
            except Exception:
                logger.warning("Mid-shift medication status push failed for worker %s", worker_id)

    try:
        asyncio.get_event_loop().create_task(_notify_all())
    except Exception:
        pass


def verify_medication(
    medication_id: str,
    organization_id: str,
    verified_by: str,
    *,
    corrections: dict[str, Any] | None = None,
    verification_notes: str | None = None,
) -> dict[str, Any]:
    """The named, timestamped confirmation step: a coordinator or managing director reviews
    the extracted fields against the source document, corrects anything wrong, and confirms —
    only this moves a medication onto the worker-facing shift checklist."""
    medication = get_medication(medication_id, organization_id)
    if medication["status"] != "pending_verification":
        raise HTTPException(
            status_code=409,
            detail=f"Only medications pending verification can be verified (current status: {medication['status']}).",
        )

    updates: dict[str, Any] = {}
    if corrections:
        if "route" in corrections and corrections["route"] not in ROUTES:
            raise HTTPException(status_code=422, detail=f"Invalid route. Must be one of: {', '.join(sorted(ROUTES))}.")
        if "high_risk_category" in corrections and corrections["high_risk_category"] not in HIGH_RISK_CATEGORIES:
            raise HTTPException(status_code=422, detail=f"Invalid high_risk_category. Must be one of: {', '.join(sorted(HIGH_RISK_CATEGORIES))}.")
        updates = {k: v for k, v in corrections.items() if v is not None}

    updates.update({
        "status": "active",
        "verified_by": verified_by,
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "verification_notes": verification_notes,
        "updated_by": verified_by,
    })
    result = (
        get_supabase_admin()
        .table("medications")
        .update(updates)
        .eq("id", medication_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    updated = result.data[0] if result.data else {**medication, **updates}
    _record_status_change(medication_id, organization_id, "pending_verification", "active", verified_by, verification_notes)
    return updated


def reject_medication(
    medication_id: str,
    organization_id: str,
    rejected_by: str,
    reason: str,
) -> dict[str, Any]:
    if not reason.strip():
        raise HTTPException(status_code=422, detail="A reason is required to reject a medication.")
    medication = get_medication(medication_id, organization_id)
    if medication["status"] != "pending_verification":
        raise HTTPException(
            status_code=409,
            detail=f"Only medications pending verification can be rejected (current status: {medication['status']}).",
        )
    result = (
        get_supabase_admin()
        .table("medications")
        .update({"status": "rejected", "rejection_reason": reason.strip(), "updated_by": rejected_by})
        .eq("id", medication_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    updated = result.data[0] if result.data else {**medication, "status": "rejected", "rejection_reason": reason.strip()}
    _record_status_change(medication_id, organization_id, "pending_verification", "rejected", rejected_by, reason.strip())
    return updated


def list_status_history(medication_id: str, organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("medication_status_history")
            .select("*, users!medication_status_history_changed_by_fkey(full_name)")
            .eq("medication_id", medication_id)
            .eq("organization_id", organization_id)
            .order("changed_at", desc=True)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def update_medication(
    medication_id: str,
    organization_id: str,
    updated_by: str,
    updates: dict[str, Any],
) -> dict[str, Any]:
    if "route" in updates and updates["route"] not in ROUTES:
        raise HTTPException(status_code=422, detail=f"Invalid route. Must be one of: {', '.join(sorted(ROUTES))}.")
    if "status" in updates and updates["status"] not in STATUSES:
        raise HTTPException(status_code=422, detail=f"Invalid status. Must be one of: {', '.join(sorted(STATUSES))}.")
    if "name" in updates and not str(updates["name"] or "").strip():
        raise HTTPException(status_code=422, detail="Medication name is required.")

    existing = get_medication(medication_id, organization_id)  # 404s if not found / wrong org

    new_status = updates.get("status")
    if new_status == "active" and existing["status"] not in REACTIVATABLE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="This medication must go through verification before it can be made active.",
        )

    required_fields = {"name", "route", "frequency_type", "scheduled_times", "is_prn", "status", "start_date"}
    clean = {k: v for k, v in updates.items() if not (v is None and k in required_fields)}
    if not clean:
        raise HTTPException(status_code=422, detail="No fields to update.")
    if "name" in clean:
        clean["name"] = str(clean["name"]).strip()
    clean["updated_by"] = updated_by

    result = (
        get_supabase_admin()
        .table("medications")
        .update(clean)
        .eq("id", medication_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    if new_status and new_status != existing["status"]:
        _record_status_change(medication_id, organization_id, existing["status"], new_status, updated_by)
        _propagate_mid_shift_status_change(
            medication_id, str(existing.get("participant_id") or ""), organization_id, new_status, existing.get("name") or "Medication",
        )
    return result.data[0] if result.data else clean


def get_medication_tolerance_minutes(organization_id: str) -> int:
    try:
        resp = (
            get_supabase_admin()
            .table("organizations")
            .select("medication_tolerance_minutes")
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema(exc):
            return DEFAULT_TOLERANCE_MINUTES
        raise
    if resp.data and resp.data[0].get("medication_tolerance_minutes") is not None:
        return int(resp.data[0]["medication_tolerance_minutes"])
    return DEFAULT_TOLERANCE_MINUTES


def set_medication_tolerance_minutes(organization_id: str, minutes: int) -> int:
    if minutes < 0 or minutes > 240:
        raise HTTPException(status_code=422, detail="Tolerance must be between 0 and 240 minutes.")
    get_supabase_admin().table("organizations").update({"medication_tolerance_minutes": minutes}).eq("organization_id", organization_id).execute()
    return minutes


def classify_given_outcome(scheduled_time: datetime | None, administered_time: datetime, tolerance_minutes: int) -> str:
    """given_on_time/given_late/given_early — the calculation the system owns, not the worker."""
    if scheduled_time is None:
        return "given_on_time"
    variance = (administered_time - scheduled_time).total_seconds() / 60
    if abs(variance) <= tolerance_minutes:
        return "given_on_time"
    return "given_late" if variance > 0 else "given_early"


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _parse_hhmm(value: str) -> tuple[int, int] | None:
    try:
        hh, mm = value.strip().split(":")
        return int(hh), int(mm)
    except (ValueError, AttributeError):
        return None


def list_administrations_for_shift(shift_id: str, organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("medication_administrations")
            .select("*")
            .eq("shift_id", shift_id)
            .eq("organization_id", organization_id)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def build_shift_medication_checklist(shift: dict[str, Any], organization_id: str) -> list[dict[str, Any]]:
    """Scheduled doses due within a shift's time window, cross-referenced against what's
    already been logged this shift. PRN medications are not included here — that's a
    separate always-available section on the mobile checklist (build order step 4)."""
    participant_id = str(shift.get("participant_id") or "")
    shift_start = _parse_dt(shift.get("scheduled_start"))
    if not participant_id or not shift_start:
        return []
    shift_end = _parse_dt(shift.get("scheduled_end")) or (shift_start + timedelta(hours=8))
    now = datetime.now(timezone.utc)

    medications = [
        m for m in list_medications(participant_id, organization_id, status="active")
        if m.get("frequency_type") == "scheduled"
    ]

    logged_by_key: dict[str, dict[str, Any]] = {}
    for admin in list_administrations_for_shift(str(shift.get("id") or ""), organization_id):
        key = f"{admin.get('medication_id')}|{admin.get('scheduled_time')}"
        logged_by_key[key] = admin

    window = timedelta(minutes=DUE_WINDOW_MINUTES)
    checklist: list[dict[str, Any]] = []
    for med in medications:
        for time_str in med.get("scheduled_times") or []:
            parsed = _parse_hhmm(time_str)
            if not parsed:
                continue
            hh, mm = parsed
            scheduled_dt = shift_start.replace(hour=hh, minute=mm, second=0, microsecond=0)
            if scheduled_dt < shift_start - timedelta(hours=1) or scheduled_dt > shift_end + timedelta(hours=1):
                continue  # outside this shift's window — belongs to a different shift
            scheduled_iso = scheduled_dt.isoformat()
            logged = logged_by_key.get(f"{med['id']}|{scheduled_iso}")
            if logged:
                due_status = logged.get("outcome")
            elif now < scheduled_dt - window:
                due_status = "upcoming"
            elif now > scheduled_dt + window:
                due_status = "overdue"
            else:
                due_status = "due_now"
            checklist.append({
                "medication_id": med["id"],
                "name": med["name"],
                "strength": med.get("strength"),
                "dosage": med.get("dosage"),
                "route": med.get("route"),
                "scheduled_time": scheduled_iso,
                "due_status": due_status,
                "administration": logged,
                "is_high_risk": bool(med.get("is_high_risk")),
                "high_risk_category": med.get("high_risk_category"),
            })
    checklist.sort(key=lambda c: c["scheduled_time"])
    return checklist


def create_administration(
    *,
    medication: dict[str, Any],
    shift: dict[str, Any],
    organization_id: str,
    administered_by: str,
    action: str,
    scheduled_time: str | None,
    administered_time: str | None = None,
    dose_given: str | None,
    notes: str | None,
    reason_code: str | None = None,
    directed_by: str | None = None,
    prn_reason: str | None = None,
    voice_captured: bool = False,
    error_subtype: str | None = None,
    corrects_administration_id: str | None = None,
    error_discovered_at: str | None = None,
    error_discovered_by: str | None = None,
    verification_photo_url: str | None = None,
) -> dict[str, Any]:
    if action not in ADMINISTRATION_ACTIONS:
        raise HTTPException(status_code=422, detail=f"Invalid action. Must be one of: {', '.join(sorted(ADMINISTRATION_ACTIONS))}.")
    # Defensive final check: the checklist/PRN screens already only ever show active
    # medications (queried live), but a worker could still be looking at a stale render
    # (cache, delayed sync, offline period) when they tap "log dose" — this is what actually
    # stops the write, not the read-side filtering alone.
    if medication.get("status") != "active":
        from .shift_content_resolution_service import log_shift_content_resolution
        log_shift_content_resolution(
            shift_id=str(shift.get("id") or ""),
            participant_id=medication.get("participant_id"),
            organization_id=organization_id,
            checkpoint="action_time",
            excluded_medications=[{"medication_id": medication.get("id"), "status": medication.get("status")}],
            resolved_for_user_id=administered_by,
        )
        raise HTTPException(
            status_code=409,
            detail=(
                f"This medication is currently {medication.get('status')}, not active. "
                "It cannot be administered until a coordinator reactivates it."
            ),
        )
    if medication.get("is_prn") and action == "given" and not (prn_reason or "").strip():
        raise HTTPException(status_code=422, detail="A reason is required to log a PRN dose.")

    scheduled_dt = _parse_dt(scheduled_time)
    administered_dt = _parse_dt(administered_time) or datetime.now(timezone.utc)

    if action == "given":
        tolerance = get_medication_tolerance_minutes(organization_id)
        outcome = classify_given_outcome(scheduled_dt, administered_dt, tolerance)
    else:
        outcome = action

    if outcome in NOTES_REQUIRED_OUTCOMES and not (notes or "").strip():
        raise HTTPException(status_code=422, detail=f"A note is required to log this dose as {outcome}.")
    if outcome == "administration_error":
        if error_subtype not in ERROR_SUBTYPES:
            raise HTTPException(status_code=422, detail=f"error_subtype is required and must be one of: {', '.join(sorted(ERROR_SUBTYPES))}.")
        if error_subtype == "other" and not (notes or "").strip():
            raise HTTPException(status_code=422, detail="A note is required when error_subtype is 'other'.")
    verification_document: dict[str, Any] | None = None
    if medication.get("is_high_risk") and outcome in GIVEN_OUTCOMES:
        photo_url = (verification_photo_url or "").strip()
        if not photo_url:
            raise HTTPException(
                status_code=422,
                detail="A verification photo is required to log a dose for a high-risk medication.",
            )
        verification_document = _resolve_verification_document(photo_url, medication["id"], organization_id)
        if not verification_document:
            raise HTTPException(
                status_code=422,
                detail=(
                    "The verification photo could not be matched to an uploaded file for this "
                    "medication. Upload the photo again and use the returned URL."
                ),
            )
    if reason_code:
        allowed_codes = REASON_CODES.get(outcome, set())
        if reason_code not in allowed_codes:
            raise HTTPException(status_code=422, detail=f"Invalid reason for {outcome}. Must be one of: {', '.join(sorted(allowed_codes))}.")
        if reason_code == "other" and not (notes or "").strip():
            raise HTTPException(status_code=422, detail="A note is required when the reason is 'other'.")
    if outcome == "withheld" and directed_by and reason_code != "clinical_direction":
        reason_code = "clinical_direction"

    payload = {
        "id": str(uuid4()),
        "medication_id": medication["id"],
        "shift_id": shift.get("id"),
        "participant_id": medication["participant_id"],
        "organization_id": organization_id,
        "administered_by": administered_by,
        "scheduled_time": scheduled_time,
        "administered_time": administered_dt.isoformat(),
        "outcome": outcome,
        "reason_code": reason_code,
        "directed_by": directed_by,
        "dose_given": dose_given,
        "notes": notes,
        "prn_reason": prn_reason,
        "voice_captured": voice_captured,
        "error_subtype": error_subtype if outcome == "administration_error" else None,
        "corrects_administration_id": corrects_administration_id,
        "error_discovered_at": error_discovered_at if corrects_administration_id else None,
        "error_discovered_by": error_discovered_by if corrects_administration_id else None,
        "verification_photo_url": verification_photo_url,
        "verification_photo_taken_at": datetime.now(timezone.utc).isoformat() if verification_photo_url else None,
        "verification_document_id": verification_document["id"] if verification_document else None,
    }
    try:
        result = get_supabase_admin().table("medication_administrations").insert(payload).execute()
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Medication administration service unavailable.") from exc
        raise
    record = result.data[0] if result.data else payload

    if outcome == "administration_error":
        # Fire-and-forget, same pattern as _maybe_escalate_prn_max below — the incident
        # creation must never block or fail the administration write itself.
        import asyncio

        from .medication_incident_service import create_incident_from_medication_error

        async def _create_incident():
            try:
                await create_incident_from_medication_error(record, medication)
            except Exception as exc:
                logger.warning("Medication error incident creation failed for administration %s: %s", record.get("id"), exc)

        try:
            asyncio.get_event_loop().create_task(_create_incident())
        except Exception:
            pass

    if medication.get("is_prn") and outcome in GIVEN_OUTCOMES and medication.get("prn_max_per_day"):
        _maybe_escalate_prn_max(medication, shift, organization_id)

    from .shift_content_resolution_service import log_shift_content_resolution
    log_shift_content_resolution(
        shift_id=str(shift.get("id") or ""),
        participant_id=medication.get("participant_id"),
        organization_id=organization_id,
        checkpoint="action_time",
        resolved_medication_ids=[medication.get("id")],
        resolved_for_user_id=administered_by,
    )

    return record


def _maybe_escalate_prn_max(medication: dict[str, Any], shift: dict[str, Any], organization_id: str) -> None:
    """Fire-and-forget coordinator alert if this dose pushed a PRN medication over its daily max."""
    max_per_day = medication.get("prn_max_per_day")
    day_start, day_end = _today_bounds_for_shift(shift)
    try:
        resp = (
            get_supabase_admin()
            .table("medication_administrations")
            .select("id", count="exact")
            .eq("medication_id", medication["id"])
            .in_("outcome", list(GIVEN_OUTCOMES))
            .not_.is_("prn_reason", "null")
            .gte("administered_time", day_start.isoformat())
            .lt("administered_time", day_end.isoformat())
            .execute()
        )
        today_count = resp.count or 0
    except Exception as exc:
        if _is_missing_schema(exc):
            return
        logger.warning("PRN max-per-day check failed for medication %s: %s", medication.get("id"), exc)
        return

    if today_count < max_per_day:
        return

    import asyncio

    from .notification_service import _org_coordinator_user_ids, notify_worker

    async def _notify():
        ref = f"medication:prn_max:{medication['id']}:{day_start.date().isoformat()}"
        for coord_id in _org_coordinator_user_ids(organization_id):
            try:
                await notify_worker(
                    user_id=coord_id,
                    org_id=organization_id,
                    event="medication_alert",
                    alert_type="medication_prn_max_exceeded",
                    title=f"PRN limit reached: {medication.get('name')}",
                    message=f"{medication.get('name')} has now been given {today_count} time(s) today (max {max_per_day}/day).",
                    reference_key=f"{ref}:{coord_id}",
                    severity="high",
                    shift_id=shift.get("id"),
                )
            except Exception:
                logger.warning("PRN max alert failed for coordinator %s", coord_id)

    try:
        asyncio.get_event_loop().create_task(_notify())
    except Exception:
        pass


def _today_bounds_for_shift(shift: dict[str, Any]) -> tuple[datetime, datetime]:
    anchor = _parse_dt(shift.get("scheduled_start")) or datetime.now(timezone.utc)
    start = anchor.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


def build_shift_prn_medications(shift: dict[str, Any], organization_id: str) -> dict[str, Any]:
    """Active PRN medications for this shift's participant, each with today's dose count
    (against prn_max_per_day) and any doses given this shift still awaiting an effect note."""
    participant_id = str(shift.get("participant_id") or "")
    if not participant_id:
        return {"medications": [], "pending_effects": []}

    prn_meds = [
        m for m in list_medications(participant_id, organization_id, status="active")
        if m.get("frequency_type") == "prn" or m.get("is_prn")
    ]
    if not prn_meds:
        return {"medications": [], "pending_effects": []}

    day_start, day_end = _today_bounds_for_shift(shift)
    try:
        resp = (
            get_supabase_admin()
            .table("medication_administrations")
            .select("*")
            .eq("participant_id", participant_id)
            .eq("organization_id", organization_id)
            .gte("administered_time", day_start.isoformat())
            .lt("administered_time", day_end.isoformat())
            .execute()
        )
        todays_admins = resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            todays_admins = []
        else:
            raise

    counts_by_med: dict[str, int] = {}
    for admin in todays_admins:
        if admin.get("outcome") in GIVEN_OUTCOMES and admin.get("prn_reason"):
            counts_by_med[admin["medication_id"]] = counts_by_med.get(admin["medication_id"], 0) + 1

    medications = []
    for med in prn_meds:
        today_count = counts_by_med.get(med["id"], 0)
        max_per_day = med.get("prn_max_per_day")
        medications.append({
            **med,
            "doses_given_today": today_count,
            "at_or_over_max": max_per_day is not None and today_count >= max_per_day,
        })

    shift_id = str(shift.get("id") or "")
    pending_effects = [
        admin for admin in todays_admins
        if admin.get("shift_id") == shift_id
        and admin.get("outcome") in GIVEN_OUTCOMES
        and admin.get("prn_reason")
        and not admin.get("prn_effect_observed")
    ]

    return {"medications": medications, "pending_effects": pending_effects}


def record_prn_effect(
    administration_id: str,
    organization_id: str,
    effect_observed: str,
    voice_captured: bool = False,
) -> dict[str, Any]:
    if not effect_observed.strip():
        raise HTTPException(status_code=422, detail="Effect observed is required.")
    resp = (
        get_supabase_admin()
        .table("medication_administrations")
        .select("id, prn_reason")
        .eq("id", administration_id)
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Administration record not found.")
    if not rows[0].get("prn_reason"):
        raise HTTPException(status_code=422, detail="Effect observed only applies to PRN administrations.")

    result = (
        get_supabase_admin()
        .table("medication_administrations")
        .update({"prn_effect_observed": effect_observed.strip(), "voice_captured": voice_captured})
        .eq("id", administration_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    return result.data[0] if result.data else {"id": administration_id, "prn_effect_observed": effect_observed}


def attach_administration_reason(
    administration_id: str,
    organization_id: str,
    reason_code: str | None,
    notes: str | None,
) -> dict[str, Any]:
    """A worker taps "confirm given" not knowing in advance whether it'll classify as
    given_on_time or given_late/given_early — that depends on the org's tolerance, computed
    after the fact. When it comes back late/early, this attaches the reason as a follow-up,
    the one other narrow exception (alongside prn_effect_observed) to the immutable ledger."""
    resp = (
        get_supabase_admin()
        .table("medication_administrations")
        .select("id, outcome")
        .eq("id", administration_id)
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Administration record not found.")
    outcome = rows[0]["outcome"]
    if outcome not in {"given_late", "given_early"}:
        raise HTTPException(status_code=422, detail="A reason can only be attached to a given_late or given_early dose.")
    if reason_code and reason_code not in REASON_CODES.get(outcome, set()):
        raise HTTPException(status_code=422, detail=f"Invalid reason for {outcome}.")
    if (not notes or not notes.strip()) and (not reason_code or reason_code == "other"):
        raise HTTPException(status_code=422, detail="A note is required.")

    result = (
        get_supabase_admin()
        .table("medication_administrations")
        .update({"reason_code": reason_code, "notes": notes})
        .eq("id", administration_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    return result.data[0] if result.data else {"id": administration_id, "reason_code": reason_code, "notes": notes}


# ── Compliance Centre Medication Register (build order step 6) ──────────────────────────────


def list_org_medications(organization_id: str, participant_id: str | None = None) -> list[dict[str, Any]]:
    """All medications for the org (or one participant), with participant name attached."""
    from ..core.timezone import participant_timezone

    try:
        query = (
            get_supabase_admin()
            .table("medications")
            .select("*, patients(full_name)")
            .eq("organization_id", organization_id)
        )
        if participant_id:
            query = query.eq("participant_id", participant_id)
        resp = query.order("status").order("name").execute()
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise

    rows = resp.data or []
    for row in rows:
        patient = row.pop("patients", None) or {}
        row["participant_name"] = patient.get("full_name")
        # Participant's branch zone; clients show this medication's own
        # times in it, labelled when it differs from the viewer's own branch.
        row["timezone"] = str(participant_timezone(row, organization_id=organization_id))
    return rows


def list_administrations_for_medication(medication_id: str, organization_id: str) -> list[dict[str, Any]]:
    """Full, read-only administration history for one medication — the ledger is append-only,
    so this is simply every row in chronological order, newest first."""
    try:
        resp = (
            get_supabase_admin()
            .table("medication_administrations")
            .select("*, users!medication_administrations_administered_by_fkey(full_name)")
            .eq("medication_id", medication_id)
            .eq("organization_id", organization_id)
            .order("administered_time", desc=True)
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise

    rows = resp.data or []
    for row in rows:
        worker = row.pop("users", None) or {}
        row["administered_by_name"] = worker.get("full_name")
    return rows


def list_medication_review_items(organization_id: str) -> dict[str, Any]:
    """Org-wide items needing coordinator attention: PRN meds at/over today's max, and
    medications nearing or past their end_date but still marked active."""
    today = datetime.now(timezone.utc).date()
    horizon = today + timedelta(days=3)

    active_meds = list_org_medications(organization_id)
    active_meds = [m for m in active_meds if m.get("status") == "active"]

    ending_soon = [
        m for m in active_meds
        if m.get("end_date") and str(m["end_date"]) <= horizon.isoformat()
    ]

    prn_meds = [m for m in active_meds if m.get("frequency_type") == "prn" or m.get("is_prn")]
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)

    at_max: list[dict[str, Any]] = []
    for med in prn_meds:
        max_per_day = med.get("prn_max_per_day")
        if not max_per_day:
            continue
        try:
            resp = (
                get_supabase_admin()
                .table("medication_administrations")
                .select("id", count="exact")
                .eq("medication_id", med["id"])
                .in_("outcome", list(GIVEN_OUTCOMES))
                .not_.is_("prn_reason", "null")
                .gte("administered_time", day_start.isoformat())
                .lt("administered_time", day_end.isoformat())
                .execute()
            )
            today_count = resp.count or 0
        except Exception as exc:
            if _is_missing_schema(exc):
                continue
            raise
        if today_count >= max_per_day:
            at_max.append({**med, "doses_given_today": today_count})

    return {"ending_soon": ending_soon, "prn_at_max": at_max}
