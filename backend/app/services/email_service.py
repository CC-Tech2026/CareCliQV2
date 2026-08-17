from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr
from html import escape
from typing import Any

from ..core.config import settings
from .email_queue import get_email_queue

logger = logging.getLogger(__name__)

ROLE_LABELS = {
    "support_worker": "Support Worker",
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
    pending = get_email_queue().pending()
    return EmailDelivery(
        status="queued",
        message=f"Email queued for delivery ({pending} pending).",
    )


def _merge_queue_result(base: EmailDelivery, queue_result: dict[str, str | int]) -> dict[str, str]:
    payload = base.as_dict()
    queue_status = str(queue_result.get("status", "queued"))
    queue_size = queue_result.get("queue_size")
    if queue_status == "queue_full":
        payload["status"] = "queue_full"
        payload["message"] = "Email queue is full. Try again shortly."
    elif queue_status == "failed":
        payload["status"] = "failed"
        payload["message"] = "Email could not be sent."
    else:
        payload["message"] = f"Email queued for delivery ({queue_size} pending)."
    return payload


def queue_email_job(*, label: str, send: Any) -> dict[str, str]:
    state = delivery_state()
    if state.status not in {"queued"}:
        return state.as_dict()
    queue_result = get_email_queue().enqueue(label=label, send=send)
    return _merge_queue_result(state, queue_result)


def _employer_sender_name(org_label: str | None) -> str | None:
    """Sender display name for onboarding-facing mail — reads as coming from
    the employer the candidate actually applied to, not CareCliQ."""
    if not org_label:
        return None
    return f"{org_label} via CareCliQ"


def _branded_header_html(*, logo_url: str | None, org_label: str, heading: str, accent_color: str | None) -> str:
    """Header block for onboarding emails. Falls back to a neutral, unbranded
    header (not CareCliQ's own logo) when the org hasn't set a logo — a
    missing logo should look intentionally blank, not silently replaced."""
    color = accent_color or "#5533CC"
    if logo_url:
        return (
            f'<img src="{escape(logo_url, quote=True)}" alt="{escape(org_label)}" '
            f'style="max-height:48px;max-width:220px;margin:0 0 16px;display:block;">'
            f'<h1 style="margin:0 0 12px;color:{escape(color, quote=True)};font-size:22px;">{escape(heading)}</h1>'
        )
    return f'<h1 style="margin:0 0 12px;color:{escape(color, quote=True)};font-size:22px;">{escape(heading)}</h1>'


def _branded_footer_html() -> str:
    return (
        '<p style="font-size:11px;line-height:1.6;color:#B3ABCE;margin:24px 0 0;text-align:center;">'
        "Powered by CareCliQ</p>"
    )


def queue_invitation_email(
    _background_tasks: Any | None = None,
    *,
    to_email: str,
    invite_url: str,
    organization_name: str | None,
    role: str,
    short_code: str | None = None,
    logo_url: str | None = None,
    brand_accent_color: str | None = None,
) -> dict[str, str]:
    return queue_email_job(
        label=f"invitation:{to_email}",
        send=lambda: _send_invitation_email_safe(
            to_email=to_email,
            invite_url=invite_url,
            organization_name=organization_name,
            role=role,
            short_code=short_code,
            logo_url=logo_url,
            brand_accent_color=brand_accent_color,
        ),
    )


def _send_invitation_email_safe(
    *,
    to_email: str,
    invite_url: str,
    organization_name: str | None,
    role: str,
    short_code: str | None = None,
    logo_url: str | None = None,
    brand_accent_color: str | None = None,
) -> None:
    try:
        send_invitation_email(
            to_email=to_email,
            invite_url=invite_url,
            organization_name=organization_name,
            role=role,
            short_code=short_code,
            logo_url=logo_url,
            brand_accent_color=brand_accent_color,
        )
    except Exception as exc:
        logger.error("Invitation email failed for %s: %s", to_email, exc)


def send_invitation_email(
    *,
    to_email: str,
    invite_url: str,
    organization_name: str | None,
    role: str,
    short_code: str | None = None,
    logo_url: str | None = None,
    brand_accent_color: str | None = None,
) -> None:
    role_label = ROLE_LABELS.get(role, role.replace("_", " ").title())
    org_label = organization_name or "CareCliQ"
    subject = f"You're invited to join {org_label}"
    code_line = (
        f"\nYour mobile join code is: {short_code}\n"
        if short_code
        else ""
    )
    text_body = (
        f"You have been invited to join {org_label} as {role_label}.\n\n"
        f"Accept your invitation here:\n{invite_url}\n"
        f"{code_line}\n"
        "This secure invitation link expires in 7 days."
    )
    html_body = _build_invitation_html(
        invite_url=invite_url,
        organization_name=org_label,
        role_label=role_label,
        short_code=short_code,
        logo_url=logo_url,
        accent_color=brand_accent_color,
    )
    send_email(
        to_email=to_email,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
        from_display_name=_employer_sender_name(organization_name),
    )


def queue_invite_verification_email(
    *,
    to_email: str,
    code: str,
    organization_name: str | None,
) -> dict[str, str]:
    return queue_email_job(
        label=f"invite-code:{to_email}",
        send=lambda: _send_invite_verification_email_safe(
            to_email=to_email,
            code=code,
            organization_name=organization_name,
        ),
    )


def _send_invite_verification_email_safe(
    *,
    to_email: str,
    code: str,
    organization_name: str | None,
) -> None:
    try:
        send_invite_verification_email(to_email=to_email, code=code, organization_name=organization_name)
    except Exception as exc:
        logger.error("Invite verification email failed for %s: %s", to_email, exc)


def send_invite_verification_email(
    *,
    to_email: str,
    code: str,
    organization_name: str | None,
) -> None:
    org_label = organization_name or "CareCliQ"
    subject = f"Your CareCliQ verification code: {code}"
    text_body = (
        f"Your verification code to finish setting up your {org_label} account is:\n\n"
        f"    {code}\n\n"
        "This code expires in 10 minutes. If you didn't request this, you can ignore this email."
    )
    safe_org = escape(org_label)
    safe_code = escape(code)
    html_body = f"""\
<!doctype html>
<html>
  <body style="margin:0;background:#f7f4ff;font-family:Arial,sans-serif;color:#1E1640;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border:1px solid #E2DEF2;border-radius:16px;padding:28px;">
        <h1 style="margin:0 0 12px;color:#5533CC;font-size:22px;">Verify your email</h1>
        <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">
          Enter this code to finish setting up your {safe_org} account:
        </p>
        <p style="font-size:32px;font-weight:800;letter-spacing:0.16em;color:#1E1640;margin:0 0 18px;">{safe_code}</p>
        <p style="font-size:12px;line-height:1.6;color:#7A6A9E;margin:0;">
          This code expires in 10 minutes. If you didn't request this, you can ignore this email.
        </p>
      </div>
    </div>
  </body>
</html>
"""
    send_email(to_email=to_email, subject=subject, text_body=text_body, html_body=html_body)


def queue_onboarding_sign_email(
    *,
    to_email: str,
    full_name: str,
    sign_url: str,
    organization_name: str | None,
    document_titles: list[str],
    logo_url: str | None = None,
    brand_accent_color: str | None = None,
) -> dict[str, str]:
    return queue_email_job(
        label=f"onboarding-sign:{to_email}",
        send=lambda: _send_onboarding_sign_email_safe(
            to_email=to_email,
            full_name=full_name,
            sign_url=sign_url,
            organization_name=organization_name,
            document_titles=document_titles,
            logo_url=logo_url,
            brand_accent_color=brand_accent_color,
        ),
    )


def _send_onboarding_sign_email_safe(
    *,
    to_email: str,
    full_name: str,
    sign_url: str,
    organization_name: str | None,
    document_titles: list[str],
    logo_url: str | None = None,
    brand_accent_color: str | None = None,
) -> None:
    try:
        send_onboarding_sign_email(
            to_email=to_email,
            full_name=full_name,
            sign_url=sign_url,
            organization_name=organization_name,
            document_titles=document_titles,
            logo_url=logo_url,
            brand_accent_color=brand_accent_color,
        )
    except Exception as exc:
        logger.error("Onboarding sign-request email failed for %s: %s", to_email, exc)


def send_onboarding_sign_email(
    *,
    to_email: str,
    full_name: str,
    sign_url: str,
    organization_name: str | None,
    document_titles: list[str],
    logo_url: str | None = None,
    brand_accent_color: str | None = None,
) -> None:
    org_label = organization_name or "CareCliQ"
    subject = f"Your offer from {org_label} — please review and sign"
    doc_list = "\n".join(f"  - {title}" for title in document_titles) or "  - Onboarding documents"
    text_body = (
        f"Hi {full_name},\n\n"
        f"Your offer letter and service agreement from {org_label} are ready for your review and signature:\n"
        f"{doc_list}\n\n"
        f"Review and sign here:\n{sign_url}\n\n"
        "Once you've signed, you'll receive a separate invite to set up your CareCliQ login."
    )
    html_body = _build_onboarding_sign_html(
        full_name=full_name,
        sign_url=sign_url,
        organization_name=org_label,
        document_titles=document_titles,
        logo_url=logo_url,
        accent_color=brand_accent_color,
    )
    send_email(
        to_email=to_email,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
        from_display_name=_employer_sender_name(organization_name),
    )


def _build_onboarding_sign_html(
    *,
    full_name: str,
    sign_url: str,
    organization_name: str,
    document_titles: list[str],
    logo_url: str | None = None,
    accent_color: str | None = None,
) -> str:
    safe_name = escape(full_name)
    safe_url = escape(sign_url, quote=True)
    doc_items = "".join(
        f'<li style="margin:0 0 6px;">{escape(title)}</li>' for title in document_titles
    ) or '<li style="margin:0 0 6px;">Onboarding documents</li>'
    header = _branded_header_html(
        logo_url=logo_url, org_label=organization_name, heading=f"Your offer from {organization_name}",
        accent_color=accent_color,
    )
    return f"""\
<!doctype html>
<html>
  <body style="margin:0;background:#f7f4ff;font-family:Arial,sans-serif;color:#1E1640;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border:1px solid #E2DEF2;border-radius:16px;padding:28px;">
        {header}
        <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">
          Hi {safe_name}, please review and sign the following before we get you set up:
        </p>
        <ul style="font-size:15px;line-height:1.6;margin:0 0 24px;padding-left:20px;color:#1E1640;">
          {doc_items}
        </ul>
        <a href="{safe_url}" style="display:inline-block;background:#F03060;color:#ffffff;text-decoration:none;font-weight:700;border-radius:999px;padding:12px 20px;">
          Review &amp; sign
        </a>
        <p style="font-size:12px;line-height:1.6;color:#7A6A9E;margin:24px 0 0;">
          Once you've signed, you'll receive a separate email with an invite to set up your login.
          If the button does not work, copy this URL into your browser:<br>
          <span style="word-break:break-all;">{safe_url}</span>
        </p>
        {_branded_footer_html()}
      </div>
    </div>
  </body>
</html>
"""


def send_email(
    *,
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str | None = None,
    from_display_name: str | None = None,
) -> None:
    if not settings.email_enabled:
        logger.info("Email disabled; skipping outbound email to %s", to_email)
        return
    if not is_configured():
        raise RuntimeError("SMTP email is enabled but not fully configured.")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((from_display_name or settings.smtp_from_name, settings.smtp_from_email))
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


def send_account_lockout_email_safe(
    *,
    to_email: str,
    locked_until: datetime,
) -> None:
    queue_email_job(
        label=f"lockout:{to_email}",
        send=lambda: _send_account_lockout_email_safe(to_email=to_email, locked_until=locked_until),
    )


def _send_account_lockout_email_safe(*, to_email: str, locked_until: datetime) -> None:
    try:
        send_account_lockout_email(to_email=to_email, locked_until=locked_until)
    except Exception as exc:
        logger.error("Account lockout email failed for %s: %s", to_email, exc)
        raise


def send_account_lockout_email(*, to_email: str, locked_until: datetime) -> None:
    until_label = locked_until.astimezone(timezone.utc).strftime("%H:%M UTC")
    subject = "Your CareCliQ account was temporarily locked"
    text_body = (
        "Your CareCliQ account was temporarily locked after several failed sign-in attempts.\n\n"
        f"You can try again after {until_label}.\n\n"
        "If this wasn't you, contact your administrator immediately."
    )
    html_body = f"""\
<!doctype html>
<html>
  <body style="margin:0;background:#f7f4ff;font-family:Arial,sans-serif;color:#1E1640;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border:1px solid #E2DEF2;border-radius:16px;padding:28px;">
        <h1 style="margin:0 0 12px;color:#5533CC;font-size:24px;">Account temporarily locked</h1>
        <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">
          Your CareCliQ account was locked after several failed sign-in attempts.
        </p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">
          You can try again after <strong>{escape(until_label)}</strong>.
        </p>
        <p style="font-size:12px;line-height:1.6;color:#7A6A9E;margin:0;">
          If this wasn't you, contact your administrator immediately.
        </p>
      </div>
    </div>
  </body>
</html>
"""
    send_email(to_email=to_email, subject=subject, text_body=text_body, html_body=html_body)


def send_suspicious_login_email_safe(
    *,
    to_email: str,
    device_name: str,
    city: str,
    country: str,
    secure_url: str,
) -> None:
    queue_email_job(
        label=f"suspicious-login:{to_email}",
        send=lambda: _send_suspicious_login_email_safe(
            to_email=to_email,
            device_name=device_name,
            city=city,
            country=country,
            secure_url=secure_url,
        ),
    )


def _send_suspicious_login_email_safe(
    *,
    to_email: str,
    device_name: str,
    city: str,
    country: str,
    secure_url: str,
) -> None:
    try:
        send_suspicious_login_email(
            to_email=to_email,
            device_name=device_name,
            city=city,
            country=country,
            secure_url=secure_url,
        )
    except Exception as exc:
        logger.error("Suspicious login email failed for %s: %s", to_email, exc)
        raise


def send_suspicious_login_email(
    *,
    to_email: str,
    device_name: str,
    city: str,
    country: str,
    secure_url: str,
) -> None:
    when = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    subject = "New sign-in to your CareCliQ account"
    text_body = (
        f"A new sign-in to your CareCliQ account was detected.\n\n"
        f"When: {when}\n"
        f"Device: {device_name}\n"
        f"Location: {city}, {country} (approximate location)\n\n"
        f"If this wasn't you, secure your account immediately:\n{secure_url}\n"
    )
    html_body = f"""\
<!doctype html>
<html>
  <body style="margin:0;background:#f7f4ff;font-family:Arial,sans-serif;color:#1E1640;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border:1px solid #E2DEF2;border-radius:16px;padding:28px;">
        <h1 style="margin:0 0 12px;color:#5533CC;font-size:24px;">New sign-in detected</h1>
        <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">
          A new sign-in to your CareCliQ account was detected.
        </p>
        <ul style="font-size:15px;line-height:1.6;margin:0 0 18px;padding-left:20px;">
          <li><strong>When:</strong> {escape(when)}</li>
          <li><strong>Device:</strong> {escape(device_name)}</li>
          <li><strong>Location:</strong> {escape(city)}, {escape(country)} (approximate location)</li>
        </ul>
        <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">
          If this wasn't you, secure your account immediately:
        </p>
        <a href="{escape(secure_url, quote=True)}" style="display:inline-block;background:#F03060;color:#ffffff;text-decoration:none;font-weight:700;border-radius:999px;padding:12px 20px;">
          Secure your account
        </a>
      </div>
    </div>
  </body>
</html>
"""
    send_email(to_email=to_email, subject=subject, text_body=text_body, html_body=html_body)


def queue_worker_notification_email(
    *,
    to_email: str,
    subject: str,
    title: str,
    message: str,
    action_url: str,
) -> dict[str, str]:
    return queue_email_job(
        label=f"worker-notification:{to_email}:{subject[:40]}",
        send=lambda: _send_worker_notification_email_safe(
            to_email=to_email,
            subject=subject,
            title=title,
            message=message,
            action_url=action_url,
        ),
    )


def _send_worker_notification_email_safe(
    *,
    to_email: str,
    subject: str,
    title: str,
    message: str,
    action_url: str,
) -> None:
    try:
        send_worker_notification_email(
            to_email=to_email,
            subject=subject,
            title=title,
            message=message,
            action_url=action_url,
        )
    except Exception as exc:
        logger.error("Worker notification email failed for %s: %s", to_email, exc)
        raise


def send_worker_notification_email(
    *,
    to_email: str,
    subject: str,
    title: str,
    message: str,
    action_url: str,
) -> None:
    text_body = f"{title}\n\n{message}\n\nOpen in CareCliQ:\n{action_url}\n"
    html_body = f"""\
<!doctype html>
<html>
  <body style="margin:0;background:#f7f4ff;font-family:Arial,sans-serif;color:#1E1640;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border:1px solid #E2DEF2;border-radius:16px;padding:28px;">
        <h1 style="margin:0 0 12px;color:#5533CC;font-size:22px;">{escape(title)}</h1>
        <p style="font-size:15px;line-height:1.6;margin:0 0 24px;white-space:pre-wrap;">{escape(message)}</p>
        <a href="{escape(action_url, quote=True)}" style="display:inline-block;background:#5533CC;color:#ffffff;text-decoration:none;font-weight:700;border-radius:999px;padding:12px 20px;">
          View in CareCliQ
        </a>
      </div>
    </div>
  </body>
</html>
"""
    send_email(to_email=to_email, subject=subject, text_body=text_body, html_body=html_body)


def _build_invitation_html(
    *,
    invite_url: str,
    organization_name: str,
    role_label: str,
    short_code: str | None = None,
    logo_url: str | None = None,
    accent_color: str | None = None,
) -> str:
    safe_org = escape(organization_name)
    safe_role = escape(role_label)
    safe_url = escape(invite_url, quote=True)
    code_block = ""
    if short_code:
        safe_code = escape(short_code)
        code_block = f"""
        <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
          Mobile join code: <strong style="letter-spacing:0.12em;">{safe_code}</strong>
        </p>
        """
    header = _branded_header_html(
        logo_url=logo_url, org_label=organization_name, heading=f"You're invited to join {organization_name}",
        accent_color=accent_color,
    )
    return f"""\
<!doctype html>
<html>
  <body style="margin:0;background:#f7f4ff;font-family:Arial,sans-serif;color:#1E1640;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border:1px solid #E2DEF2;border-radius:16px;padding:28px;">
        {header}
        <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">
          You have been invited to join <strong>{safe_org}</strong> as <strong>{safe_role}</strong>.
        </p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
          Use the secure link below to activate your account and set your password.
        </p>
        {code_block}
        <a href="{safe_url}" style="display:inline-block;background:#F03060;color:#ffffff;text-decoration:none;font-weight:700;border-radius:999px;padding:12px 20px;">
          Accept invitation
        </a>
        <p style="font-size:12px;line-height:1.6;color:#7A6A9E;margin:24px 0 0;">
          This link expires in 7 days. If the button does not work, copy this URL into your browser:<br>
          <span style="word-break:break-all;">{safe_url}</span>
        </p>
        {_branded_footer_html()}
      </div>
    </div>
  </body>
</html>
"""
