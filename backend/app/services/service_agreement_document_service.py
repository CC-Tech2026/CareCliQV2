"""Building, signing and rendering NDIS service agreements.

Flow: draft (editable) -> pending_signature (sent to the participant, no
more edits) -> active (signed by both parties). An agreement past its end
date reads as expired. Signing stores the signed PDF and marks the
participant's NDIS plan agreement as signed, so the compliance centre, the
vault and audit readiness all agree.

Agreements signed during onboarding are recorded here too (from_intake), so
a participant who signed on the onboarding board has an agreement on their
record rather than just a PDF on the intake.
"""

from __future__ import annotations

import logging
import pathlib
import re
from datetime import date, datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

from ..core.errors import internal_error_detail
from ..core.timezone import app_today
from . import audit_service, ndis_pricing_service
from .html_pdf_render import HtmlPdfRenderError, render_html_to_pdf
from .organization_branding_service import get_letterhead
from .service_agreement_service import VALID_FREQUENCIES, VALID_LOCATIONS
from .supabase_client import get_supabase_admin
from ..models.billing_period import VALID_PLAN_MANAGEMENT_TYPES

logger = logging.getLogger(__name__)

BUCKET = "service-agreements"
_TEMPLATES_DIR = pathlib.Path(__file__).parent.parent / "templates"
EDITABLE_STATUSES = {"draft"}
SIGNABLE_STATUSES = {"draft", "pending_signature"}

PLAN_MANAGEMENT_LABELS = {"NDIA-managed": "NDIA-managed", "plan-managed": "Plan-managed", "self-managed": "Self-managed"}
FUNDING_TYPE_TO_PLAN_MANAGEMENT = {
    "ndia_managed": "NDIA-managed", "plan_managed": "plan-managed", "self_managed": "self-managed",
}
LOCATION_LABELS = {
    "home": "at home", "school": "at school", "preschool": "at preschool",
    "clinic": "at a clinic", "other": "in the community",
}
FREQUENCY_LABELS = {"weekly": "Weekly", "fortnightly": "Fortnightly", "monthly": "Monthly", "as_scheduled": "As scheduled"}
# NDIS unit of measure -> (singular, plural) shown next to a quantity.
UNIT_LABELS = {
    "H": ("hr", "hrs"), "HOUR": ("hr", "hrs"), "D": ("day", "days"), "WK": ("week", "weeks"),
    "MON": ("month", "months"), "YR": ("year", "years"),
}
HOUR_UNITS = {"H", "HOUR"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _money(value: float) -> str:
    return f"${value:,.2f}"


def _fmt_date(value: Any) -> Optional[str]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10]).strftime("%-d %b %Y")
    except ValueError:
        return str(value)


def quantity_label(quantity: float, unit: Optional[str]) -> str:
    qty = f"{quantity:,.2f}".rstrip("0").rstrip(".")
    labels = UNIT_LABELS.get((unit or "").upper())
    if not labels:
        return qty
    return f"{qty} {labels[0] if quantity == 1 else labels[1]}"


def effective_status(agreement: dict[str, Any], today: Optional[date] = None) -> str:
    """An active agreement past its end date is expired, whatever the stored
    status says — nothing flips it on a schedule."""
    status = agreement.get("status") or "draft"
    end = agreement.get("end_date")
    if status == "active" and end and str(end)[:10] < (today or app_today()).isoformat():
        return "expired"
    return status


# ── Numbering ────────────────────────────────────────────────────────────


def next_agreement_number(org_id: str, year: int, supabase=None) -> str:
    supabase = supabase or get_supabase_admin()
    prefix = f"SA-{year}-"
    rows = (
        supabase.table("service_agreements").select("agreement_number")
        .eq("organization_id", org_id).like("agreement_number", f"{prefix}%").execute()
    ).data or []
    highest = 0
    for row in rows:
        match = re.fullmatch(rf"{re.escape(prefix)}(\d+)", str(row.get("agreement_number") or ""))
        if match:
            highest = max(highest, int(match.group(1)))
    return f"{prefix}{highest + 1:04d}"


def _insert_with_number(payload: dict[str, Any], org_id: str) -> dict[str, Any]:
    """Two agreements created at once could pick the same number; the
    unique index rejects the second, which then takes the next one."""
    supabase = get_supabase_admin()
    year = app_today().year
    for _ in range(4):
        payload["agreement_number"] = next_agreement_number(org_id, year, supabase)
        try:
            result = supabase.table("service_agreements").insert(payload).execute()
        except Exception as exc:
            if "uq_service_agreements_number" in str(exc) or "duplicate key" in str(exc):
                continue
            raise
        if result.data:
            return result.data[0]
    raise HTTPException(status_code=409, detail="Couldn't allocate an agreement number — try again.")


# ── Drafts ───────────────────────────────────────────────────────────────


async def _priced_lines(org_id: str, start_date: str, supports: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not supports:
        raise HTTPException(status_code=422, detail="Add at least one support.")
    lines = []
    for index, line in enumerate(supports):
        code = str(line.get("support_item_code") or "").strip()
        quantity = float(line.get("quantity") or 0)
        if not code:
            raise HTTPException(status_code=422, detail=f"Support {index + 1}: choose an NDIS support item.")
        if quantity <= 0:
            raise HTTPException(status_code=422, detail=f"Support {index + 1}: quantity must be more than zero.")
        location = line.get("location")
        if location is not None and location not in VALID_LOCATIONS:
            raise HTTPException(status_code=422, detail=f"Support {index + 1}: unknown location.")
        frequency = line.get("frequency")
        if frequency is not None and frequency not in VALID_FREQUENCIES:
            raise HTTPException(status_code=422, detail=f"Support {index + 1}: unknown frequency.")
        item = await ndis_pricing_service.resolve_price(code, org_id, start_date)
        if not item:
            raise HTTPException(
                status_code=422,
                detail=f"{code} isn't in the NDIS price catalogue for {_fmt_date(start_date)}.",
            )
        limit = item.get("effective_price")
        limit = float(limit) if limit is not None else None
        rate = line.get("rate")
        rate = float(rate) if rate is not None else limit
        if rate is None:
            raise HTTPException(
                status_code=422,
                detail=f"{item.get('name') or code} has no price limit — enter the quoted rate.",
            )
        if rate < 0:
            raise HTTPException(status_code=422, detail=f"Support {index + 1}: rate can't be negative.")
        if limit is not None and rate > limit + 0.005:
            raise HTTPException(
                status_code=422,
                detail=f"{item.get('name') or code}: {_money(rate)} is above the NDIS price limit of {_money(limit)}.",
            )
        unit = str(item.get("unit") or "H").upper()
        total = round(quantity * rate, 2)
        lines.append({
            "support_item_code": code,
            "item_name": item.get("name"),
            "unit": unit,
            "quantity": quantity,
            "rate": round(rate, 2),
            "total_funding": total,
            "total_hours_allocated": quantity if unit in HOUR_UNITS else None,
            "location": location,
            "frequency": frequency,
            "sort_order": index,
        })
    return lines


def _agreement_fields(data: dict[str, Any]) -> dict[str, Any]:
    pmt = data.get("plan_management_type")
    if pmt not in VALID_PLAN_MANAGEMENT_TYPES:
        raise HTTPException(status_code=422, detail="Choose how the plan is managed.")
    start, end = data.get("start_date"), data.get("end_date")
    if not start or not end:
        raise HTTPException(status_code=422, detail="Set the agreement start and end dates.")
    if str(end) < str(start):
        raise HTTPException(status_code=422, detail="The end date is before the start date.")
    fee = data.get("cancellation_fee_percentage")
    if fee is not None and not (0 <= float(fee) <= 100):
        raise HTTPException(status_code=422, detail="Cancellation fee must be between 0 and 100%.")
    return {
        "plan_management_type": pmt,
        "plan_manager_name": (data.get("plan_manager_name") or "").strip() or None,
        "plan_manager_email": (data.get("plan_manager_email") or "").strip() or None,
        "start_date": str(start),
        "end_date": str(end),
        "includes_price_adjustment_clause": bool(data.get("includes_price_adjustment_clause")),
        "gst_treatment_basis": (data.get("gst_treatment_basis") or "").strip() or None,
        "cancellation_notice_hours": data.get("cancellation_notice_hours"),
        "cancellation_fee_percentage": fee,
    }


def get_agreement(org_id: str, agreement_id: str) -> dict[str, Any]:
    rows = (
        get_supabase_admin().table("service_agreements").select("*, service_agreement_supports(*)")
        .eq("organization_id", org_id).eq("id", agreement_id).limit(1).execute()
    ).data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Service agreement not found.")
    agreement = rows[0]
    agreement["service_agreement_supports"] = sorted(
        agreement.get("service_agreement_supports") or [], key=lambda s: s.get("sort_order") or 0,
    )
    return agreement


def _replace_lines(agreement_id: str, lines: list[dict[str, Any]]) -> None:
    supabase = get_supabase_admin()
    supabase.table("service_agreement_supports").delete().eq("service_agreement_id", agreement_id).execute()
    supabase.table("service_agreement_supports").insert(
        [{**line, "service_agreement_id": agreement_id} for line in lines]
    ).execute()


async def create_draft(participant_id: str, org_id: str, user_id: Optional[str], data: dict[str, Any]) -> dict[str, Any]:
    fields = _agreement_fields(data)
    lines = await _priced_lines(org_id, fields["start_date"], data.get("supports") or [])
    agreement = _insert_with_number({
        **fields,
        "organization_id": org_id,
        "participant_id": participant_id,
        "status": "draft",
        "created_by": user_id,
    }, org_id)
    _replace_lines(agreement["id"], lines)
    await audit_service.log_action(
        action_type="service_agreement.drafted", entity_type="service_agreement", entity_id=agreement["id"],
        user_id=user_id, organization_id=org_id,
        after_state={"agreement_number": agreement.get("agreement_number"), "participant_id": participant_id,
                     "total": round(sum(line["total_funding"] for line in lines), 2)},
    )
    return get_agreement(org_id, agreement["id"])


async def update_draft(org_id: str, agreement_id: str, user_id: Optional[str], data: dict[str, Any]) -> dict[str, Any]:
    existing = get_agreement(org_id, agreement_id)
    if existing.get("status") not in EDITABLE_STATUSES:
        raise HTTPException(status_code=409, detail="Only a draft can be edited. Start a new agreement to change a sent or signed one.")
    fields = _agreement_fields(data)
    lines = await _priced_lines(org_id, fields["start_date"], data.get("supports") or [])
    get_supabase_admin().table("service_agreements").update({**fields, "updated_at": _now()}) \
        .eq("id", agreement_id).eq("organization_id", org_id).execute()
    _replace_lines(agreement_id, lines)
    await audit_service.log_action(
        action_type="service_agreement.draft_updated", entity_type="service_agreement", entity_id=agreement_id,
        user_id=user_id, organization_id=org_id,
        after_state={"total": round(sum(line["total_funding"] for line in lines), 2)},
    )
    return get_agreement(org_id, agreement_id)


async def delete_draft(org_id: str, agreement_id: str, user_id: Optional[str]) -> None:
    existing = get_agreement(org_id, agreement_id)
    if existing.get("status") != "draft":
        raise HTTPException(status_code=409, detail="Only a draft can be deleted.")
    get_supabase_admin().table("service_agreements").delete().eq("id", agreement_id).eq("organization_id", org_id).execute()
    await audit_service.log_action(
        action_type="service_agreement.draft_deleted", entity_type="service_agreement", entity_id=agreement_id,
        user_id=user_id, organization_id=org_id, before_state={"agreement_number": existing.get("agreement_number")},
    )


async def send_for_signature(org_id: str, agreement_id: str, user_id: Optional[str]) -> dict[str, Any]:
    existing = get_agreement(org_id, agreement_id)
    if existing.get("status") != "draft":
        raise HTTPException(status_code=409, detail="This agreement has already been sent.")
    if not existing.get("service_agreement_supports"):
        raise HTTPException(status_code=422, detail="Add at least one support before sending.")
    get_supabase_admin().table("service_agreements").update({
        "status": "pending_signature", "sent_at": _now(), "updated_at": _now(),
    }).eq("id", agreement_id).eq("organization_id", org_id).execute()
    await audit_service.log_action(
        action_type="service_agreement.sent_for_signature", entity_type="service_agreement", entity_id=agreement_id,
        user_id=user_id, organization_id=org_id,
    )
    return get_agreement(org_id, agreement_id)


def mark_plan_agreement_signed(org_id: str, participant_id: str, start: str, end: Optional[str], signed_at: str) -> None:
    """The compliance centre reads agreement status off the NDIS plan; mark
    the plan(s) this agreement covers as signed."""
    try:
        query = (
            get_supabase_admin().table("ndis_plans")
            .update({"agreement_status": "signed", "agreement_signed_at": signed_at})
            .eq("organization_id", org_id).eq("patient_id", participant_id)
            .gte("plan_end", start)
        )
        if end:
            query = query.lte("plan_start", end)
        query.execute()
    except Exception as exc:
        logger.warning("Couldn't update NDIS plan agreement status for %s: %s", participant_id, exc)


async def sign(
    org_id: str,
    agreement_id: str,
    user_id: Optional[str],
    *,
    provider_name: str,
    provider_signature_png: str,
    participant_name: str,
    participant_signature_png: str,
) -> dict[str, Any]:
    existing = get_agreement(org_id, agreement_id)
    if existing.get("status") not in SIGNABLE_STATUSES:
        raise HTTPException(status_code=409, detail="This agreement has already been signed.")
    if not existing.get("service_agreement_supports"):
        raise HTTPException(status_code=422, detail="Add at least one support before signing.")
    for label, value in (("Provider name", provider_name), ("Participant name", participant_name)):
        if not (value or "").strip():
            raise HTTPException(status_code=422, detail=f"{label} is required.")
    for label, png in (("Provider", provider_signature_png), ("Participant", participant_signature_png)):
        if not str(png or "").startswith("data:image/png;base64,") or len(png) > 400_000:
            raise HTTPException(status_code=422, detail=f"{label} signature is missing.")

    now = _now()
    signed = {
        **existing,
        "provider_signed_name": provider_name.strip(), "provider_signed_at": now,
        "provider_signature_png": provider_signature_png,
        "participant_signed_name": participant_name.strip(), "participant_signed_at": now,
        "participant_signature_png": participant_signature_png,
        "status": "active",
    }
    pdf = render_agreement_pdf(org_id, signed)
    path = f"{org_id}/{agreement_id}/{existing.get('agreement_number') or agreement_id}-signed.pdf"
    try:
        get_supabase_admin().storage.from_(BUCKET).upload(path, pdf, {"content-type": "application/pdf", "upsert": "true"})
    except Exception as exc:
        raise HTTPException(status_code=502, detail=internal_error_detail("Couldn't store the signed agreement", exc))

    get_supabase_admin().table("service_agreements").update({
        "status": "active",
        "provider_signed_name": signed["provider_signed_name"], "provider_signed_at": now,
        "provider_signature_png": provider_signature_png,
        "participant_signed_name": signed["participant_signed_name"], "participant_signed_at": now,
        "participant_signature_png": participant_signature_png,
        "signed_by": signed["participant_signed_name"], "signed_date": app_today().isoformat(),
        "document_bucket": BUCKET, "document_path": path,
        "updated_at": now,
    }).eq("id", agreement_id).eq("organization_id", org_id).execute()
    mark_plan_agreement_signed(org_id, str(existing["participant_id"]), str(existing["start_date"]), existing.get("end_date"), now)
    await audit_service.log_action(
        action_type="service_agreement.signed", entity_type="service_agreement", entity_id=agreement_id,
        user_id=user_id, organization_id=org_id,
        after_state={"provider_signed_name": signed["provider_signed_name"],
                     "participant_signed_name": signed["participant_signed_name"], "document_path": path},
    )
    return get_agreement(org_id, agreement_id)


# ── Onboarding hand-over ────────────────────────────────────────────────


def from_intake(intake: dict[str, Any], participant_id: str) -> Optional[dict[str, Any]]:
    """Record the agreement signed on the onboarding board against the new
    participant. Idempotent per intake. Never blocks activation."""
    if not intake.get("provider_signed_at") and not intake.get("family_signed_at"):
        return None
    org_id = intake["organization_id"]
    supabase = get_supabase_admin()
    try:
        existing = (
            supabase.table("service_agreements").select("id").eq("intake_id", intake["id"]).limit(1).execute()
        ).data or []
        if existing:
            return existing[0]
        web = intake.get("web_intake") or {}
        # The active agreement's plan management type drives invoice routing
        # (billing_period_service), so never guess it: use what the intake or
        # the participant record says, or record nothing.
        plan_management = FUNDING_TYPE_TO_PLAN_MANAGEMENT.get(web.get("funding_type"))
        if not plan_management:
            row = (
                supabase.table("participants").select("plan_management_type")
                .eq("id", participant_id).limit(1).execute()
            ).data or []
            recorded = (row[0] if row else {}).get("plan_management_type")
            plan_management = recorded if recorded in VALID_PLAN_MANAGEMENT_TYPES else None
        if not plan_management:
            logger.info("Intake %s has no plan management type; not recording its agreement", intake.get("id"))
            return None
        start = intake.get("plan_start_date") or app_today().isoformat()
        created = _insert_with_number({
            "organization_id": org_id,
            "participant_id": participant_id,
            "intake_id": intake["id"],
            "plan_management_type": plan_management,
            "plan_manager_name": web.get("plan_manager_org") or web.get("plan_manager_name"),
            "plan_manager_email": web.get("plan_manager_email"),
            "start_date": start,
            "end_date": intake.get("plan_end_date"),
            "status": "active",
            "signed_by": intake.get("family_signed_name"),
            "signed_date": str(intake.get("family_signed_at") or "")[:10] or None,
            "provider_signed_name": intake.get("provider_signed_name"),
            "provider_signed_at": intake.get("provider_signed_at"),
            "provider_signature_png": intake.get("provider_signature_png"),
            "participant_signed_name": intake.get("family_signed_name"),
            "participant_signed_at": intake.get("family_signed_at"),
            "participant_signature_png": intake.get("family_signature_png"),
            "document_bucket": "participant-intake-files" if intake.get("signed_document_path") else None,
            "document_path": intake.get("signed_document_path"),
        }, org_id)
        if intake.get("family_signed_at"):
            mark_plan_agreement_signed(org_id, participant_id, start, intake.get("plan_end_date"), intake["family_signed_at"])
        return created
    except Exception as exc:
        logger.warning("Couldn't record the onboarding service agreement for intake %s: %s", intake.get("id"), exc)
        return None


# ── Rendering ────────────────────────────────────────────────────────────


def _participant(org_id: str, participant_id: str) -> dict[str, Any]:
    rows = (
        get_supabase_admin().table("participants").select("full_name, ndis_number, date_of_birth")
        .eq("organization_id", org_id).eq("id", participant_id).limit(1).execute()
    ).data or []
    return rows[0] if rows else {"full_name": "Participant"}


def document_context(org: dict[str, Any], agreement: dict[str, Any], participant: dict[str, Any]) -> dict[str, Any]:
    lines = []
    total = 0.0
    for s in agreement.get("service_agreement_supports") or []:
        quantity = float(s.get("quantity") or s.get("total_hours_allocated") or 0)
        rate = s.get("rate") if s.get("rate") is not None else s.get("negotiated_rate")
        line_total = float(s.get("total_funding") or (quantity * float(rate) if rate is not None else 0))
        total += line_total
        detail = [FREQUENCY_LABELS.get(s.get("frequency") or ""), LOCATION_LABELS.get(s.get("location") or ""), s.get("support_item_code")]
        lines.append({
            "name": s.get("item_name") or s.get("support_item_code"),
            "detail": " · ".join(d for d in detail if d),
            "quantity_label": quantity_label(quantity, s.get("unit")) if quantity else "—",
            "rate_label": _money(float(rate)) if rate is not None else "—",
            "total_label": _money(line_total),
        })
    start, end = _fmt_date(agreement.get("start_date")), _fmt_date(agreement.get("end_date"))
    return {
        "org": org,
        "agreement": agreement,
        "participant": {**participant, "date_of_birth": _fmt_date(participant.get("date_of_birth"))},
        "plan_management_label": PLAN_MANAGEMENT_LABELS.get(agreement.get("plan_management_type"), agreement.get("plan_management_type") or "—"),
        "period": f"{start} to {end}" if end else f"From {start}",
        "supports": lines,
        "total_label": _money(total),
        "provider_signed_on": _fmt_date(agreement.get("provider_signed_at")),
        "participant_signed_on": _fmt_date(agreement.get("participant_signed_at")),
        "draft": agreement.get("status") == "draft",
    }


def render_agreement_html(org_id: str, agreement: dict[str, Any]) -> str:
    from jinja2 import Environment, FileSystemLoader, select_autoescape

    env = Environment(loader=FileSystemLoader(str(_TEMPLATES_DIR)), autoescape=select_autoescape(["html"]))
    context = document_context(get_letterhead(org_id), agreement, _participant(org_id, str(agreement["participant_id"])))
    return env.get_template("service_agreement.html").render(**context)


def render_agreement_pdf(org_id: str, agreement: dict[str, Any]) -> bytes:
    try:
        return render_html_to_pdf(render_agreement_html(org_id, agreement), base_url=str(_TEMPLATES_DIR))
    except HtmlPdfRenderError as exc:
        raise HTTPException(status_code=502, detail=internal_error_detail("Couldn't generate the service agreement", exc))


def agreement_document(org_id: str, agreement_id: str) -> tuple[str, bytes]:
    """The stored signed copy when there is one, otherwise rendered now
    (a draft carries a DRAFT watermark)."""
    agreement = get_agreement(org_id, agreement_id)
    name = f"service-agreement-{agreement.get('agreement_number') or agreement_id[:8]}.pdf"
    bucket, path = agreement.get("document_bucket"), agreement.get("document_path")
    if bucket and path:
        try:
            return name, get_supabase_admin().storage.from_(bucket).download(path)
        except Exception as exc:
            logger.warning("Stored agreement %s unavailable, rendering instead: %s", agreement_id, exc)
    return name, render_agreement_pdf(org_id, agreement)
