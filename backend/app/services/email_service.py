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


# ---------------------------------------------------------------------------
# Account-setup emails (founding welcome, staff invitation)
#
# Table layout with inline styles so Outlook and Gmail render it the same,
# matching the /get-started look: ink text and buttons, hairline dividers,
# pink kept to small accents. Images come from the web app's public folder.
# ---------------------------------------------------------------------------

_INK = "#2D2D3D"
_MUTED = "#6A6A77"
_RULE = "#E6E6EA"
_PAGE = "#F2F3F5"
_PINK = "#E8457A"
_FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif"


def _asset_url(path: str) -> str:
    return f"{settings.frontend_base_url.rstrip('/')}/{path.lstrip('/')}"


def _ink_button(url: str, label: str) -> str:
    safe_url = escape(url, quote=True)
    return f"""\
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td bgcolor="{_INK}" style="border-radius:999px;">
      <a href="{safe_url}" style="display:inline-block;padding:15px 30px;font-family:{_FONT};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">{escape(label)}&nbsp;&nbsp;&rarr;</a>
    </td>
  </tr>
</table>"""


def _numbered_steps(steps: list[tuple[str, str]]) -> str:
    rows = "".join(
        f"""\
  <tr>
    <td valign="top" width="36" style="padding:16px 0;border-top:1px solid {_RULE};font-family:{_FONT};font-size:13px;font-weight:700;color:{_PINK};">0{i}</td>
    <td style="padding:16px 0;border-top:1px solid {_RULE};font-family:{_FONT};">
      <div style="font-size:15px;font-weight:700;color:{_INK};">{escape(title)}</div>
      <div style="padding-top:3px;font-size:14px;line-height:1.55;color:{_MUTED};">{escape(body)}</div>
    </td>
  </tr>"""
        for i, (title, body) in enumerate(steps, start=1)
    )
    return f"""\
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid {_RULE};">
{rows}
</table>"""


def _account_email_shell(
    *,
    preheader: str,
    header_html: str,
    hero_photo: str | None,
    body_html: str,
    setup_url: str,
    footer_note: str,
    top_bar_color: str = _PINK,
) -> str:
    """The shared frame: page background, white card with a thin coloured
    top bar, header, optional people photo, body, then the expiry and
    fallback link and the company footer."""
    safe_url = escape(setup_url, quote=True)
    photo = (
        f"""\
        <tr>
          <td style="padding:0 40px;">
            <img src="{escape(hero_photo, quote=True)}" width="520" alt="" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:14px;">
          </td>
        </tr>"""
        if hero_photo
        else ""
    )
    return f"""\
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
  </head>
  <body style="margin:0;padding:0;background:{_PAGE};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:{_PAGE};">{escape(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{_PAGE}">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:600px;border-radius:20px;overflow:hidden;">
            <tr><td height="4" bgcolor="{escape(top_bar_color, quote=True)}" style="font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr><td style="padding:28px 40px 24px;">{header_html}</td></tr>
{photo}
            <tr><td style="padding:32px 40px 8px;font-family:{_FONT};color:{_INK};">{body_html}</td></tr>
            <tr>
              <td style="padding:24px 40px 36px;font-family:{_FONT};font-size:12px;line-height:1.6;color:{_MUTED};">
                {escape(footer_note)} If the button doesn't work, paste this link into your browser:<br>
                <a href="{safe_url}" style="color:{_MUTED};word-break:break-all;">{safe_url}</a>
              </td>
            </tr>
          </table>
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
            <tr>
              <td align="center" style="padding:20px 24px 0;font-family:{_FONT};font-size:11px;line-height:1.7;color:#9A9AA5;">
                CareCliQ · Documentation software for NDIS providers<br>
                CC Tech Australia Pty Ltd
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def _carecliq_logo_header() -> str:
    return (
        f'<img src="{escape(_asset_url("carecliQ_logo_new.png"), quote=True)}" width="56" alt="CareCliQ" '
        'style="display:block;width:56px;height:auto;border:0;">'
    )


def _build_founding_welcome_html(*, setup_url: str, organization_name: str, status_line: str, is_trial: bool) -> str:
    safe_org = escape(organization_name)
    steps = [
        ("Set your password", "Use the button above to choose a password for your director account."),
        (
            "Add your organisation details",
            "Head office state, business address, ABN, and your NDIS registration number if you're registered. About two minutes.",
        ),
        (
            "Invite your team",
            "Coordinators and support workers each get their own invite. The worker app runs in English, Vietnamese, Chinese and Arabic.",
        ),
    ]
    body = f"""\
<div style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:{_PINK};">Welcome to CareCliQ</div>
<h1 style="margin:10px 0 0;font-family:{_FONT};font-size:30px;line-height:1.15;font-weight:800;color:{_INK};">{safe_org} is ready to set up.</h1>
<p style="margin:14px 0 0;font-size:16px;line-height:1.6;color:{_INK};">Thanks for choosing CareCliQ. {escape(status_line)}</p>
<p style="margin:10px 0 28px;font-size:15px;line-height:1.6;color:{_MUTED};">
  Less time on paperwork, more time with the people you support. Here's how to get going.
</p>
{_ink_button(setup_url, "Set up my account")}
<div style="height:32px;line-height:32px;font-size:0;">&nbsp;</div>
<div style="padding-bottom:6px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:{_MUTED};">What happens next</div>
{_numbered_steps(steps)}
"""
    return _account_email_shell(
        preheader=(
            f"{status_line} Set your password in about two minutes."
            if is_trial
            else "Your pilot account is ready. Set your password to get started."
        ),
        header_html=_carecliq_logo_header(),
        hero_photo=_asset_url("auth-hero-login.jpg"),
        body_html=body,
        setup_url=setup_url,
        footer_note="This link is just for you and expires in 7 days.",
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


def queue_founding_welcome_email(
    *,
    to_email: str,
    setup_url: str,
    organization_name: str | None,
    trial_days: int,
) -> dict[str, str]:
    return queue_email_job(
        label=f"founding-welcome:{to_email}",
        send=lambda: _send_founding_welcome_email_safe(
            to_email=to_email,
            setup_url=setup_url,
            organization_name=organization_name,
            trial_days=trial_days,
        ),
    )


def _send_founding_welcome_email_safe(**kwargs: Any) -> None:
    try:
        send_founding_welcome_email(**kwargs)
    except Exception as exc:
        logger.error("Founding welcome email failed for %s: %s", kwargs.get("to_email"), exc)


def send_founding_welcome_email(
    *,
    to_email: str,
    setup_url: str,
    organization_name: str | None,
    trial_days: int | None,
) -> None:
    """Sent to the person who just bought a plan on /get-started. They were
    not invited by anyone, so this reads as a welcome from CareCliQ rather
    than the staff invitation's "you're invited to join". trial_days=None
    is a pilot organisation set up by the CareCliQ team, with no trial."""
    org_label = organization_name or "your organisation"
    subject = f"Welcome to CareCliQ: set up {org_label}"
    status_line = (
        f"Your {trial_days}-day free trial has started."
        if trial_days
        else "Your pilot account is ready, with sample staff and participants to explore."
    )
    text_body = (
        f"Thanks for choosing CareCliQ for {org_label}. {status_line}\n\n"
        "Set your password and finish setting up your organisation here:\n"
        f"{setup_url}\n\n"
        "It takes about two minutes: your head office state, business address, ABN and "
        "NDIS registration number (if you're registered).\n\n"
        "This secure link expires in 7 days."
    )
    html_body = _build_founding_welcome_html(
        setup_url=setup_url,
        organization_name=organization_name or "Your organisation",
        status_line=status_line,
        is_trial=bool(trial_days),
    )
    send_email(
        to_email=to_email,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
    )


def queue_signing_verification_email(
    *,
    to_email: str,
    code: str,
    organization_name: str | None,
) -> dict[str, str]:
    return queue_email_job(
        label=f"signing-code:{to_email}",
        send=lambda: _send_signing_verification_email_safe(
            to_email=to_email,
            code=code,
            organization_name=organization_name,
        ),
    )


def _send_signing_verification_email_safe(
    *,
    to_email: str,
    code: str,
    organization_name: str | None,
) -> None:
    try:
        send_signing_verification_email(to_email=to_email, code=code, organization_name=organization_name)
    except Exception as exc:
        logger.error("Signing verification email failed for %s: %s", to_email, exc)


def send_signing_verification_email(
    *,
    to_email: str,
    code: str,
    organization_name: str | None,
) -> None:
    org_label = organization_name or "CareCliQ"
    subject = f"Your verification code to view your offer: {code}"
    text_body = (
        f"Before you can view and sign your offer documents from {org_label}, "
        f"we need to confirm this is really your inbox.\n\n"
        f"Your verification code is:\n\n"
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
          Before you can view and sign your offer documents from {safe_org}, enter this code to confirm it's really you:
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
    cta_label: str = "View in CareCliQ",
    severity: str | None = None,
    settings_url: str | None = None,
) -> dict[str, str]:
    return queue_email_job(
        label=f"worker-notification:{to_email}:{subject[:40]}",
        send=lambda: _send_worker_notification_email_safe(
            to_email=to_email,
            subject=subject,
            title=title,
            message=message,
            action_url=action_url,
            cta_label=cta_label,
            severity=severity,
            settings_url=settings_url,
        ),
    )


def _send_worker_notification_email_safe(
    *,
    to_email: str,
    subject: str,
    title: str,
    message: str,
    action_url: str,
    cta_label: str = "View in CareCliQ",
    severity: str | None = None,
    settings_url: str | None = None,
) -> None:
    try:
        send_worker_notification_email(
            to_email=to_email,
            subject=subject,
            title=title,
            message=message,
            action_url=action_url,
            cta_label=cta_label,
            severity=severity,
            settings_url=settings_url,
        )
    except Exception as exc:
        logger.error("Worker notification email failed for %s: %s", to_email, exc)
        raise


# Severities that get a coloured "needs attention" line above the title, so an
# urgent email doesn't look like every other one in the inbox.
_URGENT_EMAIL_SEVERITIES = {"critical", "emergency", "urgent", "high"}


def send_worker_notification_email(
    *,
    to_email: str,
    subject: str,
    title: str,
    message: str,
    action_url: str,
    cta_label: str = "View in CareCliQ",
    severity: str | None = None,
    settings_url: str | None = None,
) -> None:
    """Branded single-message email. settings_url adds a footer saying why it
    was sent and where to change it, for emails driven by notification settings."""
    urgent = (severity or "").lower() in _URGENT_EMAIL_SEVERITIES
    footer_text = (
        "\n\nYou're getting this email because of your CareCliQ notification settings."
        f" Choose which emails you get: {settings_url}\n"
        if settings_url
        else ""
    )
    attention = "Needs your attention. " if urgent else ""
    text_body = f"{attention}{title}\n\n{message}\n\n{cta_label}:\n{action_url}\n{footer_text}"
    preheader = message.replace("\n", " ")[:140]
    urgent_html = (
        '<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:.04em;'
        'text-transform:uppercase;color:#B91C1C;">Needs your attention</p>'
        if urgent
        else ""
    )
    card_border = "#FCA5A5" if urgent else "#E2DEF2"
    footer_html = (
        f"""
      <p style="font-size:12px;line-height:1.6;color:#8A82A6;margin:16px 4px 0;">
        You're getting this email because of your CareCliQ notification settings.
        <a href="{escape(settings_url, quote=True)}" style="color:#5533CC;">Choose which emails you get</a>.
      </p>"""
        if settings_url
        else ""
    )
    html_body = f"""<!doctype html>
<html>
  <body style="margin:0;background:#f7f4ff;font-family:Arial,sans-serif;color:#1E1640;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{escape(preheader)}</span>
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <p style="margin:0 0 14px 4px;font-size:15px;font-weight:700;color:#5533CC;">CareCliQ</p>
      <div style="background:#ffffff;border:1px solid {card_border};border-radius:16px;padding:28px;">
        {urgent_html}
        <h1 style="margin:0 0 12px;color:#1E1640;font-size:21px;line-height:1.3;">{escape(title)}</h1>
        <p style="font-size:15px;line-height:1.6;margin:0 0 24px;white-space:pre-wrap;">{escape(message)}</p>
        <a href="{escape(action_url, quote=True)}" style="display:inline-block;background:#5533CC;color:#ffffff;text-decoration:none;font-weight:700;border-radius:999px;padding:12px 20px;">
          {escape(cta_label)}
        </a>
        <p style="font-size:12px;line-height:1.6;color:#8A82A6;margin:20px 0 0;">
          If the button doesn't work, copy this link into your browser:<br>
          <span style="word-break:break-all;">{escape(action_url)}</span>
        </p>
      </div>{footer_html}
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
    code_block = ""
    if short_code:
        code_block = f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;border:1px solid {_RULE};border-radius:14px;">
  <tr>
    <td style="padding:18px 20px;font-family:{_FONT};">
      <div style="font-size:14px;font-weight:700;color:{_INK};">Using the CareCliQ mobile app?</div>
      <div style="padding-top:2px;font-size:13px;line-height:1.5;color:{_MUTED};">Enter this join code when the app asks for it.</div>
      <div style="padding-top:12px;font-size:28px;font-weight:800;letter-spacing:0.2em;color:{_INK};">{escape(short_code)}</div>
    </td>
  </tr>
</table>"""
    # The organisation's own logo when it has one; otherwise its name, never
    # CareCliQ's logo, so the invite reads as coming from the employer.
    if logo_url:
        header = (
            f'<img src="{escape(logo_url, quote=True)}" alt="{safe_org}" '
            'style="display:block;max-height:48px;max-width:220px;height:auto;border:0;">'
        )
    else:
        header = f'<div style="font-family:{_FONT};font-size:17px;font-weight:800;color:{_INK};">{safe_org}</div>'
    body = f"""<div style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:{_PINK};">You're invited</div>
<h1 style="margin:10px 0 0;font-family:{_FONT};font-size:30px;line-height:1.15;font-weight:800;color:{_INK};">Join {safe_org} on CareCliQ.</h1>
<p style="margin:14px 0 0;font-size:16px;line-height:1.6;color:{_INK};">
  {safe_org} has invited you to join as <strong>{safe_role}</strong>.
</p>
<p style="margin:10px 0 28px;font-size:15px;line-height:1.6;color:{_MUTED};">
  CareCliQ is where your team keeps shifts, notes and records for the people you support.
  Accept the invitation to set your password and get started.
</p>
{_ink_button(invite_url, "Accept invitation")}
{code_block}
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:{_MUTED};">
  The mobile app works in English, Vietnamese, Chinese and Arabic, and you can write or speak
  your notes in your own language.
</p>
"""
    return _account_email_shell(
        preheader=f"{organization_name} has invited you to join as {role_label}.",
        header_html=header,
        hero_photo=_asset_url("auth-hero-signup.jpg"),
        body_html=body,
        setup_url=invite_url,
        footer_note="This invitation is just for you and expires in 7 days.",
        top_bar_color=accent_color or _PINK,
    )
