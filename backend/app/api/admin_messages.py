"""Admin portal: messages to providers, the site banner, the platform
activity log and system status. Super admin only, like admin.py, with the
same boundary: business accounts, never participant records.

Also two non-admin routers:
  platform_router   GET /platform/banners - the banner the app shows
  public_router     /email-preferences    - unsubscribe from news emails,
                    from the link in the email (signed token, no login)
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from ..core.access import get_user_id, is_super_admin
from ..core.config import settings
from ..core.errors import internal_error_detail
from ..core.security import get_current_user
from ..services import email_service, schema_status
from ..services import platform_messages_service as pm
from ..services.audit_service import log_action
from ..services.email_queue import get_email_queue
from ..services.supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])
platform_router = APIRouter(prefix="/platform", tags=["platform"])
public_router = APIRouter(prefix="/email-preferences", tags=["email-preferences"])


def _require_super_admin(user: dict) -> None:
    if not is_super_admin(user):
        raise HTTPException(status_code=403, detail="Super admin access required.")


def _missing_table(exc: Exception) -> bool:
    text = str(exc)
    return any(t in text for t in ("platform_messages", "platform_message_recipients", "platform_banners", "product_news_opt_out"))


def _https_or_app_url(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    value = value.strip()
    if value.startswith("/"):
        return settings.frontend_base_url.rstrip("/") + value
    if not value.startswith("https://"):
        raise ValueError("Links must start with https:// or / (a page in CareCliQ).")
    return value


# -- Messages ------------------------------------------------------------------

class Audience(BaseModel):
    orgs: Literal["all", "status", "selected"] = "all"
    status: Optional[Literal["trial", "paying", "free_access", "not_billed", "needs_attention", "payment_trouble"]] = None
    org_ids: list[str] = Field(default_factory=list, max_length=500)
    roles: list[Literal["managing_director", "support_coordinator", "support_worker"]] = Field(
        default_factory=lambda: ["managing_director"], min_length=1
    )


# Template blanks like {date} must be replaced; only these are filled in
# per person (platform_messages_service.personalise).
PERSONAL_TOKENS = {"first_name", "name", "organisation"}
UNFILLED = re.compile(r"\{([a-z_]+)\}")


class MessageBody(BaseModel):
    subject: str = Field(min_length=3, max_length=150)
    body: str = Field(min_length=10, max_length=8000)
    category: Literal["service", "news"] = "service"
    channels: list[Literal["email", "in_app"]] = Field(default_factory=lambda: ["email"], min_length=1)
    button_label: Optional[str] = Field(default=None, max_length=40)
    button_url: Optional[str] = Field(default=None, max_length=500)

    @field_validator("button_url")
    @classmethod
    def _link(cls, v: Optional[str]) -> Optional[str]:
        return _https_or_app_url(v)

    @field_validator("subject", "body")
    @classmethod
    def _blanks_filled(cls, v: str) -> str:
        left = sorted(set(UNFILLED.findall(v)) - PERSONAL_TOKENS)
        if left:
            raise ValueError("Fill in " + ", ".join("{" + t + "}" for t in left) + " before sending.")
        return v


class SendRequest(BaseModel):
    message: MessageBody
    audience: Audience


@router.get("/messages/templates")
async def message_templates(current_user: dict = Depends(get_current_user)):
    _require_super_admin(current_user)
    return {"templates": pm.TEMPLATES}


@router.post("/messages/preview")
async def preview_audience(body: SendRequest, current_user: dict = Depends(get_current_user)):
    """Who it would reach, before sending. Nothing is saved."""
    _require_super_admin(current_user)
    try:
        resolved = pm.resolve_audience(body.audience.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=internal_error_detail("Couldn't work out the audience", exc))
    recipients = resolved["recipients"]
    opted_out = sum(1 for r in recipients if r["opted_out"]) if body.message.category == "news" else 0
    by_role: dict[str, int] = {}
    for r in recipients:
        by_role[r["role"]] = by_role.get(r["role"], 0) + 1
    sample = recipients[0] if recipients else {"full_name": "Alex Example", "organization_name": "Example Provider", "user_id": None}
    subject, text, _html = pm.render_email({**body.message.model_dump(), "id": "preview"}, sample)
    return {
        "org_count": len(resolved["organizations"]),
        "organizations": [o["name"] for o in resolved["organizations"]][:50],
        "recipient_count": len(recipients),
        "will_email": len(recipients) - opted_out if "email" in body.message.channels else 0,
        "opted_out": opted_out,
        "by_role": by_role,
        "sample": {"to": sample.get("full_name") or "", "organisation": sample.get("organization_name"), "subject": subject, "text": text},
        "email_delivery": email_service.delivery_state().as_dict(),
    }


@router.post("/messages/test")
async def send_test_message(body: MessageBody, current_user: dict = Depends(get_current_user)):
    _require_super_admin(current_user)
    to_email = current_user.get("email")
    if not to_email:
        raise HTTPException(status_code=422, detail="Your account has no email address to send the test to.")
    result = pm.send_test(body.model_dump(), to_email, current_user.get("full_name"))
    return {"to": to_email, **result}


@router.post("/messages", status_code=201)
async def send_message(body: SendRequest, current_user: dict = Depends(get_current_user)):
    _require_super_admin(current_user)
    actor = get_user_id(current_user)
    try:
        saved = pm.send_message(body.message.model_dump(), body.audience.model_dump(), actor)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        if _missing_table(exc):
            raise HTTPException(status_code=409, detail="Messages need database migration 274 first.")
        raise HTTPException(status_code=500, detail=internal_error_detail("The message wasn't sent", exc))
    # One line per provider, so each provider's page shows what we sent them.
    for org in saved["organizations"]:
        await log_action(
            action_type="admin.message.sent", entity_type="platform_message", entity_id=saved["id"],
            user_id=actor, organization_id=org["organization_id"],
            after_state={"subject": saved["subject"], "category": saved["category"], "channels": saved["channels"]},
        )
    return {
        "id": saved["id"], "recipient_count": saved["recipient_count"], "org_count": saved["org_count"],
        "queued": saved["queued"], "failed": saved["failed"],
    }


@router.get("/messages")
async def list_messages(current_user: dict = Depends(get_current_user)):
    _require_super_admin(current_user)
    db = get_supabase_admin()
    try:
        messages = (
            db.table("platform_messages")
            .select("id, subject, category, channels, audience, status, recipient_count, org_count, created_by, created_at, sent_at")
            .order("created_at", desc=True).limit(100).execute().data or []
        )
    except Exception as exc:
        if _missing_table(exc):
            return {"messages": [], "needs_migration": True}
        raise HTTPException(status_code=500, detail=internal_error_detail("Couldn't load messages", exc))
    ids = [m["id"] for m in messages]
    counts: dict[str, dict[str, int]] = {i: {} for i in ids}
    for start in range(0, len(ids), 50):
        rows = (
            db.table("platform_message_recipients").select("message_id, status")
            .in_("message_id", ids[start:start + 50]).execute().data or []
        )
        for r in rows:
            c = counts.setdefault(r["message_id"], {})
            c[r["status"]] = c.get(r["status"], 0) + 1
    return {"messages": [{**m, "delivery": counts.get(m["id"], {})} for m in messages], "needs_migration": False}


@router.get("/messages/{message_id}")
async def get_message(message_id: str, current_user: dict = Depends(get_current_user)):
    _require_super_admin(current_user)
    db = get_supabase_admin()
    rows = db.table("platform_messages").select("*").eq("id", message_id).limit(1).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Message not found.")
    recipients = (
        db.table("platform_message_recipients")
        .select("id, organization_id, email, full_name, role, status, error, sent_at")
        .eq("message_id", message_id).order("organization_id").limit(5000).execute().data or []
    )
    org_ids = sorted({r["organization_id"] for r in recipients if r.get("organization_id")})
    names: dict[str, str] = {}
    if org_ids:
        for o in db.table("organizations").select("organization_id, organization_name, name").in_("organization_id", org_ids).execute().data or []:
            names[o["organization_id"]] = o.get("organization_name") or o.get("name") or "Unnamed"
    return {
        **rows[0],
        "delivery": pm.delivery_counts(message_id),
        "recipients": [{**r, "organization_name": names.get(r.get("organization_id"), "")} for r in recipients],
    }


@router.post("/messages/{message_id}/retry")
async def retry_message(message_id: str, current_user: dict = Depends(get_current_user)):
    _require_super_admin(current_user)
    try:
        count = pm.retry_unsent(message_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"requeued": count}


# -- Site banner ---------------------------------------------------------------

class BannerBody(BaseModel):
    message: str = Field(min_length=5, max_length=280)
    tone: Literal["info", "warning"] = "info"
    audience: Literal["everyone", "directors"] = "everyone"
    link_label: Optional[str] = Field(default=None, max_length=40)
    link_url: Optional[str] = Field(default=None, max_length=500)
    starts_at: Optional[datetime] = None
    ends_at: datetime

    @field_validator("link_url")
    @classmethod
    def _link(cls, v: Optional[str]) -> Optional[str]:
        return _https_or_app_url(v)


@router.get("/banners")
async def list_banners(current_user: dict = Depends(get_current_user)):
    _require_super_admin(current_user)
    since = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
    try:
        rows = (
            get_supabase_admin().table("platform_banners").select("*")
            .gt("ends_at", since).order("starts_at", desc=True).limit(50).execute().data or []
        )
    except Exception as exc:
        if _missing_table(exc):
            return {"banners": [], "needs_migration": True}
        raise HTTPException(status_code=500, detail=internal_error_detail("Couldn't load banners", exc))
    return {"banners": rows, "needs_migration": False}


@router.post("/banners", status_code=201)
async def create_banner(body: BannerBody, current_user: dict = Depends(get_current_user)):
    _require_super_admin(current_user)
    now = datetime.now(timezone.utc)
    starts = body.starts_at or now
    if starts.tzinfo is None:
        starts = starts.replace(tzinfo=timezone.utc)
    ends = body.ends_at if body.ends_at.tzinfo else body.ends_at.replace(tzinfo=timezone.utc)
    if ends <= max(starts, now):
        raise HTTPException(status_code=422, detail="The banner has to end after it starts, and in the future.")
    if ends - starts > timedelta(days=31):
        raise HTTPException(status_code=422, detail="A banner can run for up to 31 days.")
    try:
        row = get_supabase_admin().table("platform_banners").insert({
            "message": body.message.strip(), "tone": body.tone, "audience": body.audience,
            "link_label": body.link_label, "link_url": body.link_url,
            "starts_at": starts.isoformat(), "ends_at": ends.isoformat(),
            "created_by": get_user_id(current_user),
        }).execute().data[0]
    except Exception as exc:
        if _missing_table(exc):
            raise HTTPException(status_code=409, detail="Banners need database migration 274 first.")
        raise HTTPException(status_code=500, detail=internal_error_detail("Couldn't save the banner", exc))
    await log_action(action_type="platform.banner.created", entity_type="platform_banner", entity_id=row["id"],
                     user_id=get_user_id(current_user), after_state={"message": row["message"], "ends_at": row["ends_at"]})
    return row


@router.post("/banners/{banner_id}/end")
async def end_banner(banner_id: str, current_user: dict = Depends(get_current_user)):
    _require_super_admin(current_user)
    now = datetime.now(timezone.utc)
    db = get_supabase_admin()
    rows = db.table("platform_banners").select("id, starts_at").eq("id", banner_id).limit(1).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Banner not found.")
    starts = datetime.fromisoformat(str(rows[0]["starts_at"]).replace("Z", "+00:00"))
    # ends_at must stay after starts_at: a banner that hasn't started yet ends
    # a second after its start, which is the same as never showing.
    ends = max(now, starts + timedelta(seconds=1))
    db.table("platform_banners").update({"ends_at": ends.isoformat()}).eq("id", banner_id).execute()
    await log_action(action_type="platform.banner.ended", entity_type="platform_banner", entity_id=banner_id,
                     user_id=get_user_id(current_user))
    return {"ok": True}


# -- Activity across the platform -----------------------------------------------

@router.get("/activity")
async def platform_activity(
    organization_id: Optional[str] = None,
    limit: int = 100,
    current_user: dict = Depends(get_current_user),
):
    """Everything CareCliQ staff have done in the admin portal, newest first."""
    _require_super_admin(current_user)
    db = get_supabase_admin()
    limit = max(1, min(limit, 300))
    try:
        query = (
            db.table("audit_logs")
            .select("action_type, user_id, organization_id, after_state, details, created_at")
            .or_("action_type.like.admin.%,action_type.like.platform.%")
        )
        if organization_id:
            query = query.eq("organization_id", organization_id)
        rows = query.order("created_at", desc=True).limit(limit).execute().data or []
    except Exception as exc:
        raise HTTPException(status_code=500, detail=internal_error_detail("Couldn't load activity", exc))
    actor_ids = sorted({r["user_id"] for r in rows if r.get("user_id")})
    org_ids = sorted({r["organization_id"] for r in rows if r.get("organization_id")})
    actors: dict[str, str] = {}
    orgs: dict[str, str] = {}
    if actor_ids:
        for u in db.table("users").select("id, full_name, email").in_("id", actor_ids).execute().data or []:
            actors[str(u["id"])] = u.get("full_name") or u.get("email") or "CareCliQ"
    if org_ids:
        for o in db.table("organizations").select("organization_id, organization_name, name").in_("organization_id", org_ids).execute().data or []:
            orgs[str(o["organization_id"])] = o.get("organization_name") or o.get("name") or "Unnamed"
    return {
        "activity": [
            {
                **r,
                "actor_name": actors.get(str(r.get("user_id")), "CareCliQ"),
                "organization_name": orgs.get(str(r.get("organization_id")), "") if r.get("organization_id") else "",
            }
            for r in rows
        ]
    }


# -- System status ---------------------------------------------------------------

def _stripe_mode() -> str:
    key = settings.stripe_secret_key or ""
    if not key:
        return "not_set"
    return "live" if "_live_" in key else "test"


@router.get("/system")
async def system_status(current_user: dict = Depends(get_current_user)):
    """Plain health checks. Never returns keys, only what kind they are."""
    _require_super_admin(current_user)
    try:
        schema = schema_status.check()
    except Exception as exc:
        logger.warning("schema check failed: %s", exc)
        schema = {"migrations_checked": False, "pending": [], "up_to_date": None, "latest_shipped": None}
    db = get_supabase_admin()
    try:
        org_count = len(db.table("organizations").select("organization_id").execute().data or [])
        staff = db.table("users").select("role, is_active").execute().data or []
    except Exception:
        org_count, staff = None, []
    return {
        "email": {**email_service.delivery_state().as_dict(), "queue": get_email_queue().stats()},
        "database": {
            "checked": schema.get("migrations_checked"),
            "up_to_date": schema.get("up_to_date"),
            "pending": [str(p) for p in schema.get("pending") or []],
            "latest_migration": schema.get("latest_shipped"),
        },
        "stripe": {"mode": _stripe_mode()},
        "reminders": {"scheduler_on": bool(settings.notification_scheduler_enabled)},
        "site": {"url": settings.frontend_base_url},
        "counts": {
            "organizations": org_count,
            "active_staff": sum(1 for u in staff if u.get("is_active") is not False and u.get("role") in pm.STAFF_ROLES),
        },
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


# -- In the app: the banner -------------------------------------------------------

@platform_router.get("/banners")
async def current_banners(current_user: dict = Depends(get_current_user)):
    try:
        return {"banners": pm.active_banners(current_user)}
    except Exception as exc:
        logger.warning("banner read failed: %s", exc)
        return {"banners": []}


# -- From the email: news opt-out -----------------------------------------------

class PreferenceUpdate(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    news: bool


def _mask(email: str) -> str:
    name, _, domain = email.partition("@")
    return (name[:2] + "***@" + domain) if domain else "***"


def _user_for(token: str) -> dict[str, Any]:
    user_id = pm.user_for_token(token)
    if not user_id:
        raise HTTPException(status_code=404, detail="This link isn't valid. Use the link in your most recent email.")
    rows = get_supabase_admin().table("users").select("id, email, product_news_opt_out").eq("id", user_id).limit(1).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="This link isn't valid any more.")
    return rows[0]


@public_router.get("")
async def read_preferences(token: str):
    user = _user_for(token)
    return {"email": _mask(user.get("email") or ""), "news": not user.get("product_news_opt_out")}


@public_router.post("")
async def update_preferences(body: PreferenceUpdate):
    """A POST from the page, not the link itself, so mail scanners that open
    links can't unsubscribe anyone."""
    user = _user_for(body.token)
    get_supabase_admin().table("users").update({"product_news_opt_out": not body.news}).eq("id", user["id"]).execute()
    await log_action(action_type="email_preferences.news", entity_type="user", entity_id=str(user["id"]),
                     user_id=str(user["id"]), after_state={"news": body.news})
    return {"email": _mask(user.get("email") or ""), "news": body.news}
