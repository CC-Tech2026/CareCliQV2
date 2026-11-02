"""Bring a provider's existing participants and staff across from another
system (ShiftCare, Brevity, SupportAbility, Lumary, CareMaster, or a plain
spreadsheet) as a CSV export.

Flow: parse_csv() reads the file and suggests which column holds which
field; the page lets the director correct that; preview_*() validates every
row without writing anything; import_*() re-validates on the server and
writes only the rows that are ready.

Participants land on the onboarding board (source "import"), not as active
participants: nobody is rostered until their CareCliQ service agreement is
signed, the same rule as every other new participant. Their plan and contact
details come across, so the director's remaining work is the agreement, not
retyping. Staff become ordinary invitations, emailed the usual way.
"""

from __future__ import annotations

import csv
import io
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

from .supabase_client import get_supabase_admin

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_ROWS = 2000

SOURCE_SYSTEMS = ("spreadsheet", "shiftcare", "brevity", "supportability", "lumary", "caremaster", "other")

# Header aliases, compared after lower-casing and dropping everything but
# letters and digits ("NDIS No." -> "ndisno"). Broad on purpose: vendors
# label the same thing differently, and the director can always re-map.
PARTICIPANT_FIELDS: dict[str, tuple[str, ...]] = {
    "full_name": ("name", "fullname", "clientname", "participantname", "customername", "displayname", "client", "participant"),
    "first_name": ("firstname", "givenname", "givennames", "forename", "first"),
    "last_name": ("lastname", "surname", "familyname", "last"),
    "ndis_number": ("ndisnumber", "ndisno", "ndis", "ndisnum", "ndisid", "ndisparticipantnumber", "participantnumber", "ndisreference", "ndisref"),
    "date_of_birth": ("dateofbirth", "dob", "birthdate", "birthday", "dateofbirthddmmyyyy"),
    "email": ("email", "emailaddress", "clientemail", "participantemail", "personalemail"),
    "phone": ("phone", "mobile", "mobilephone", "phonenumber", "contactnumber", "mobilenumber", "telephone", "homephone", "cell"),
    "address": ("address", "streetaddress", "residentialaddress", "homeaddress", "fulladdress", "address1", "addressline1"),
    "plan_start_date": ("planstart", "planstartdate", "ndisplanstart", "ndisplanstartdate", "plandatefrom", "planfrom", "startdate"),
    "plan_end_date": ("planend", "planenddate", "ndisplanend", "ndisplanenddate", "planreviewdate", "plandateto", "planto", "planexpiry", "enddate", "reviewdate"),
    "total_budget": ("totalbudget", "budget", "planbudget", "totalfunding", "funding", "planfunding", "plantotal", "planvalue", "totalplanbudget"),
    "plan_management_type": ("planmanagement", "planmanagementtype", "managementtype", "fundingmanagement", "fundingtype", "managedby", "planmanager", "fundmanagement"),
    "primary_disability": ("primarydisability", "disability", "diagnosis", "primarydiagnosis", "disabilitytype"),
}

STAFF_FIELDS: dict[str, tuple[str, ...]] = {
    "full_name": ("name", "fullname", "staffname", "employeename", "workername", "displayname"),
    "first_name": ("firstname", "givenname", "forename", "first"),
    "last_name": ("lastname", "surname", "familyname", "last"),
    "email": ("email", "emailaddress", "workemail", "staffemail", "personalemail"),
    "role": ("role", "position", "jobtitle", "title", "employeetype", "stafftype", "type", "jobrole"),
    "phone": ("phone", "mobile", "mobilephone", "phonenumber", "contactnumber", "mobilenumber"),
}

FIELDS_BY_KIND = {"participants": PARTICIPANT_FIELDS, "staff": STAFF_FIELDS}

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _norm(header: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (header or "").lower())


# ---------------------------------------------------------------------------
# Reading the file
# ---------------------------------------------------------------------------

def parse_csv(raw: bytes, kind: str) -> dict[str, Any]:
    if kind not in FIELDS_BY_KIND:
        raise ValueError("Choose participants or staff.")
    if not raw:
        raise ValueError("The file is empty.")
    if len(raw) > MAX_FILE_BYTES:
        raise ValueError("The file is larger than 5 MB. Split it into smaller files.")
    if raw[:2] == b"PK":
        raise ValueError("That looks like an Excel workbook. In Excel choose File, Save As, CSV, then upload the CSV.")

    text = None
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError("Couldn't read the file. Save it as CSV (UTF-8) and try again.")

    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = [row for row in csv.reader(io.StringIO(text), dialect) if any(cell.strip() for cell in row)]
    if not rows:
        raise ValueError("The file has no rows.")

    headers = [h.strip() for h in rows[0]]
    body = rows[1:]
    if not body:
        raise ValueError("The file only has a header row.")
    if len(body) > MAX_ROWS:
        raise ValueError(f"The file has {len(body)} rows. Import up to {MAX_ROWS} at a time.")
    width = len(headers)
    body = [(row + [""] * width)[:width] for row in body]
    return {"headers": headers, "rows": body, "suggested_mapping": suggest_mapping(headers, kind)}


def suggest_mapping(headers: list[str], kind: str) -> dict[str, Optional[str]]:
    fields = FIELDS_BY_KIND[kind]
    normalized = [_norm(h) for h in headers]
    used: set[int] = set()
    mapping: dict[str, Optional[str]] = {}
    for field, aliases in fields.items():
        mapping[field] = None
        for alias in aliases:
            for i, h in enumerate(normalized):
                if i not in used and h == alias:
                    mapping[field] = headers[i]
                    used.add(i)
                    break
            if mapping[field]:
                break
    # "Name" matched as a full name but the file also splits first/last:
    # prefer the split columns only when there is no full-name column.
    if mapping.get("full_name") and mapping.get("first_name") and mapping.get("last_name"):
        mapping["first_name"] = mapping["last_name"] = None
    return mapping


# ---------------------------------------------------------------------------
# Value parsing
# ---------------------------------------------------------------------------

_DATE_FORMATS = (
    "%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d-%m-%y", "%d.%m.%Y", "%Y-%m-%d", "%Y/%m/%d",
    "%d %b %Y", "%d %B %Y", "%d-%b-%Y", "%d-%b-%y", "%b %d %Y", "%B %d %Y", "%b %d, %Y", "%B %d, %Y",
)


def parse_date(value: str, *, birth: bool = False) -> Optional[date]:
    """Australian exports write dates day-first (12/03/1985 is 12 March).
    Also takes ISO dates, month names, a trailing time ("12/03/1985 0:00"),
    and Excel serial day numbers. Returns None when it can't be read."""
    text = (value or "").strip()
    if not text:
        return None
    if re.fullmatch(r"\d{5}(\.0+)?", text):
        serial = int(float(text))
        if 1 <= serial <= 80000:
            return date(1899, 12, 30) + timedelta(days=serial)
    candidates = [text]
    if " " in text or "T" in text:
        candidates.append(re.split(r"[ T]", text, maxsplit=1)[0])
    for candidate in candidates:
        for fmt in _DATE_FORMATS:
            try:
                parsed = datetime.strptime(candidate, fmt).date()
            except ValueError:
                continue
            if birth and parsed > date.today() and parsed.year > 1999:
                parsed = parsed.replace(year=parsed.year - 100)
            return parsed
    return None


def parse_money(value: str) -> Optional[float]:
    text = re.sub(r"(?i)aud|\$|,|\s", "", value or "")
    if not text:
        return None
    try:
        amount = float(text)
    except ValueError:
        return None
    return amount if amount >= 0 else None


def parse_plan_management(value: str) -> Optional[str]:
    text = _norm(value)
    if not text:
        return None
    if "self" in text or text == "sm":
        return "self-managed"
    if "ndia" in text or "agency" in text or text == "am":
        return "NDIA-managed"
    if "plan" in text or text == "pm":
        return "plan-managed"
    return None


def parse_role(value: str) -> Optional[str]:
    text = _norm(value)
    if not text:
        return "support_worker"
    if any(word in text for word in ("coordinat", "teamlead", "teamleader", "manager", "supervisor", "rostering", "scheduler")):
        return "support_coordinator"
    if any(word in text for word in ("worker", "carer", "support", "disability", "caregiver", "casual", "dsw", "assistant")):
        return "support_worker"
    return None


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _name(record: dict[str, Any]) -> str:
    full = _clean(record.get("full_name"))
    if full:
        return full
    return _clean(f"{_clean(record.get('first_name'))} {_clean(record.get('last_name'))}")


# ---------------------------------------------------------------------------
# Participants
# ---------------------------------------------------------------------------

def _existing_ndis_numbers(organization_id: str) -> tuple[set[str], set[str]]:
    db = get_supabase_admin()
    participants = db.table("participants").select("ndis_number").eq("organization_id", organization_id).execute().data or []
    intakes = (
        db.table("participant_intakes").select("ndis_number, status").eq("organization_id", organization_id).execute().data or []
    )
    active = {re.sub(r"\D", "", p.get("ndis_number") or "") for p in participants}
    onboarding = {
        re.sub(r"\D", "", i.get("ndis_number") or "")
        for i in intakes
        if i.get("status") not in ("declined", "withdrawn")
    }
    return active - {""}, onboarding - {""}


def preview_participants(organization_id: str, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(records) > MAX_ROWS:
        raise ValueError(f"Import up to {MAX_ROWS} rows at a time.")
    active, onboarding = _existing_ndis_numbers(organization_id)
    seen: set[str] = set()
    results = []
    for index, record in enumerate(records, start=1):
        errors: list[str] = []
        warnings: list[str] = []
        name = _name(record)
        if not name:
            errors.append("Name is missing.")

        ndis = re.sub(r"\D", "", _clean(record.get("ndis_number")))
        if not ndis:
            errors.append("NDIS number is missing.")
        elif len(ndis) != 9:
            errors.append("NDIS number should be 9 digits.")
        elif not ndis.startswith("43"):
            warnings.append("NDIS numbers usually start with 43. Check this one.")

        dob_raw = _clean(record.get("date_of_birth"))
        dob = parse_date(dob_raw, birth=True)
        if not dob_raw:
            errors.append("Date of birth is missing.")
        elif not dob:
            errors.append(f'Couldn\'t read the date of birth "{dob_raw}". Use DD/MM/YYYY.')
        elif dob > date.today():
            errors.append("Date of birth is in the future.")

        start_raw, end_raw = _clean(record.get("plan_start_date")), _clean(record.get("plan_end_date"))
        start, end = parse_date(start_raw), parse_date(end_raw)
        if start_raw and not start:
            warnings.append(f'Couldn\'t read the plan start "{start_raw}", so it was left blank.')
        if end_raw and not end:
            warnings.append(f'Couldn\'t read the plan end "{end_raw}", so it was left blank.')
        if start and end and end < start:
            errors.append("Plan end is before plan start.")
        elif end and end < date.today():
            warnings.append("This plan has already ended. Add their current plan after importing.")

        budget_raw = _clean(record.get("total_budget"))
        budget = parse_money(budget_raw)
        if budget_raw and budget is None:
            warnings.append(f'Couldn\'t read the budget "{budget_raw}", so it was left blank.')

        email = _clean(record.get("email")).lower()
        if email and not _EMAIL_RE.match(email):
            warnings.append(f'"{email}" isn\'t a valid email, so it was left blank.')
            email = ""

        pm_raw = _clean(record.get("plan_management_type"))
        plan_management = parse_plan_management(pm_raw)
        if pm_raw and not plan_management:
            warnings.append(f'Couldn\'t tell how "{pm_raw}" is managed. Set plan management after importing.')

        status = "error" if errors else "ready"
        if not errors:
            if ndis in active:
                status, errors = "duplicate", ["Already a participant in CareCliQ."]
            elif ndis in onboarding:
                status, errors = "duplicate", ["Already on the onboarding board."]
            elif ndis in seen:
                status, errors = "duplicate", ["Appears earlier in this file."]
        if ndis:
            seen.add(ndis)

        results.append({
            "row": index,
            "status": status,
            "errors": errors,
            "warnings": warnings,
            "record": {
                "full_name": name,
                "ndis_number": ndis,
                "date_of_birth": dob.isoformat() if dob else None,
                "email": email or None,
                "phone": _clean(record.get("phone")) or None,
                "address": _clean(record.get("address")) or None,
                "plan_start_date": start.isoformat() if start else None,
                "plan_end_date": end.isoformat() if end else None,
                "total_budget": budget,
                "plan_management_type": plan_management,
                "primary_disability": _clean(record.get("primary_disability")) or None,
            },
        })
    return results


def import_participants(
    organization_id: str, created_by: Optional[str], records: list[dict[str, Any]], source_system: str,
) -> dict[str, Any]:
    source_system = source_system if source_system in SOURCE_SYSTEMS else "other"
    results = preview_participants(organization_id, records)
    ready = [r for r in results if r["status"] == "ready"]
    imported_at = datetime.now(timezone.utc).isoformat()
    rows = []
    for result in ready:
        record = result["record"]
        rows.append({
            "id": str(uuid4()),
            "organization_id": organization_id,
            "created_by": created_by,
            "full_name": record["full_name"],
            "ndis_number": record["ndis_number"],
            "email": record["email"] or "",
            "phone": record["phone"] or "",
            "source": "import",
            "service_category": "disability",
            "status": "enquiry",
            "plan_start_date": record["plan_start_date"],
            "plan_end_date": record["plan_end_date"],
            "total_budget": f"{record['total_budget']:.2f}" if record["total_budget"] is not None else None,
            "web_intake": {
                "date_of_birth": record["date_of_birth"],
                "address": record["address"],
                "imported": {
                    "source_system": source_system,
                    "imported_at": imported_at,
                    "plan_management_type": record["plan_management_type"],
                    "primary_disability": record["primary_disability"],
                },
            },
        })
    if rows:
        table = get_supabase_admin().table("participant_intakes")
        try:
            table.insert(rows).execute()
        except Exception as exc:
            # Migration 244 adds the "import" source. Until it's applied, file
            # them as coordinator referrals; web_intake.imported still marks
            # them as imported for the onboarding board.
            if "participant_intakes_source_check" not in str(exc):
                raise
            for row in rows:
                row["source"] = "coordinator_referral"
            table.insert(rows).execute()
    return {
        "imported": len(rows),
        "skipped": len(results) - len(rows),
        "results": results,
    }


# ---------------------------------------------------------------------------
# Staff
# ---------------------------------------------------------------------------

def _existing_staff_emails(organization_id: str) -> tuple[set[str], set[str]]:
    db = get_supabase_admin()
    members = db.table("organization_members").select("user_id").eq("organization_id", organization_id).execute().data or []
    user_ids = [m["user_id"] for m in members if m.get("user_id")]
    emails: set[str] = set()
    for start in range(0, len(user_ids), 200):
        chunk = user_ids[start:start + 200]
        users = db.table("users").select("email").in_("id", chunk).execute().data or []
        emails.update((u.get("email") or "").lower() for u in users)
    now = datetime.now(timezone.utc).isoformat()
    invites = (
        db.table("invitations").select("email").eq("organization_id", organization_id)
        .is_("accepted_at", "null").gt("expires_at", now).execute().data or []
    )
    pending = {(i.get("email") or "").lower() for i in invites}
    return emails - {""}, pending - {""}


def preview_staff(organization_id: str, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(records) > MAX_ROWS:
        raise ValueError(f"Import up to {MAX_ROWS} rows at a time.")
    members, pending = _existing_staff_emails(organization_id)
    seen: set[str] = set()
    results = []
    for index, record in enumerate(records, start=1):
        errors: list[str] = []
        warnings: list[str] = []
        email = _clean(record.get("email")).lower()
        if not email:
            errors.append("Email is missing. Invitations are sent by email.")
        elif not _EMAIL_RE.match(email):
            errors.append(f'"{email}" isn\'t a valid email.')

        role_raw = _clean(record.get("role"))
        role = parse_role(role_raw)
        if role is None:
            role = "support_worker"
            warnings.append(f'Couldn\'t tell what "{role_raw}" is, so they\'ll be invited as a support worker.')

        status = "error" if errors else "ready"
        if not errors:
            if email in members:
                status, errors = "duplicate", ["Already on your team."]
            elif email in pending:
                status, errors = "duplicate", ["Already has an invitation waiting."]
            elif email in seen:
                status, errors = "duplicate", ["Appears earlier in this file."]
        if email:
            seen.add(email)
        results.append({
            "row": index,
            "status": status,
            "errors": errors,
            "warnings": warnings,
            "record": {"full_name": _name(record) or None, "email": email or None, "role": role},
        })
    return results


def import_staff(
    organization_id: str, invited_by: Optional[str], records: list[dict[str, Any]],
) -> dict[str, Any]:
    from ..api.invitations import _generate_short_code
    from ..core.config import settings
    from . import organization_branding_service
    from .email_service import queue_invitation_email

    results = preview_staff(organization_id, records)
    ready = [r for r in results if r["status"] == "ready"]
    db = get_supabase_admin()
    try:
        branding = organization_branding_service.get_branding(organization_id)
    except Exception:
        branding = {}

    sent = 0
    for result in ready:
        record = result["record"]
        token = secrets.token_hex(32)
        short_code = _generate_short_code(db)
        db.table("invitations").insert({
            "organization_id": organization_id,
            "invited_by": invited_by,
            "email": record["email"],
            "role": record["role"],
            "token": token,
            "short_code": short_code,
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        }).execute()
        queue_invitation_email(
            None,
            to_email=record["email"],
            invite_url=f"{settings.frontend_base_url.rstrip('/')}/accept-invite?token={token}",
            organization_name=branding.get("display_name"),
            role=record["role"],
            short_code=short_code,
            logo_url=branding.get("logo_url"),
            brand_accent_color=branding.get("brand_accent_color"),
        )
        sent += 1
    return {"imported": sent, "skipped": len(results) - sent, "results": results}
