from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.access import get_user_id, get_user_organization_id, is_coordinator_role
from ..core.security import get_current_user
from ..services.supabase_client import get_supabase_admin

router = APIRouter(prefix="/hub", tags=["hub"])


def _get_org_id(user: dict) -> str | None:
    return get_user_organization_id(user)


def _require_coordinator(user: dict) -> str:
    if not is_coordinator_role(user):
        raise HTTPException(status_code=403, detail="Only coordinators can perform this action.")
    org_id = _get_org_id(user)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organisation membership required.")
    return org_id


# ── Organisation Info ─────────────────────────────────────────────────────────

@router.get("/org")
async def get_org_info(current_user: dict = Depends(get_current_user)):
    """Return the current user's organisation name."""
    org_id = _get_org_id(current_user)
    if not org_id:
        return {"organization_name": None}
    supabase = get_supabase_admin()
    try:
        res = (
            supabase.table("organizations")
            .select("organization_name")
            .eq("id", org_id)
            .single()
            .execute()
        )
        return {"organization_name": (res.data or {}).get("organization_name")}
    except Exception:
        return {"organization_name": None}


# ── Compliance Alerts ─────────────────────────────────────────────────────────

@router.get("/compliance-alerts")
async def get_compliance_alerts(current_user: dict = Depends(get_current_user)):
    """
    Return credential-based compliance alerts derived from the credentials table.
    Coordinators see the full team view; workers see only their own credentials.
    """
    supabase = get_supabase_admin()
    org_id = _get_org_id(current_user)

    try:
        if is_coordinator_role(current_user) and org_id:
            cred_res = (
                supabase.table("credentials")
                .select("id, credential_type, title, expiry_date, status, user_id")
                .eq("organization_id", org_id)
                .execute()
            )
            rows: list[dict] = cred_res.data or []

            user_ids = list({str(r["user_id"]) for r in rows if r.get("user_id")})
            names_by_id: dict[str, str] = {}
            if user_ids:
                u_res = (
                    supabase.table("users")
                    .select("id, full_name, email")
                    .in_("id", user_ids)
                    .execute()
                )
                for u in u_res.data or []:
                    names_by_id[str(u["id"])] = (
                        u.get("full_name") or u.get("email") or "Team member"
                    )
        else:
            uid = get_user_id(current_user)
            cred_res = (
                supabase.table("credentials")
                .select("id, credential_type, title, expiry_date, status, user_id")
                .eq("user_id", uid)
                .execute()
            )
            rows = cred_res.data or []
            names_by_id = {}
    except Exception:
        return []

    today = date.today()

    def _live_status(row: dict) -> str:
        exp = row.get("expiry_date")
        s = row.get("status") or "valid"
        if s in ("rejected", "pending_review"):
            return s
        if not exp:
            return s
        try:
            d = date.fromisoformat(str(exp)[:10])
            if d < today:
                return "expired"
            if (d - today).days <= 30:
                return "expiring"
        except Exception:
            pass
        return "valid"

    type_groups: dict[str, list[dict]] = {}
    for row in rows:
        live = _live_status(row)
        if live not in ("expired", "expiring"):
            continue
        label = row.get("credential_type") or row.get("title") or "Credential"
        type_groups.setdefault(label, []).append({**row, "_live_status": live})

    alerts = []
    for label, creds in type_groups.items():
        count = len(creds)
        staff_names = [
            names_by_id.get(str(c["user_id"]), "Team member")
            for c in creds
            if c.get("user_id")
        ]

        min_days: int | None = None
        any_expired = False
        for c in creds:
            exp = c.get("expiry_date")
            if exp:
                try:
                    d = date.fromisoformat(str(exp)[:10])
                    days = (d - today).days
                    if min_days is None or days < min_days:
                        min_days = days
                    if days < 0:
                        any_expired = True
                except Exception:
                    pass

        if any_expired:
            severity = "critical"
        elif min_days is not None and min_days <= 14:
            severity = "critical"
        else:
            severity = "high"

        due_date_str: str | None = None
        if min_days is not None:
            due_date_str = (today + timedelta(days=min_days)).isoformat()

        noun = "credential" if count == 1 else "credentials"
        subj = "1 team member has" if count == 1 else f"{count} team members have"
        detail = f"{subj} {label} {noun} that {'is' if count == 1 else 'are'} {'expired' if any_expired else 'expiring soon'}."
        if any_expired:
            detail += " Immediate action required."

        alerts.append({
            "id": f"cred-{label.lower().replace(' ', '-').replace('/', '-')}",
            "title": f"{label} {'Expired' if any_expired else 'Expiring'}",
            "detail": detail,
            "severity": severity,
            "due_date": due_date_str,
            "affected_staff": staff_names[:5],
            "action_label": "Review Credentials",
            "source": "credentials",
        })

    alerts.sort(key=lambda a: ({"critical": 0, "high": 1, "medium": 2, "info": 3, "positive": 4}.get(a["severity"], 5)))
    return alerts


# ── Organisation Events ───────────────────────────────────────────────────────

class OrgEventBody(BaseModel):
    title: str
    event_date: str
    duration: str = "1 hour"
    event_type: str = "meeting"
    location: Optional[str] = None
    participants_desc: Optional[str] = None


@router.get("/org-events")
async def list_org_events(current_user: dict = Depends(get_current_user)):
    """List upcoming org calendar events from the database."""
    org_id = _get_org_id(current_user)
    if not org_id:
        return []
    supabase = get_supabase_admin()
    try:
        today = date.today().isoformat()
        result = (
            supabase.table("org_events")
            .select("*")
            .eq("organization_id", org_id)
            .gte("event_date", today)
            .order("event_date", desc=False)
            .limit(20)
            .execute()
        )
        return result.data or []
    except Exception:
        return []


@router.post("/org-events", status_code=201)
async def create_org_event(body: OrgEventBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    allowed_types = {"audit", "training", "meeting", "review"}
    if body.event_type not in allowed_types:
        raise HTTPException(status_code=422, detail=f"event_type must be one of: {', '.join(allowed_types)}")
    supabase = get_supabase_admin()
    payload = {
        **body.model_dump(),
        "organization_id": org_id,
        "created_by": get_user_id(current_user),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        result = supabase.table("org_events").insert(payload).execute()
        return result.data[0] if result.data else payload
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not create event: {e}")


@router.delete("/org-events/{event_id}", status_code=204)
async def delete_org_event(event_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        supabase.table("org_events").delete().eq("id", event_id).eq("organization_id", org_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not delete event: {e}")
    return None


# ── Announcements ─────────────────────────────────────────────────────────────

class AnnouncementBody(BaseModel):
    title: str
    body: str
    severity: str = "info"
    category: str = "Announcement"


_VALID_SEVERITIES = {"critical", "high", "medium", "info", "positive"}


@router.get("/announcements")
async def list_announcements(current_user: dict = Depends(get_current_user)):
    """List org-wide announcements — readable by any org member."""
    org_id = _get_org_id(current_user)
    if not org_id:
        return []
    supabase = get_supabase_admin()
    try:
        result = (
            supabase.table("announcements")
            .select("*")
            .eq("organization_id", org_id)
            .order("created_at", desc=True)
            .limit(20)
            .execute()
        )
        return result.data or []
    except Exception:
        return []


@router.post("/announcements", status_code=201)
async def create_announcement(body: AnnouncementBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    if body.severity not in _VALID_SEVERITIES:
        raise HTTPException(status_code=422, detail=f"severity must be one of: {', '.join(_VALID_SEVERITIES)}")
    supabase = get_supabase_admin()
    payload = {
        **body.model_dump(),
        "organization_id": org_id,
        "created_by": get_user_id(current_user),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        result = supabase.table("announcements").insert(payload).execute()
        return result.data[0] if result.data else payload
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not publish announcement: {e}")


@router.delete("/announcements/{announcement_id}", status_code=204)
async def delete_announcement(announcement_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        supabase.table("announcements").delete().eq("id", announcement_id).eq("organization_id", org_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not delete announcement: {e}")
    return None


# ── Staff Community ───────────────────────────────────────────────────────────

@router.get("/community")
async def get_community(current_user: dict = Depends(get_current_user)):
    """
    Return staff community highlights: new starters (joined ≤30 days ago),
    work anniversaries (±7 days of annual date), and birthdays (±1 day / next 7 days)
    derived from the organization_members and users tables.
    """
    org_id = _get_org_id(current_user)
    if not org_id:
        return []
    supabase = get_supabase_admin()
    today = date.today()

    try:
        mem_res = (
            supabase.table("organization_members")
            .select("user_id, joined_at, is_active")
            .eq("organization_id", org_id)
            .execute()
        )
        members: list[dict] = [r for r in (mem_res.data or []) if r.get("is_active") is not False]
    except Exception:
        members = []

    user_ids = [str(r["user_id"]) for r in members if r.get("user_id")]

    if not user_ids:
        try:
            u_res = (
                supabase.table("users")
                .select("id, full_name, email, date_of_birth, created_at")
                .eq("organization_id", org_id)
                .execute()
            )
            user_rows = u_res.data or []
        except Exception:
            return []

        items = []
        for u in user_rows:
            uid = str(u.get("id") or "")
            name = u.get("full_name") or u.get("email") or "Team member"
            initials = "".join(p[0].upper() for p in name.split()[:2])
            joined_str = u.get("created_at")
            if joined_str:
                try:
                    j = date.fromisoformat(str(joined_str)[:10])
                    if (today - j).days <= 30:
                        items.append({
                            "id": f"new-{uid}",
                            "type": "new_starter",
                            "name": name,
                            "detail": f"{name} recently joined the team. Welcome aboard!",
                            "date": j.isoformat(),
                            "avatar": initials,
                        })
                    years = today.year - j.year
                    ann = j.replace(year=today.year)
                    if -3 <= (ann - today).days <= 7 and years > 0:
                        items.append({
                            "id": f"ann-{uid}",
                            "type": "anniversary",
                            "name": name,
                            "detail": f"{name} celebrates {years} year{'s' if years > 1 else ''} with the organisation. Thank you for your dedication!",
                            "date": ann.isoformat(),
                            "avatar": initials,
                        })
                except Exception:
                    pass
        items.sort(key=lambda x: x.get("date") or "", reverse=True)
        return items

    try:
        u_res = (
            supabase.table("users")
            .select("id, full_name, email, date_of_birth")
            .in_("id", user_ids)
            .execute()
        )
        profiles: dict[str, dict] = {
            str(u["id"]): u for u in (u_res.data or []) if u.get("id")
        }
    except Exception:
        profiles = {}

    joined_by_uid: dict[str, str | None] = {
        str(r["user_id"]): r.get("joined_at") for r in members if r.get("user_id")
    }

    items = []
    for uid, profile in profiles.items():
        name = profile.get("full_name") or profile.get("email") or "Team member"
        initials = "".join(p[0].upper() for p in name.split()[:2])

        joined_str = joined_by_uid.get(uid)
        if joined_str:
            try:
                j = date.fromisoformat(str(joined_str)[:10])
                days_since = (today - j).days
                if days_since <= 30:
                    items.append({
                        "id": f"new-{uid}",
                        "type": "new_starter",
                        "name": name,
                        "detail": f"{name} recently joined the team. Welcome aboard!",
                        "date": j.isoformat(),
                        "avatar": initials,
                    })
                years = today.year - j.year
                ann = j.replace(year=today.year)
                days_to_ann = (ann - today).days
                if -3 <= days_to_ann <= 7 and years > 0:
                    items.append({
                        "id": f"ann-{uid}",
                        "type": "anniversary",
                        "name": name,
                        "detail": f"{name} celebrates {years} year{'s' if years > 1 else ''} with the organisation. Thank you for your dedication!",
                        "date": ann.isoformat(),
                        "avatar": initials,
                    })
            except Exception:
                pass

        dob_str = profile.get("date_of_birth")
        if dob_str:
            try:
                dob = date.fromisoformat(str(dob_str)[:10])
                bday = dob.replace(year=today.year)
                days_to_bday = (bday - today).days
                if -1 <= days_to_bday <= 7:
                    suffix = "!" if days_to_bday <= 0 else " coming up soon!"
                    items.append({
                        "id": f"bday-{uid}",
                        "type": "birthday",
                        "name": name,
                        "detail": f"Wishing {name} a wonderful birthday{suffix}",
                        "date": bday.isoformat(),
                        "avatar": initials,
                    })
            except Exception:
                pass

    items.sort(key=lambda x: x.get("date") or "", reverse=True)
    return items
