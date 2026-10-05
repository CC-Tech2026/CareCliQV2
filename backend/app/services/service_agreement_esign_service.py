"""Remote e-signing of NDIS service agreements.

1. In CareCliQ, the provider signs and sends the agreement to the
   participant (or their nominee / guardian) by email.
2. The email carries a single-use link, valid for 14 days. Only its SHA-256
   is stored. Sending again issues a new link and the old one stops working.
3. Opening the link shows who the agreement is from and for, but nothing
   from the agreement itself until the signer confirms a 6-digit code sent
   to the same address (10 minutes, 5 tries) — a forwarded link on its own
   isn't enough.
4. The signer reads the agreement, types their name, draws a signature and
   confirms they understood it. The signed PDF is generated and stored with
   its hash, their IP address and browser, and the organisation is told.
"""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Any, Optional

from fastapi import HTTPException

from . import audit_service
from . import service_agreement_document_service as documents
from .email_service import (
    delivery_state, queue_email_job, send_email, _branded_header_html, _branded_footer_html, _employer_sender_name,
)
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

LINK_TTL = timedelta(days=14)
CODE_TTL = timedelta(minutes=10)
CODE_RESEND_COOLDOWN = timedelta(seconds=30)
MAX_CODE_ATTEMPTS = 5
RELATIONSHIPS = {"participant", "nominee", "guardian", "other"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _code_hash(code: str, agreement_id: str) -> str:
    # Salted with the agreement so equal codes don't share a hash.
    return hashlib.sha256(f"{agreement_id}:{code}".encode("utf-8")).hexdigest()


def mask_email(email: str) -> str:
    local, _, domain = (email or "").partition("@")
    if not domain:
        return email
    shown = local[:2] if len(local) > 2 else local[:1]
    return f"{shown}{'•' * max(1, len(local) - len(shown))}@{domain}"


def _sign_url(token: str) -> str:
    from ..core.config import settings

    return f"{settings.frontend_base_url.rstrip('/')}/agreement-sign?token={token}"


def _branding(org_id: str) -> dict[str, Any]:
    try:
        from . import organization_branding_service

        return organization_branding_service.get_branding(org_id) or {}
    except Exception:
        return {}


# ── Sending ──────────────────────────────────────────────────────────────


async def send_for_esign(
    org_id: str,
    agreement_id: str,
    user_id: Optional[str],
    *,
    provider_name: str,
    provider_signature_png: str,
    signer_name: str,
    signer_email: str,
    relationship: str,
) -> dict[str, Any]:
    existing = documents.get_agreement(org_id, agreement_id)
    if existing.get("status") not in documents.SIGNABLE_STATUSES:
        raise HTTPException(status_code=409, detail="This agreement has already been signed.")
    if not existing.get("service_agreement_supports"):
        raise HTTPException(status_code=422, detail="Add at least one support before sending.")
    if not (provider_name or "").strip():
        raise HTTPException(status_code=422, detail="Provider signatory name is required.")
    if not str(provider_signature_png or "").startswith("data:image/png;base64,") or len(provider_signature_png) > 400_000:
        raise HTTPException(status_code=422, detail="Sign as the provider before sending.")
    if not (signer_name or "").strip():
        raise HTTPException(status_code=422, detail="Who is signing for the participant?")
    email = (signer_email or "").strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    if relationship not in RELATIONSHIPS:
        raise HTTPException(status_code=422, detail="Choose who is signing.")

    # The signer confirms an emailed code, so without email this can't work.
    if delivery_state().status != "queued":
        raise HTTPException(
            status_code=503,
            detail="Email isn't set up for CareCliQ yet, so agreements can't be signed remotely. Use Sign now to sign in person.",
        )

    token = secrets.token_urlsafe(32)
    now = _now()
    get_supabase_admin().table("service_agreements").update({
        "status": "pending_signature",
        "sent_at": existing.get("sent_at") or now.isoformat(),
        "provider_signed_name": provider_name.strip(),
        "provider_signed_at": now.isoformat(),
        "provider_signature_png": provider_signature_png,
        "signer_name": signer_name.strip(),
        "signer_email": email,
        "signer_relationship": relationship,
        "sign_token_hash": token_hash(token),
        "sign_token_expires_at": (now + LINK_TTL).isoformat(),
        "signing_code_hash": None,
        "signing_code_expires_at": None,
        "signing_code_sent_at": None,
        "signing_code_attempts": 0,
        "signing_email_verified_at": None,
        "updated_at": now.isoformat(),
    }).eq("id", agreement_id).eq("organization_id", org_id).execute()

    branding = _branding(org_id)
    participant = documents.party(org_id, existing)
    delivery = queue_email_job(
        label=f"agreement-sign:{email}",
        send=lambda: _safe(
            send_sign_request_email,
            to_email=email,
            signer_name=signer_name.strip(),
            participant_name=participant.get("full_name") or "the participant",
            relationship=relationship,
            agreement_number=existing.get("agreement_number"),
            sign_url=_sign_url(token),
            organization_name=branding.get("display_name"),
            logo_url=branding.get("logo_url"),
            accent_color=branding.get("brand_accent_color"),
        ),
    )
    await audit_service.log_action(
        action_type="service_agreement.sent_for_esign", entity_type="service_agreement", entity_id=agreement_id,
        user_id=user_id, organization_id=org_id,
        after_state={"signer_name": signer_name.strip(), "signer_email": email, "relationship": relationship,
                     "provider_signed_name": provider_name.strip()},
    )
    result = {"email_delivery": delivery, "sent_to": mask_email(email), "expires_at": (now + LINK_TTL).isoformat()}
    # When email isn't going out, hand the link to the (authorised) sender so
    # they can pass it on themselves — it can't be recovered later.
    if (delivery or {}).get("status") != "queued":
        result["sign_url"] = _sign_url(token)
    return result


async def cancel_esign(org_id: str, agreement_id: str, user_id: Optional[str]) -> None:
    existing = documents.get_agreement(org_id, agreement_id)
    if not existing.get("sign_token_hash"):
        return
    get_supabase_admin().table("service_agreements").update({
        "sign_token_hash": None, "sign_token_expires_at": None,
        "signing_code_hash": None, "signing_code_expires_at": None, "signing_email_verified_at": None,
    }).eq("id", agreement_id).eq("organization_id", org_id).execute()
    await audit_service.log_action(
        action_type="service_agreement.esign_cancelled", entity_type="service_agreement", entity_id=agreement_id,
        user_id=user_id, organization_id=org_id,
    )


# ── Public (the signer, no login) ────────────────────────────────────────


_PUBLIC_COLUMNS = (
    "id, organization_id, participant_id, intake_id, agreement_number, status, start_date, end_date, "
    "plan_management_type, plan_manager_name, includes_price_adjustment_clause, gst_treatment_basis, "
    "cancellation_notice_hours, cancellation_fee_percentage, provider_signed_name, provider_signed_at, "
    "participant_signed_name, participant_signed_at, signer_name, signer_email, signer_relationship, "
    "sign_token_expires_at, signing_code_hash, signing_code_expires_at, signing_code_sent_at, "
    "signing_code_attempts, signing_email_verified_at, service_agreement_supports(*)"
)


def _by_token(token: str) -> dict[str, Any]:
    if not token or len(token) > 200:
        raise HTTPException(status_code=404, detail="This signing link isn't valid.")
    rows = (
        get_supabase_admin().table("service_agreements").select(_PUBLIC_COLUMNS)
        .eq("sign_token_hash", token_hash(token)).limit(1).execute()
    ).data or []
    if not rows:
        raise HTTPException(status_code=404, detail="This signing link isn't valid or has been replaced.")
    agreement = rows[0]
    expires = _parse(agreement.get("sign_token_expires_at"))
    if agreement.get("status") == "pending_signature" and expires and expires < _now():
        raise HTTPException(status_code=410, detail="This signing link has expired. Ask your provider to send a new one.")
    agreement["service_agreement_supports"] = sorted(
        agreement.get("service_agreement_supports") or [], key=lambda s: s.get("sort_order") or 0,
    )
    return agreement


def _summary(agreement: dict[str, Any]) -> dict[str, Any]:
    org = documents.get_letterhead(agreement["organization_id"])
    participant = documents.party(agreement["organization_id"], agreement)
    ctx = documents.document_context(org, agreement, participant)
    return {
        "agreement_number": agreement.get("agreement_number"),
        "period": ctx["period"],
        "plan_management": ctx["plan_management_label"],
        "plan_manager": agreement.get("plan_manager_name"),
        "supports": [
            {"name": line["name"], "detail": line["detail"], "quantity": line["quantity_label"],
             "rate": line["rate_label"], "total": line["total_label"]}
            for line in ctx["supports"]
        ],
        "total": ctx["total_label"],
        "price_changes": (
            "Rates follow NDIS Pricing Arrangements updates after written notice."
            if agreement.get("includes_price_adjustment_clause") else "Rates are fixed for the agreement period."
        ),
        "cancellations": (
            f"At least {agreement['cancellation_notice_hours']} hours' notice; later cancellations may be charged "
            f"at {round(float(agreement.get('cancellation_fee_percentage') or 100))}% of the agreed rate."
            if agreement.get("cancellation_notice_hours") else "As the NDIS Pricing Arrangements allow."
        ),
        "gst": agreement.get("gst_treatment_basis"),
    }


def public_view(token: str) -> dict[str, Any]:
    agreement = _by_token(token)
    branding = _branding(agreement["organization_id"])
    participant = documents.party(agreement["organization_id"], agreement)
    signed = agreement.get("status") != "pending_signature"
    verified = bool(agreement.get("signing_email_verified_at"))
    view = {
        "organization_name": branding.get("display_name") or documents.get_letterhead(agreement["organization_id"]).get("provider_name"),
        "logo_url": branding.get("logo_url"),
        "participant_first_name": (participant.get("full_name") or "").split(" ")[0],
        "signer_name": agreement.get("signer_name"),
        "relationship": agreement.get("signer_relationship"),
        "email_hint": mask_email(agreement.get("signer_email") or ""),
        "status": "signed" if signed else "awaiting_signature",
        "email_verified": verified,
        "provider_signed_name": agreement.get("provider_signed_name"),
        "provider_signed_at": agreement.get("provider_signed_at"),
        "participant_signed_name": agreement.get("participant_signed_name"),
        "participant_signed_at": agreement.get("participant_signed_at"),
        "agreement": None,
    }
    # Nothing from the agreement until the inbox is confirmed.
    if verified or signed:
        view["agreement"] = _summary(agreement)
    return view


def send_code(token: str) -> dict[str, Any]:
    agreement = _by_token(token)
    if agreement.get("status") != "pending_signature":
        raise HTTPException(status_code=409, detail="This agreement has already been signed.")
    sent_at = _parse(agreement.get("signing_code_sent_at"))
    if sent_at and _now() - sent_at < CODE_RESEND_COOLDOWN:
        return {"ok": True, "message": "A code was just sent — check your inbox, or wait a moment to resend."}
    code = f"{secrets.randbelow(1_000_000):06d}"
    now = _now()
    get_supabase_admin().table("service_agreements").update({
        "signing_code_hash": _code_hash(code, agreement["id"]),
        "signing_code_expires_at": (now + CODE_TTL).isoformat(),
        "signing_code_sent_at": now.isoformat(),
        "signing_code_attempts": 0,
        "signing_email_verified_at": None,
    }).eq("id", agreement["id"]).execute()
    branding = _branding(agreement["organization_id"])
    delivery = queue_email_job(
        label=f"agreement-code:{agreement['signer_email']}",
        send=lambda: _safe(
            send_code_email, to_email=agreement["signer_email"], code=code,
            organization_name=branding.get("display_name"),
        ),
    )
    if (delivery or {}).get("status") != "queued":
        raise HTTPException(status_code=503, detail="We couldn't send a code just now. Try again in a few minutes.")
    return {"ok": True, "message": f"We've sent a 6-digit code to {mask_email(agreement['signer_email'])}."}


def verify_code(token: str, code: str) -> dict[str, Any]:
    agreement = _by_token(token)
    if agreement.get("status") != "pending_signature":
        raise HTTPException(status_code=409, detail="This agreement has already been signed.")
    if not agreement.get("signing_code_hash"):
        raise HTTPException(status_code=400, detail="Request a code first.")
    expires = _parse(agreement.get("signing_code_expires_at"))
    if not expires or expires < _now():
        raise HTTPException(status_code=400, detail="This code has expired. Request a new one.")
    attempts = int(agreement.get("signing_code_attempts") or 0)
    if attempts >= MAX_CODE_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Too many attempts. Request a new code.")
    if not secrets.compare_digest(_code_hash((code or "").strip(), agreement["id"]), agreement["signing_code_hash"]):
        get_supabase_admin().table("service_agreements").update({"signing_code_attempts": attempts + 1}).eq("id", agreement["id"]).execute()
        left = MAX_CODE_ATTEMPTS - attempts - 1
        raise HTTPException(status_code=400, detail=f"That code isn't right. {left} {'try' if left == 1 else 'tries'} left." if left else "Too many attempts. Request a new code.")
    get_supabase_admin().table("service_agreements").update({
        "signing_email_verified_at": _now().isoformat(), "signing_code_hash": None,
    }).eq("id", agreement["id"]).execute()
    return {"ok": True}


def document(token: str) -> tuple[str, bytes]:
    """The PDF: the signed copy once signed, otherwise the current version
    with the provider's signature — only after the code is confirmed."""
    agreement = _by_token(token)
    if agreement.get("status") == "pending_signature" and not agreement.get("signing_email_verified_at"):
        raise HTTPException(status_code=403, detail="Confirm the code sent to your email first.")
    return documents.agreement_document(agreement["organization_id"], agreement["id"])


async def sign(token: str, *, full_name: str, signature_png: str, understood: bool,
               ip_address: Optional[str], user_agent: Optional[str]) -> dict[str, Any]:
    agreement = _by_token(token)
    if agreement.get("status") != "pending_signature":
        raise HTTPException(status_code=409, detail="This agreement has already been signed.")
    if not agreement.get("signing_email_verified_at"):
        raise HTTPException(status_code=403, detail="Confirm the code sent to your email first.")
    if not understood:
        raise HTTPException(status_code=422, detail="Please confirm you've read and understood the agreement.")
    if len((full_name or "").strip()) < 2:
        raise HTTPException(status_code=422, detail="Type your full name to sign.")
    if not str(signature_png or "").startswith("data:image/png;base64,") or len(signature_png) > 400_000:
        raise HTTPException(status_code=422, detail="Draw your signature to sign.")
    org_id = agreement["organization_id"]
    full = documents.get_agreement(org_id, agreement["id"])
    if not full.get("provider_signed_at") or not full.get("provider_signature_png"):
        raise HTTPException(status_code=409, detail="This agreement isn't ready to sign. Ask your provider to resend it.")

    now = _now().isoformat()
    digest = await documents.finalise_signature(
        org_id, full, None,
        provider={"name": full["provider_signed_name"], "png": full["provider_signature_png"], "at": full["provider_signed_at"]},
        participant={"name": full_name.strip(), "png": signature_png, "at": now},
        method="email",
        extra={
            "participant_signed_ip": (ip_address or "")[:64] or None,
            "participant_signed_user_agent": (user_agent or "")[:400] or None,
            # Keep the link working as a receipt of what was signed.
            "sign_token_hash": token_hash(token),
        },
    )
    _notify_organisation(org_id, full, full_name.strip())
    return {"ok": True, "document_sha256": digest}


def _notify_organisation(org_id: str, agreement: dict[str, Any], signed_by: str) -> None:
    org = documents.get_letterhead(org_id)
    to = (org.get("email") or "").strip()
    if not to:
        return
    participant = documents.party(org_id, agreement)
    number = agreement.get("agreement_number") or "Service agreement"
    subject = f"{number} signed by {signed_by}"
    body = (
        f"{signed_by} has signed service agreement {number} for {participant.get('full_name') or 'a participant'}.\n\n"
        "The signed copy is on the participant's record (or their onboarding record, until they're made active) "
        "in CareCliQ and in the Documents & Audit Vault."
    )
    queue_email_job(label=f"agreement-signed:{to}", send=lambda: _safe(send_email, to_email=to, subject=subject, text_body=body))


# ── Emails ───────────────────────────────────────────────────────────────


def _safe(fn, **kwargs) -> None:
    try:
        fn(**kwargs)
    except Exception as exc:  # never let email break the request
        logger.error("Agreement email failed (%s): %s", kwargs.get("to_email"), exc)


RELATIONSHIP_PHRASE = {
    "participant": "your",
    "nominee": "{name}'s",
    "guardian": "{name}'s",
    "other": "{name}'s",
}


def send_sign_request_email(
    *, to_email: str, signer_name: str, participant_name: str, relationship: str,
    agreement_number: Optional[str], sign_url: str, organization_name: Optional[str],
    logo_url: Optional[str] = None, accent_color: Optional[str] = None,
) -> None:
    org = organization_name or "Your NDIS provider"
    whose = RELATIONSHIP_PHRASE.get(relationship, "{name}'s").format(name=participant_name)
    subject = f"Please review and sign {whose} NDIS service agreement"
    text = (
        f"Hi {signer_name},\n\n"
        f"{org} has prepared {whose} NDIS service agreement{f' ({agreement_number})' if agreement_number else ''}. "
        "It sets out the supports they'll provide, the prices, and how changes and cancellations work.\n\n"
        f"Review and sign here (link valid for 14 days):\n{sign_url}\n\n"
        "You'll be asked for a code we email you, to make sure it's you. "
        "If you have questions, contact your provider before signing — you don't have to sign straight away."
    )
    header = _branded_header_html(logo_url=logo_url, org_label=org, heading="Your service agreement is ready", accent_color=accent_color)
    safe_url = escape(sign_url, quote=True)
    html = f"""\
<!doctype html>
<html>
  <body style="margin:0;background:#f7f4ff;font-family:Arial,sans-serif;color:#1E1640;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border:1px solid #E2DEF2;border-radius:16px;padding:28px;">
        {header}
        <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">Hi {escape(signer_name)},</p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
          {escape(org)} has prepared {escape(whose)} NDIS service agreement{escape(f' ({agreement_number})') if agreement_number else ''}.
          It sets out the supports they'll provide, the prices, and how changes and cancellations work.
        </p>
        <a href="{safe_url}" style="display:inline-block;background:#E8457A;color:#ffffff;text-decoration:none;font-weight:700;border-radius:999px;padding:12px 22px;">
          Review &amp; sign
        </a>
        <p style="font-size:12px;line-height:1.6;color:#7A6A9E;margin:22px 0 0;">
          The link is valid for 14 days. We'll email you a code to confirm it's you.
          Take your time — contact your provider with any questions before signing.<br><br>
          If the button doesn't work, copy this into your browser:<br>
          <span style="word-break:break-all;">{safe_url}</span>
        </p>
        {_branded_footer_html()}
      </div>
    </div>
  </body>
</html>
"""
    send_email(to_email=to_email, subject=subject, text_body=text, html_body=html,
               from_display_name=_employer_sender_name(organization_name))


def send_code_email(*, to_email: str, code: str, organization_name: Optional[str]) -> None:
    org = organization_name or "your NDIS provider"
    subject = f"Your code to view your service agreement: {code}"
    text = (
        f"Enter this code to view and sign your service agreement from {org}:\n\n    {code}\n\n"
        "It expires in 10 minutes. If you didn't ask for it, you can ignore this email."
    )
    html = f"""\
<!doctype html>
<html>
  <body style="margin:0;background:#f7f4ff;font-family:Arial,sans-serif;color:#1E1640;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border:1px solid #E2DEF2;border-radius:16px;padding:28px;">
        <h1 style="margin:0 0 12px;font-size:22px;">Confirm it's you</h1>
        <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">Enter this code to view and sign your service agreement from {escape(org)}:</p>
        <p style="font-size:32px;font-weight:800;letter-spacing:0.16em;margin:0 0 18px;">{escape(code)}</p>
        <p style="font-size:12px;line-height:1.6;color:#7A6A9E;margin:0;">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p>
      </div>
    </div>
  </body>
</html>
"""
    send_email(to_email=to_email, subject=subject, text_body=text, html_body=html)
