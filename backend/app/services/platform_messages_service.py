"""Messages from CareCliQ to the providers on the platform, and the site
banner (migration 274). Used by backend/app/api/admin_messages.py.

Audience: which providers (every one, by account status, or chosen ones)
and which people in them (by role). Participant portal logins never get
these: they're the providers' clients, not our customers. Suspended and
offboarded providers are left out.

Categories:
  service  maintenance, billing, security, changes to how CareCliQ works.
           Always delivered.
  news     new features and product news. Carries an unsubscribe link and
           skips anyone who opted out (Spam Act 2003).

Each recipient gets a row in platform_message_recipients whose status the
email job updates when it runs, so failures show up and can be retried.
The email queue is in memory: a row still "queued" after a restart is
picked up by retry_unsent().
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import re
from datetime import datetime, timezone
from html import escape
from typing import Any, Optional

from ..core.access import PARTICIPANT_ROLES
from ..core.config import settings
from . import admin_console_service as console
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

STAFF_ROLES = ("managing_director", "support_coordinator", "support_worker")
STATUS_FILTERS = ("trial", "paying", "free_access", "not_billed", "needs_attention", "payment_trouble")
MAX_RECIPIENTS = 5000

TEMPLATES: list[dict[str, str]] = [
    {
        "key": "maintenance",
        "name": "Planned maintenance",
        "category": "service",
        "subject": "Planned maintenance on {date}",
        "body": (
            "Hi {first_name},\n\n"
            "CareCliQ will be unavailable for a short time on {date} between {start} and {end} (Adelaide time) "
            "while we carry out planned maintenance.\n\n"
            "Shift notes and records already saved are safe. If your team is working during that window, "
            "they can write notes on paper and add them when CareCliQ is back.\n\n"
            "Thanks for your patience,\nThe CareCliQ team"
        ),
    },
    {
        "key": "feature",
        "name": "New feature",
        "category": "news",
        "subject": "New in CareCliQ: {feature}",
        "body": (
            "Hi {first_name},\n\n"
            "{feature} is now available in CareCliQ for {organisation}.\n\n"
            "What it does: ...\n\n"
            "Where to find it: ...\n\n"
            "As always, reply to this email if you'd like a hand getting started.\n\nThe CareCliQ team"
        ),
    },
    {
        "key": "billing",
        "name": "Billing reminder",
        "category": "service",
        "subject": "Your CareCliQ subscription needs attention",
        "body": (
            "Hi {first_name},\n\n"
            "We couldn't take the latest payment for {organisation}'s CareCliQ subscription.\n\n"
            "To keep everything running, please update your card under Settings, Billing. "
            "If you've already sorted it, you can ignore this email.\n\nThe CareCliQ team"
        ),
    },
    {
        "key": "trial",
        "name": "Trial ending",
        "category": "service",
        "subject": "Your CareCliQ trial ends soon",
        "body": (
            "Hi {first_name},\n\n"
            "{organisation}'s CareCliQ trial ends soon. Nothing changes for your team: your plan starts "
            "automatically and everything you've set up stays where it is.\n\n"
            "If you'd like to talk about which plan suits you, or need more time, just reply to this email.\n\n"
            "The CareCliQ team"
        ),
    },
]

ROLE_LABEL = {
    "managing_director": "Managing directors",
    "support_coordinator": "Coordinators",
    "support_worker": "Support workers",
}


# -- Audience ------------------------------------------------------------------

def _org_matches(snap: dict[str, Any], status_filter: Optional[str], now: datetime) -> bool:
    if not status_filter:
        return True
    label = snap.get("billing_label")
    if status_filter == "trial":
        return snap.get("subscription_status") == "trialing" or label == "Trial"
    if status_filter == "paying":
        return label == "Paying"
    if status_filter == "free_access":
        return label == "Free access"
    if status_filter == "not_billed":
        return label == "Not billed through Stripe"
    if status_filter == "needs_attention":
        return bool(snap.get("attention"))
    if status_filter == "payment_trouble":
        return any(a["code"] in ("payment", "grace", "read_only") for a in snap.get("attention") or [])
    return True


def resolve_audience(audience: dict[str, Any], now: Optional[datetime] = None) -> dict[str, Any]:
    """Who a message would reach. audience = {
         orgs: "all" | "status" | "selected",
         status: one of STATUS_FILTERS (when orgs == "status"),
         org_ids: [...] (when orgs == "selected"),
         roles: subset of STAFF_ROLES (default: managing directors),
       }
    Returns organisations, recipients and how many were left out."""
    now = now or datetime.now(timezone.utc)
    db = get_supabase_admin()
    orgs = db.table("organizations").select("*").execute().data or []
    orgs = [o for o in orgs if (o.get("status") or "active") == "active"]
    mode = audience.get("orgs") or "all"
    if mode == "selected":
        wanted = {str(i) for i in audience.get("org_ids") or []}
        orgs = [o for o in orgs if str(o.get("organization_id")) in wanted]
    elif mode == "status":
        snaps = console.snapshots(orgs, now)
        status_filter = audience.get("status")
        keep = {s["organization_id"] for s in snaps if _org_matches(s, status_filter, now)}
        orgs = [o for o in orgs if o.get("organization_id") in keep]

    roles = [r for r in (audience.get("roles") or ["managing_director"]) if r in STAFF_ROLES] or ["managing_director"]
    org_ids = [o["organization_id"] for o in orgs if o.get("organization_id")]
    names = {o["organization_id"]: o.get("organization_name") or o.get("name") or "your organisation" for o in orgs}

    users: list[dict[str, Any]] = []
    for start in range(0, len(org_ids), 100):
        chunk = org_ids[start:start + 100]
        for columns in (
            "id, email, full_name, role, organization_id, is_active, product_news_opt_out",
            "id, email, full_name, role, organization_id, is_active",
        ):
            try:
                users.extend(db.table("users").select(columns).in_("organization_id", chunk).execute().data or [])
                break
            except Exception as exc:
                if "product_news_opt_out" in str(exc):
                    continue  # migration 274 not applied yet
                raise

    recipients = []
    seen: set[str] = set()
    for u in users:
        email = (u.get("email") or "").strip().lower()
        if (
            not email
            or u.get("is_active") is False
            or u.get("role") in PARTICIPANT_ROLES
            or u.get("role") not in roles
            or email in seen
        ):
            continue
        seen.add(email)
        recipients.append({
            "user_id": u["id"],
            "email": email,
            "full_name": u.get("full_name"),
            "role": u.get("role"),
            "organization_id": u.get("organization_id"),
            "organization_name": names.get(u.get("organization_id"), "your organisation"),
            "opted_out": bool(u.get("product_news_opt_out")),
        })
    return {
        "organizations": [{"organization_id": o["organization_id"], "name": names[o["organization_id"]]} for o in orgs],
        "recipients": recipients,
        "roles": roles,
    }


# -- Personalising and rendering -------------------------------------------------

_TOKEN = re.compile(r"\{(first_name|name|organisation)\}")


def personalise(text: str, recipient: dict[str, Any]) -> str:
    full = (recipient.get("full_name") or "").strip()
    values = {
        "first_name": full.split()[0] if full else "there",
        "name": full or "there",
        "organisation": recipient.get("organization_name") or "your organisation",
    }
    return _TOKEN.sub(lambda m: values[m.group(1)], text)


def unsubscribe_token(user_id: str) -> str:
    sig = hmac.new(settings.secret_key.encode(), f"news-optout:{user_id}".encode(), hashlib.sha256).digest()
    return (
        base64.urlsafe_b64encode(str(user_id).encode()).decode().rstrip("=")
        + "."
        + base64.urlsafe_b64encode(sig[:18]).decode().rstrip("=")
    )


def user_for_token(token: str) -> Optional[str]:
    try:
        raw_id, _, _sig = token.partition(".")
        user_id = base64.urlsafe_b64decode(raw_id + "=" * (-len(raw_id) % 4)).decode()
    except Exception:
        return None
    return user_id if hmac.compare_digest(unsubscribe_token(user_id), token) else None


def render_email(message: dict[str, Any], recipient: dict[str, Any]) -> tuple[str, str, str]:
    """(subject, plain text, HTML) for one person."""
    from .email_service import _FONT, _INK, _MUTED, _PAGE, _PINK, _carecliq_logo_header

    subject = personalise(message["subject"], recipient)
    body = personalise(message["body"], recipient)
    button_label, button_url = message.get("button_label"), message.get("button_url")
    base = settings.frontend_base_url.rstrip("/")

    if message.get("category") == "news" and recipient.get("user_id"):
        unsubscribe_url = f"{base}/email-preferences?token={unsubscribe_token(str(recipient['user_id']))}"
        footer_text = f"You're receiving CareCliQ news because you have a CareCliQ account. Unsubscribe: {unsubscribe_url}"
        footer_html = (
            "You're receiving CareCliQ news because you have a CareCliQ account. "
            f'<a href="{escape(unsubscribe_url, quote=True)}" style="color:{_MUTED};">Unsubscribe from news emails</a>.'
        )
    else:
        footer_text = "This is a service message about your CareCliQ account."
        footer_html = escape(footer_text)

    text = body + (f"\n\n{button_label}: {button_url}" if button_label and button_url else "") + f"\n\n--\n{footer_text}\n"

    paragraphs = "".join(
        f'<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:{_INK};">{escape(p).replace(chr(10), "<br>")}</p>'
        for p in body.split("\n\n") if p.strip()
    )
    button = (
        f'<p style="margin:24px 0 8px;"><a href="{escape(button_url, quote=True)}" '
        f'style="display:inline-block;background:#1A1A2E;color:#FFFFFF;text-decoration:none;font-weight:600;'
        f'font-size:15px;padding:12px 22px;border-radius:999px;">{escape(button_label)}</a></p>'
        if button_label and button_url else ""
    )
    html = f"""\
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;padding:0;background:{_PAGE};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{_PAGE}">
      <tr><td align="center" style="padding:32px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:600px;border-radius:20px;overflow:hidden;">
          <tr><td height="4" bgcolor="{_PINK}" style="font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="padding:28px 40px 8px;">{_carecliq_logo_header()}</td></tr>
          <tr><td style="padding:16px 40px 24px;font-family:{_FONT};">{paragraphs}{button}</td></tr>
        </table>
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
          <tr><td align="center" style="padding:20px 24px 0;font-family:{_FONT};font-size:11px;line-height:1.7;color:#9A9AA5;">
            {footer_html}<br>CareCliQ · CC Tech Australia Pty Ltd
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
"""
    return subject, text, html


# -- Sending ---------------------------------------------------------------------

def _email_job(row_id: str, message: dict[str, Any], recipient: dict[str, Any]):
    def send() -> None:
        from .email_service import send_email

        db = get_supabase_admin()
        try:
            subject, text, html = render_email(message, recipient)
            send_email(
                to_email=recipient["email"],
                subject=subject,
                text_body=text,
                html_body=html,
                from_display_name="CareCliQ",
            )
            db.table("platform_message_recipients").update(
                {"status": "sent", "sent_at": datetime.now(timezone.utc).isoformat(), "error": None}
            ).eq("id", row_id).execute()
        except Exception as exc:
            db.table("platform_message_recipients").update(
                {"status": "failed", "error": str(exc)[:300]}
            ).eq("id", row_id).execute()
            raise

    return send


def _enqueue(row_id: str, message: dict[str, Any], recipient: dict[str, Any]) -> bool:
    from .email_service import queue_email_job

    result = queue_email_job(label=f"platform message {message['id']} to {recipient['email']}", send=_email_job(row_id, message, recipient))
    status = result.get("status")
    if status != "queued":
        get_supabase_admin().table("platform_message_recipients").update(
            {"status": "failed", "error": result.get("message") or status}
        ).eq("id", row_id).execute()
        return False
    return True


def send_message(message: dict[str, Any], audience: dict[str, Any], created_by: Optional[str]) -> dict[str, Any]:
    """Saves the message and its recipients, queues the emails and writes the
    in-app notices. Returns the saved message with counts."""
    from .user_notification_store import create_user_notification

    resolved = resolve_audience(audience)
    recipients = resolved["recipients"]
    if not recipients:
        raise ValueError("Nobody matches that audience.")
    if len(recipients) > MAX_RECIPIENTS:
        raise ValueError(f"That's {len(recipients)} people; send to at most {MAX_RECIPIENTS} at a time.")

    db = get_supabase_admin()
    channels = [c for c in message.get("channels") or ["email"] if c in ("email", "in_app")] or ["email"]
    saved = db.table("platform_messages").insert({
        "subject": message["subject"],
        "body": message["body"],
        "category": message.get("category") or "service",
        "channels": channels,
        "button_label": message.get("button_label") or None,
        "button_url": message.get("button_url") or None,
        "audience": {**audience, "roles": resolved["roles"]},
        "status": "sending",
        "recipient_count": len(recipients),
        "org_count": len(resolved["organizations"]),
        "created_by": created_by,
    }).execute().data[0]

    news = saved["category"] == "news"
    rows = []
    for r in recipients:
        if "email" in channels:
            status = "opted_out" if news and r["opted_out"] else "queued"
        else:
            status = "in_app_only"
        rows.append({
            "message_id": saved["id"],
            "organization_id": r["organization_id"],
            "user_id": r["user_id"],
            "email": r["email"],
            "full_name": r["full_name"],
            "role": r["role"],
            "status": status,
        })
    inserted: list[dict[str, Any]] = []
    for start in range(0, len(rows), 500):
        inserted.extend(db.table("platform_message_recipients").insert(rows[start:start + 500]).execute().data or [])

    by_email = {r["email"]: r for r in recipients}
    queued = failed = 0
    for row in inserted:
        recipient = by_email.get(row["email"])
        if not recipient:
            continue
        if row["status"] == "queued":
            if _enqueue(row["id"], saved, recipient):
                queued += 1
            else:
                failed += 1
        if "in_app" in channels:
            try:
                create_user_notification(
                    user_id=str(recipient["user_id"]),
                    organization_id=str(recipient["organization_id"]) if recipient.get("organization_id") else None,
                    event_type="platform_message",
                    title=personalise(saved["subject"], recipient),
                    body=personalise(saved["body"], recipient)[:2000],
                    severity="medium",
                    action_url=saved.get("button_url") or None,
                    reference_key=f"platform_message:{saved['id']}:{recipient['user_id']}",
                )
            except Exception as exc:
                logger.warning("platform message in-app notice failed for %s: %s", recipient["user_id"], exc)

    db.table("platform_messages").update(
        {"status": "sent", "sent_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", saved["id"]).execute()
    return {**saved, "queued": queued, "failed": failed, "organizations": resolved["organizations"]}


def send_test(message: dict[str, Any], to_email: str, full_name: Optional[str]) -> dict[str, str]:
    """One copy to the admin, personalised as if they were a director at
    'Example Provider'. Nothing is saved."""
    from .email_service import queue_email_job, send_email

    recipient = {"full_name": full_name or "Alex Example", "organization_name": "Example Provider", "user_id": "test", "email": to_email}
    subject, text, html = render_email({**message, "id": "test"}, recipient)
    return queue_email_job(
        label=f"platform message test to {to_email}",
        send=lambda: send_email(to_email=to_email, subject=f"[Test] {subject}", text_body=text, html_body=html, from_display_name="CareCliQ"),
    )


def retry_unsent(message_id: str) -> int:
    """Queues again every failed or still-queued email for a message."""
    db = get_supabase_admin()
    message = db.table("platform_messages").select("*").eq("id", message_id).limit(1).execute().data
    if not message:
        raise LookupError("Message not found.")
    message = message[0]
    rows = (
        db.table("platform_message_recipients").select("*").eq("message_id", message_id)
        .in_("status", ["failed", "queued"]).execute().data or []
    )
    orgs = {
        o["organization_id"]: o.get("organization_name") or o.get("name") or "your organisation"
        for o in (db.table("organizations").select("organization_id, organization_name, name").execute().data or [])
    }
    count = 0
    for row in rows:
        db.table("platform_message_recipients").update({"status": "queued", "error": None}).eq("id", row["id"]).execute()
        recipient = {**row, "organization_name": orgs.get(row.get("organization_id"), "your organisation")}
        if _enqueue(row["id"], message, recipient):
            count += 1
    return count


def delivery_counts(message_id: str) -> dict[str, int]:
    rows = (
        get_supabase_admin().table("platform_message_recipients").select("status")
        .eq("message_id", message_id).execute().data or []
    )
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return counts


# -- Banners ---------------------------------------------------------------------

def active_banners(user: dict[str, Any], now: Optional[datetime] = None) -> list[dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    role = user.get("role")
    if role in PARTICIPANT_ROLES:
        return []
    try:
        rows = (
            get_supabase_admin().table("platform_banners")
            .select("id, message, tone, audience, link_label, link_url, starts_at, ends_at")
            .lte("starts_at", now.isoformat()).gt("ends_at", now.isoformat())
            .order("starts_at", desc=True).execute().data or []
        )
    except Exception as exc:
        if "platform_banners" in str(exc):
            return []  # migration 274 not applied yet
        raise
    return [b for b in rows if b.get("audience") == "everyone" or role in ("managing_director", "super_admin")]
