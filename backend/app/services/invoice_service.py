"""
NDIS Invoice Generation Service

Handles invoice creation, line item aggregation, and PDF export for NDIS billing.
Integrates with pricing model and task completion tracking for accurate billing.
"""

from __future__ import annotations
from typing import Any, Dict, List, Optional
from datetime import date, datetime, timedelta
from decimal import Decimal
import logging
import os
import pathlib

from .supabase_client import get_supabase_admin
from . import billing_period_service

logger = logging.getLogger(__name__)


class InvoiceGenerationError(Exception):
    """Invoice generation specific error."""
    pass


def _safe_decimal(value: Any) -> Decimal:
    """Safely convert value to Decimal."""
    try:
        return Decimal(str(value)) if value else Decimal("0")
    except:
        return Decimal("0")


def generate_invoice_number(org_id: str, participant_id: str, period_end: date) -> str:
    """Generate unique invoice number: ORG-PART-YYYYMM-SEQ."""
    year_month = period_end.strftime("%Y%m")
    short_org = org_id[:8].upper()
    short_part = participant_id[:8].upper()
    timestamp = int(datetime.now().timestamp()) % 10000
    return f"INV-{short_org[:4]}-{short_part[:4]}-{year_month}-{timestamp:04d}"


def get_completed_tasks_for_period(
    supabase: Any,
    participant_id: str,
    organization_id: str,
    period_start: date,
    period_end: date,
    status: str = "verified"
) -> List[Dict[str, Any]]:
    """
    Get all verified task completions for invoice period.
    
    Args:
        participant_id: Target participant
        organization_id: Organization ID for scoping
        period_start: Invoice period start date
        period_end: Invoice period end date
        status: Task completion status filter (default: verified)
    
    Returns:
        List of task completions with pricing details
    """
    try:
        # Query task completions in period with pricing details
        resp = (
            supabase.table("task_completions")
            .select(
                """
                id,
                task_id,
                completion_date,
                duration_minutes,
                evidence_type,
                evidence_verified,
                price_item_code,
                billed_amount,
                participant_tasks(
                    id,
                    name,
                    shift_type,
                    category,
                    support_category
                ),
                ndis_price_items(
                    item_code,
                    name,
                    price_national,
                    price_remote,
                    price_very_remote,
                    day_type,
                    time_type,
                    support_category_name,
                    support_intensity
                )
                """
            )
            .eq("participant_id", participant_id)
            .eq("organization_id", organization_id)
            .eq("status", status)
            .gte("completion_date", period_start.isoformat())
            .lte("completion_date", period_end.isoformat())
            .order("completion_date", desc=False)
            .execute()
        )
        return resp.data or []
    except Exception as e:
        logger.error(f"Failed to get completed tasks: {e}")
        raise InvoiceGenerationError(f"Task query failed: {e}")


def aggregate_line_items(
    completions: List[Dict[str, Any]]
) -> Dict[str, Dict[str, Any]]:
    """
    Group task completions by price item code and aggregate.
    
    Returns:
        Dict keyed by price_item_code with aggregated quantities and totals
    """
    line_items: Dict[str, Dict[str, Any]] = {}
    
    for completion in completions:
        price_code = completion.get("price_item_code")
        if not price_code:
            logger.warning(f"Task completion {completion.get('id')} has no price item code")
            continue
            
        if price_code not in line_items:
            price_item = completion.get("ndis_price_items", {}) or {}
            line_items[price_code] = {
                "price_item_code": price_code,
                "description": price_item.get("name", "Unknown Service"),
                "support_category": price_item.get("support_category_name"),
                "day_type": price_item.get("day_type"),
                "time_type": price_item.get("time_type"),
                "support_intensity": price_item.get("support_intensity"),
                "unit_price": _safe_decimal(price_item.get("price_national", 0)),
                "quantity": Decimal("0"),
                "total_price": Decimal("0"),
                "task_ids": [],
            }
        
        # Add quantity (hours)
        duration_hours = Decimal(str(completion.get("duration_minutes", 0))) / Decimal("60")
        line_items[price_code]["quantity"] += duration_hours
        
        # Add to total
        billed = _safe_decimal(completion.get("billed_amount", 0))
        if billed == 0:
            # Calculate from unit price and duration
            billed = line_items[price_code]["unit_price"] * duration_hours
        
        line_items[price_code]["total_price"] += billed
        
        # Track task IDs for audit trail
        task_id = completion.get("task_id")
        if task_id and task_id not in line_items[price_code]["task_ids"]:
            line_items[price_code]["task_ids"].append(task_id)
    
    return line_items


async def create_invoice(
    supabase: Any,
    organization_id: str,
    participant_id: str,
    plan_id: Optional[str],
    period_start: date,
    period_end: date,
    created_by_user_id: str,
    status: str = "draft"
) -> Dict[str, Any]:
    """
    Create NDIS invoice from verified task completions.
    
    Args:
        organization_id: Provider organization
        participant_id: Participant being invoiced
        plan_id: NDIS plan reference (optional)
        period_start: Invoice period start
        period_end: Invoice period end
        created_by_user_id: Coordinator who generated invoice
        status: Initial status (default: draft for review)
    
    Returns:
        Created invoice object with line items
    """
    try:
        # Get all verified completions in period
        completions = get_completed_tasks_for_period(
            supabase,
            participant_id,
            organization_id,
            period_start,
            period_end,
            status="verified"
        )
        
        if not completions:
            raise InvoiceGenerationError(
                f"No verified task completions found for {period_start} to {period_end}"
            )
        
        # Aggregate into line items
        line_items_dict = aggregate_line_items(completions)
        line_items = list(line_items_dict.values())
        
        # Calculate total
        total_amount = sum(_safe_decimal(item["total_price"]) for item in line_items)
        
        # Generate invoice number
        invoice_number = generate_invoice_number(organization_id, participant_id, period_end)

        period = billing_period_service.get_or_open_billing_period(
            participant_id,
            organization_id,
            as_of_date=period_start,
        )
        billing_period_id = period.get("id")

        # Create invoice header
        invoice_payload = {
            "organization_id": organization_id,
            "participant_id": participant_id,
            "plan_id": plan_id,
            "billing_period_id": billing_period_id,
            "invoice_number": invoice_number,
            "invoice_date": date.today().isoformat(),
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "total_amount": str(total_amount),
            "status": status,
            "created_by": created_by_user_id,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }
        
        # Insert invoice
        invoice_resp = supabase.table("invoices").insert(invoice_payload).execute()
        invoice = (invoice_resp.data or [{}])[0]
        invoice_id = invoice.get("id")
        
        if not invoice_id:
            raise InvoiceGenerationError("Failed to create invoice header")
        
        # Insert line items
        line_items_to_insert = []
        for item in line_items:
            line_items_to_insert.append({
                "invoice_id": invoice_id,
                "price_item_code": item["price_item_code"],
                "description": item["description"],
                "support_category": item["support_category"],
                "quantity": str(item["quantity"]),
                "unit_price": str(item["unit_price"]),
                "total_price": str(item["total_price"]),
                "day_type": item["day_type"],
                "time_type": item["time_type"],
                "support_intensity": item["support_intensity"],
                "task_ids": item["task_ids"],
            })
        
        if line_items_to_insert:
            supabase.table("invoice_line_items").insert(line_items_to_insert).execute()
        
        # Link invoice to task completions
        supabase.table("task_completions").update({
            "invoice_id": invoice_id,
            "updated_at": datetime.now().isoformat()
        }).eq("participant_id", participant_id).eq(
            "completion_date", f"gte.{period_start.isoformat()}"
        ).eq(
            "completion_date", f"lte.{period_end.isoformat()}"
        ).eq("status", "verified").execute()
        
        # Fetch complete invoice
        full_invoice = supabase.table("invoices").select(
            "*, invoice_line_items(*)"
        ).eq("id", invoice_id).single().execute()
        
        return {
            "invoice": full_invoice.data,
            "line_items_count": len(line_items),
            "total_amount": str(total_amount),
        }
    
    except Exception as e:
        logger.error(f"Invoice creation failed: {e}")
        raise InvoiceGenerationError(f"Invoice creation failed: {e}")


async def get_invoice_summary(
    supabase: Any,
    organization_id: str,
    participant_id: str,
    period_start: date,
    period_end: date
) -> Dict[str, Any]:
    """
    Get invoice preview before finalization.
    Shows what will be billed without creating invoice yet.
    """
    try:
        completions = get_completed_tasks_for_period(
            supabase,
            participant_id,
            organization_id,
            period_start,
            period_end,
            status="verified"
        )
        
        line_items_dict = aggregate_line_items(completions)
        line_items = list(line_items_dict.values())
        total_amount = sum(_safe_decimal(item["total_price"]) for item in line_items)
        
        # Group by support category for summary
        by_category: Dict[str, Decimal] = {}
        for item in line_items:
            category = item.get("support_category", "Other")
            by_category[category] = by_category.get(category, Decimal("0")) + _safe_decimal(item["total_price"])
        
        return {
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "total_items": len(completions),
            "line_items": line_items,
            "by_category": {k: str(v) for k, v in by_category.items()},
            "total_amount": str(total_amount),
        }
    
    except Exception as e:
        logger.error(f"Invoice summary failed: {e}")
        raise InvoiceGenerationError(f"Summary generation failed: {e}")


def finalize_invoice(
    supabase: Any,
    invoice_id: str,
    organization_id: str,
) -> Dict[str, Any]:
    """
    Finalize invoice (move from draft to finalized for sending).
    """
    try:
        now = datetime.now().isoformat()
        resp = (
            supabase.table("invoices")
            .update({"status": "finalized", "updated_at": now})
            .eq("id", invoice_id)
            .eq("organization_id", organization_id)
            .execute()
        )
        return (resp.data or [{}])[0]
    except Exception as e:
        logger.error(f"Invoice finalization failed: {e}")
        raise InvoiceGenerationError(f"Finalization failed: {e}")


def mark_invoice_sent(
    supabase: Any,
    invoice_id: str,
    organization_id: str,
) -> Dict[str, Any]:
    """
    Mark invoice as sent to participant/scheme.
    """
    try:
        now = datetime.now().isoformat()
        resp = (
            supabase.table("invoices")
            .update({"status": "sent", "sent_date": now, "updated_at": now})
            .eq("id", invoice_id)
            .eq("organization_id", organization_id)
            .execute()
        )
        return (resp.data or [{}])[0]
    except Exception as e:
        logger.error(f"Mark sent failed: {e}")
        raise InvoiceGenerationError(f"Mark sent failed: {e}")


# ── Templates directory (one level up from services/) ──────────────────────────
_TEMPLATES_DIR = pathlib.Path(__file__).parent.parent / "templates"


def generate_invoice_number_with_sequence(
    supabase: Any,
    org_id: str,
    period_end: date,
) -> str:
    """Generate invoice number using per-org atomic sequence (requires migration 079)."""
    try:
        resp = supabase.rpc("increment_invoice_sequence", {"p_org_id": org_id}).execute()
        seq = int(resp.data or 1)
    except Exception:
        # Fall back to timestamp-based numbering if sequence function not yet applied
        seq = int(datetime.now().timestamp()) % 10000

    year_month = period_end.strftime("%Y%m")
    short_org = org_id[:4].upper()
    return f"INV-{short_org}-{year_month}-{seq:04d}"


def assemble_invoice_data(
    supabase: Any,
    invoice_id: str,
    org_id: str,
) -> Dict[str, Any]:
    """
    Fetch all data required to render the invoice PDF.

    Joins invoice → line items → organization → participant → ndis_plan.
    Returns a flat dict that maps directly to template variables.
    """
    # ── Invoice header ──────────────────────────────────────────────────────
    inv_resp = (
        supabase.table("invoices")
        .select("*, invoice_line_items(*)")
        .eq("id", invoice_id)
        .eq("organization_id", org_id)
        .single()
        .execute()
    )
    invoice = inv_resp.data
    if not invoice:
        raise InvoiceGenerationError(f"Invoice {invoice_id} not found")

    line_items_raw: List[Dict] = invoice.get("invoice_line_items") or []

    # ── Organization (provider) ─────────────────────────────────────────────
    org_resp = (
        supabase.table("organizations")
        .select(
            "organization_name, abn, contact_number, email, "
            "org_address, ndis_provider_number"
        )
        .eq("id", org_id)
        .single()
        .execute()
    )
    org = org_resp.data or {}

    # ── Participant ─────────────────────────────────────────────────────────
    participant_id = invoice.get("participant_id")
    participant: Dict = {}
    if participant_id:
        pt_resp = (
            supabase.table("patients")
            .select("full_name, ndis_number, date_of_birth, address")
            .eq("id", participant_id)
            .single()
            .execute()
        )
        participant = pt_resp.data or {}

    # ── NDIS Plan ───────────────────────────────────────────────────────────
    plan_id = invoice.get("plan_id")
    plan: Dict = {}
    if plan_id:
        plan_resp = (
            supabase.table("ndis_plans")
            .select("plan_number, plan_management_type, plan_start, plan_end")
            .eq("id", plan_id)
            .single()
            .execute()
        )
        plan = plan_resp.data or {}

    # ── Build by_category map ───────────────────────────────────────────────
    by_category: Dict[str, float] = {}
    for item in line_items_raw:
        cat = item.get("support_category") or "Other"
        by_category[cat] = by_category.get(cat, 0.0) + float(item.get("total_price") or 0)

    # ── Format dates ────────────────────────────────────────────────────────
    def _fmt_date(val: Any) -> str:
        if not val:
            return ""
        try:
            return datetime.fromisoformat(str(val)).strftime("%d %b %Y")
        except Exception:
            return str(val)

    invoice_date_raw = invoice.get("invoice_date") or date.today().isoformat()
    try:
        due_date = (
            datetime.fromisoformat(str(invoice_date_raw)) + timedelta(days=30)
        ).strftime("%d %b %Y")
    except Exception:
        due_date = ""

    dob_raw = participant.get("date_of_birth")
    dob_str = ""
    if dob_raw:
        try:
            dob_str = datetime.fromisoformat(str(dob_raw)).strftime("%d %b %Y")
        except Exception:
            dob_str = str(dob_raw)

    return {
        # invoice
        "invoice_number": invoice.get("invoice_number", ""),
        "invoice_date": _fmt_date(invoice_date_raw),
        "period_start": _fmt_date(invoice.get("period_start")),
        "period_end": _fmt_date(invoice.get("period_end")),
        "total_amount": float(invoice.get("total_amount") or 0),
        "status": invoice.get("status", "draft"),
        "due_date": due_date,
        # provider
        "provider_name": org.get("organization_name", ""),
        "provider_abn": org.get("abn", ""),
        "provider_ndis_number": org.get("ndis_provider_number", ""),
        "provider_address": org.get("org_address", ""),
        "provider_email": org.get("email", ""),
        "provider_phone": org.get("contact_number", ""),
        # participant
        "participant_name": participant.get("full_name", ""),
        "participant_ndis_number": participant.get("ndis_number", ""),
        "participant_dob": dob_str,
        "participant_address": participant.get("address", ""),
        # plan
        "plan_number": plan.get("plan_number", ""),
        "plan_management_type": plan.get("plan_management_type") or "PLAN",
        # line items (pass through as-is for template)
        "line_items": line_items_raw,
        "by_category": by_category,
        # meta
        "generated_at": datetime.now().strftime("%d %b %Y %H:%M UTC"),
    }


def render_invoice_pdf(invoice_data: Dict[str, Any]) -> bytes:
    """
    Render the Jinja2 invoice template to PDF.

    Tries WeasyPrint first (preferred, production-grade).
    Falls back to xhtml2pdf on environments without GTK (e.g. local Windows).
    """
    try:
        from jinja2 import Environment, FileSystemLoader, select_autoescape
    except ImportError as exc:
        raise InvoiceGenerationError(f"PDF rendering requires jinja2: {exc}")

    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATES_DIR)),
        autoescape=select_autoescape(["html"]),
    )
    template = env.get_template("invoice.html")
    html_str = template.render(**invoice_data)

    # Try WeasyPrint (Linux / production with GTK/Pango available)
    try:
        from weasyprint import HTML
        return HTML(string=html_str, base_url=str(_TEMPLATES_DIR)).write_pdf()
    except Exception:
        pass

    # Fall back to xhtml2pdf (pure-Python, works on Windows without GTK)
    try:
        import io
        from xhtml2pdf import pisa
        buf = io.BytesIO()
        result = pisa.CreatePDF(html_str, dest=buf)
        if not result.err:
            return buf.getvalue()
    except ImportError:
        pass

    raise InvoiceGenerationError(
        "PDF rendering failed: install weasyprint (Linux) or xhtml2pdf (Windows)."
    )
