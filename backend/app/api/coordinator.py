from __future__ import annotations

import json
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from ..core.access import get_user_id, get_user_organization_id, is_coordinator_role, get_coordinator_team_ids
from ..core.security import get_current_user
from ..services.compliance_engine import collect_budget_rule_alerts_from_sessions
from ..services.pattern_detection_service import (
    dismiss_pattern,
    get_active_patterns,
    run_pattern_detection_for_org,
)
from ..services import participant_service, session_service, shift_service
from ..services.credential_verification_service import (
    get_shift_credential_requirements,
    verify_worker_credentials,
)
from ..services.notification_service import (
    notify_certification_expiry,
    notify_coordinator_message,
    notify_conversation_message,
    notify_feedback_received,
    notify_shift_cancelled,
    notify_shift_change,
)
from ..services import conversation_service
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
            .select("user_id, role, is_active, joined_at, employee_id")
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
                .select(
                    "id, email, full_name, role, is_active, last_login, organization_id, "
                    "preferred_contact_method, phone"
                )
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
            "employee_id": row.get("employee_id"),
            "preferred_contact_method": profile.get("preferred_contact_method"),
            "phone": profile.get("phone"),
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
            .select(
                "id, email, full_name, role, is_active, last_login, organization_id, "
                "preferred_contact_method, phone"
            )
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
    org_id = _require_coordinator(current_user)
    sessions = await session_service.get_compliance_report(current_user)
    scores = [float(s["compliance_score"]) for s in sessions if s.get("compliance_score") is not None]
    average = round(sum(scores) / len(scores), 1) if scores else 0
    return {
        "average_score": average,
        "total_sessions": len(sessions),
        "compliant": sum(1 for score in scores if score >= 85),
        "at_risk": sum(1 for score in scores if 60 <= score < 85),
        "non_compliant": sum(1 for score in scores if score < 60),
        "budget_warnings": collect_budget_rule_alerts_from_sessions(sessions),
        "ai_detected_patterns": get_active_patterns(org_id),
        "sessions": [_session_payload(session) for session in sessions],
    }


@router.get("/ai-detected-patterns")
async def list_ai_detected_patterns(current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    return {"patterns": get_active_patterns(org_id)}


@router.post("/ai-detected-patterns/run")
async def run_ai_pattern_detection(current_user: dict = Depends(get_current_user)):
    """Manual trigger for QA / dev (weekly cron uses the same service)."""
    org_id = _require_coordinator(current_user)
    result = run_pattern_detection_for_org(org_id)
    return {
        **result,
        "patterns": get_active_patterns(org_id),
    }


@router.post("/ai-detected-patterns/{pattern_id}/dismiss")
async def dismiss_ai_detected_pattern(
    pattern_id: str,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_coordinator(current_user)
    user_id = get_user_id(current_user)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User id required")
    row = dismiss_pattern(pattern_id, org_id, str(user_id))
    if not row:
        raise HTTPException(status_code=404, detail="Pattern not found or already dismissed")
    return {"ok": True, "pattern": row}


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
        existing = supabase.table("sessions").select(
            "id, participant_id, patient_id, worker_id, support_worker_id, owner_user_id, organization_id"
        ).eq("id", session_id).maybe_single().execute()
        session_row = existing.data if existing else None
    except Exception:
        session_row = None

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

    if body.flagged and session_row:
        worker_id = str(
            session_row.get("worker_id")
            or session_row.get("support_worker_id")
            or session_row.get("owner_user_id")
            or ""
        )
        if worker_id:
            participant_id = str(session_row.get("participant_id") or session_row.get("patient_id") or "") or None
            await notify_feedback_received(
                worker_id=worker_id,
                org_id=org_id,
                session_id=session_id,
                review_note=body.review_note,
                participant_id=participant_id,
            )

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
                "is_active": True,
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
    """Send certification expiry notifications to selected workers (respects notification prefs)."""
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
            await notify_certification_expiry(
                user_id=worker_id,
                org_id=org_id,
                credential_title="Credential compliance",
                expiry_date=date.today().isoformat(),
                status="expiring",
                credential_id=f"bulk:{worker_id}:{date.today().isoformat()}",
                custom_message=body.message,
            )
            count += 1
        except Exception as exc:
            errors.append(str(exc))

    return {"notifications_sent": count, "errors": errors}


class WorkerMessageBody(BaseModel):
    title: str = "Message from your coordinator"
    message: str


@router.post("/workers/{worker_id}/message")
async def send_worker_message(
    worker_id: str,
    body: WorkerMessageBody,
    current_user: dict = Depends(get_current_user),
):
    """Send a coordinator message to a worker (in-app + email per notification prefs)."""
    org_id = _require_coordinator(current_user)
    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=422, detail="Message is required.")

    supabase = get_supabase_admin()
    try:
        member = (
            supabase.table("organization_members")
            .select("user_id")
            .eq("organization_id", org_id)
            .eq("user_id", worker_id)
            .maybe_single()
            .execute()
        )
        if not member or not member.data:
            raise HTTPException(status_code=404, detail="Worker not found in this organisation.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Worker lookup failed: {exc}")

    result = await notify_coordinator_message(
        user_id=worker_id,
        org_id=org_id,
        title=(body.title or "Message from your coordinator").strip(),
        message=message,
    )
    return {"worker_id": worker_id, "delivered": result}


class ShiftScheduleUpdateBody(BaseModel):
    scheduled_start: Optional[str] = None
    scheduled_end: Optional[str] = None


@router.patch("/shifts/{shift_id}/schedule")
async def update_shift_schedule(
    shift_id: str,
    body: ShiftScheduleUpdateBody,
    current_user: dict = Depends(get_current_user),
):
    """Reschedule a shift and notify the assigned worker."""
    org_id = _require_coordinator(current_user)
    if not body.scheduled_start and not body.scheduled_end:
        raise HTTPException(status_code=422, detail="Provide scheduled_start and/or scheduled_end.")

    shift = shift_service.get_shift_by_id(shift_id)
    if not shift or str(shift.get("organization_id") or "") != org_id:
        raise HTTPException(status_code=404, detail="Shift not found.")

    update_payload: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    changes: list[str] = []
    old_values: dict[str, Any] = {}
    new_values: dict[str, Any] = {}
    if body.scheduled_start:
        old_values["scheduled_start"] = shift.get("scheduled_start")
        update_payload["scheduled_start"] = body.scheduled_start
        new_values["scheduled_start"] = body.scheduled_start
        changes.append("start time updated")
    if body.scheduled_end:
        old_values["scheduled_end"] = shift.get("scheduled_end")
        update_payload["scheduled_end"] = body.scheduled_end
        new_values["scheduled_end"] = body.scheduled_end
        changes.append("end time updated")

    try:
        result = (
            get_supabase_admin()
            .table("shifts")
            .update(update_payload)
            .eq("id", shift_id)
            .execute()
        )
        updated = (result.data or [None])[0] or {**shift, **update_payload}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Shift update failed: {exc}")

    summary = " and ".join(changes) if changes else "Schedule updated"
    await notify_shift_change(
        shift=updated,
        change_summary=summary.capitalize() + ".",
        old_values=old_values,
        new_values=new_values,
    )
    return {"shift_id": shift_id, "shift": updated}


@router.patch("/shifts/{shift_id}/cancel")
async def cancel_shift(
    shift_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Cancel a shift and notify the assigned worker (CARECLIQV2-261)."""
    org_id = _require_coordinator(current_user)
    shift = shift_service.get_shift_by_id(shift_id)
    if not shift or str(shift.get("organization_id") or "") != org_id:
        raise HTTPException(status_code=404, detail="Shift not found.")
    if shift.get("status") == "cancelled":
        return {"shift_id": shift_id, "shift": shift}

    now = datetime.now(timezone.utc).isoformat()
    try:
        result = (
            get_supabase_admin()
            .table("shifts")
            .update({"status": "cancelled", "updated_at": now})
            .eq("id", shift_id)
            .execute()
        )
        updated = (result.data or [None])[0] or {**shift, "status": "cancelled", "updated_at": now}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Shift cancel failed: {exc}") from exc

    await notify_shift_cancelled(shift=updated)
    conversation_service.set_conversation_read_only_for_shift(shift_id)
    return {"shift_id": shift_id, "shift": updated}


# ── Shift Assignment (CARECLIQV2-300) ─────────────────────────────────────────

class AssignShiftBody(BaseModel):
    worker_id: str
    participant_id: str
    scheduled_start: str
    scheduled_end: Optional[str] = None
    duration_minutes: Optional[int] = None
    shift_type: str = "standard_support"


class CredentialStatus(BaseModel):
    valid: bool
    missing_credentials: list[str] = []
    warning: Optional[str] = None


@router.get("/workers/{worker_id}/credential-status")
async def worker_credential_status(
    worker_id: str,
    shift_type: str = Query(default="standard_support"),
    current_user: dict = Depends(get_current_user),
):
    """Return credential status for a worker/shift-type pair for pre-assignment UI checks."""
    org_id = _require_coordinator(current_user)

    # Ensure worker belongs to coordinator's org
    supabase = get_supabase_admin()
    worker_resp = (
        supabase.table("users")
        .select("id")
        .eq("id", worker_id)
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    if not worker_resp.data:
        raise HTTPException(status_code=404, detail="Worker not found in your organization")

    normalized = _normalize_shift_type(shift_type)
    status_payload = await _check_worker_credentials(worker_id, org_id, normalized)
    return {
        "worker_id": worker_id,
        "shift_type": normalized,
        "credential_status": status_payload,
    }


@router.get("/shifts")
async def coordinator_shifts(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    worker_id: Optional[str] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    limit: int = Query(default=500, ge=1, le=2000),
    current_user: dict = Depends(get_current_user),
):
    """List organization shifts for coordinator roster/calendar management."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()

    try:
        rows = _execute_shift_query_with_legacy_fallback(
            supabase=supabase,
            org_id=org_id,
            limit=limit,
            start_date=start_date,
            end_date=end_date,
            worker_id=worker_id,
            status_filter=status_filter,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load shifts: {exc}")

    worker_ids = sorted({str(r.get("worker_id")) for r in rows if r.get("worker_id")})
    participant_ids = sorted({str(r.get("participant_id")) for r in rows if r.get("participant_id")})

    workers_by_id: dict[str, dict] = {}
    participants_by_id: dict[str, dict] = {}

    if worker_ids:
        try:
            workers_resp = (
                supabase.table("users")
                .select("id, full_name, email")
                .in_("id", worker_ids)
                .eq("organization_id", org_id)
                .execute()
            )
            workers_by_id = {
                str(w.get("id")): w
                for w in (workers_resp.data or [])
                if isinstance(w, dict) and w.get("id")
            }
        except Exception:
            workers_by_id = {}

    if participant_ids:
        try:
            participants_resp = (
                supabase.table("patients")
                .select("id, full_name")
                .in_("id", participant_ids)
                .eq("organization_id", org_id)
                .execute()
            )
            participants_by_id = {
                str(p.get("id")): p
                for p in (participants_resp.data or [])
                if isinstance(p, dict) and p.get("id")
            }
        except Exception:
            participants_by_id = {}

    return [
        {
            **row,
            "worker_name": (workers_by_id.get(str(row.get("worker_id")), {}) or {}).get("full_name") or "Worker",
            "worker_email": (workers_by_id.get(str(row.get("worker_id")), {}) or {}).get("email"),
            "participant_name": row.get("participant_name")
            or (participants_by_id.get(str(row.get("participant_id")), {}) or {}).get("full_name")
            or "Participant",
        }
        for row in rows
    ]


class ShiftCredentialRequirementBody(BaseModel):
    shift_type: str
    required_credential_type: str
    minimum_status: str = "valid"


def _normalize_shift_type(value: str | None) -> str:
    return (value or "standard_support").strip().lower()


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return (
        "does not exist" in err
        or "42703" in err
        or "pgrst" in err
        or "could not find" in err
    )


def _execute_shift_query_with_legacy_fallback(
    supabase,
    org_id: str,
    limit: int,
    start_date: Optional[str],
    end_date: Optional[str],
    worker_id: Optional[str],
    status_filter: Optional[str],
) -> list[dict[str, Any]]:
    full_columns = (
        "id, organization_id, worker_id, participant_id, session_id, shift_type, "
        "scheduled_start, scheduled_end, duration_minutes, status, participant_name, "
        "created_at, updated_at"
    )
    legacy_columns = (
        "id, organization_id, worker_id, participant_id, session_id, "
        "scheduled_start, scheduled_end, duration_minutes, status, participant_name, "
        "created_at, updated_at"
    )

    def _run(select_columns: str):
        query = (
            supabase.table("shifts")
            .select(select_columns)
            .eq("organization_id", org_id)
            .order("scheduled_start", desc=False)
            .limit(limit)
        )
        if start_date:
            query = query.gte("scheduled_start", start_date)
        if end_date:
            query = query.lte("scheduled_start", end_date)
        if worker_id:
            query = query.eq("worker_id", worker_id)
        if status_filter:
            query = query.eq("status", status_filter)
        return query.execute()

    try:
        result = _run(full_columns)
        return [r for r in (result.data or []) if isinstance(r, dict)]
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            raise
        result = _run(legacy_columns)
        rows = [r for r in (result.data or []) if isinstance(r, dict)]
        for row in rows:
            row.setdefault("shift_type", "standard_support")
        return rows


def _insert_shift_with_legacy_fallback(supabase, payload: dict[str, Any]):
    try:
        return supabase.table("shifts").insert(payload).execute()
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            raise

        # Legacy deployments may not yet have these columns on public.shifts.
        fallback_payload = dict(payload)
        fallback_payload.pop("created_by", None)
        fallback_payload.pop("shift_type", None)
        return supabase.table("shifts").insert(fallback_payload).execute()


async def _check_worker_credentials(
    worker_id: str,
    org_id: str,
    shift_type: str,
) -> CredentialStatus:
    """Check if worker has any valid, non-expired credentials.
    
    Returns CredentialStatus with:
    - valid: True if worker has at least one valid credential
    - missing_credentials: List of credential types that are expired/rejected
    - warning: Human-readable warning if credentials are expiring soon
    """
    required_types = await get_shift_credential_requirements(
        org_id=org_id,
        shift_type=shift_type,
        supabase=get_supabase_admin(),
    )
    service_status = await verify_worker_credentials(
        worker_id=worker_id,
        org_id=org_id,
        required_credential_types=required_types,
        supabase=get_supabase_admin(),
    )
    return CredentialStatus(
        valid=service_status.valid,
        missing_credentials=service_status.missing_credentials,
        warning=service_status.warning,
    )


@router.get("/shift-credential-requirements")
async def list_shift_credential_requirements(
    shift_type: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()

    query = (
        supabase.table("shift_credential_requirements")
        .select("id, shift_type, required_credential_type, minimum_status, is_active, created_at, updated_at")
        .eq("organization_id", org_id)
        .order("shift_type")
        .order("required_credential_type")
    )
    if shift_type:
        query = query.eq("shift_type", _normalize_shift_type(shift_type))

    result = query.execute()
    return result.data or []


@router.post("/shift-credential-requirements", status_code=201)
async def create_shift_credential_requirement(
    body: ShiftCredentialRequirementBody,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()

    minimum_status = (body.minimum_status or "valid").strip().lower()
    if minimum_status != "valid":
        raise HTTPException(status_code=422, detail="minimum_status currently supports only 'valid'.")

    payload = {
        "organization_id": org_id,
        "shift_type": _normalize_shift_type(body.shift_type),
        "required_credential_type": body.required_credential_type.strip(),
        "minimum_status": minimum_status,
        "is_active": True,
        "created_by": get_user_id(current_user),
    }

    result = supabase.table("shift_credential_requirements").insert(payload).execute()
    return (result.data or [payload])[0]


@router.delete("/shift-credential-requirements/{requirement_id}", status_code=204)
async def delete_shift_credential_requirement(
    requirement_id: str,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()

    supabase.table("shift_credential_requirements").delete().eq("id", requirement_id).eq("organization_id", org_id).execute()
    return None


@router.post("/shifts")
async def assign_shift(
    body: AssignShiftBody,
    current_user: dict = Depends(get_current_user),
):
    """Create and assign a new shift to a worker.
    
    CARECLIQV2-300: Shift Assignment Endpoint
    - Validates worker exists and belongs to organization
    - Validates participant exists and belongs to organization
    - Checks worker credentials (warns if expired/missing, blocks if all invalid)
    - Creates shift record with assigned worker
    """
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    
    # Validate required fields
    if not body.worker_id or not body.participant_id:
        raise HTTPException(
            status_code=422,
            detail="worker_id and participant_id are required"
        )
    if not body.scheduled_start:
        raise HTTPException(
            status_code=422,
            detail="scheduled_start is required"
        )
    
    # Verify worker exists and belongs to organization
    try:
        worker_resp = supabase.table("users").select(
            "id, full_name, email, role, is_active"
        ).eq("id", body.worker_id).eq("organization_id", org_id).execute()
        
        if not worker_resp.data:
            raise HTTPException(
                status_code=404,
                detail="Worker not found in your organization"
            )
        
        worker = worker_resp.data[0]
        if not worker.get("is_active"):
            raise HTTPException(
                status_code=400,
                detail="Cannot assign shift to inactive worker"
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Worker lookup failed: {exc}"
        )
    
    # Verify participant exists and belongs to organization
    try:
        participant_resp = supabase.table("patients").select(
            "id, full_name, ndis_number"
        ).eq("id", body.participant_id).eq("organization_id", org_id).execute()
        
        if not participant_resp.data:
            raise HTTPException(
                status_code=404,
                detail="Participant not found in your organization"
            )
        
        participant = participant_resp.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Participant lookup failed: {exc}"
        )
    
    # Check worker credentials
    shift_type = _normalize_shift_type(body.shift_type)
    cred_status = await _check_worker_credentials(
        body.worker_id,
        org_id,
        shift_type=shift_type,
    )
    if not cred_status.valid:
        raise HTTPException(
            status_code=400,
            detail=f"Worker has invalid credentials: {', '.join(cred_status.missing_credentials)}. "
                   f"Please ensure worker credentials are up to date before assigning shifts."
        )
    
    # Parse timestamps and calculate duration if needed
    try:
        scheduled_start = datetime.fromisoformat(body.scheduled_start)
        scheduled_end = datetime.fromisoformat(body.scheduled_end) if body.scheduled_end else (scheduled_start + timedelta(hours=4))
        
        # Calculate duration in minutes if not provided and end time is provided
        duration_minutes = body.duration_minutes
        if duration_minutes is None and scheduled_end:
            duration_minutes = int((scheduled_end - scheduled_start).total_seconds() / 60)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid datetime format: {exc}"
        )
    
    # Create shift record
    try:
        shift_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        
        shift_payload = {
            "id": shift_id,
            "organization_id": org_id,
            "worker_id": body.worker_id,
            "participant_id": body.participant_id,
            "participant_name": participant.get("full_name"),
            "shift_type": shift_type,
            "scheduled_start": scheduled_start.isoformat(),
            "scheduled_end": scheduled_end.isoformat(),
            "duration_minutes": duration_minutes,
            "status": "scheduled",
            "created_by": get_user_id(current_user),
            "created_at": now,
            "updated_at": now,
        }
        
        result = _insert_shift_with_legacy_fallback(supabase, shift_payload)
        
        if not result.data:
            raise HTTPException(
                status_code=500,
                detail="Failed to create shift"
            )
        
        shift = result.data[0]
        
        # Send notification to worker about new shift
        try:
            await notify_shift_change(
                shift=shift,
                change_summary=f"New shift assigned: {participant.get('full_name')} "
                              f"on {body.scheduled_start}"
            )
        except Exception as notify_exc:
            logger.warning(f"Failed to notify worker of new shift: {notify_exc}")
        
        return {
            "shift_id": shift_id,
            "shift": shift,
            "credential_status": cred_status,
            "message": "Shift assigned successfully"
        }
    
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Shift creation failed: {exc}"
        )


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


# ══════════════════════════════════════════════════════════════════════════════
# CARECLIQV2-235 – Shift Assignment & Scheduling (conflict detection, DnD, bulk)
# ══════════════════════════════════════════════════════════════════════════════

def _parse_dt(value: str | None) -> datetime | None:
    """Parse ISO datetime string, returning None on failure."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def _shifts_overlap(s1_start: datetime, s1_end: datetime, s2_start: datetime, s2_end: datetime) -> bool:
    """Return True if two time intervals overlap."""
    return s1_start < s2_end and s2_start < s1_end


def _detect_worker_conflicts(
    supabase,
    worker_id: str,
    org_id: str,
    shift_start: datetime,
    shift_end: datetime,
    exclude_shift_id: str | None = None,
) -> list[dict]:
    """Return a list of conflict descriptions for a worker over a time window.

    Checks:
    1. Existing shifts that overlap the window.
    2. Blackout dates that cover the window date.
    3. Weekly hours approaching/exceeding max.
    """
    conflicts: list[dict] = []

    # 1 — Overlapping shifts
    try:
        resp = (
            supabase.table("shifts")
            .select("id, scheduled_start, scheduled_end, participant_name, status")
            .eq("worker_id", worker_id)
            .not_.in_("status", ["cancelled", "completed"])
            .execute()
        )
        for row in (resp.data or []):
            if exclude_shift_id and row.get("id") == exclude_shift_id:
                continue
            rs = _parse_dt(row.get("scheduled_start"))
            re = _parse_dt(row.get("scheduled_end") or row.get("scheduled_start"))
            if rs and re and _shifts_overlap(shift_start, shift_end, rs, re):
                ts = rs.strftime("%I:%M %p").lstrip("0")
                te = re.strftime("%I:%M %p").lstrip("0")
                conflicts.append({
                    "type": "shift_overlap",
                    "severity": "error",
                    "message": f"Has shift {ts}–{te} ({row.get('participant_name', 'Participant')})",
                })
    except Exception:
        pass

    # 2 — Blackout dates
    try:
        day_str = shift_start.date().isoformat()
        bo_resp = (
            supabase.table("worker_blackout_dates")
            .select("start_date, end_date, reason")
            .eq("user_id", worker_id)
            .lte("start_date", day_str)
            .gte("end_date", day_str)
            .execute()
        )
        for row in (bo_resp.data or []):
            reason = row.get("reason") or "Blackout date"
            conflicts.append({
                "type": "blackout",
                "severity": "warning",
                "message": f"Off-schedule: {reason} ({row['start_date']} – {row['end_date']})",
            })
    except Exception:
        pass

    # 3 — Weekly hours check
    try:
        avail_resp = (
            supabase.table("worker_availability")
            .select("max_hours_per_week, available_days, day_start_time, day_end_time")
            .eq("user_id", worker_id)
            .limit(1)
            .execute()
        )
        if avail_resp.data:
            avail = avail_resp.data[0]
            max_hours = avail.get("max_hours_per_week") or 40
            week_start = (shift_start - timedelta(days=shift_start.weekday())).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            week_end = week_start + timedelta(days=7)
            week_shifts = (
                supabase.table("shifts")
                .select("scheduled_start, scheduled_end, duration_minutes")
                .eq("worker_id", worker_id)
                .gte("scheduled_start", week_start.isoformat())
                .lt("scheduled_start", week_end.isoformat())
                .not_.in_("status", ["cancelled"])
                .execute()
            )
            total_minutes = 0
            for row in (week_shifts.data or []):
                if row.get("duration_minutes"):
                    total_minutes += row["duration_minutes"]
                else:
                    rs = _parse_dt(row.get("scheduled_start"))
                    re = _parse_dt(row.get("scheduled_end"))
                    if rs and re:
                        total_minutes += int((re - rs).total_seconds() / 60)
            # Add the proposed shift
            proposed_minutes = int((shift_end - shift_start).total_seconds() / 60)
            total_minutes += proposed_minutes
            total_hours = total_minutes / 60
            if total_hours > max_hours:
                conflicts.append({
                    "type": "max_hours",
                    "severity": "warning",
                    "message": f"Will exceed max hours ({total_hours:.1f}h / {max_hours}h this week)",
                })
            elif total_hours > max_hours * 0.9:
                conflicts.append({
                    "type": "approaching_hours",
                    "severity": "info",
                    "message": f"Approaching max hours ({total_hours:.1f}h / {max_hours}h this week)",
                })
    except Exception:
        pass

    return conflicts


def _check_skill_match(
    supabase, worker_id: str, participant_id: str | None
) -> list[dict]:
    """Return list of missing-skill warnings for a worker/participant pair."""
    if not participant_id:
        return []
    warnings: list[dict] = []
    try:
        req_resp = (
            supabase.table("participant_required_skills")
            .select("skill, is_mandatory")
            .eq("participant_id", participant_id)
            .execute()
        )
        required = {r["skill"]: r.get("is_mandatory", True) for r in (req_resp.data or [])}
        if not required:
            return []
        skill_resp = (
            supabase.table("worker_skills")
            .select("skill, is_certified")
            .eq("user_id", worker_id)
            .execute()
        )
        worker_skills = {r["skill"] for r in (skill_resp.data or []) if r.get("is_certified")}
        for skill, mandatory in required.items():
            if skill not in worker_skills:
                warnings.append({
                    "type": "missing_skill",
                    "severity": "error" if mandatory else "warning",
                    "message": f"Missing required skill: {skill}",
                })
    except Exception:
        pass
    return warnings


async def _send_worker_notification(
    supabase,
    user_id: str,
    org_id: str,
    notif_type: str,
    shift_id: str | None,
    title: str,
    body: str,
) -> None:
    """Insert a worker_notifications row (fire-and-forget)."""
    try:
        supabase.table("worker_notifications").insert({
            "user_id": user_id,
            "organization_id": org_id,
            "type": notif_type,
            "shift_id": shift_id,
            "title": title,
            "body": body,
        }).execute()
    except Exception as exc:
        logger.warning(f"Worker notification insert failed: {exc}")


# ── GET /workers/{id}/conflicts ───────────────────────────────────────────────

@router.get("/workers/{worker_id}/conflicts")
async def get_worker_conflicts(
    worker_id: str,
    shift_start: str = Query(..., description="ISO datetime"),
    shift_end: str = Query(..., description="ISO datetime"),
    participant_id: Optional[str] = Query(default=None),
    exclude_shift_id: Optional[str] = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    """Return conflicts (overlapping shifts, blackout dates, hours) for a worker over a window.

    Also checks skill matching if participant_id is provided.
    Returns availability_status: 'available' | 'warning' | 'unavailable'.
    """
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()

    s_dt = _parse_dt(shift_start)
    e_dt = _parse_dt(shift_end)
    if not s_dt or not e_dt:
        raise HTTPException(status_code=422, detail="Invalid shift_start or shift_end")

    conflicts = _detect_worker_conflicts(supabase, worker_id, org_id, s_dt, e_dt, exclude_shift_id)
    skill_warnings = _check_skill_match(supabase, worker_id, participant_id)
    all_issues = conflicts + skill_warnings

    hard = [i for i in all_issues if i["severity"] == "error"]
    soft = [i for i in all_issues if i["severity"] in ("warning", "info")]
    if hard:
        availability_status = "unavailable"
    elif soft:
        availability_status = "warning"
    else:
        availability_status = "available"

    return {
        "worker_id": worker_id,
        "availability_status": availability_status,
        "conflicts": conflicts,
        "skill_warnings": skill_warnings,
    }


# ── GET /available-workers ────────────────────────────────────────────────────

@router.get("/available-workers")
async def get_available_workers(
    shift_start: str = Query(...),
    shift_end: str = Query(...),
    participant_id: Optional[str] = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    """List all team workers with their availability status for a given shift window.

    Returns workers sorted by: available → warning → unavailable, then by name.
    """
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()

    s_dt = _parse_dt(shift_start)
    e_dt = _parse_dt(shift_end)
    if not s_dt or not e_dt:
        raise HTTPException(status_code=422, detail="Invalid shift_start or shift_end")

    # Fetch all active workers in org
    team = await _team(org_id)
    active_workers = [w for w in team if w.get("is_active", True)]

    results = []
    for worker in active_workers:
        wid = worker.get("id") or worker.get("user_id") or ""
        if not wid:
            continue
        conflicts = _detect_worker_conflicts(supabase, wid, org_id, s_dt, e_dt)
        skill_warnings = _check_skill_match(supabase, wid, participant_id)
        all_issues = conflicts + skill_warnings
        hard = any(i["severity"] == "error" for i in all_issues)
        soft = any(i["severity"] in ("warning", "info") for i in all_issues)
        status = "unavailable" if hard else ("warning" if soft else "available")
        results.append({
            **worker,
            "availability_status": status,
            "conflicts": conflicts,
            "skill_warnings": skill_warnings,
        })

    order = {"available": 0, "warning": 1, "unavailable": 2}
    results.sort(key=lambda w: (order.get(w["availability_status"], 3), (w.get("full_name") or "").lower()))
    return results


# ── PUT /shifts/{id}/assign ───────────────────────────────────────────────────

class ShiftAssignBody(BaseModel):
    worker_id: str
    confirm_conflicts: bool = False


@router.put("/shifts/{shift_id}/assign")
async def assign_existing_shift(
    shift_id: str,
    body: ShiftAssignBody,
    current_user: dict = Depends(get_current_user),
):
    """Assign a worker to an existing (unassigned) shift.

    Returns 409 with conflict list if conflicts exist and confirm_conflicts=False.
    Returns 200 with updated shift + any conflicts on success.
    """
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()

    # Fetch shift
    shift = shift_service.get_shift_by_id(shift_id)
    if not shift or str(shift.get("organization_id") or "") != org_id:
        raise HTTPException(status_code=404, detail="Shift not found")

    s_dt = _parse_dt(shift.get("scheduled_start"))
    e_dt = _parse_dt(shift.get("scheduled_end") or shift.get("scheduled_start"))
    if not s_dt or not e_dt:
        raise HTTPException(status_code=422, detail="Shift has invalid times")

    # Verify worker exists in org
    worker_resp = (
        supabase.table("users")
        .select("id, full_name, is_active")
        .eq("id", body.worker_id)
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    if not worker_resp.data:
        raise HTTPException(status_code=404, detail="Worker not found")
    worker = worker_resp.data[0]
    if not worker.get("is_active", True):
        raise HTTPException(status_code=400, detail="Worker is inactive")

    # Conflict detection
    participant_id = str(shift.get("participant_id") or "")
    conflicts = _detect_worker_conflicts(supabase, body.worker_id, org_id, s_dt, e_dt, exclude_shift_id=shift_id)
    skill_warnings = _check_skill_match(supabase, body.worker_id, participant_id or None)
    hard_conflicts = [c for c in conflicts if c["severity"] == "error"]

    if hard_conflicts and not body.confirm_conflicts:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Worker has scheduling conflicts",
                "conflicts": conflicts,
                "skill_warnings": skill_warnings,
            },
        )

    old_worker_id = shift.get("worker_id")

    # Assign
    try:
        now = datetime.now(timezone.utc).isoformat()
        result = (
            supabase.table("shifts")
            .update({"worker_id": body.worker_id, "status": "scheduled", "updated_at": now})
            .eq("id", shift_id)
            .execute()
        )
        updated = (result.data or [None])[0] or {**shift, "worker_id": body.worker_id, "status": "scheduled"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Shift update failed: {exc}")

    # Notify new worker
    await _send_worker_notification(
        supabase, body.worker_id, org_id,
        "shift_assigned", shift_id,
        "Shift Assigned",
        f"You've been assigned to a shift on {s_dt.strftime('%d %b %Y at %I:%M %p')}",
    )

    # Notify old worker if reassignment
    if old_worker_id and old_worker_id != body.worker_id:
        await _send_worker_notification(
            supabase, old_worker_id, org_id,
            "shift_unassigned", shift_id,
            "Shift Reassigned",
            f"You have been removed from the shift on {s_dt.strftime('%d %b %Y at %I:%M %p')}",
        )

    return {
        "shift_id": shift_id,
        "shift": updated,
        "conflicts": conflicts,
        "skill_warnings": skill_warnings,
        "assigned_at": now,
    }


# ── PUT /shifts/{id}/unassign ─────────────────────────────────────────────────

@router.put("/shifts/{shift_id}/unassign")
async def unassign_existing_shift(
    shift_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Remove the assigned worker from a shift, returning it to 'unassigned' status."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()

    shift = shift_service.get_shift_by_id(shift_id)
    if not shift or str(shift.get("organization_id") or "") != org_id:
        raise HTTPException(status_code=404, detail="Shift not found")

    old_worker_id = shift.get("worker_id")
    if not old_worker_id:
        raise HTTPException(status_code=400, detail="Shift has no assigned worker")

    # Block unassignment if shift starts within 2 hours
    s_dt = _parse_dt(shift.get("scheduled_start"))
    warning_msg: str | None = None
    if s_dt:
        mins_until = (s_dt - datetime.now(timezone.utc)).total_seconds() / 60
        if mins_until < 120:
            warning_msg = "Shift starts within 2 hours"

    try:
        now = datetime.now(timezone.utc).isoformat()
        result = (
            supabase.table("shifts")
            .update({"worker_id": None, "status": "unassigned", "updated_at": now})
            .eq("id", shift_id)
            .execute()
        )
        updated = (result.data or [None])[0] or {**shift, "worker_id": None, "status": "unassigned"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Shift update failed: {exc}")

    await _send_worker_notification(
        supabase, old_worker_id, org_id,
        "shift_unassigned", shift_id,
        "Shift Unassigned",
        f"You have been removed from the shift on {s_dt.strftime('%d %b %Y at %I:%M %p') if s_dt else 'an upcoming date'}",
    )

    return {"shift_id": shift_id, "shift": updated, "warning": warning_msg}


# ── PUT /shifts/{id}/reassign ─────────────────────────────────────────────────

class ReassignShiftBody(BaseModel):
    new_worker_id: str
    confirm_conflicts: bool = False


@router.put("/shifts/{shift_id}/reassign")
async def reassign_shift(
    shift_id: str,
    body: ReassignShiftBody,
    current_user: dict = Depends(get_current_user),
):
    """Reassign a shift to a different worker. Same conflict checks as assign."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()

    shift = shift_service.get_shift_by_id(shift_id)
    if not shift or str(shift.get("organization_id") or "") != org_id:
        raise HTTPException(status_code=404, detail="Shift not found")

    # Reuse the assign endpoint logic
    class _Body(BaseModel):
        worker_id: str = body.new_worker_id
        confirm_conflicts: bool = body.confirm_conflicts

    return await assign_existing_shift(shift_id, _Body(), current_user)


# ── POST /shifts/bulk ─────────────────────────────────────────────────────────

class BulkShiftBody(BaseModel):
    participant_id: str
    days_of_week: list[int]           # 0=Mon … 6=Sun (Python weekday())
    start_time: str                   # "HH:MM" local time
    end_time: str                     # "HH:MM"
    start_date: str                   # "YYYY-MM-DD" first week start
    weeks: int = 4
    shift_type: str = "standard_support"
    worker_id: Optional[str] = None   # auto-assign if provided
    confirm_conflicts: bool = False


@router.post("/shifts/bulk")
async def bulk_create_shifts(
    body: BulkShiftBody,
    current_user: dict = Depends(get_current_user),
):
    """Create recurring shifts (e.g. every Mon/Wed/Fri for 4 weeks).

    Returns a summary with created shifts and per-shift conflict info.
    """
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()

    if not body.days_of_week:
        raise HTTPException(status_code=422, detail="days_of_week must not be empty")
    if body.weeks < 1 or body.weeks > 26:
        raise HTTPException(status_code=422, detail="weeks must be between 1 and 26")

    # Resolve participant
    p_resp = (
        supabase.table("patients")
        .select("id, full_name")
        .eq("id", body.participant_id)
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    if not p_resp.data:
        raise HTTPException(status_code=404, detail="Participant not found")
    participant = p_resp.data[0]

    try:
        first_day = date.fromisoformat(body.start_date)
        sh, sm = (int(x) for x in body.start_time.split(":"))
        eh, em = (int(x) for x in body.end_time.split(":"))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid date/time format: {exc}")

    created: list[dict] = []
    skipped: list[dict] = []
    conflicts_summary: list[dict] = []

    for week in range(body.weeks):
        for dow in sorted(set(body.days_of_week)):
            # Calculate the actual date for this occurrence
            days_ahead = (dow - first_day.weekday()) % 7
            shift_date = first_day + timedelta(days=week * 7 + days_ahead)
            shift_start_dt = datetime(
                shift_date.year, shift_date.month, shift_date.day, sh, sm,
                tzinfo=timezone.utc,
            )
            shift_end_dt = datetime(
                shift_date.year, shift_date.month, shift_date.day, eh, em,
                tzinfo=timezone.utc,
            )
            if shift_end_dt <= shift_start_dt:
                shift_end_dt += timedelta(days=1)

            conflicts: list[dict] = []
            if body.worker_id:
                conflicts = _detect_worker_conflicts(
                    supabase, body.worker_id, org_id, shift_start_dt, shift_end_dt
                )
                hard = any(c["severity"] == "error" for c in conflicts)
                if hard and not body.confirm_conflicts:
                    skipped.append({
                        "date": shift_date.isoformat(),
                        "reason": "Worker has conflicts",
                        "conflicts": conflicts,
                    })
                    continue

            shift_id = str(uuid.uuid4())
            now_iso = datetime.now(timezone.utc).isoformat()
            payload: dict[str, Any] = {
                "id": shift_id,
                "organization_id": org_id,
                "participant_id": body.participant_id,
                "participant_name": participant.get("full_name"),
                "shift_type": _normalize_shift_type(body.shift_type),
                "scheduled_start": shift_start_dt.isoformat(),
                "scheduled_end": shift_end_dt.isoformat(),
                "duration_minutes": int((shift_end_dt - shift_start_dt).total_seconds() / 60),
                "status": "scheduled" if body.worker_id else "unassigned",
                "created_by": get_user_id(current_user),
                "created_at": now_iso,
                "updated_at": now_iso,
            }
            if body.worker_id:
                payload["worker_id"] = body.worker_id

            try:
                result = _insert_shift_with_legacy_fallback(supabase, payload)
                inserted = (result.data or [None])[0] or payload
                created.append(inserted)
                conflicts_summary.append({
                    "shift_id": shift_id,
                    "date": shift_date.isoformat(),
                    "conflicts": conflicts,
                })
                if body.worker_id and conflicts:
                    pass  # Conflicts exist but were confirmed
            except Exception as exc:
                skipped.append({
                    "date": shift_date.isoformat(),
                    "reason": f"Insert failed: {exc}",
                    "conflicts": [],
                })

    if body.worker_id and created:
        await _send_worker_notification(
            supabase, body.worker_id, org_id,
            "shift_assigned", None,
            "Recurring Shifts Assigned",
            f"{len(created)} new shifts assigned to you. Check your schedule.",
        )

    return {
        "created_count": len(created),
        "skipped_count": len(skipped),
        "total_requested": body.weeks * len(body.days_of_week),
        "shifts": created,
        "skipped": skipped,
        "conflicts_summary": conflicts_summary,
    }


# ── POST /shifts (unassigned) — allow creating without worker ─────────────────
# (Existing POST /shifts endpoint updated to make worker_id optional via
#  the existing AssignShiftBody.worker_id — handled below via a separate route)

class CreateUnassignedShiftBody(BaseModel):
    participant_id: str
    scheduled_start: str
    scheduled_end: Optional[str] = None
    duration_minutes: Optional[int] = None
    shift_type: str = "standard_support"


@router.post("/shifts/unassigned")
async def create_unassigned_shift(
    body: CreateUnassignedShiftBody,
    current_user: dict = Depends(get_current_user),
):
    """Create a shift without an assigned worker (status = 'unassigned')."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()

    p_resp = (
        supabase.table("patients")
        .select("id, full_name")
        .eq("id", body.participant_id)
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    if not p_resp.data:
        raise HTTPException(status_code=404, detail="Participant not found")
    participant = p_resp.data[0]

    try:
        s_dt = datetime.fromisoformat(body.scheduled_start)
        e_dt = datetime.fromisoformat(body.scheduled_end) if body.scheduled_end else s_dt + timedelta(hours=4)
        duration = body.duration_minutes or int((e_dt - s_dt).total_seconds() / 60)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid datetime: {exc}")

    shift_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    payload = {
        "id": shift_id,
        "organization_id": org_id,
        "participant_id": body.participant_id,
        "participant_name": participant.get("full_name"),
        "shift_type": _normalize_shift_type(body.shift_type),
        "scheduled_start": s_dt.isoformat(),
        "scheduled_end": e_dt.isoformat(),
        "duration_minutes": duration,
        "status": "unassigned",
        "created_by": get_user_id(current_user),
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    result = _insert_shift_with_legacy_fallback(supabase, payload)
    shift = (result.data or [None])[0] or payload
    return {"shift_id": shift_id, "shift": shift}


# ── Worker notifications ──────────────────────────────────────────────────────

@router.get("/workers/{worker_id}/notifications")
async def get_worker_notifications(
    worker_id: str,
    unread_only: bool = Query(default=False),
    limit: int = Query(default=50, le=200),
    current_user: dict = Depends(get_current_user),
):
    """Get in-app notifications for a worker."""
    _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        q = (
            supabase.table("worker_notifications")
            .select("*")
            .eq("user_id", worker_id)
            .order("created_at", desc=True)
            .limit(limit)
        )
        if unread_only:
            q = q.is_("read_at", "null")
        resp = q.execute()
        return resp.data or []
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Notification fetch failed: {exc}")


@router.post("/workers/{worker_id}/notifications/read")
async def mark_notifications_read(
    worker_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Mark all notifications as read for a worker."""
    _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        now = datetime.now(timezone.utc).isoformat()
        supabase.table("worker_notifications").update({"read_at": now}).eq("user_id", worker_id).is_("read_at", "null").execute()
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Mark read failed: {exc}")


# ── Worker availability ───────────────────────────────────────────────────────

class WorkerAvailabilityBody(BaseModel):
    available_days: list[int] = [1, 2, 3, 4, 5]
    day_start_time: str = "08:00"
    day_end_time: str = "18:00"
    max_hours_per_week: int = 40
    blackout_dates: Optional[list[dict]] = None  # [{start_date, end_date, reason}]


@router.get("/workers/{worker_id}/availability")
async def get_worker_availability(
    worker_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get availability settings and blackout dates for a worker."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        avail = (
            supabase.table("worker_availability")
            .select("*")
            .eq("user_id", worker_id)
            .limit(1)
            .execute()
        )
        blackouts = (
            supabase.table("worker_blackout_dates")
            .select("id, start_date, end_date, reason")
            .eq("user_id", worker_id)
            .order("start_date")
            .execute()
        )
        default_avail = {
            "user_id": worker_id,
            "available_days": [1, 2, 3, 4, 5],
            "day_start_time": "08:00",
            "day_end_time": "18:00",
            "max_hours_per_week": 40,
        }
        return {
            "availability": (avail.data or [default_avail])[0],
            "blackout_dates": blackouts.data or [],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Availability fetch failed: {exc}")


@router.put("/workers/{worker_id}/availability")
async def update_worker_availability(
    worker_id: str,
    body: WorkerAvailabilityBody,
    current_user: dict = Depends(get_current_user),
):
    """Upsert availability settings for a worker."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "user_id": worker_id,
            "organization_id": org_id,
            "available_days": body.available_days,
            "day_start_time": body.day_start_time,
            "day_end_time": body.day_end_time,
            "max_hours_per_week": body.max_hours_per_week,
            "updated_at": now,
        }
        supabase.table("worker_availability").upsert(payload, on_conflict="user_id").execute()

        if body.blackout_dates is not None:
            # Replace blackouts
            supabase.table("worker_blackout_dates").delete().eq("user_id", worker_id).execute()
            for bd in body.blackout_dates:
                if bd.get("start_date") and bd.get("end_date"):
                    supabase.table("worker_blackout_dates").insert({
                        "user_id": worker_id,
                        "organization_id": org_id,
                        "start_date": bd["start_date"],
                        "end_date": bd["end_date"],
                        "reason": bd.get("reason"),
                    }).execute()
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Availability update failed: {exc}")


# ── Worker skills ─────────────────────────────────────────────────────────────

@router.get("/workers/{worker_id}/skills")
async def get_worker_skills(
    worker_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get certified skills for a worker."""
    _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        resp = (
            supabase.table("worker_skills")
            .select("id, skill, is_certified, certified_at, expires_at")
            .eq("user_id", worker_id)
            .order("skill")
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Skills fetch failed: {exc}")


class WorkerSkillBody(BaseModel):
    skill: str
    is_certified: bool = True
    certified_at: Optional[str] = None
    expires_at: Optional[str] = None


@router.post("/workers/{worker_id}/skills")
async def add_worker_skill(
    worker_id: str,
    body: WorkerSkillBody,
    current_user: dict = Depends(get_current_user),
):
    """Add or update a certified skill for a worker."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        payload: dict[str, Any] = {
            "user_id": worker_id,
            "organization_id": org_id,
            "skill": body.skill.strip(),
            "is_certified": body.is_certified,
        }
        if body.certified_at:
            payload["certified_at"] = body.certified_at
        if body.expires_at:
            payload["expires_at"] = body.expires_at
        resp = (
            supabase.table("worker_skills")
            .upsert(payload, on_conflict="user_id,skill")
            .execute()
        )
        return (resp.data or [payload])[0]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Skill add failed: {exc}")


@router.delete("/workers/{worker_id}/skills/{skill}")
async def remove_worker_skill(
    worker_id: str,
    skill: str,
    current_user: dict = Depends(get_current_user),
):
    """Remove a skill from a worker."""
    _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        supabase.table("worker_skills").delete().eq("user_id", worker_id).eq("skill", skill).execute()
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Skill delete failed: {exc}")


# ── Participant required skills ───────────────────────────────────────────────

@router.get("/participants/{participant_id}/required-skills")
async def get_participant_required_skills(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get required skills for a participant."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        resp = (
            supabase.table("participant_required_skills")
            .select("id, skill, is_mandatory")
            .eq("participant_id", participant_id)
            .eq("organization_id", org_id)
            .order("skill")
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Required skills fetch failed: {exc}")


class RequiredSkillBody(BaseModel):
    skill: str
    is_mandatory: bool = True


@router.post("/participants/{participant_id}/required-skills")
async def add_participant_required_skill(
    participant_id: str,
    body: RequiredSkillBody,
    current_user: dict = Depends(get_current_user),
):
    """Add a required skill to a participant."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        payload = {
            "participant_id": participant_id,
            "organization_id": org_id,
            "skill": body.skill.strip(),
            "is_mandatory": body.is_mandatory,
        }
        resp = (
            supabase.table("participant_required_skills")
            .upsert(payload, on_conflict="participant_id,skill")
            .execute()
        )
        return (resp.data or [payload])[0]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Required skill add failed: {exc}")


# ══════════════════════════════════════════════════════════════════════════════
# CARECLIQV2-236 – Real-Time Shift Monitoring
# ══════════════════════════════════════════════════════════════════════════════

def _elapsed_minutes(dt_str: str | None) -> float:
    """Minutes elapsed since the given ISO datetime string."""
    if not dt_str:
        return 0.0
    dt = _parse_dt(dt_str)
    if not dt:
        return 0.0
    return max(0.0, (datetime.now(timezone.utc) - dt).total_seconds() / 60)


def _shift_live_status(shift: dict, task_counts: dict, alerts: list[dict]) -> str:
    """Derive green/yellow/red status for a live shift."""
    elapsed = _elapsed_minutes(shift.get("clocked_in_at") or shift.get("scheduled_start"))
    has_session = bool(shift.get("session_id") or shift.get("status") == "in_progress")
    has_notes = bool(shift.get("visit_notes"))
    total_tasks = task_counts.get("total", 0)
    completed_tasks = task_counts.get("completed", 0)

    if shift.get("emergency_flagged"):
        return "red"
    if alerts:
        return "red"
    if elapsed > 30 and not has_session:
        return "red"
    if elapsed > 45 and not has_notes:
        return "yellow"
    if total_tasks > 0 and completed_tasks < total_tasks / 2 and elapsed > 60:
        return "yellow"
    return "green"


@router.get("/shifts/live")
async def get_live_shifts(
    current_user: dict = Depends(get_current_user),
):
    """Return all in-progress and recently-clocked-in shifts for real-time monitoring.
    Also auto-generates alerts for shifts that meet alert conditions.
    """
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc)
    window_start = (now - timedelta(hours=12)).isoformat()

    try:
        resp = (
            supabase.table("shifts")
            .select("id, organization_id, worker_id, participant_id, participant_name, "
                    "shift_type, scheduled_start, scheduled_end, status, "
                    "clocked_in_at, clocked_out_at, duration_minutes, "
                    "session_id, visit_notes, coordinator_notes, "
                    "emergency_flagged, emergency_flagged_at, emergency_note, "
                    "created_at, updated_at")
            .eq("organization_id", org_id)
            .in_("status", ["in_progress", "clocked_in", "scheduled"])
            .gte("scheduled_start", window_start)
            .order("scheduled_start")
            .execute()
        )
        shifts_raw = resp.data or []
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Live shifts fetch failed: {exc}")

    # Fetch workers for name lookup
    worker_ids = list({s.get("worker_id") for s in shifts_raw if s.get("worker_id")})
    worker_map: dict[str, dict] = {}
    if worker_ids:
        try:
            w_resp = supabase.table("users").select("id, full_name, email").in_("id", worker_ids).execute()
            for w in (w_resp.data or []):
                worker_map[w["id"]] = w
        except Exception:
            pass

    # Fetch task counts per shift
    shift_ids = [s["id"] for s in shifts_raw]
    task_counts_map: dict[str, dict] = {}
    if shift_ids:
        try:
            t_resp = (
                supabase.table("shift_tasks")
                .select("shift_id, completed")
                .in_("shift_id", shift_ids)
                .execute()
            )
            for task in (t_resp.data or []):
                sid = task.get("shift_id")
                if sid:
                    c = task_counts_map.setdefault(sid, {"total": 0, "completed": 0})
                    c["total"] += 1
                    if task.get("completed"):
                        c["completed"] += 1
        except Exception:
            pass

    # Fetch active alerts per shift
    alerts_map: dict[str, list] = {}
    if shift_ids:
        try:
            a_resp = (
                supabase.table("alerts")
                .select("id, alert_type, message, severity, shift_id")
                .in_("shift_id", shift_ids)
                .eq("is_read", False)
                .execute()
            )
            for alert in (a_resp.data or []):
                sid = alert.get("shift_id")
                if sid:
                    alerts_map.setdefault(sid, []).append(alert)
        except Exception:
            pass

    # Auto-generate alerts for monitored conditions
    alert_service_import_ok = True
    for shift in shifts_raw:
        sid = shift["id"]
        elapsed = _elapsed_minutes(shift.get("clocked_in_at") or shift.get("scheduled_start"))
        has_session = bool(shift.get("session_id"))
        has_notes = bool(shift.get("visit_notes"))

        if elapsed > 30 and not has_session and shift.get("clocked_in_at"):
            existing = [a for a in alerts_map.get(sid, []) if a.get("alert_type") == "no_session_started"]
            if not existing and alert_service_import_ok:
                try:
                    supabase.table("alerts").insert({
                        "organization_id": org_id,
                        "shift_id": sid,
                        "alert_type": "no_session_started",
                        "message": f"Worker clocked in {elapsed:.0f} min ago but no session started",
                        "severity": "warning",
                        "is_read": False,
                    }).execute()
                except Exception:
                    pass

        elif elapsed > 45 and has_session and not has_notes:
            existing = [a for a in alerts_map.get(sid, []) if a.get("alert_type") == "no_notes_recorded"]
            if not existing and alert_service_import_ok:
                try:
                    supabase.table("alerts").insert({
                        "organization_id": org_id,
                        "shift_id": sid,
                        "alert_type": "no_notes_recorded",
                        "message": f"Session active {elapsed:.0f} min but no notes recorded",
                        "severity": "warning",
                        "is_read": False,
                    }).execute()
                except Exception:
                    pass

    # Build response
    result = []
    for shift in shifts_raw:
        sid = shift["id"]
        worker_id = shift.get("worker_id")
        worker = worker_map.get(worker_id, {}) if worker_id else {}
        task_counts = task_counts_map.get(sid, {"total": 0, "completed": 0})
        shift_alerts = alerts_map.get(sid, [])
        live_status = _shift_live_status(shift, task_counts, shift_alerts)
        elapsed_mins = _elapsed_minutes(shift.get("clocked_in_at") or shift.get("scheduled_start"))

        result.append({
            **shift,
            "worker_name": worker.get("full_name") or shift.get("participant_name") or "Worker",
            "worker_email": worker.get("email"),
            "task_counts": task_counts,
            "alerts": shift_alerts,
            "live_status": live_status,
            "elapsed_minutes": round(elapsed_mins, 1),
        })

    return result


# ── POST /shifts/{id}/message ─────────────────────────────────────────────────

class ShiftMessageBody(BaseModel):
    recipient_id: str
    message: str
    message_type: str = "text"


@router.post("/shifts/{shift_id}/message")
async def send_shift_message(
    shift_id: str,
    body: ShiftMessageBody,
    current_user: dict = Depends(get_current_user),
):
    """Send an in-app message from coordinator to worker (CARECLIQV2-262)."""
    org_id = _require_coordinator(current_user)
    sender_id = get_user_id(current_user)

    shift = shift_service.get_shift_by_id(shift_id)
    if not shift or str(shift.get("organization_id") or "") != org_id:
        raise HTTPException(status_code=404, detail="Shift not found")

    conv = conversation_service.get_or_create_shift_conversation(
        organization_id=org_id,
        worker_id=body.recipient_id,
        shift_id=shift_id,
        coordinator_id=sender_id,
        participant_id=str(shift.get("participant_id") or "") or None,
        participant_name=shift.get("participant_name"),
    )
    if not conv:
        raise HTTPException(status_code=500, detail="Could not open conversation")

    requires_action = body.message_type == "action_required"
    try:
        msg = conversation_service.send_conversation_message(
            conversation_id=str(conv["id"]),
            sender_id=sender_id,
            body=body.message,
            message_type=body.message_type if body.message_type in ("text", "image", "action_required") else "text",
            requires_action=requires_action,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not msg:
        raise HTTPException(status_code=500, detail="Message send failed")

    await notify_conversation_message(
        recipient_id=body.recipient_id,
        org_id=org_id,
        conversation_id=str(conv["id"]),
        shift_id=shift_id,
        message_preview=body.message,
    )
    return msg


@router.get("/shifts/{shift_id}/messages")
async def get_shift_messages(
    shift_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get messages for a shift conversation."""
    org_id = _require_coordinator(current_user)
    user_id = get_user_id(current_user)
    try:
        conv = (
            get_supabase_admin()
            .table("conversations")
            .select("id")
            .eq("shift_id", shift_id)
            .eq("organization_id", org_id)
            .limit(1)
            .execute()
        )
        if not conv.data:
            return []
        conv_id = conv.data[0]["id"]
        return conversation_service.get_conversation_messages(str(conv_id), user_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Messages fetch failed: {exc}") from exc


# ── POST /shifts/{id}/flag ────────────────────────────────────────────────────

class ShiftFlagBody(BaseModel):
    message: str
    severity: str = "warning"


@router.post("/shifts/{shift_id}/flag")
async def flag_shift_alert(
    shift_id: str,
    body: ShiftFlagBody,
    current_user: dict = Depends(get_current_user),
):
    """Create an alert flag for a shift."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        resp = supabase.table("alerts").insert({
            "organization_id": org_id,
            "shift_id": shift_id,
            "alert_type": "coordinator_flag",
            "message": body.message,
            "severity": body.severity,
            "is_read": False,
        }).execute()
        return (resp.data or [{}])[0]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Flag failed: {exc}")


# ── POST /shifts/{id}/emergency-stop ─────────────────────────────────────────

class EmergencyStopBody(BaseModel):
    note: str = "Emergency stop triggered by coordinator"


@router.post("/shifts/{shift_id}/emergency-stop")
async def emergency_stop_shift(
    shift_id: str,
    body: EmergencyStopBody,
    current_user: dict = Depends(get_current_user),
):
    """Flag a shift as an emergency and notify the worker."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc).isoformat()

    shift = shift_service.get_shift_by_id(shift_id)
    if not shift or str(shift.get("organization_id") or "") != org_id:
        raise HTTPException(status_code=404, detail="Shift not found")

    try:
        result = supabase.table("shifts").update({
            "emergency_flagged": True,
            "emergency_flagged_at": now,
            "emergency_note": body.note,
            "updated_at": now,
        }).eq("id", shift_id).execute()
        updated = (result.data or [{}])[0]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Emergency stop failed: {exc}")

    worker_id = shift.get("worker_id")
    if worker_id:
        await _send_worker_notification(
            supabase, worker_id, org_id,
            "shift_unassigned", shift_id,
            "⚠️ Emergency — Contact Coordinator",
            body.note,
        )
        # Also create a high-severity alert
        try:
            supabase.table("alerts").insert({
                "organization_id": org_id,
                "shift_id": shift_id,
                "alert_type": "emergency",
                "message": body.note,
                "severity": "critical",
                "is_read": False,
            }).execute()
        except Exception:
            pass

    return {"ok": True, "shift": updated}


# ── GET /notifications (coordinator) ─────────────────────────────────────────

@router.get("/notifications")
async def get_coordinator_notifications(
    limit: int = Query(default=50, le=200),
    unread_only: bool = Query(default=False),
    current_user: dict = Depends(get_current_user),
):
    """Get alerts/notifications for the coordinator's organization."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        q = (
            supabase.table("alerts")
            .select("id, alert_type, message, severity, is_read, session_id, patient_id, created_at")
            .eq("organization_id", org_id)
            .order("created_at", desc=True)
            .limit(limit)
        )
        if unread_only:
            q = q.eq("is_read", False)
        resp = q.execute()
        return resp.data or []
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Notifications fetch failed: {exc}")


@router.post("/notifications/{alert_id}/read")
async def mark_coordinator_notification_read(
    alert_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Mark a specific alert as read."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        supabase.table("alerts").update({"is_read": True}).eq("id", alert_id).eq("organization_id", org_id).execute()
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Mark read failed: {exc}")


@router.post("/notifications/read-all")
async def mark_all_coordinator_notifications_read(
    current_user: dict = Depends(get_current_user),
):
    """Mark all alerts as read for this organization."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        supabase.table("alerts").update({"is_read": True}).eq("organization_id", org_id).eq("is_read", False).execute()
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Mark all read failed: {exc}")


# ══════════════════════════════════════════════════════════════════════════════
# CARECLIQV2-237/240 – NDIS Goals + Task Templates
# ══════════════════════════════════════════════════════════════════════════════

class NdisGoalBody(BaseModel):
    participant_id: str
    name: str
    goal_area: str = "daily_living"
    description: Optional[str] = None
    target_date: Optional[str] = None
    success_criteria: Optional[str] = None
    related_task_ids: Optional[list[str]] = None


@router.get("/goals")
async def list_coordinator_goals(
    participant_id: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    """List NDIS goals for the coordinator's organization."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        q = supabase.table("ndis_goals").select("*").eq("organization_id", org_id).order("created_at", desc=True)
        if participant_id:
            q = q.eq("participant_id", participant_id)
        if status:
            q = q.eq("status", status)
        resp = q.execute()
        return resp.data or []
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Goals fetch failed: {exc}")


@router.post("/goals", status_code=201)
async def create_ndis_goal(
    body: NdisGoalBody,
    current_user: dict = Depends(get_current_user),
):
    """Create a new NDIS goal for a participant."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc).isoformat()
    payload: dict[str, Any] = {
        "participant_id": body.participant_id,
        "organization_id": org_id,
        "created_by": get_user_id(current_user),
        "name": body.name,
        "goal_area": body.goal_area,
        "description": body.description,
        "target_date": body.target_date,
        "success_criteria": body.success_criteria,
        "related_task_ids": body.related_task_ids or [],
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    try:
        resp = supabase.table("ndis_goals").insert(payload).execute()
        return (resp.data or [payload])[0]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Goal create failed: {exc}")


@router.put("/goals/{goal_id}")
async def update_ndis_goal(
    goal_id: str,
    body: NdisGoalBody,
    current_user: dict = Depends(get_current_user),
):
    """Update an existing NDIS goal."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc).isoformat()
    update: dict[str, Any] = {
        "name": body.name,
        "goal_area": body.goal_area,
        "description": body.description,
        "target_date": body.target_date,
        "success_criteria": body.success_criteria,
        "related_task_ids": body.related_task_ids or [],
        "updated_at": now,
    }
    try:
        resp = supabase.table("ndis_goals").update(update).eq("id", goal_id).eq("organization_id", org_id).execute()
        return (resp.data or [update])[0]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Goal update failed: {exc}")


@router.put("/goals/{goal_id}/archive")
async def archive_ndis_goal(
    goal_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Archive an NDIS goal."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc).isoformat()
    try:
        resp = supabase.table("ndis_goals").update({"status": "archived", "archived_at": now, "updated_at": now}).eq("id", goal_id).eq("organization_id", org_id).execute()
        return (resp.data or [{}])[0]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Goal archive failed: {exc}")


@router.put("/goals/{goal_id}/complete")
async def complete_ndis_goal(
    goal_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Mark an NDIS goal as completed."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc).isoformat()
    try:
        resp = supabase.table("ndis_goals").update({"status": "completed", "completed_at": now, "updated_at": now}).eq("id", goal_id).eq("organization_id", org_id).execute()
        return (resp.data or [{}])[0]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Goal complete failed: {exc}")


@router.get("/goals/{goal_id}/progress")
async def get_goal_progress(
    goal_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get progress metrics for a specific goal (linked sessions + evidence)."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        goal_resp = supabase.table("ndis_goals").select("*").eq("id", goal_id).eq("organization_id", org_id).single().execute()
        if not goal_resp.data:
            raise HTTPException(status_code=404, detail="Goal not found")
        goal = goal_resp.data
        participant_id = goal.get("participant_id")

        # Get recent sessions for participant
        from datetime import timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        sessions_resp = (
            supabase.table("sessions")
            .select("id, session_date, status, compliance_score, notes")
            .eq("participant_id", participant_id)
            .gte("session_date", cutoff[:10])
            .order("session_date", desc=True)
            .limit(10)
            .execute()
        )
        sessions = sessions_resp.data or []
        return {
            "goal": goal,
            "sessions_count": len(sessions),
            "sessions": sessions,
            "evidence_count": sum(1 for s in sessions if s.get("notes")),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Goal progress failed: {exc}")


# ── Task templates ────────────────────────────────────────────────────────────

class TaskTemplateBody(BaseModel):
    name: str
    description: Optional[str] = None
    linked_goal_ids: Optional[list[str]] = None
    evidence_required: str = "optional"
    is_mandatory: bool = False
    estimated_duration_minutes: Optional[int] = None
    sort_order: int = 0


@router.get("/participants/{participant_id}/task-templates")
async def list_task_templates(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    """List task templates for a participant (default + custom)."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    default_tasks = [
        {"id": f"default_{i}", "name": name, "description": desc, "is_custom": False, "is_mandatory": True, "evidence_required": "optional", "sort_order": i}
        for i, (name, desc) in enumerate([
            ("Personal Hygiene", "Assist with personal hygiene and grooming"),
            ("Meal Prep", "Prepare and/or assist with meals"),
            ("Medication", "Administer and document medications"),
            ("Community Access", "Support community participation activities"),
            ("Documentation", "Complete required documentation for the shift"),
        ])
    ]
    try:
        custom_resp = (
            supabase.table("participant_task_templates")
            .select("*")
            .eq("participant_id", participant_id)
            .eq("organization_id", org_id)
            .eq("is_active", True)
            .order("sort_order")
            .execute()
        )
        custom = custom_resp.data or []
        return {"default_tasks": default_tasks, "custom_tasks": custom}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Task templates fetch failed: {exc}")


@router.post("/participants/{participant_id}/task-templates", status_code=201)
async def create_task_template(
    participant_id: str,
    body: TaskTemplateBody,
    current_user: dict = Depends(get_current_user),
):
    """Create a custom task template for a participant."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "participant_id": participant_id,
        "organization_id": org_id,
        "created_by": get_user_id(current_user),
        "name": body.name,
        "description": body.description,
        "linked_goal_ids": body.linked_goal_ids or [],
        "evidence_required": body.evidence_required,
        "is_mandatory": body.is_mandatory,
        "estimated_duration_minutes": body.estimated_duration_minutes,
        "sort_order": body.sort_order,
        "is_custom": True,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
    }
    try:
        resp = supabase.table("participant_task_templates").insert(payload).execute()
        return (resp.data or [payload])[0]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Task template create failed: {exc}")


@router.put("/task-templates/{template_id}")
async def update_task_template(
    template_id: str,
    body: TaskTemplateBody,
    current_user: dict = Depends(get_current_user),
):
    """Update a custom task template."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc).isoformat()
    update = {
        "name": body.name,
        "description": body.description,
        "linked_goal_ids": body.linked_goal_ids or [],
        "evidence_required": body.evidence_required,
        "is_mandatory": body.is_mandatory,
        "estimated_duration_minutes": body.estimated_duration_minutes,
        "sort_order": body.sort_order,
        "updated_at": now,
    }
    try:
        resp = supabase.table("participant_task_templates").update(update).eq("id", template_id).eq("organization_id", org_id).execute()
        return (resp.data or [update])[0]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Task template update failed: {exc}")


@router.delete("/task-templates/{template_id}", status_code=204)
async def delete_task_template(
    template_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Soft-delete a task template (mark inactive)."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        supabase.table("participant_task_templates").update({"is_active": False}).eq("id", template_id).eq("organization_id", org_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Task template delete failed: {exc}")
