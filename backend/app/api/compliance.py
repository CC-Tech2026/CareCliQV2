from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from ..core.access import get_user_organization_id, is_coordinator_role
from ..core.security import get_current_user
from ..services import session_service, participant_service, funding_service, ai_service, shift_service, incident_service
from ..services.incident_notification_service import compute_notification_due_at
from ..services.compliance_engine import (
    COMPLIANCE_BLOCKED_MESSAGE,
    ComplianceBlockedError,
    run_compliance_check,
)
from ..services.compliance_rules_catalog import enrich_rule_results, get_rules_catalog
from ..services.credential_status import live_status
from ..services.settings_service import get_physical_exam_session_types
from ..services.supabase_client import get_supabase_admin
import logging
from ..core.timezone import app_today, participant_timezone, shift_local_date


def _local_day(value) -> str:
    """Calendar day of a timestamptz in the viewer's branch zone (slicing
    the UTC string put early-morning incidents on the previous day)."""
    local = shift_local_date(value)
    return local.isoformat() if local else str(value or "")[:10]

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/compliance", tags=["compliance"])


def _require_coordinator_org(current_user: dict) -> str:
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Only support coordinators can access the compliance centre.")
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=400, detail="No organization found for this user.")
    return org_id


def _session_score_band(score: float) -> str:
    if score >= 85:
        return "compliant"
    if score >= 60:
        return "at_risk"
    return "non_compliant"


def _worker_id_of(row: dict) -> str:
    return str(row.get("worker_id") or row.get("support_worker_id") or row.get("owner_user_id") or "")


@router.get("/rules")
async def list_compliance_rules(current_user: dict = Depends(get_current_user)):
    """Return the CareCliQ 12-rule catalog with explanations for UI tooltips."""
    return {"rules": get_rules_catalog()}


def _derive_status(score) -> str:
    if score is None:
        return "draft"
    score = float(score)
    if score >= 85:
        return "compliant"
    if score >= 60:
        return "at_risk"
    return "non_compliant"


@router.post("/run/{session_id}")
async def run_compliance(session_id: str, current_user: dict = Depends(get_current_user)):
    """Run the compliance engine on a specific session, store results, and get AI explanation."""
    session = await session_service.get_session_by_id(session_id, current_user)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    participant_id = session.get("participant_id") or session.get("patient_id")
    participant = None
    existing_sessions = []

    if participant_id:
        participant = await participant_service.get_participant_by_id(participant_id, current_user)
        existing_sessions = await session_service.get_sessions_by_participant(participant_id, current_user)

    custom_physical_types = await get_physical_exam_session_types()

    budget_context = None
    if participant_id:
        plan = await funding_service.get_plan_for_participant(participant_id)
        budget_context = funding_service.build_budget_alignment_context(session, plan)

    duration_context = shift_service.build_duration_consistency_context(session)

    try:
        rules_result = run_compliance_check(
            session,
            participant,
            existing_sessions,
            custom_physical_types,
            budget_context=budget_context,
            duration_context=duration_context,
        )
    except ComplianceBlockedError:
        raise HTTPException(status_code=422, detail=COMPLIANCE_BLOCKED_MESSAGE)
    score = rules_result["score"]
    status = _derive_status(score)

    updates: dict = {
        "compliance_score": score,
    }
    if "compliance_status" in (session.keys() if hasattr(session, "keys") else {}):
        updates["compliance_status"] = status

    try:
        await session_service.update_session(session_id, updates, current_user)
    except Exception as e:
        logger.warning(f"Could not update compliance_status (column may not exist yet): {e}")
        try:
            await session_service.update_session(session_id, {"compliance_score": score}, current_user)
        except Exception:
            pass

    try:
        await funding_service.create_compliance_audit_log(session_id, rules_result)
    except Exception as e:
        logger.warning(f"Audit log write failed: {e}")

    explanation = None
    failed = rules_result.get("failed_rules", [])
    if failed:
        try:
            explanation = await ai_service.explain_compliance(
                failed,
                session.get("compliance_input_text") or session.get("translated_english_note") or "",
            )
        except Exception as e:
            logger.warning(f"AI explanation failed: {e}")

    enriched_rules = enrich_rule_results(rules_result.get("rules", []))

    return {
        "session_id": session_id,
        "score": score,
        "status": status,
        "rules_result": {**rules_result, "rules": enriched_rules},
        "explanation": explanation,
    }


@router.get("/report/{patient_id}")
async def compliance_report_for_patient(patient_id: str, current_user: dict = Depends(get_current_user)):
    """Get full compliance report for a specific participant."""
    if current_user.get("role") == "support_worker":
        raise HTTPException(status_code=403, detail="Use the worker compliance endpoint for scoped compliance data.")
    sessions = await session_service.get_sessions_by_participant(patient_id, current_user)
    scored = [s for s in sessions if s.get("compliance_score") is not None]
    scores = [float(s["compliance_score"]) for s in scored]

    avg = round(sum(scores) / len(scores), 1) if scores else 0
    compliant = sum(1 for s in scores if s >= 85)
    at_risk = sum(1 for s in scores if 60 <= s < 85)
    non_compliant = sum(1 for s in scores if s < 60)

    session_rows = []
    for s in sessions:
        score = s.get("compliance_score")
        status = _derive_status(score)
        goals = s.get("goals_addressed") or []
        if isinstance(goals, str):
            import json
            try:
                goals = json.loads(goals)
            except Exception:
                goals = []

        session_rows.append({
            "session_id": s.get("id"),
            "session_date": s.get("session_date"),
            "session_type": s.get("session_type"),
            "compliance_score": score,
            "compliance_status": status,
            "duration_minutes": s.get("duration_minutes"),
            "notes_length": len(s.get("compliance_input_text") or s.get("translated_english_note") or ""),
            "goals_linked": bool(goals),
            "status": s.get("status"),
        })

    return {
        "participant_id": patient_id,
        "total_sessions": len(sessions),
        "analyzed_sessions": len(scored),
        "average_score": avg,
        "compliant": compliant,
        "at_risk": at_risk,
        "non_compliant": non_compliant,
        "sessions": sorted(session_rows, key=lambda x: x.get("session_date") or "", reverse=True),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# COMPLIANCE CENTRE — Overview / Staff / Participant / Incidents sub-tabs
# ═══════════════════════════════════════════════════════════════════════════════

# The 8 credential types the Staff compliance table always shows as columns
# (Tier 1 + Tier 2 of the credential taxonomy, plus Medication Admin).
FIXED_CREDENTIAL_TYPES = [
    "ndis_screening", "wwcc", "code_of_conduct",
    "first_aid", "cpr", "manual_handling", "infection_control",
    "medication_admin",
]


def _date_range(date_from: Optional[str], date_to: Optional[str]) -> tuple[str, str]:
    """Default to the last 30 days when no explicit range is supplied."""
    since = date_from or (app_today() - timedelta(days=30)).isoformat()
    until = date_to or app_today().isoformat()
    return since, until


@router.get("/centre/overview")
async def compliance_centre_overview(current_user: dict = Depends(get_current_user)):
    """Compliance centre — Overview: KPIs, urgent actions, session bands, common
    issues, and staff/participant snapshots. All real data, last 30 days."""
    org_id = _require_coordinator_org(current_user)
    supabase = get_supabase_admin()
    since = (app_today() - timedelta(days=30)).isoformat()

    try:
        sessions_resp = (
            supabase.table("sessions")
            .select("id, session_date, compliance_score, worker_id, support_worker_id, owner_user_id, patient_id")
            .eq("organization_id", org_id)
            .gte("session_date", since)
            .not_.is_("compliance_score", "null")
            .execute()
        )
        sessions = sessions_resp.data or []
    except Exception as exc:
        logger.warning("compliance centre overview: session fetch failed: %s", exc)
        sessions = []

    scores = [float(s["compliance_score"]) for s in sessions if s.get("compliance_score") is not None]
    overall_score = round(sum(scores) / len(scores), 1) if scores else 0.0
    compliant = sum(1 for s in scores if s >= 85)
    at_risk = sum(1 for s in scores if 60 <= s < 85)
    non_compliant = sum(1 for s in scores if s < 60)

    incident_stats = await incident_service.get_incident_stats(org_id=org_id, current_user=current_user)

    # ── Common issues: compliance_rule_results (fail/warning), last 30 days ────
    common_issues: list[dict[str, Any]] = []
    try:
        rr_resp = (
            supabase.table("compliance_rule_results")
            .select("rule_id, status, checked_at, sessions!inner(organization_id)")
            .in_("status", ["fail", "warning"])
            .gte("checked_at", since)
            .execute()
        )
        counts: dict[str, int] = {}
        for r in (rr_resp.data or []):
            if (r.get("sessions") or {}).get("organization_id") != org_id:
                continue
            code = r.get("rule_id")
            if code:
                counts[code] = counts.get(code, 0) + 1
        catalog = {r["rule"]: r for r in get_rules_catalog()}
        top = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:4]
        max_count = top[0][1] if top else 1
        for code, count in top:
            label = catalog.get(code, {}).get("label") or code
            common_issues.append({"rule_code": code, "label": label, "count": count, "pct": round(count / max_count * 100)})
    except Exception as exc:
        logger.warning("compliance centre overview: rule results fetch failed: %s", exc)

    # ── Urgent actions: critical incidents, expiring credentials, unsigned agreements ──
    try:
        crit_resp = (
            supabase.table("incidents")
            .select("id, participant_id, user_id, incident_type, incident_date")
            .eq("organization_id", org_id)
            .eq("ndis_reportable", True)
            .in_("status", ["reported", "under_investigation"])
            .order("incident_date", desc=True)
            .execute()
        )
        crit_rows = crit_resp.data or []
    except Exception:
        crit_rows = []

    try:
        warn_date = (app_today() + timedelta(days=30)).isoformat()
        exp_resp = (
            supabase.table("credentials")
            .select("id, user_id, credential_type, expiry_date, status")
            .eq("organization_id", org_id)
            # See coordinator.py's credential_alerts for why this can't filter
            # on the raw `status` column — recomputed live below instead.
            .not_.in_("status", ["rejected", "pending_review"])
            .lte("expiry_date", warn_date)
            .order("expiry_date")
            .execute()
        )
        exp_rows = [
            {**row, "status": live_status(row.get("expiry_date"), row.get("status"))}
            for row in (exp_resp.data or [])
        ]
        exp_rows = [row for row in exp_rows if row["status"] in ("expiring", "expired")]
    except Exception:
        exp_rows = []
    seen_workers: set[str] = set()
    exp_rows_dedup = []
    for r in exp_rows:
        wid = str(r.get("user_id") or "")
        if wid and wid not in seen_workers:
            seen_workers.add(wid)
            exp_rows_dedup.append(r)

    try:
        agr_resp = (
            supabase.table("ndis_plans")
            .select("id, patient_id, agreement_status")
            .eq("organization_id", org_id)
            .eq("agreement_status", "unsigned")
            .execute()
        )
        agr_rows = agr_resp.data or []
    except Exception:
        agr_rows = []

    participant_ids = {str(r.get("participant_id")) for r in crit_rows if r.get("participant_id")}
    participant_ids |= {str(r.get("patient_id")) for r in agr_rows if r.get("patient_id")}
    worker_ids = {str(r.get("user_id")) for r in exp_rows_dedup if r.get("user_id")}
    worker_ids |= {str(r.get("user_id")) for r in crit_rows if r.get("user_id")}

    participants_by_id: dict[str, dict] = {}
    if participant_ids:
        try:
            presp = supabase.table("patients").select("id, full_name").in_("id", list(participant_ids)).execute()
            participants_by_id = {str(p["id"]): p for p in (presp.data or [])}
        except Exception:
            pass

    workers_by_id: dict[str, dict] = {}
    if worker_ids:
        try:
            wresp = supabase.table("users").select("id, full_name").in_("id", list(worker_ids)).execute()
            workers_by_id = {str(w["id"]): w for w in (wresp.data or [])}
        except Exception:
            pass

    urgent: list[dict[str, Any]] = []
    for r in crit_rows:
        pid = str(r.get("participant_id") or "")
        pname = participants_by_id.get(pid, {}).get("full_name") or "Unknown participant"
        urgent.append({
            "severity": "critical",
            "type": "incident",
            "label": f"Restrictive practice — {pname}",
            "detail": _local_day(r.get("incident_date")),
            "link": f"/incident/{r.get('id')}",
        })
    for r in exp_rows_dedup:
        wid = str(r.get("user_id") or "")
        wname = workers_by_id.get(wid, {}).get("full_name") or "Team member"
        try:
            days_left = (date.fromisoformat(str(r["expiry_date"])[:10]) - app_today()).days
        except Exception:
            days_left = None
        urgent.append({
            "severity": "high",
            "type": "credential",
            "label": f"Screening expiring — {wname}",
            "detail": f"{max(days_left, 0)} days" if days_left is not None else "",
            "link": f"/team?workerId={wid}&tab=credentials" if wid else "/team",
        })
    for r in agr_rows:
        pid = str(r.get("patient_id") or "")
        pname = participants_by_id.get(pid, {}).get("full_name") or "Unknown participant"
        urgent.append({
            "severity": "high",
            "type": "agreement",
            "label": f"Service agreement unsigned — {pname}",
            "detail": "",
            "link": f"/patients/{pid}",
        })
    urgent.sort(key=lambda a: 0 if a["severity"] == "critical" else 1)
    urgent = urgent[:5]

    # ── Staff snapshot (top 3 by urgency: RP flag, expiring cred, low score) ──
    scores_by_worker: dict[str, list[float]] = {}
    for s in sessions:
        wid = _worker_id_of(s)
        if wid and s.get("compliance_score") is not None:
            scores_by_worker.setdefault(wid, []).append(float(s["compliance_score"]))

    rp_flag_workers = {str(r.get("user_id")) for r in crit_rows if r.get("user_id")}
    expiry_by_worker = {str(r.get("user_id")): r.get("expiry_date") for r in exp_rows if r.get("user_id")}
    all_worker_ids = set(scores_by_worker.keys()) | set(expiry_by_worker.keys()) | rp_flag_workers
    staff_names: dict[str, str] = {}
    if all_worker_ids:
        try:
            wresp2 = supabase.table("users").select("id, full_name").in_("id", list(all_worker_ids)).execute()
            staff_names = {str(w["id"]): w.get("full_name") for w in (wresp2.data or [])}
        except Exception:
            pass

    staff_snapshot = []
    for wid in all_worker_ids:
        worker_scores = scores_by_worker.get(wid, [])
        avg = round(sum(worker_scores) / len(worker_scores), 1) if worker_scores else None
        staff_snapshot.append({
            "user_id": wid,
            "full_name": staff_names.get(wid) or "Team member",
            "expiry_date": expiry_by_worker.get(wid),
            "avg_score": avg,
            "rp_flag": wid in rp_flag_workers,
        })
    staff_snapshot.sort(key=lambda w: 0 if w["rp_flag"] else (1 if w["expiry_date"] else (2 if (w["avg_score"] or 100) < 60 else 3)))
    staff_snapshot = staff_snapshot[:3]

    # ── Participant snapshot (top 3: unsigned agreement, open flags, low score) ──
    unsigned_ids = {str(r.get("patient_id")) for r in agr_rows if r.get("patient_id")}
    flagged_ids = {str(r.get("participant_id")) for r in crit_rows if r.get("participant_id")}
    participant_scores: dict[str, list[float]] = {}
    for s in sessions:
        pid = str(s.get("patient_id") or "")
        if pid and s.get("compliance_score") is not None:
            participant_scores.setdefault(pid, []).append(float(s["compliance_score"]))

    all_participant_ids = unsigned_ids | flagged_ids | set(participant_scores.keys())
    participant_names: dict[str, str] = {}
    if all_participant_ids:
        try:
            presp2 = supabase.table("patients").select("id, full_name").in_("id", list(all_participant_ids)).execute()
            participant_names = {str(p["id"]): p.get("full_name") for p in (presp2.data or [])}
        except Exception:
            pass

    participant_snapshot = []
    for pid in all_participant_ids:
        pscores = participant_scores.get(pid, [])
        avg_p = round(sum(pscores) / len(pscores), 1) if pscores else None
        participant_snapshot.append({
            "participant_id": pid,
            "full_name": participant_names.get(pid) or "Unknown participant",
            "agreement_unsigned": pid in unsigned_ids,
            "has_flag": pid in flagged_ids,
            "note_quality": avg_p,
        })
    participant_snapshot.sort(key=lambda p: 0 if p["agreement_unsigned"] else (1 if p["has_flag"] else (2 if (p["note_quality"] or 100) < 60 else 3)))
    participant_snapshot = participant_snapshot[:3]

    return {
        "kpis": {
            "overall_score": overall_score,
            "compliant_sessions": compliant,
            "at_risk_sessions": at_risk,
            "open_incidents": incident_stats.get("open", 0),
        },
        "urgent_actions": urgent,
        "bands": {"compliant": compliant, "at_risk": at_risk, "non_compliant": non_compliant},
        "common_issues": common_issues,
        "staff_snapshot": staff_snapshot,
        "participant_snapshot": participant_snapshot,
    }


@router.get("/centre/staff")
async def compliance_centre_staff(current_user: dict = Depends(get_current_user)):
    """Compliance centre — Staff compliance sub-tab: every worker's credential
    status across the 8 fixed columns, avg session score, and RP flag status."""
    org_id = _require_coordinator_org(current_user)
    supabase = get_supabase_admin()
    since = (app_today() - timedelta(days=30)).isoformat()

    try:
        users_resp = (
            supabase.table("users")
            .select("id, full_name, role")
            .eq("organization_id", org_id)
            .eq("role", "support_worker")
            .execute()
        )
        workers = users_resp.data or []
    except Exception as exc:
        logger.warning("compliance centre staff: worker fetch failed: %s", exc)
        workers = []
    worker_ids = [str(w["id"]) for w in workers]

    creds_by_worker: dict[str, dict[str, dict]] = {}
    if worker_ids:
        try:
            creds_resp = (
                supabase.table("credentials")
                .select("user_id, credential_type, expiry_date, status")
                .eq("organization_id", org_id)
                .in_("user_id", worker_ids)
                .execute()
            )
            for row in (creds_resp.data or []):
                wid = str(row.get("user_id") or "")
                ctype = row.get("credential_type")
                if wid and ctype in FIXED_CREDENTIAL_TYPES:
                    creds_by_worker.setdefault(wid, {})[ctype] = {
                        "status": row.get("status"),
                        "expiry_date": row.get("expiry_date"),
                    }
        except Exception as exc:
            logger.warning("compliance centre staff: credential fetch failed: %s", exc)

    scores_by_worker: dict[str, list[float]] = {}
    if worker_ids:
        try:
            sess_resp = (
                supabase.table("sessions")
                .select("worker_id, support_worker_id, owner_user_id, compliance_score")
                .eq("organization_id", org_id)
                .gte("session_date", since)
                .not_.is_("compliance_score", "null")
                .execute()
            )
            for s in (sess_resp.data or []):
                wid = _worker_id_of(s)
                if wid in worker_ids and s.get("compliance_score") is not None:
                    scores_by_worker.setdefault(wid, []).append(float(s["compliance_score"]))
        except Exception as exc:
            logger.warning("compliance centre staff: session fetch failed: %s", exc)

    rp_flag_workers: set[str] = set()
    if worker_ids:
        try:
            inc_resp = (
                supabase.table("incidents")
                .select("user_id")
                .eq("organization_id", org_id)
                .eq("ndis_reportable", True)
                .in_("status", ["reported", "under_investigation"])
                .in_("user_id", worker_ids)
                .execute()
            )
            rp_flag_workers = {str(r.get("user_id")) for r in (inc_resp.data or []) if r.get("user_id")}
        except Exception as exc:
            logger.warning("compliance centre staff: incident fetch failed: %s", exc)

    today = app_today()
    rows = []
    total_expiring = 0
    total_action = 0
    total_compliant = 0
    for w in workers:
        wid = str(w["id"])
        worker_creds = creds_by_worker.get(wid, {})
        expiring_soon = any(
            c.get("status") in ("expiring", "expired") for c in worker_creds.values()
        )
        rp_flag = wid in rp_flag_workers
        worker_scores = scores_by_worker.get(wid, [])
        avg_score = round(sum(worker_scores) / len(worker_scores), 1) if worker_scores else None

        groups = []
        if expiring_soon:
            groups.append("expiring")
            total_expiring += 1
        if rp_flag:
            groups.append("action")
            total_action += 1
        if not expiring_soon and not rp_flag:
            groups.append("compliant")
            total_compliant += 1

        rows.append({
            "user_id": wid,
            "full_name": w.get("full_name") or "Team member",
            "credentials": worker_creds,
            "avg_score": avg_score,
            "rp_flag": rp_flag,
            "groups": groups,
        })

    return {
        "kpis": {
            "total_workers": len(workers),
            "fully_compliant": total_compliant,
            "expiring_credentials": total_expiring,
            "action_required": total_action,
        },
        "fixed_credential_types": FIXED_CREDENTIAL_TYPES,
        "workers": rows,
        "generated_at": today.isoformat(),
    }


@router.get("/centre/participants")
async def compliance_centre_participants(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Compliance centre — Participant compliance sub-tab: agreement status, note
    quality, and open flags per participant."""
    org_id = _require_coordinator_org(current_user)
    supabase = get_supabase_admin()
    since, until = _date_range(date_from, date_to)

    try:
        patients_resp = (
            supabase.table("patients")
            .select("id, full_name, ndis_number, plan_status, ndis_plan_id")
            .eq("organization_id", org_id)
            .execute()
        )
        patients = patients_resp.data or []
    except Exception as exc:
        logger.warning("compliance centre participants: patient fetch failed: %s", exc)
        patients = []
    patient_ids = [str(p["id"]) for p in patients]

    agreements_by_patient: dict[str, dict] = {}
    if patient_ids:
        try:
            plans_resp = (
                supabase.table("ndis_plans")
                .select("patient_id, agreement_status, agreement_signed_at")
                .eq("organization_id", org_id)
                .in_("patient_id", patient_ids)
                .execute()
            )
            for row in (plans_resp.data or []):
                pid = str(row.get("patient_id") or "")
                if pid:
                    agreements_by_patient[pid] = row
        except Exception as exc:
            logger.warning("compliance centre participants: plan fetch failed: %s", exc)

    sessions_by_patient: dict[str, list[float]] = {}
    session_count_by_patient: dict[str, int] = {}
    if patient_ids:
        try:
            sess_resp = (
                supabase.table("sessions")
                .select("patient_id, compliance_score, session_date")
                .eq("organization_id", org_id)
                .gte("session_date", since)
                .lte("session_date", until)
                .in_("patient_id", patient_ids)
                .execute()
            )
            for s in (sess_resp.data or []):
                pid = str(s.get("patient_id") or "")
                if not pid:
                    continue
                session_count_by_patient[pid] = session_count_by_patient.get(pid, 0) + 1
                if s.get("compliance_score") is not None:
                    sessions_by_patient.setdefault(pid, []).append(float(s["compliance_score"]))
        except Exception as exc:
            logger.warning("compliance centre participants: session fetch failed: %s", exc)

    rp_flag_patients: set[str] = set()
    if patient_ids:
        try:
            inc_resp = (
                supabase.table("incidents")
                .select("participant_id")
                .eq("organization_id", org_id)
                .eq("ndis_reportable", True)
                .in_("status", ["reported", "under_investigation"])
                .in_("participant_id", patient_ids)
                .execute()
            )
            rp_flag_patients = {str(r.get("participant_id")) for r in (inc_resp.data or []) if r.get("participant_id")}
        except Exception as exc:
            logger.warning("compliance centre participants: incident fetch failed: %s", exc)

    goal_not_linked_patients: set[str] = set()
    if patient_ids:
        try:
            goals_resp = (
                supabase.table("ndis_goals")
                .select("participant_id, support_category")
                .eq("organization_id", org_id)
                .in_("participant_id", patient_ids)
                .execute()
            )
            for g in (goals_resp.data or []):
                if not g.get("support_category"):
                    goal_not_linked_patients.add(str(g.get("participant_id") or ""))
        except Exception as exc:
            logger.warning("compliance centre participants: goals fetch failed: %s", exc)

    allocations_by_patient: dict[str, str] = {}
    if patient_ids:
        try:
            alloc_resp = (
                supabase.table("practitioner_allocations")
                .select("patient_id, user_id, allocated_role")
                .eq("organization_id", org_id)
                .eq("is_active", True)
                .eq("allocated_role", "support_worker")
                .in_("patient_id", patient_ids)
                .execute()
            )
            worker_ids_needed = set()
            for a in (alloc_resp.data or []):
                pid = str(a.get("patient_id") or "")
                wid = str(a.get("user_id") or "")
                if pid and wid and pid not in allocations_by_patient:
                    allocations_by_patient[pid] = wid
                    worker_ids_needed.add(wid)
            worker_names: dict[str, str] = {}
            if worker_ids_needed:
                wresp = supabase.table("users").select("id, full_name").in_("id", list(worker_ids_needed)).execute()
                worker_names = {str(w["id"]): w.get("full_name") for w in (wresp.data or [])}
            allocations_by_patient = {pid: worker_names.get(wid, "Unassigned") for pid, wid in allocations_by_patient.items()}
        except Exception as exc:
            logger.warning("compliance centre participants: allocation fetch failed: %s", exc)

    rows = []
    total_signed = 0
    all_note_scores: list[float] = []
    total_open_flags = 0
    for p in patients:
        pid = str(p["id"])
        agreement = agreements_by_patient.get(pid, {})
        agreement_status = agreement.get("agreement_status") or "unsigned"
        if agreement_status == "signed":
            total_signed += 1
        p_scores = sessions_by_patient.get(pid, [])
        avg_note = round(sum(p_scores) / len(p_scores), 1) if p_scores else None
        if avg_note is not None:
            all_note_scores.append(avg_note)

        flags = []
        if pid in rp_flag_patients:
            flags.append("rp")
        if agreement_status == "unsigned":
            flags.append("agreement")
        if pid in goal_not_linked_patients:
            flags.append("goal")
        total_open_flags += len(flags)

        groups = []
        if flags:
            groups.append("flags")
        if agreement_status == "unsigned":
            groups.append("agreement")
        if avg_note is not None and avg_note < 70:
            groups.append("lowscore")

        rows.append({
            "participant_id": pid,
            "full_name": p.get("full_name"),
            "ndis_number": p.get("ndis_number"),
            "plan_status": p.get("plan_status"),
            "agreement_status": agreement_status,
            "agreement_signed_at": agreement.get("agreement_signed_at"),
            "sessions_count": session_count_by_patient.get(pid, 0),
            "avg_note_quality": avg_note,
            "flags": flags,
            "worker_name": allocations_by_patient.get(pid, "Unassigned"),
            "groups": groups,
        })

    return {
        "kpis": {
            "total_participants": len(patients),
            "agreements_signed": total_signed,
            "avg_note_quality": round(sum(all_note_scores) / len(all_note_scores), 1) if all_note_scores else 0,
            "open_flags": total_open_flags,
        },
        "participants": rows,
        "date_from": since,
        "date_to": until,
    }


@router.get("/centre/incidents")
async def compliance_centre_incidents(current_user: dict = Depends(get_current_user)):
    """Compliance centre — Incidents sub-tab: read-only list, action buttons link
    to the existing incident pages."""
    org_id = _require_coordinator_org(current_user)
    supabase = get_supabase_admin()

    stats = await incident_service.get_incident_stats(org_id=org_id, current_user=current_user)

    try:
        month_start = app_today().replace(day=1).isoformat()
        inc_resp = (
            supabase.table("incidents")
            .select("id, participant_id, user_id, incident_type, description, status, severity, incident_date, ndis_reportable")
            .eq("organization_id", org_id)
            .order("incident_date", desc=True)
            .limit(50)
            .execute()
        )
        rows = inc_resp.data or []
    except Exception as exc:
        logger.warning("compliance centre incidents: fetch failed: %s", exc)
        rows = []
        month_start = app_today().replace(day=1).isoformat()

    resolved_this_month = sum(
        1 for r in rows
        if r.get("status") == "closed" and _local_day(r.get("incident_date")) >= month_start
    )
    rp_flags = sum(1 for r in rows if r.get("incident_type") == "restrictive_practice" and r.get("status") != "closed")

    participant_ids = {str(r.get("participant_id")) for r in rows if r.get("participant_id")}
    worker_ids = {str(r.get("user_id")) for r in rows if r.get("user_id")}
    participant_names: dict[str, str] = {}
    worker_names: dict[str, str] = {}
    if participant_ids:
        try:
            presp = supabase.table("patients").select("id, full_name").in_("id", list(participant_ids)).execute()
            participant_names = {str(p["id"]): p.get("full_name") for p in (presp.data or [])}
        except Exception:
            pass
    if worker_ids:
        try:
            wresp = supabase.table("users").select("id, full_name").in_("id", list(worker_ids)).execute()
            worker_names = {str(w["id"]): w.get("full_name") for w in (wresp.data or [])}
        except Exception:
            pass

    now = datetime.now(timezone.utc)
    incidents_out = []
    for r in rows:
        pid = str(r.get("participant_id") or "")
        wid = str(r.get("user_id") or "")
        desc = r.get("description") or ""
        due_at = (
            compute_notification_due_at(r)
            if r.get("status") in ("reported", "under_investigation")
            else None
        )
        incidents_out.append({
            "id": r.get("id"),
            "incident_date": r.get("incident_date"),
            "worker_name": worker_names.get(wid) or "Unknown",
            "participant_name": participant_names.get(pid) or "Unknown",
            "incident_type": r.get("incident_type"),
            "description": (desc[:140] + "…") if len(desc) > 140 else desc,
            "status": r.get("status"),
            "ndis_reportable": r.get("ndis_reportable"),
            "notification_due_at": due_at.isoformat() if due_at else None,
            "overdue": bool(due_at and now > due_at),
            "timezone": str(participant_timezone(r, organization_id=org_id)),
        })

    return {
        "kpis": {
            "open_incidents": stats.get("open", 0),
            "rp_flags": rp_flags,
            "resolved_this_month": resolved_this_month,
        },
        "incidents": incidents_out,
    }
