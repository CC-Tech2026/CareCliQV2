"""Super Admin Portal — CareCliQ's own vendor-side view across every
provider organisation. Every endpoint here is the one deliberate place in
the whole backend allowed to read/act across tenants; everywhere else in
the app scopes by the caller's own organization_id.

HARD BOUNDARY — B2B account data only, never clinical/participant data:

  ALLOWED   — organizations, users (a provider's own staff/business
              accounts: name, email, role, login activity), plan/status,
              billing (Stripe ids), aggregate usage buckets (team_size,
              participant_volume — coarse strings the provider chose at
              signup, not a live participant list).

  FORBIDDEN — patients, sessions, ndis_plans, incidents, credentials,
              shifts, or any other table holding an actual participant's
              name, NDIS number, goals, notes, or health information.
              CareCliQ staff manage the business relationship, not the
              provider's clients — a support engineer debugging an error
              should see "Error 500, Org abc-123", never the participant
              record that error happened to touch.

  Before adding a new query here, ask: does this touch a provider's own
  clients rather than the provider's account? If yes, it doesn't belong
  in this file — full stop, no exceptions for "just this one field"."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.access import is_super_admin
from ..core.security import get_current_user
from ..services import device_security_service as dss
from ..services import jira_service
from ..services.object_storage import get_evidence_storage_backend
from ..services.supabase_client import get_supabase_admin

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_super_admin(user: dict) -> None:
    if not is_super_admin(user):
        raise HTTPException(status_code=403, detail="Super admin access required.")


@router.get("/organizations")
async def list_organizations(current_user: dict = Depends(get_current_user)):
    """Every provider org on the platform, for the portal's list view."""
    _require_super_admin(current_user)
    supabase = get_supabase_admin()
    try:
        orgs_result = (
            supabase.table("organizations")
            .select(
                "organization_id, organization_name, name, provider_type, status, "
                "plan_tier, team_size, participant_volume, created_at, "
                "stripe_customer_id, stripe_subscription_id"
            )
            .order("created_at", desc=True)
            .execute()
        )
        orgs = orgs_result.data or []

        org_ids = [o["organization_id"] for o in orgs if o.get("organization_id")]
        counts_by_org: dict[str, int] = {}
        if org_ids:
            users_result = (
                supabase.table("users")
                .select("organization_id")
                .in_("organization_id", org_ids)
                .execute()
            )
            for row in users_result.data or []:
                oid = row.get("organization_id")
                if oid:
                    counts_by_org[oid] = counts_by_org.get(oid, 0) + 1

        return [
            {
                **o,
                "display_name": o.get("organization_name") or o.get("name") or "Unnamed organisation",
                "status": o.get("status") or "active",
                "user_count": counts_by_org.get(o.get("organization_id"), 0),
            }
            for o in orgs
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load organisations: {exc}")


@router.get("/organizations/{organization_id}")
async def get_organization(organization_id: str, current_user: dict = Depends(get_current_user)):
    """One provider's full detail — org fields plus its users — for the portal's detail view."""
    _require_super_admin(current_user)
    supabase = get_supabase_admin()
    try:
        org_result = (
            supabase.table("organizations")
            .select("*")
            .eq("organization_id", organization_id)
            .maybe_single()
            .execute()
        )
        org = org_result.data if org_result else None
        if not org:
            raise HTTPException(status_code=404, detail="Organisation not found.")

        users_result = (
            supabase.table("users")
            .select("id, full_name, email, role, is_active, created_at, last_login")
            .eq("organization_id", organization_id)
            .order("created_at")
            .execute()
        )
        return {
            **org,
            "display_name": org.get("organization_name") or org.get("name") or "Unnamed organisation",
            "status": org.get("status") or "active",
            "users": users_result.data or [],
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load organisation: {exc}")


@router.post("/organizations/{organization_id}/suspend")
async def suspend_organization(organization_id: str, current_user: dict = Depends(get_current_user)):
    """Locks the provider out immediately — sets status and revokes every
    live session for that org's users in the same action, so it takes
    effect on their very next request, not just their next login."""
    _require_super_admin(current_user)
    supabase = get_supabase_admin()
    try:
        result = (
            supabase.table("organizations")
            .update({"status": "suspended"})
            .eq("organization_id", organization_id)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Organisation not found.")
        revoked_count = dss.revoke_all_sessions_for_org(organization_id)
        return {"ok": True, "status": "suspended", "sessions_revoked": revoked_count}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not suspend organisation: {exc}")


@router.post("/organizations/{organization_id}/activate")
async def activate_organization(organization_id: str, current_user: dict = Depends(get_current_user)):
    """Restores access — the org's users will need to log in again since
    suspension already revoked their sessions, which is expected."""
    _require_super_admin(current_user)
    supabase = get_supabase_admin()
    try:
        result = (
            supabase.table("organizations")
            .update({"status": "active"})
            .eq("organization_id", organization_id)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Organisation not found.")
        return {"ok": True, "status": "active"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not activate organisation: {exc}")


# Bug reports & Improvements/Feedback — staff-submitted, via
# /api/bug-reports and /api/improvement-feedback respectively (see
# bug_reports.py and improvement_feedback.py). Cross-org listing/triage for
# both lives here, same as everything else in this file: a provider's own
# coordinators/MD never see these, only CareCliQ. The two tables share an
# identical shape (org, submitter, description, status), so the query and
# status-update logic is factored into shared helpers below rather than
# duplicated per feature.

_FEEDBACK_STATUSES = {"open", "in_progress", "resolved"}


class BugReportStatusUpdate(BaseModel):
    status: str


class ImprovementFeedbackStatusUpdate(BaseModel):
    status: str


def _list_cross_org_feedback(table: str, submitter_column: str, select_columns: str) -> list[dict]:
    supabase = get_supabase_admin()
    rows = (
        supabase.table(table).select(select_columns).order("created_at", desc=True).execute()
    ).data or []

    org_ids = list({r["organization_id"] for r in rows if r.get("organization_id")})
    orgs_by_id: dict[str, str] = {}
    if org_ids:
        orgs_result = (
            supabase.table("organizations")
            .select("organization_id, organization_name, name")
            .in_("organization_id", org_ids)
            .execute()
        )
        orgs_by_id = {
            o["organization_id"]: o.get("organization_name") or o.get("name") or "Unnamed organisation"
            for o in (orgs_result.data or [])
        }

    submitter_ids = list({r[submitter_column] for r in rows if r.get(submitter_column)})
    names_by_id: dict[str, str] = {}
    if submitter_ids:
        users_result = supabase.table("users").select("id, full_name, email").in_("id", submitter_ids).execute()
        names_by_id = {
            u["id"]: u.get("full_name") or u.get("email") or "Staff member" for u in (users_result.data or [])
        }

    return [
        {
            **r,
            "organization_name": orgs_by_id.get(r.get("organization_id"), "Unknown organisation"),
            "reporter_name": names_by_id.get(r.get(submitter_column), "Staff member"),
            # Built server-side so the frontend never needs to know the
            # Jira site URL itself.
            "jira_url": jira_service.issue_url(r["jira_issue_key"]) if r.get("jira_issue_key") else None,
        }
        for r in rows
    ]


async def _update_feedback_status(table: str, record_id: str, new_status: str, not_found_label: str) -> dict:
    if new_status not in _FEEDBACK_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status.")
    result = (
        get_supabase_admin()
        .table(table)
        .update({"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", record_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail=f"{not_found_label} not found.")

    # Best-effort — keep the linked Jira issue's status in sync. Never lets
    # a Jira outage block the status update already saved above.
    issue_key = result.data[0].get("jira_issue_key")
    if issue_key:
        await jira_service.transition_issue(issue_key, new_status)

    return {"ok": True, "status": new_status}


@router.get("/bug-reports")
async def list_bug_reports(current_user: dict = Depends(get_current_user)):
    """Every bug report across every provider, for the portal's Bug Reports view."""
    _require_super_admin(current_user)
    try:
        reports = _list_cross_org_feedback(
            "bug_reports",
            "reporter_id",
            "id, organization_id, reporter_id, page_url, description, status, severity, jira_issue_key, attachments, created_at, updated_at",
        )
        # Attachment URLs are signed and expire — generated fresh on every
        # read rather than stored, so a report opened weeks later still
        # has working links (see 183_bug_report_attachments.sql). Only
        # touches storage when at least one report actually has an
        # attachment, so the common no-attachments case skips it entirely.
        if any(r.get("attachments") for r in reports):
            backend = get_evidence_storage_backend()
            for report in reports:
                for attachment in report.get("attachments") or []:
                    attachment["url"] = backend.signed_url(attachment["storage_path"])
        return reports
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load bug reports: {exc}")


@router.patch("/bug-reports/{report_id}/status")
async def update_bug_report_status(
    report_id: str, body: BugReportStatusUpdate, current_user: dict = Depends(get_current_user)
):
    """Moves a report through Open -> In Progress -> Resolved."""
    _require_super_admin(current_user)
    try:
        return await _update_feedback_status("bug_reports", report_id, body.status, "Bug report")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not update bug report: {exc}")


@router.get("/improvement-feedback")
async def list_improvement_feedback(current_user: dict = Depends(get_current_user)):
    """Every improvement/feature-request submission across every provider,
    for the portal's Improvements & Feedback view."""
    _require_super_admin(current_user)
    try:
        return _list_cross_org_feedback(
            "improvement_feedback",
            "submitted_by",
            "id, organization_id, submitted_by, description, status, jira_issue_key, created_at, updated_at",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load improvement feedback: {exc}")


@router.patch("/improvement-feedback/{feedback_id}/status")
async def update_improvement_feedback_status(
    feedback_id: str, body: ImprovementFeedbackStatusUpdate, current_user: dict = Depends(get_current_user)
):
    """Moves a submission through Open -> In Progress -> Resolved."""
    _require_super_admin(current_user)
    try:
        return await _update_feedback_status("improvement_feedback", feedback_id, body.status, "Feedback")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not update improvement feedback: {exc}")
