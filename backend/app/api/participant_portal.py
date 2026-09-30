"""Participants Portal — the participant-facing counterpart to the staff
app. A portal login can cover more than one participant (a participant
themselves, or a nominee/parent viewing someone they represent), so every
endpoint takes the participant to view as a `participant_id` query argument
and checks it against an active participant_portal_access row for the
caller (participant_portal_access_service.assert_active_access) before
reading anything. Supplying someone else's id gets a 404.

Read-only for now: the portal shows a participant their own profile,
support schedule, service agreement, NDIS plan and invoices. It never writes
to any of those tables — updates still go through the staff-facing flows."""

from __future__ import annotations

import io
import logging
import re
import zipfile
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from ..core.access import get_user_id, get_user_organization_id, is_participant
from ..core.security import get_current_user
from ..services import audit_service, service_agreement_service
from ..services import participant_portal_access_service as access_svc
from ..services.billing_service import INVOICE_FILES_BUCKET
from ..services.participant_intake_service import (
    BUCKET as INTAKE_FILES_BUCKET,
    SIGNED_URL_EXPIRY_SECONDS as INTAKE_SIGNED_URL_EXPIRY_SECONDS,
    TABLE as INTAKES_TABLE,
)
from ..services.supabase_client import get_supabase_admin, signed_storage_url

router = APIRouter(prefix="/participant-portal", tags=["participant-portal"])
logger = logging.getLogger(__name__)

# What the portal may show, as allowlists — the rows are read with "*" (the
# participants table's optional columns vary by deployment, same reason
# participant_service does) and filtered here, so a new clinical or internal
# column can never leak by default. Deliberately excluded: disability and
# clinical fields, behaviour support, risk and worker notes, medications.
_PARTICIPANT_PROFILE_FIELDS = (
    "id", "full_name", "preferred_name", "email", "phone", "address", "date_of_birth",
    "ndis_number", "profile_photo_url", "plan_management_type",
    "emergency_contact_name", "emergency_contact_relationship", "emergency_contact_number",
    "interests", "favourite_activities", "preferred_activities", "daily_routine", "preferred_schedule",
)
# From the intake's public referral form (participant_intakes.web_intake).
# Excluded: who submitted it, referral source/date and free-text notes —
# those are the provider's records, not the participant's profile. Screening
# results, red-flag and meet & greet notes live in other intake columns and
# are never read here.
_INTAKE_PROFILE_FIELDS = (
    "given_name", "surname", "preferred_name", "pronouns", "gender", "preferred_language",
    "street_address", "suburb", "state", "postcode",
    "funding_type", "plan_status", "plan_start", "plan_end",
    "plan_manager_name", "plan_manager_org", "plan_manager_phone", "plan_manager_email",
    "next_of_kin", "presenting_needs",
)
# Invoices a participant may see — drafts are the provider's work in
# progress, and void/cancelled ones were never (or are no longer) owed.
_PORTAL_INVOICE_STATUSES = ("issued", "sent", "overdue", "paid")
# Agreements a participant may see — same reasoning as invoices: a draft is
# the provider's work in progress. Only the fields the Documents page shows
# go out; the row also holds e-signing token/code hashes and the signer's
# IP address and browser, which never leave the server.
_PORTAL_HIDDEN_AGREEMENT_STATUSES = ("draft",)
_AGREEMENT_PORTAL_FIELDS = (
    "id", "agreement_number", "plan_management_type", "start_date", "end_date",
    "status", "participant_signed_at",
)

_ROLE_LABELS = {
    "support_worker": "Support worker",
    "support_coordinator": "Support coordinator",
    "allied_health": "Allied health",
    "managing_director": "Managing director",
}


def _require_portal_user(current_user: dict) -> str:
    if not is_participant(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Participants Portal only.")
    return get_user_id(current_user)


def _require_access(current_user: dict, participant_id: str) -> str:
    user_id = _require_portal_user(current_user)
    access_svc.assert_active_access(user_id, participant_id, get_user_organization_id(current_user))
    return participant_id


async def _log_view(current_user: dict, participant_id: str, what: str, **details) -> None:
    await audit_service.log_action(
        action_type=f"participant_portal.{what}_viewed",
        entity_type="participant",
        entity_id=participant_id,
        user_id=get_user_id(current_user),
        organization_id=get_user_organization_id(current_user),
        details=details or None,
    )


def _require_org(current_user: dict) -> str:
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organisation not found.")
    return org_id


async def _enrich_shifts_with_worker_name(supabase, shifts: list[dict]) -> list[dict]:
    worker_ids = list({str(s["worker_id"]) for s in shifts if s.get("worker_id")})
    if not worker_ids:
        return shifts
    workers = (
        supabase.table("users").select("id, full_name").in_("id", worker_ids).execute()
    )
    names = {str(row["id"]): row.get("full_name") for row in (workers.data or [])}
    return [dict(s, worker_name=names.get(str(s.get("worker_id")))) for s in shifts]


@router.get("/access")
async def list_my_participants(current_user: dict = Depends(get_current_user)):
    """Who this login may view — one entry skips the picker, several show it."""
    user_id = _require_portal_user(current_user)
    return access_svc.list_accessible_participants(user_id, get_user_organization_id(current_user))


def _pick(row: dict | None, fields: tuple[str, ...]) -> dict[str, Any]:
    row = row or {}
    return {k: row[k] for k in fields if row.get(k) not in (None, "", [])}


def _latest_intake(supabase, participant_id: str, org_id: str) -> dict | None:
    result = (
        supabase.table(INTAKES_TABLE)
        .select("web_intake, service_category, service_hours_required, service_agreement_document_path, "
                "service_agreement_document_name, activated_at, updated_at")
        .eq("participant_id", participant_id)
        .eq("organization_id", org_id)
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    return (result.data or [None])[0]


def _support_team(supabase, worker_ids: list[str], assigned_worker_id: str | None) -> list[dict]:
    """Name, photo and role only — never a worker's personal phone or email;
    participants contact their provider, not staff directly."""
    ids = [i for i in dict.fromkeys([assigned_worker_id, *worker_ids]) if i]
    if not ids:
        return []
    rows = (
        supabase.table("users").select("id, full_name, profile_photo_url, role").in_("id", ids).execute()
    ).data or []
    by_id = {str(r["id"]): r for r in rows}
    team = []
    for worker_id in ids:
        r = by_id.get(str(worker_id))
        if not r:
            continue
        team.append({
            "id": str(r["id"]),
            "full_name": r.get("full_name"),
            "profile_photo_url": r.get("profile_photo_url"),
            "role_label": _ROLE_LABELS.get(r.get("role"), "Support team"),
            "is_assigned": str(worker_id) == str(assigned_worker_id),
        })
    return team


def _active_plan(supabase, participant_id: str, org_id: str) -> dict | None:
    """The participant's current NDIS plan (active first, else most recent)."""
    rows = (
        supabase.table("ndis_plans")
        .select("*, plan_budgets(*)")
        .eq("patient_id", participant_id)
        .eq("organization_id", org_id)
        .order("plan_start", desc=True)
        .limit(5)
        .execute()
    ).data or []
    if not rows:
        return None
    return next((r for r in rows if r.get("status") == "active"), rows[0])


@router.get("/overview")
async def get_overview(participant_id: str = Query(...), current_user: dict = Depends(get_current_user)):
    """Everything the portal's home page shows for one participant."""
    _require_access(current_user, participant_id)
    org_id = _require_org(current_user)
    supabase = get_supabase_admin()

    participant = (
        supabase.table("participants")
        .select("*")
        .eq("id", participant_id)
        .eq("organization_id", org_id)
        .maybe_single()
        .execute()
    )
    if not participant or not participant.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found")
    row = participant.data

    intake = _latest_intake(supabase, participant_id, org_id)
    now = datetime.now(timezone.utc).isoformat()
    upcoming = (
        supabase.table("shifts")
        .select("id, scheduled_start, scheduled_end, status, worker_id")
        .eq("participant_id", participant_id)
        .gte("scheduled_start", now)
        .neq("status", "cancelled")
        .order("scheduled_start", desc=False)
        .limit(20)
        .execute()
    ).data or []
    recent = (
        supabase.table("shifts")
        .select("id, scheduled_start, scheduled_end, clocked_in_at, clocked_out_at, status, worker_id")
        .eq("participant_id", participant_id)
        .eq("status", "completed")
        .order("scheduled_start", desc=True)
        .limit(3)
        .execute()
    ).data or []
    plan = _active_plan(supabase, participant_id, org_id)

    await _log_view(current_user, participant_id, "overview")
    return {
        "profile": {
            **_pick(row, _PARTICIPANT_PROFILE_FIELDS),
            "intake": _pick((intake or {}).get("web_intake"), _INTAKE_PROFILE_FIELDS),
            "service_category": (intake or {}).get("service_category") or row.get("service_category"),
            "service_hours_required": (intake or {}).get("service_hours_required"),
            "active_since": (intake or {}).get("activated_at"),
        },
        "support_team": _support_team(
            supabase,
            [str(s["worker_id"]) for s in upcoming if s.get("worker_id")],
            str(row["assigned_worker_id"]) if row.get("assigned_worker_id") else None,
        ),
        "upcoming_shifts": await _enrich_shifts_with_worker_name(supabase, upcoming[:3]),
        "recent_shifts": await _enrich_shifts_with_worker_name(supabase, recent),
        "pinned": {
            "service_agreement": {
                "available": bool((intake or {}).get("service_agreement_document_path")),
                "name": (intake or {}).get("service_agreement_document_name"),
                "updated_at": (intake or {}).get("updated_at"),
            },
            "ndis_plan": {
                "available": bool(plan),
                "plan_start": (plan or {}).get("plan_start"),
                "plan_end": (plan or {}).get("plan_end"),
                "status": (plan or {}).get("status"),
            },
        },
    }


@router.get("/plan")
async def get_my_plan(participant_id: str = Query(...), current_user: dict = Depends(get_current_user)):
    """Current NDIS plan: dates, funding, budget per category and goals."""
    _require_access(current_user, participant_id)
    org_id = _require_org(current_user)
    supabase = get_supabase_admin()
    plan = _active_plan(supabase, participant_id, org_id)
    goals = (
        supabase.table("ndis_goals")
        .select("name, goal_area, description, target_date, status")
        .eq("participant_id", participant_id)
        .eq("organization_id", org_id)
        .neq("status", "archived")
        .order("target_date", desc=False)
        .execute()
    ).data or []
    participant = (
        supabase.table("participants").select("*").eq("id", participant_id).maybe_single().execute()
    )
    await _log_view(current_user, participant_id, "ndis_plan")
    budgets = []
    for b in (plan or {}).get("plan_budgets") or []:
        allocated = float(b.get("allocated_amount") or 0)
        used = float(b.get("used_amount") or 0)
        budgets.append({
            "category": b.get("category"),
            "allocated": allocated,
            "used": used,
            "remaining": round(allocated - used, 2),
        })
    return {
        "plan": {
            "plan_number": plan.get("plan_number"),
            "plan_start": plan.get("plan_start"),
            "plan_end": plan.get("plan_end"),
            "status": plan.get("status"),
            "total_funding": float(plan.get("total_funding") or 0),
            "plan_management_type": plan.get("plan_management_type")
            or ((participant.data or {}) if participant else {}).get("plan_management_type"),
            "budgets": budgets,
        }
        if plan
        else None,
        "goals": goals,
    }


@router.get("/shifts")
async def list_my_shifts(participant_id: str = Query(...), current_user: dict = Depends(get_current_user)):
    _require_access(current_user, participant_id)
    supabase = get_supabase_admin()
    result = (
        supabase.table("shifts")
        .select("id, scheduled_start, scheduled_end, clocked_in_at, clocked_out_at, status, worker_id")
        .eq("participant_id", participant_id)
        .order("scheduled_start", desc=True)
        .limit(200)
        .execute()
    )
    return await _enrich_shifts_with_worker_name(supabase, result.data or [])


def _get_my_signed_intake_document(supabase, participant_id: str, org_id: str) -> dict | None:
    """The onboarding pipeline's "service agreement" stage uploads a signed
    PDF onto the participant's intake record (participant_intakes.
    service_agreement_document_path) — a separate mechanism from the
    structured service_agreements table below, and the only one anything
    actually writes to today. Storage is a private bucket, so the URL is
    always regenerated fresh from the stored path, never trusted as stored
    (it expires) — same pattern as participant_intake_service._with_fresh_document_url."""
    result = (
        supabase.table(INTAKES_TABLE)
        .select("service_agreement_document_path, service_agreement_document_name, updated_at")
        .eq("participant_id", participant_id)
        .eq("organization_id", org_id)
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    row = (result.data or [None])[0]
    if not row or not row.get("service_agreement_document_path"):
        return None
    signed = supabase.storage.from_(INTAKE_FILES_BUCKET).create_signed_url(
        row["service_agreement_document_path"], INTAKE_SIGNED_URL_EXPIRY_SECONDS
    )
    return {
        "name": row.get("service_agreement_document_name"),
        "url": signed.get("signedURL") or signed.get("signed_url"),
        "updated_at": row.get("updated_at"),
    }


@router.get("/service-agreements")
async def list_my_service_agreements(participant_id: str = Query(...), current_user: dict = Depends(get_current_user)):
    _require_access(current_user, participant_id)
    org_id = _require_org(current_user)
    supabase = get_supabase_admin()
    await _log_view(current_user, participant_id, "service_agreement")
    agreements = service_agreement_service.list_service_agreements(participant_id, org_id)
    return {
        "agreements": [
            _pick(a, _AGREEMENT_PORTAL_FIELDS)
            for a in agreements
            if a.get("status") not in _PORTAL_HIDDEN_AGREEMENT_STATUSES
        ],
        "signed_document": _get_my_signed_intake_document(supabase, participant_id, org_id),
    }


@router.get("/invoices")
async def list_my_invoices(participant_id: str = Query(...), current_user: dict = Depends(get_current_user)):
    _require_access(current_user, participant_id)
    org_id = _require_org(current_user)
    supabase = get_supabase_admin()
    result = (
        supabase.table("invoices")
        .select("*")
        .eq("organization_id", org_id)
        .eq("participant_id", participant_id)
        .in_("status", list(_PORTAL_INVOICE_STATUSES))
        .order("created_at", desc=True)
        .execute()
    )
    await _log_view(current_user, participant_id, "invoices", count=len(result.data or []))
    return [
        dict(row, pdf_url=signed_storage_url(INVOICE_FILES_BUCKET, row.get("pdf_path")))
        for row in (result.data or [])
    ]


# ── Invoice PDFs ─────────────────────────────────────────────────────────


def _visible_invoice(supabase, invoice_id: str, participant_id: str, org_id: str) -> dict:
    rows = (
        supabase.table("invoices")
        .select("*")
        .eq("id", invoice_id)
        .eq("organization_id", org_id)
        .eq("participant_id", participant_id)
        .in_("status", list(_PORTAL_INVOICE_STATUSES))
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    return rows[0]


def _invoice_pdf_bytes(supabase, invoice: dict) -> bytes | None:
    """The invoice's PDF: the stored copy if staff generated one, otherwise
    rendered now from the same template — without storing it (the portal is
    read-only). None when neither works: a participant is never sent the
    billing service's placeholder PDF (see billing_service.generate_invoice_pdf)."""
    path = invoice.get("pdf_path")
    if path and not invoice.get("pdf_generation_failed"):
        try:
            return supabase.storage.from_(INVOICE_FILES_BUCKET).download(path)
        except Exception as exc:
            logger.warning("Portal: stored invoice PDF %s unreadable, rendering instead: %s", path, exc)
    try:
        from ..services import billing_service, invoice_service

        return invoice_service.render_invoice_pdf(billing_service._build_template_data(invoice, supabase))
    except Exception:
        logger.exception("Portal: could not render PDF for invoice %s", invoice.get("id"))
        return None


def _safe_filename(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-") or "invoice"


@router.get("/invoices/download-all")
async def download_all_invoices(participant_id: str = Query(...), current_user: dict = Depends(get_current_user)):
    """Every invoice the participant can see, as one .zip. Any invoice whose
    PDF can't be produced is left out and listed in a note inside the zip."""
    _require_access(current_user, participant_id)
    org_id = _require_org(current_user)
    supabase = get_supabase_admin()
    invoices = (
        supabase.table("invoices")
        .select("*")
        .eq("organization_id", org_id)
        .eq("participant_id", participant_id)
        .in_("status", list(_PORTAL_INVOICE_STATUSES))
        .order("created_at", desc=True)
        .limit(200)
        .execute()
    ).data or []
    if not invoices:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="There are no invoices to download.")

    buffer = io.BytesIO()
    included, missing = [], []
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        used_names: set[str] = set()
        for invoice in invoices:
            number = invoice.get("invoice_number") or str(invoice["id"])
            pdf = _invoice_pdf_bytes(supabase, invoice)
            if pdf is None:
                missing.append(number)
                continue
            name = f"{_safe_filename(number)}.pdf"
            while name in used_names:
                name = f"{_safe_filename(number)}-{len(used_names)}.pdf"
            used_names.add(name)
            archive.writestr(name, pdf)
            included.append(number)
        if missing:
            archive.writestr(
                "NOT-INCLUDED.txt",
                "These invoices couldn't be included because their PDF isn't available yet.\n"
                "Please contact your care provider for a copy:\n\n" + "\n".join(missing) + "\n",
            )
    if not included:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Your invoice PDFs aren't available yet. Please contact your care provider.",
        )

    await _log_view(current_user, participant_id, "invoices_zip", included=included, missing=missing)
    filename = f"invoices-{datetime.now(timezone.utc).date().isoformat()}.zip"
    return Response(
        content=buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/invoices/{invoice_id}/pdf")
async def download_invoice_pdf(
    invoice_id: str,
    participant_id: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    _require_access(current_user, participant_id)
    org_id = _require_org(current_user)
    supabase = get_supabase_admin()
    invoice = _visible_invoice(supabase, invoice_id, participant_id, org_id)
    pdf = _invoice_pdf_bytes(supabase, invoice)
    if pdf is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="This invoice's PDF isn't available yet. Please contact your care provider.",
        )
    number = invoice.get("invoice_number") or invoice_id
    await _log_view(current_user, participant_id, "invoice_pdf", invoice_id=invoice_id, invoice_number=number)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{_safe_filename(number)}.pdf"'},
    )
