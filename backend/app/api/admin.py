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

import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..core.access import get_user_id, is_super_admin
from ..core.security import get_current_user
from ..services import bug_report_service
from ..services import device_security_service as dss
from ..services import jira_service
from ..services.object_storage import get_evidence_storage_backend
from ..services.supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

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
        try:
            orgs_result = (
                supabase.table("organizations")
                .select(
                    "organization_id, organization_name, name, provider_type, org_type, status, "
                    "plan_tier, team_size, participant_volume, created_at, "
                    "stripe_customer_id, stripe_subscription_id"
                )
                .order("created_at", desc=True)
                .execute()
            )
        except Exception as exc:
            # The list must still work before 189_organization_org_type.sql
            # has actually run against this database — same "never let an
            # optional field block the core read" reasoning as
            # bug_report_service.py's severity-column handling.
            if "org_type" in str(exc).lower() and "column" in str(exc).lower():
                logger.warning("organizations.org_type column missing — listing without it: %s", exc)
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
            else:
                raise
        orgs = orgs_result.data or []
        for o in orgs:
            o.setdefault("org_type", None)

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


class OrganizationTypeUpdate(BaseModel):
    org_type: Literal["aged_care", "disability", "aged_care_disability"]


@router.patch("/organizations/{organization_id}/org-type")
async def update_organization_type(
    organization_id: str, body: OrganizationTypeUpdate, current_user: dict = Depends(get_current_user)
):
    """Sets which service(s) a provider delivers — see 189_organization_org_type.sql
    for why this is a separate field from provider_type."""
    _require_super_admin(current_user)
    try:
        result = (
            get_supabase_admin()
            .table("organizations")
            .update({"org_type": body.org_type})
            .eq("organization_id", organization_id)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Organisation not found.")
        return {"ok": True, "org_type": body.org_type}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not update organisation: {exc}")


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
# duplicated per feature. Bug reports alone carry Jira sync (create,
# outbound/inbound status sync) — feedback is a plain internal list with no
# external integration, so its two endpoints below opt the shared helpers
# out of any Jira behaviour (include_jira=False, sync_jira=False). Bug
# reports also never surface who reported them (include_reporter=False) —
# a report is identified by which org hit it, not which staff member did.

_FEEDBACK_STATUSES = {"open", "in_progress", "resolved"}


class BugReportStatusUpdate(BaseModel):
    status: str


class ImprovementFeedbackStatusUpdate(BaseModel):
    status: str


def _list_cross_org_feedback(
    table: str,
    submitter_column: str,
    select_columns: str,
    include_jira: bool = True,
    include_reporter: bool = True,
) -> list[dict]:
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

    def _org_name(row: dict) -> str:
        # A null organization_id only ever occurs on bug_reports — a Super
        # Admin filed it as "Internal", not on behalf of any provider (see
        # 190_bug_reports_nullable_org.sql and bug_report_service's matching
        # _organization_display_name). improvement_feedback's organization_id
        # is still NOT NULL, so this branch never fires for that table.
        if row.get("organization_id") is None:
            return "Internal — Master Portal"
        return orgs_by_id.get(row["organization_id"], "Unknown organisation")

    # Skipped entirely for bug reports (include_reporter=False) — the Bug
    # Reports view identifies a report by which org hit it, never by which
    # staff member did (that's the individual's private info, not the
    # org's — see bug-reports.tsx's card footer). Not querying "users" at
    # all here, rather than just hiding the name client-side, means that
    # info never leaves the backend for this endpoint in the first place.
    names_by_id: dict[str, str] = {}
    if include_reporter:
        submitter_ids = list({r[submitter_column] for r in rows if r.get(submitter_column)})
        if submitter_ids:
            users_result = supabase.table("users").select("id, full_name, email").in_("id", submitter_ids).execute()
            names_by_id = {
                u["id"]: u.get("full_name") or u.get("email") or "Staff member" for u in (users_result.data or [])
            }

    return [
        {
            **r,
            "organization_name": _org_name(r),
            **(
                {"reporter_name": names_by_id.get(r.get(submitter_column), "Staff member")}
                if include_reporter
                else {}
            ),
            # Built server-side so the frontend never needs to know the
            # Jira site URL itself. Feedback has no Jira integration (see
            # improvement_feedback_service.py) — include_jira=False keeps
            # its rows from claiming a link they don't have.
            "jira_url": (
                jira_service.issue_url(r["jira_issue_key"]) if include_jira and r.get("jira_issue_key") else None
            ),
        }
        for r in rows
    ]


async def _update_feedback_status(
    table: str, record_id: str, new_status: str, not_found_label: str, sync_jira: bool = True
) -> dict:
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
    # a Jira outage block the status update already saved above. Skipped
    # entirely for feedback (sync_jira=False) — it has no Jira integration.
    if sync_jira:
        issue_key = result.data[0].get("jira_issue_key")
        if issue_key:
            await jira_service.transition_issue(issue_key, new_status)

    return {"ok": True, "status": new_status}


class AdminBugReportAttachment(BaseModel):
    mime_type: str
    data: str = Field(description="Base64-encoded file content, optionally with a data: URL prefix.")


class AdminBugReportCreate(BaseModel):
    description: str = Field(min_length=1, max_length=5000)
    page_url: str | None = Field(default=None, max_length=500)
    attachments: list[AdminBugReportAttachment] = Field(default_factory=list)
    severity: str = "low"
    # None files this as "Internal" — about CareCliQ itself, not on behalf
    # of any provider (see 190_bug_reports_nullable_org.sql). A real staff
    # member never sends this field at all — see POST /bug-reports, which
    # always derives organization_id from their own session instead.
    organization_id: str | None = None


@router.post("/bug-reports")
async def create_bug_report(body: AdminBugReportCreate, current_user: dict = Depends(get_current_user)):
    """Lets a Super Admin file a bug report from inside the Master Portal
    itself (ReportBugPanel.tsx) — either "Internal" (organization_id=None)
    or on behalf of a specific provider they pick, unlike POST /bug-reports
    which always scopes to the reporter's own org and requires one to exist."""
    _require_super_admin(current_user)
    reporter_id = get_user_id(current_user)
    if not reporter_id:
        raise HTTPException(status_code=400, detail="User id required.")
    try:
        row = await bug_report_service.create_bug_report(
            body.organization_id,
            reporter_id,
            body.description,
            body.page_url,
            [a.model_dump() for a in body.attachments],
            body.severity,
        )
        return {"id": row["id"], "status": row["status"]}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not file bug report: {exc}")


@router.get("/bug-reports")
async def list_bug_reports(current_user: dict = Depends(get_current_user)):
    """Every bug report across every provider, for the portal's Bug Reports view."""
    _require_super_admin(current_user)
    try:
        reports = _list_cross_org_feedback(
            "bug_reports",
            "reporter_id",
            "id, organization_id, page_url, description, status, severity, jira_issue_key, attachments, created_at, updated_at",
            include_reporter=False,
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
            "id, organization_id, submitted_by, description, status, created_at, updated_at",
            include_jira=False,
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
        return await _update_feedback_status(
            "improvement_feedback", feedback_id, body.status, "Feedback", sync_jira=False
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not update improvement feedback: {exc}")
