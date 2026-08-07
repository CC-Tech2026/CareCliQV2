"""Medication management v1 — prescribed medications, the shift-level checklist (scheduled +
PRN), the append-only administration ledger, escalation, and the org-wide register used by the
Compliance Centre (Medication Management spec, build order steps 1-6). Outcome linkage (step 7)
is explicitly deferred post-v1 by the spec itself.
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
ADMINISTRATION_STATUSES = {"given", "refused", "missed", "withheld"}
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
) -> dict[str, Any]:
    if not name.strip():
        raise HTTPException(status_code=422, detail="Medication name is required.")
    if route not in ROUTES:
        raise HTTPException(status_code=422, detail=f"Invalid route. Must be one of: {', '.join(sorted(ROUTES))}.")
    if frequency_type not in FREQUENCY_TYPES:
        raise HTTPException(status_code=422, detail="frequency_type must be 'scheduled' or 'prn'.")
    if frequency_type == "prn" and not is_prn:
        is_prn = True

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
        # Submitted, not yet confirmed by a named reviewer against the source document —
        # it will not appear on any worker's shift checklist until verify_medication() runs.
        "status": "pending_verification",
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
    _record_status_change(medication["id"], organization_id, None, "pending_verification", created_by, "Created")
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

    existing = get_medication(medication_id, organization_id)  # 404s if not found / wrong org

    new_status = updates.get("status")
    if new_status == "active" and existing["status"] not in REACTIVATABLE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="This medication must go through verification before it can be made active.",
        )

    clean = {k: v for k, v in updates.items() if v is not None}
    if not clean:
        raise HTTPException(status_code=422, detail="No fields to update.")
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
    return result.data[0] if result.data else clean


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
                due_status = logged.get("status")
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
            })
    checklist.sort(key=lambda c: c["scheduled_time"])
    return checklist


def create_administration(
    *,
    medication: dict[str, Any],
    shift: dict[str, Any],
    organization_id: str,
    administered_by: str,
    status: str,
    scheduled_time: str | None,
    dose_given: str | None,
    notes: str | None,
    prn_reason: str | None = None,
    voice_captured: bool = False,
) -> dict[str, Any]:
    if status not in ADMINISTRATION_STATUSES:
        raise HTTPException(status_code=422, detail=f"Invalid status. Must be one of: {', '.join(sorted(ADMINISTRATION_STATUSES))}.")
    if medication.get("is_prn") and status == "given" and not (prn_reason or "").strip():
        raise HTTPException(status_code=422, detail="A reason is required to log a PRN dose.")

    payload = {
        "id": str(uuid4()),
        "medication_id": medication["id"],
        "shift_id": shift.get("id"),
        "participant_id": medication["participant_id"],
        "organization_id": organization_id,
        "administered_by": administered_by,
        "scheduled_time": scheduled_time,
        "status": status,
        "dose_given": dose_given,
        "notes": notes,
        "prn_reason": prn_reason,
        "voice_captured": voice_captured,
    }
    try:
        result = get_supabase_admin().table("medication_administrations").insert(payload).execute()
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Medication administration service unavailable.") from exc
        raise
    record = result.data[0] if result.data else payload

    if medication.get("is_prn") and status == "given" and medication.get("prn_max_per_day"):
        _maybe_escalate_prn_max(medication, shift, organization_id)

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
            .eq("status", "given")
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
        if admin.get("status") == "given" and admin.get("prn_reason"):
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
        and admin.get("status") == "given"
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


# ── Compliance Centre Medication Register (build order step 6) ──────────────────────────────


def list_org_medications(organization_id: str, participant_id: str | None = None) -> list[dict[str, Any]]:
    """All medications for the org (or one participant), with participant name attached."""
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
                .eq("status", "given")
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
