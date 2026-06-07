from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..core.access import get_user_id, get_user_organization_id, is_coordinator_role, get_coordinator_team_ids
from ..core.security import get_current_user
from ..services import participant_service, session_service
from ..services.supabase_client import get_supabase_admin


router = APIRouter(prefix="/coordinator", tags=["coordinator"])


def _require_coordinator(user: dict) -> str:
    if not is_coordinator_role(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Support coordinator access required.")
    org_id = get_user_organization_id(user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required.")
    return org_id


def _date_part(value: Any) -> str:
    return str(value or "")[:10]


def _score_status(score: Any) -> str:
    if score is None:
        return "draft"
    value = float(score)
    if value >= 85:
        return "compliant"
    if value >= 60:
        return "at_risk"
    return "non_compliant"


def _safe_json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return {}
    return value if value is not None else {}


def _session_payload(session: dict) -> dict:
    participant = session.get("participants") or {}
    return {
        "id": session.get("id"),
        "participant_id": session.get("participant_id") or session.get("patient_id"),
        "participant_name": participant.get("full_name") or session.get("participant_name"),
        "worker_id": session.get("worker_id") or session.get("support_worker_id") or session.get("owner_user_id"),
        "practitioner_id": session.get("practitioner_id") or session.get("allied_health_id"),
        "session_date": session.get("session_date"),
        "session_type": session.get("session_type"),
        "duration_minutes": session.get("duration_minutes"),
        "status": session.get("status"),
        "compliance_score": session.get("compliance_score"),
        "compliance_status": _score_status(session.get("compliance_score")),
        "translation_status": session.get("translation_status"),
    }


def _has_rp_flag(session: dict) -> bool:
    if session.get("restrictive_practice_detected") is True:
        return True
    flags = _safe_json(session.get("compliance_flags"))
    insights = _safe_json(session.get("ai_insights"))
    if isinstance(flags, dict) and flags.get("rp_flags"):
        return True
    if isinstance(insights, dict):
        if insights.get("rp_flags"):
            return True
        rules = insights.get("rules_result") or {}
        return isinstance(rules, dict) and bool(rules.get("rp_flags"))
    return False


def _rp_payload(session: dict) -> list[dict]:
    flags = _safe_json(session.get("compliance_flags"))
    insights = _safe_json(session.get("ai_insights"))
    candidates = []
    if isinstance(flags, dict):
        candidates.extend(flags.get("rp_flags") or [])
    if isinstance(insights, dict):
        candidates.extend(insights.get("rp_flags") or [])
        rules = insights.get("rules_result") or {}
        if isinstance(rules, dict):
            candidates.extend(rules.get("rp_flags") or [])
    if not candidates and session.get("restrictive_practice_detected"):
        candidates.append({"category": "restrictive_practice", "severity": "review"})
    return [
        {
            "session_id": session.get("id"),
            "participant_id": session.get("participant_id") or session.get("patient_id"),
            "participant_name": (session.get("participants") or {}).get("full_name"),
            "session_date": session.get("session_date"),
            "category": flag.get("category") if isinstance(flag, dict) else "restrictive_practice",
            "severity": flag.get("severity") if isinstance(flag, dict) else "review",
            "phrase": flag.get("phrase") if isinstance(flag, dict) else None,
            "suggestion": flag.get("suggestion") if isinstance(flag, dict) else None,
        }
        for flag in candidates
    ]


async def _team(org_id: str, coordinator_user: dict | None = None) -> list[dict]:
    supabase = get_supabase_admin()

    # Resolve coordinator-scoped member IDs before hitting organization_members.
    # get_coordinator_team_ids returns:
    #   - coordinator's linked workers (if any assigned via coordinator_id FK)
    #   - all org support_workers (global fallback when no one has coordinator_id set)
    #   - empty list (rollout started but this coordinator has no team yet)
    scoped_ids: set[str] | None = None
    if coordinator_user is not None:
        ids = get_coordinator_team_ids(coordinator_user, supabase)
        scoped_ids = set(ids)  # may be empty — that's intentional

    try:
        memberships = (
            supabase.table("organization_members")
            .select("user_id, role, is_active, joined_at")
            .eq("organization_id", org_id)
            .execute()
        )
    except Exception:
        return await _team_fallback(org_id, coordinator_user=coordinator_user)

    rows = [row for row in memberships.data or [] if isinstance(row, dict)]
    if not rows:
        return await _team_fallback(org_id, coordinator_user=coordinator_user)

    # Apply coordinator team scoping to the membership rows when IDs are known.
    if scoped_ids is not None:
        rows = [r for r in rows if str(r.get("user_id") or "") in scoped_ids]

    user_ids = [row.get("user_id") for row in rows if row.get("user_id")]
    profiles_by_id: dict[str, dict] = {}
    if user_ids:
        try:
            profiles = (
                supabase.table("users")
                .select("id, email, full_name, role, is_active, last_login, organization_id")
                .in_("id", user_ids)
                .eq("organization_id", org_id)
                .execute()
            )
            profiles_by_id = {
                str(row.get("id")): row
                for row in profiles.data or []
                if isinstance(row, dict) and row.get("id")
            }
        except Exception:
            profiles_by_id = {}

    output = []
    for row in rows:
        profile = profiles_by_id.get(str(row.get("user_id")), {})
        output.append({
            "id": row.get("user_id"),
            "full_name": profile.get("full_name") or profile.get("email") or "Team member",
            "email": profile.get("email"),
            "role": row.get("role") or profile.get("role"),
            "is_active": bool(row.get("is_active")),
            "joined_at": row.get("joined_at"),
            "last_login": profile.get("last_login"),
        })
    return output


async def _team_fallback(org_id: str, coordinator_user: dict | None = None) -> list[dict]:
    supabase = get_supabase_admin()

    # When coordinator context is available, resolve their scoped team IDs.
    # get_coordinator_team_ids distinguishes three states:
    #   non-empty list  → coordinator's linked workers (filter to these)
    #   empty list      → rollout started but this coordinator has no team yet
    #                     (must return [] — do NOT fall through to org-wide query)
    #   None sentinel   → no coordinator context, return org-wide (no scoping)
    if coordinator_user is not None:
        member_ids = get_coordinator_team_ids(coordinator_user, supabase)
        if not member_ids:
            # Empty means either: rollout started and this coordinator has no
            # linked workers, or the helper encountered an error. Either way,
            # returning org-wide results would leak cross-team data.
            return []
        id_filter: list[str] | None = member_ids
    else:
        id_filter = None

    try:
        query = (
            supabase.table("users")
            .select("id, email, full_name, role, is_active, last_login, organization_id")
            .eq("organization_id", org_id)
            .in_("role", ["support_worker", "allied_health", "support_coordinator"])
        )
        if id_filter is not None:
            query = query.in_("id", id_filter)
        profiles = query.execute()
    except Exception:
        return []

    output = []
    for row in profiles.data or []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        output.append({
            "id": row.get("id"),
            "full_name": row.get("full_name") or row.get("email") or "Team member",
            "email": row.get("email"),
            "role": row.get("role"),
            "is_active": bool(row.get("is_active")),
            "joined_at": None,
            "last_login": row.get("last_login"),
        })
    return output


@router.get("/team")
async def team(current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    return await _team(org_id, coordinator_user=current_user)


@router.get("/all-sessions")
async def all_sessions(limit: int = 500, current_user: dict = Depends(get_current_user)):
    _require_coordinator(current_user)
    sessions = await session_service.get_all_sessions(limit, current_user)
    return [_session_payload(session) for session in sessions]


@router.get("/compliance-overview")
async def compliance_overview(current_user: dict = Depends(get_current_user)):
    _require_coordinator(current_user)
    sessions = await session_service.get_compliance_report(current_user)
    scores = [float(s["compliance_score"]) for s in sessions if s.get("compliance_score") is not None]
    average = round(sum(scores) / len(scores), 1) if scores else 0
    return {
        "average_score": average,
        "total_sessions": len(sessions),
        "compliant": sum(1 for score in scores if score >= 85),
        "at_risk": sum(1 for score in scores if 60 <= score < 85),
        "non_compliant": sum(1 for score in scores if score < 60),
        "sessions": [_session_payload(session) for session in sessions],
    }


@router.get("/rp-flags")
async def rp_flags(current_user: dict = Depends(get_current_user)):
    _require_coordinator(current_user)
    sessions = await session_service.get_all_sessions(1000, current_user)
    flags: list[dict] = []
    for session in sessions:
        if _has_rp_flag(session):
            flags.extend(_rp_payload(session))
    return flags


@router.get("/credential-alerts")
async def credential_alerts(current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()

    today = date.today()
    warn_date = (today + timedelta(days=60)).isoformat()

    try:
        result = (
            supabase.table("credentials")
            .select("id, user_id, credential_type, title, expiry_date, status")
            .eq("organization_id", org_id)
            .in_("status", ["expiring", "expired"])
            .lte("expiry_date", warn_date)
            .execute()
        )
        rows = result.data or []
    except Exception:
        rows = []

    user_ids = list({r["user_id"] for r in rows if r.get("user_id")})
    users_by_id: dict[str, dict] = {}
    if user_ids:
        try:
            profiles = (
                supabase.table("users")
                .select("id, full_name, email, role")
                .in_("id", user_ids)
                .execute()
            )
            users_by_id = {
                str(p["id"]): p
                for p in (profiles.data or [])
                if p.get("id")
            }
        except Exception:
            pass

    alerts_out = []
    for row in rows:
        uid = str(row.get("user_id") or "")
        profile = users_by_id.get(uid, {})
        alerts_out.append({
            "credential_id": row.get("id"),
            "user_id": uid or None,
            "full_name": profile.get("full_name") or profile.get("email") or "Team member",
            "role": profile.get("role"),
            "credential_type": row.get("credential_type"),
            "title": row.get("title"),
            "expiry_date": row.get("expiry_date"),
            "status": row.get("status"),
        })

    # Count workers whose avg compliance < 60 — these need coaching / training.
    training_due_count = 0
    try:
        sessions_resp = supabase.table("sessions").select(
            "worker_id, support_worker_id, owner_user_id, compliance_score, organization_id"
        ).eq("organization_id", org_id).not_.is_("compliance_score", "null").execute()
        sessions_data = sessions_resp.data or []

        scores_by_worker: dict[str, list[float]] = {}
        for s in sessions_data:
            wid = str(
                s.get("worker_id") or s.get("support_worker_id") or s.get("owner_user_id") or ""
            )
            if not wid:
                continue
            try:
                scores_by_worker.setdefault(wid, []).append(float(s["compliance_score"]))
            except (ValueError, TypeError):
                pass

        training_due_count = sum(
            1 for scores in scores_by_worker.values()
            if scores and (sum(scores) / len(scores)) < 60
        )
    except Exception:
        training_due_count = 0

    return {
        "generated_at": today.isoformat(),
        "alerts": alerts_out,
        "training_due_count": training_due_count,
    }


# ── Worker Stats ──────────────────────────────────────────────────────────────

@router.get("/worker-stats")
async def worker_stats(current_user: dict = Depends(get_current_user)):
    """Per-worker aggregated stats: sessions, compliance, drafts, flagged."""
    org_id = _require_coordinator(current_user)
    members = await _team(org_id, coordinator_user=current_user)
    all_sessions = await session_service.get_all_sessions(2000, current_user)

    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).date().isoformat()

    stats: dict[str, dict] = {}
    for m in members:
        stats[str(m["id"])] = {
            **m,
            "total_sessions": 0,
            "sessions_this_week": 0,
            "avg_compliance": None,
            "draft_count": 0,
            "flagged_count": 0,
            "_scores": [],
        }

    for session in all_sessions:
        wid = str(
            session.get("worker_id")
            or session.get("support_worker_id")
            or session.get("owner_user_id")
            or ""
        )
        if wid not in stats:
            continue
        stats[wid]["total_sessions"] += 1
        session_date = str(session.get("session_date") or "")[:10]
        if session_date >= week_ago:
            stats[wid]["sessions_this_week"] += 1
        if session.get("status") in ("draft", None) or not session.get("compliance_score"):
            stats[wid]["draft_count"] += 1
        if session.get("review_flag"):
            stats[wid]["flagged_count"] += 1
        if session.get("compliance_score") is not None:
            try:
                stats[wid]["_scores"].append(float(session["compliance_score"]))
            except (ValueError, TypeError):
                pass

    result = []
    for data in stats.values():
        scores = data.pop("_scores")
        data["avg_compliance"] = round(sum(scores) / len(scores), 1) if scores else None
        result.append(data)

    return result


# ── Flag Session for Review ───────────────────────────────────────────────────

class FlagReviewBody(BaseModel):
    flagged: bool = True
    review_note: Optional[str] = None


@router.patch("/sessions/{session_id}/flag-review")
async def flag_session_for_review(
    session_id: str,
    body: FlagReviewBody,
    current_user: dict = Depends(get_current_user),
):
    """Flag (or unflag) a session for worker correction."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    coordinator_id = str(get_user_id(current_user) or "")

    update_data: dict[str, Any] = {
        "review_flag": body.flagged,
        "review_note": body.review_note if body.flagged else None,
        "review_requested_by": coordinator_id if body.flagged else None,
        "review_requested_at": datetime.now(timezone.utc).isoformat() if body.flagged else None,
    }

    def _do_update() -> None:
        supabase.table("sessions").update(update_data).eq("id", session_id).execute()

    try:
        _do_update()
    except Exception as e:
        err = str(e)
        if "42703" in err or "updated_at" in err:
            try:
                existing = supabase.table("sessions").select("*").eq("id", session_id).execute()
                rows = existing.data or []
                if not rows:
                    raise HTTPException(status_code=404, detail="Session not found.")
                merged = {**rows[0], **update_data}
                supabase.table("sessions").delete().eq("id", session_id).execute()
                supabase.table("sessions").insert(merged).execute()
            except HTTPException:
                raise
            except Exception as e2:
                raise HTTPException(status_code=500, detail=f"Flag update failed: {e2}")
        else:
            raise HTTPException(status_code=500, detail=f"Flag update failed: {e}")

    return {"session_id": session_id, "flagged": body.flagged}


@router.post("/sessions/{session_id}/approve")
async def approve_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Approve a flagged session — clears review_flag; org-scoped to coordinator's organisation."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    coordinator_id = str(get_user_id(current_user) or "")
    approved_at = datetime.now(timezone.utc).isoformat()

    # ── 1. Fetch and verify org ownership before mutating ────────────────────
    try:
        existing_resp = (
            supabase.table("sessions")
            .select("id, participant_id, patient_id, session_date, session_type, status, "
                    "compliance_score, worker_id, support_worker_id, owner_user_id, organization_id, "
                    "review_flag, review_note, review_requested_by, review_requested_at")
            .eq("id", session_id)
            .execute()
        )
        existing_rows = existing_resp.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Session lookup failed: {e}")

    if not existing_rows:
        raise HTTPException(status_code=404, detail="Session not found.")

    session_row = existing_rows[0]
    session_org = str(session_row.get("organization_id") or "")
    if session_org != org_id:
        raise HTTPException(status_code=403, detail="Session does not belong to your organisation.")

    # ── 2. Build update payload; try with extended fields first ──────────────
    base_update: dict[str, Any] = {
        "review_flag": False,
        "review_requested_by": None,
        "review_requested_at": None,
        "review_note": f"Approved by {coordinator_id} at {approved_at}",
    }
    extended_update: dict[str, Any] = {
        **base_update,
        "approved_by": coordinator_id,
        "approved_at": approved_at,
    }

    def _do_update(payload: dict[str, Any]) -> None:
        supabase.table("sessions").update(payload).eq("id", session_id).execute()

    # ── 3. Apply update — no delete/insert fallback to avoid FK cascade risk ─
    try:
        _do_update(extended_update)
        persisted = {**session_row, **extended_update}
    except Exception as e:
        err = str(e)
        # Column missing (approved_by / approved_at not yet in schema) — retry base only
        if "42703" in err or "column" in err.lower():
            try:
                _do_update(base_update)
                persisted = {**session_row, **base_update}
            except Exception as e2:
                err2 = str(e2)
                if "42703" in err2 or "updated_at" in err2:
                    # updated_at trigger bug: update is actually applied despite the error;
                    # treat as success rather than corrupting data with delete+insert.
                    persisted = {**session_row, **base_update}
                else:
                    raise HTTPException(status_code=500, detail=f"Approve failed: {e2}")
        elif "42703" in err or "updated_at" in err:
            # updated_at trigger bug on extended update — treat as success
            persisted = {**session_row, **extended_update}
        else:
            raise HTTPException(status_code=500, detail=f"Approve failed: {e}")

    # ── 4. Return the updated session payload ────────────────────────────────
    return {
        **_session_payload(persisted),
        "review_flag": False,
        "review_note": persisted.get("review_note"),
        "approved_by": coordinator_id,
        "approved_at": approved_at,
    }


@router.get("/flagged-sessions")
async def flagged_sessions(current_user: dict = Depends(get_current_user)):
    """Return all sessions currently flagged for review in this organisation."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()

    try:
        result = supabase.table("sessions").select(
            "id, participant_id, patient_id, session_date, session_type, status, "
            "compliance_score, review_flag, review_note, review_requested_by, "
            "review_requested_at, worker_id, support_worker_id, owner_user_id, organization_id"
        ).eq("review_flag", "true").execute()
        rows = [
            s for s in (result.data or [])
            if str(s.get("organization_id") or "") == org_id
        ]
    except Exception:
        rows = []

    return [
        {
            **_session_payload(s),
            "review_flag": True,
            "review_note": s.get("review_note"),
            "review_requested_by": s.get("review_requested_by"),
            "review_requested_at": s.get("review_requested_at"),
        }
        for s in rows
    ]


# ── Worker Activation / Deactivation ─────────────────────────────────────────

@router.post("/workers/{worker_id}/deactivate")
async def deactivate_worker(worker_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        supabase.table("users").update({"is_active": False}).eq("id", worker_id).eq("organization_id", org_id).execute()
        supabase.table("organization_members").update({"is_active": False}).eq("user_id", worker_id).eq("organization_id", org_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Deactivation failed: {e}")
    return {"worker_id": worker_id, "is_active": False}


@router.post("/workers/{worker_id}/activate")
async def activate_worker(worker_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        supabase.table("users").update({"is_active": True}).eq("id", worker_id).eq("organization_id", org_id).execute()
        supabase.table("organization_members").update({"is_active": True}).eq("user_id", worker_id).eq("organization_id", org_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Activation failed: {e}")
    return {"worker_id": worker_id, "is_active": True}


# ── Worker ↔ Client Assignments ───────────────────────────────────────────────

class AssignClientBody(BaseModel):
    patient_id: str
    role: str = "support_worker"


@router.post("/workers/{worker_id}/assign-client")
async def assign_worker_to_client(
    worker_id: str,
    body: AssignClientBody,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        existing = supabase.table("practitioner_allocations").select("id").eq("user_id", worker_id).eq("patient_id", body.patient_id).execute()
        if not (existing.data or []):
            supabase.table("practitioner_allocations").insert({
                "user_id": worker_id,
                "patient_id": body.patient_id,
                "allocated_role": body.role,
                "organization_id": org_id,
            }).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Assignment failed: {e}")
    return {"worker_id": worker_id, "patient_id": body.patient_id, "role": body.role}


@router.delete("/workers/{worker_id}/assign-client/{patient_id}")
async def unassign_worker_from_client(
    worker_id: str,
    patient_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        supabase.table("practitioner_allocations").delete().eq("user_id", worker_id).eq("patient_id", patient_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unassignment failed: {e}")
    return {"worker_id": worker_id, "patient_id": patient_id, "unassigned": True}


# ── Worker Client Assignments List ────────────────────────────────────────────

class BulkRemindersBody(BaseModel):
    worker_ids: list[str]
    message: str = "Your credential is expiring soon. Please update it to remain compliant."


@router.post("/bulk-reminders")
async def bulk_reminders(
    body: BulkRemindersBody,
    current_user: dict = Depends(get_current_user),
):
    """Send an in-app training_reminder alert to each selected worker."""
    from ..services import alert_service
    from ..schemas.alert import AlertCreate

    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        members = supabase.table("organization_members").select("user_id").eq("organization_id", org_id).execute()
        valid_ids: set[str] = {str(r["user_id"]) for r in (members.data or []) if r.get("user_id")}
    except Exception as lookup_err:
        raise HTTPException(status_code=500, detail=f"Could not validate worker membership: {lookup_err}")

    count = 0
    errors: list[str] = []
    for worker_id in body.worker_ids:
        if worker_id not in valid_ids:
            errors.append(f"worker {worker_id} not in organisation")
            continue
        try:
            await alert_service.create_alert(
                AlertCreate(
                    alert_type="training_reminder",
                    severity="medium",
                    title="Credential reminder",
                    message=body.message,
                    recipient_user_id=worker_id,
                )
            )
            count += 1
        except Exception as exc:
            errors.append(str(exc))

    return {"alerts_created": count, "errors": errors}


@router.get("/workers/{worker_id}/clients")
async def get_worker_clients(worker_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        allocs = supabase.table("practitioner_allocations").select("patient_id, allocated_role").eq("user_id", worker_id).execute()
        patient_ids = [r["patient_id"] for r in (allocs.data or []) if r.get("patient_id")]
        if not patient_ids:
            return []
        patients = supabase.table("patients").select("id, full_name, ndis_number, plan_status").in_("id", patient_ids).eq("organization_id", org_id).execute()
        return patients.data or []
    except Exception:
        return []
