from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr
from html import escape
from typing import Any

from ..core.config import settings

logger = logging.getLogger(__name__)

ROLE_LABELS = {
    "support_worker": "Support Worker",
    "allied_health": "Allied Health Professional",
    "support_coordinator": "Support Coordinator",
}


@dataclass(frozen=True)
class EmailDelivery:
    status: str
    provider: str = "smtp"
    message: str = ""

    def as_dict(self) -> dict[str, str]:
        return {
            "status": self.status,
            "provider": self.provider,
            "message": self.message,
        }


def is_configured() -> bool:
    return bool(
        settings.smtp_host
        and settings.smtp_port
        and settings.smtp_username
        and settings.smtp_password
        and settings.smtp_from_email
    )


def delivery_state() -> EmailDelivery:
    if not settings.email_enabled:
        return EmailDelivery(
            status="disabled",
            message="Automatic email is disabled. Set EMAIL_ENABLED=true to send mail.",
        )
    if not is_configured():
        return EmailDelivery(
            status="not_configured",
            message="SMTP settings are incomplete. Check SMTP_USERNAME, SMTP_PASSWORD, and SMTP_FROM_EMAIL.",
        )
    return EmailDelivery(status="queued", message="Email queued for delivery.")


def queue_invitation_email(
    background_tasks: Any,
    *,
    to_email: str,
    invite_url: str,
    organization_name: str | None,
    role: str,
) -> dict[str, str]:
    state = delivery_state()
    if state.status != "queued":
        return state.as_dict()

    background_tasks.add_task(
        _send_invitation_email_safe,
        to_email=to_email,
        invite_url=invite_url,
        organization_name=organization_name,
        role=role,
    )
    return state.as_dict()


def _send_invitation_email_safe(
    *,
    to_email: str,
    invite_url: str,
    organization_name: str | None,
    role: str,
) -> None:
    try:
        send_invitation_email(
            to_email=to_email,
            invite_url=invite_url,
            organization_name=organization_name,
            role=role,
        )
    except Exception as exc:
        logger.error("Invitation email failed for %s: %s", to_email, exc)


def send_invitation_email(
    *,
    to_email: str,
    invite_url: str,
    organization_name: str | None,
    role: str,
) -> None:
    role_label = ROLE_LABELS.get(role, role.replace("_", " ").title())
    org_label = organization_name or "CareScribe"
    subject = f"You're invited to {org_label} on CareScribe"
    text_body = (
        f"You have been invited to join {org_label} as {role_label}.\n\n"
        f"Accept your invitation here:\n{invite_url}\n\n"
        "This secure invitation link expires in 7 days."
    )
    html_body = _build_invitation_html(
        invite_url=invite_url,
        organization_name=org_label,
        role_label=role_label,
    )
    send_email(to_email=to_email, subject=subject, text_body=text_body, html_body=html_body)


def send_email(*, to_email: str, subject: str, text_body: str, html_body: str | None = None) -> None:
    if not settings.email_enabled:
        logger.info("Email disabled; skipping outbound email to %s", to_email)
        return
    if not is_configured():
        raise RuntimeError("SMTP email is enabled but not fully configured.")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((settings.smtp_from_name, settings.smtp_from_email))
    message["To"] = to_email
    message.set_content(text_body)
    if html_body:
        message.add_alternative(html_body, subtype="html")

    if settings.smtp_use_starttls:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.ehlo()
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
            smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
    else:
        with smtplib.SMTP_SSL(
            settings.smtp_host,
            settings.smtp_port,
            timeout=15,
            context=ssl.create_default_context(),
        ) as smtp:
            smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)

    logger.info("Email sent to %s via %s:%s", to_email, settings.smtp_host, settings.smtp_port)


def _build_invitation_html(*, invite_url: str, organization_name: str, role_label: str) -> str:
    safe_org = escape(organization_name)
    safe_role = escape(role_label)
    safe_url = escape(invite_url, quote=True)
    return f"""\
<!doctype html>
<html>
  <body style="margin:0;background:#f7f4ff;font-family:Arial,sans-serif;color:#1E1640;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border:1px solid #E2DEF2;border-radius:16px;padding:28px;">
        <h1 style="margin:0 0 12px;color:#5533CC;font-size:24px;">CareScribe invitation</h1>
        <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">
          You have been invited to join <strong>{safe_org}</strong> as <strong>{safe_role}</strong>.
        </p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
          Use the secure link below to activate your account and set your password.
        </p>
        <a href="{safe_url}" style="display:inline-block;background:#F03060;color:#ffffff;text-decoration:none;font-weight:700;border-radius:999px;padding:12px 20px;">
          Accept invitation
        </a>
        <p style="font-size:12px;line-height:1.6;color:#7A6A9E;margin:24px 0 0;">
          This link expires in 7 days. If the button does not work, copy this URL into your browser:<br>
          <span style="word-break:break-all;">{safe_url}</span>
        </p>
      </div>
    </div>
  </body>
</html>
"""
