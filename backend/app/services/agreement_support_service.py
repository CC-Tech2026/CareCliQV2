"""Agreement-led shifts, stage 3a: which agreed support a shift delivers.

A service agreement line (service_agreement_supports) names one NDIS item
code, but NDIS codes are tied to a time of day and day type, so a line is
treated as a *support*: its code plus the catalogue's other time-of-day
versions of the same item. Two codes are the same support when they share
support category (first part of the code), registration group, support
purpose, unit, and the item name once its day and time words are removed.
Intensity stays in the name ("Standard", "High Intensity"), so standard and
high intensity never mix; the catalogue's own intensity and category fields
are empty, so they can't be used.

Hours are counted per line: delivered (completed shifts, at their billed
minutes once verified), booked in the next four weeks (what the picker
shows), and booked later. The overrun warning counts every booking up to
the agreement's end date. Lines billed per unit rather than per hour aren't
counted in hours.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

BOOKED_WINDOW_DAYS = 28
HOUR_UNITS = {"H", "HOUR", "HR"}
PICKABLE_STATUSES = ("pending_signature", "active")
_OPEN_SHIFT_STATUSES = {"scheduled", "unassigned", "in_progress", "clocked_in"}

_DAY_TIME_WORDS = re.compile(
    r"\b(weekday|saturday|sunday|public holiday|daytime|evening|night)\b", re.IGNORECASE
)


def _base_name(name: Optional[str]) -> str:
    """The item name without its day and time words: "Assistance With
    Self-Care Activities - Standard - Weekday Daytime" -> "assistance with
    self-care activities - standard". Sleepover items keep "night" because
    "Night-Time Sleepover" isn't a time band."""
    text = str(name or "")
    if "sleepover" not in text.lower():
        text = _DAY_TIME_WORDS.sub("", text)
    text = re.sub(r"\s*-\s*(-\s*)+", " - ", text)
    return re.sub(r"\s{2,}", " ", text).strip(" -").lower()


def support_group_key(item: dict[str, Any]) -> tuple:
    return (
        str(item.get("item_code") or "").split("_")[0],
        item.get("registration_group"),
        item.get("support_purpose"),
        str(item.get("unit") or "").upper(),
        _base_name(item.get("name")),
    )


def _catalogue(codes: Optional[list[str]] = None) -> list[dict[str, Any]]:
    """Current platform catalogue rows (all of them, or just `codes`)."""
    cols = "item_code, name, unit, registration_group, support_purpose, day_type, time_type, price_national"
    out: list[dict[str, Any]] = []
    start = 0
    while True:
        q = get_supabase_admin().table("platform_ndis_price_items").select(cols).is_("valid_to", "null")
        if codes is not None:
            q = q.in_("item_code", codes)
        page = q.range(start, start + 999).execute().data or []
        out += page
        if len(page) < 1000 or codes is not None:
            return out
        start += 1000


def support_groups(codes: list[str], catalogue: Optional[list[dict[str, Any]]] = None) -> dict[str, list[dict[str, Any]]]:
    """code -> every current catalogue item in the same support (the code
    itself included). A code not in the current catalogue maps to []."""
    rows = catalogue if catalogue is not None else _catalogue()
    by_key: dict[tuple, list[dict[str, Any]]] = {}
    by_code: dict[str, dict[str, Any]] = {}
    for row in rows:
        by_key.setdefault(support_group_key(row), []).append(row)
        by_code[str(row["item_code"])] = row
    return {
        code: sorted(by_key.get(support_group_key(by_code[code]), []), key=lambda r: r["item_code"])
        if code in by_code else []
        for code in dict.fromkeys(codes)
    }


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _minutes(start: Any, end: Any) -> float:
    s, e = _parse(start), _parse(end)
    return max(0.0, (e - s).total_seconds() / 60) if s and e else 0.0


def _rows(resp: Any) -> list[dict[str, Any]]:
    data = getattr(resp, "data", None)
    return [r for r in data if isinstance(r, dict)] if isinstance(data, list) else []


def line_usage(line_ids: list[str], org_id: str, *, now: Optional[datetime] = None,
               exclude_shift_id: Optional[str] = None) -> dict[str, dict[str, float]]:
    """line id -> minutes delivered, booked in the next four weeks, booked later."""
    now = now or datetime.now(timezone.utc)
    usage = {lid: {"delivered": 0.0, "booked_soon": 0.0, "booked_later": 0.0} for lid in line_ids}
    if not line_ids:
        return usage
    supabase = get_supabase_admin()
    shifts = _rows(
        supabase.table("shifts")
        .select("id, status, service_agreement_support_id, scheduled_start, scheduled_end, clocked_in_at, clocked_out_at")
        .in_("service_agreement_support_id", line_ids).eq("organization_id", org_id).execute()
    )
    shifts = [s for s in shifts if str(s.get("id")) != str(exclude_shift_id or "")]
    completed_ids = [str(s["id"]) for s in shifts if s.get("status") == "completed"]
    billed: dict[str, float] = {}
    if completed_ids:
        try:
            verifications = _rows(
                supabase.table("shift_verifications").select("shift_id, checks_run")
                .in_("shift_id", completed_ids).is_("reversed_at", "null").execute()
            )
        except Exception:  # migration 233 not applied: no reversals yet
            verifications = _rows(
                supabase.table("shift_verifications").select("shift_id, checks_run")
                .in_("shift_id", completed_ids).execute()
            )
        for v in verifications:
            minutes = ((v.get("checks_run") or {}).get("billing") or {}).get("billable_minutes")
            if minutes is not None:
                billed[str(v["shift_id"])] = float(minutes)
    soon_until = now + timedelta(days=BOOKED_WINDOW_DAYS)
    for s in shifts:
        bucket = usage.get(str(s.get("service_agreement_support_id")))
        if bucket is None or s.get("status") == "cancelled":
            continue
        if s.get("status") == "completed":
            worked = _minutes(s.get("clocked_in_at"), s.get("clocked_out_at")) or _minutes(s.get("scheduled_start"), s.get("scheduled_end"))
            bucket["delivered"] += billed.get(str(s["id"]), worked)
        elif s.get("status") in _OPEN_SHIFT_STATUSES:
            start = _parse(s.get("scheduled_start"))
            key = "booked_soon" if start is None or start <= soon_until else "booked_later"
            bucket[key] += _minutes(s.get("scheduled_start"), s.get("scheduled_end"))
    return usage


def _agreements_with_lines(participant_id: str, org_id: str) -> list[dict[str, Any]]:
    """Sent or active agreements (never drafts: a draft replaces its lines
    on every edit) with their support lines."""
    return _rows(
        get_supabase_admin().table("service_agreements")
        .select("id, agreement_number, status, start_date, end_date, service_agreement_supports(*)")
        .eq("organization_id", org_id).eq("participant_id", participant_id)
        .in_("status", list(PICKABLE_STATUSES)).order("start_date", desc=True).execute()
    )


def _hours(minutes: float) -> float:
    return round(minutes / 60, 2)


def creation_warnings(
    line: dict[str, Any],
    *,
    start: Optional[datetime],
    end: Optional[datetime],
    local_date: Optional[date],
) -> list[str]:
    """Warnings for rostering a shift on this line. Never blocks: the same
    checks need a reason at verification (stage 3c)."""
    warnings: list[str] = []
    if local_date is not None:
        if line.get("start_date") and local_date.isoformat() < str(line["start_date"])[:10]:
            warnings.append(f"The shift is before this agreement starts ({str(line['start_date'])[:10]}).")
        if line.get("end_date") and local_date.isoformat() > str(line["end_date"])[:10]:
            warnings.append(f"The shift is after this agreement ends ({str(line['end_date'])[:10]}).")
    if line.get("agreement_status") == "pending_signature":
        warnings.append("This agreement hasn't been signed yet.")
    allocated = line.get("hours_allocated")
    if line.get("counted") and allocated is not None and start and end:
        after = (line["delivered_hours"] + line["booked_soon_hours"] + line["booked_later_hours"]
                 + _hours(_minutes(start, end)))
        if after > float(allocated) + 0.001:
            warnings.append(
                f"With every booking up to the agreement end, this goes {round(after - float(allocated), 2):g}h "
                f"over the {float(allocated):g}h agreed."
            )
    return warnings


def list_participant_supports(
    participant_id: str,
    org_id: str,
    *,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    local_date: Optional[date] = None,
    exclude_shift_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Every pickable agreement line for the participant with its usage, and
    the rostering warnings for a proposed shift when start/end are given."""
    agreements = _agreements_with_lines(participant_id, org_id)
    raw_lines = [(a, line) for a in agreements for line in (a.get("service_agreement_supports") or [])]
    if not raw_lines:
        return []
    codes = [str(line["support_item_code"]) for _, line in raw_lines]
    catalogue = _catalogue(None)
    groups = support_groups(codes, catalogue)
    usage = line_usage([str(line["id"]) for _, line in raw_lines], org_id, exclude_shift_id=exclude_shift_id)
    out: list[dict[str, Any]] = []
    for agreement, line in raw_lines:
        code = str(line["support_item_code"])
        group = groups.get(code, [])
        item = next((g for g in group if g["item_code"] == code), None)
        unit = str(line.get("unit") or (item or {}).get("unit") or "H").upper()
        counted = unit in HOUR_UNITS
        used = usage[str(line["id"])]
        allocated = line.get("total_hours_allocated")
        entry = {
            "id": line["id"],
            "service_agreement_id": agreement["id"],
            "agreement_number": agreement.get("agreement_number"),
            "agreement_status": agreement.get("status"),
            "start_date": agreement.get("start_date"),
            "end_date": agreement.get("end_date"),
            "support_item_code": code,
            "item_name": line.get("item_name") or (item or {}).get("name"),
            "unit": unit,
            "frequency": line.get("frequency"),
            "location": line.get("location"),
            "group_codes": [g["item_code"] for g in group],
            "in_current_catalogue": item is not None,
            "counted": counted,
            "hours_allocated": float(allocated) if allocated is not None and counted else None,
            "delivered_hours": _hours(used["delivered"]),
            "booked_soon_hours": _hours(used["booked_soon"]),
            "booked_later_hours": _hours(used["booked_later"]),
        }
        entry["left_hours"] = (
            round(entry["hours_allocated"] - entry["delivered_hours"] - entry["booked_soon_hours"]
                  - entry["booked_later_hours"], 2)
            if entry["hours_allocated"] is not None else None
        )
        entry["warnings"] = creation_warnings(entry, start=start, end=end, local_date=local_date) if start else []
        out.append(entry)
    return out


# ── Verification (stage 3c) ───────────────────────────────────────────────

# An agreement that has since expired or ended still covers the shifts
# delivered while it ran.
_VERIFY_STATUSES = ("pending_signature", "active", "expired", "ended")


def _verification_lines(participant_id: str, org_id: str) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    agreements = _rows(
        get_supabase_admin().table("service_agreements")
        .select("id, agreement_number, status, start_date, end_date, service_agreement_supports(*)")
        .eq("organization_id", org_id).eq("participant_id", participant_id)
        .in_("status", list(_VERIFY_STATUSES)).execute()
    )
    return [(a, line) for a in agreements for line in (a.get("service_agreement_supports") or [])]


def _covers(agreement: dict[str, Any], day: date) -> bool:
    start, end = str(agreement.get("start_date") or "")[:10], str(agreement.get("end_date") or "")[:10]
    return (not start or day.isoformat() >= start) and (not end or day.isoformat() <= end)


def _pick(candidates: list[tuple[dict, dict]], day: date) -> Optional[tuple[dict, dict]]:
    """One line, or None when it would be a guess. Lines on an agreement that
    covers the shift's date win over lines on other agreements."""
    covering = [c for c in candidates if _covers(c[0], day)]
    pool = covering or candidates
    return pool[0] if len(pool) == 1 else None


def assess_for_verification(
    shift: dict[str, Any],
    *,
    billed_code: Optional[str],
    local_start: datetime,
    local_end: datetime,
    holidays: set[str],
    billable_minutes: Optional[float],
) -> dict[str, Any]:
    """Re-match a finished shift to its agreement line using the actual date
    and times, and say what needs a reason before it's billed.

    The time band picks the code within the shift's support (its stored
    line, else its expected item). The billed code then finds the line:
    an exact code first (the line stored at rostering wins a tie), else the
    one line whose support contains it. Several lines and none exact is
    never guessed. The agreed rate applies only to the line's own code."""
    from . import ndis_time_band_service as bands_svc

    participant_id = str(shift.get("participant_id") or "")
    org_id = str(shift.get("organization_id") or "")
    stored_id = str(shift.get("service_agreement_support_id") or "") or None
    day = local_start.date()

    lines = _verification_lines(participant_id, org_id)
    stored = next(((a, l) for a, l in lines if str(l["id"]) == stored_id), None)
    bands = bands_svc.support_bands(local_start, local_end, holidays)

    reference = (stored[1]["support_item_code"] if stored else None) or shift.get("expected_price_item_code")
    catalogue = _catalogue(None)
    by_code = {str(r["item_code"]): r for r in catalogue}
    suggested = None
    if reference:
        group = support_groups([str(reference)], catalogue)[str(reference)]
        chosen = bands_svc.choose_code(group, bands)
        suggested = chosen["item_code"] if chosen else str(reference)
    billed = billed_code or suggested
    billed_item = by_code.get(str(billed)) if billed else None
    billed_band = bands_svc.item_band(billed_item) if billed_item else None
    band_warning = None
    if billed_band and bands and billed_band not in bands:
        band_warning = (
            f"{billed} is priced for {bands_svc.BAND_LABELS[billed_band]}, but the shift ran "
            f"{bands_svc.bands_label(bands)}."
        )

    match = None
    ambiguous = False
    if billed and lines:
        exact = [(a, l) for a, l in lines if str(l["support_item_code"]) == str(billed)]
        if exact:
            match = stored if stored in exact else _pick(exact, day)
            ambiguous = match is None
        else:
            groups = support_groups([str(l["support_item_code"]) for _, l in lines], catalogue)
            in_group = [(a, l) for a, l in lines if str(billed) in {g["item_code"] for g in groups[str(l["support_item_code"])]}]
            match = _pick(in_group, day)
            ambiguous = match is None and len(in_group) > 1

    issues: list[dict[str, str]] = []
    if not lines:
        issues.append({"code": "no_agreement", "message": "This participant has no sent or signed service agreement."})
    elif match is None:
        issues.append({
            "code": "no_line",
            "message": (
                f"{billed} matches more than one support on the agreement, so it can't be counted against one."
                if ambiguous else f"{billed or 'The billed item'} isn't a support on this participant's agreement."
            ),
        })

    matched_line = None
    agreed_rate = None
    if match:
        agreement, line = match
        if not _covers(agreement, day):
            issues.append({"code": "outside_dates", "message": (
                f"The shift ({day.isoformat()}) is outside the agreement dates "
                f"({str(agreement.get('start_date') or '')[:10]} to {str(agreement.get('end_date') or 'open')[:10]})."
            )})
        if agreement.get("status") == "pending_signature":
            issues.append({"code": "unsigned", "message": "The agreement hasn't been signed yet."})
        allocated = line.get("total_hours_allocated")
        unit = str(line.get("unit") or (by_code.get(str(line["support_item_code"])) or {}).get("unit") or "H").upper()
        if allocated is not None and unit in HOUR_UNITS and billable_minutes:
            used = line_usage([str(line["id"])], org_id, exclude_shift_id=str(shift.get("id")))[str(line["id"])]
            total = _hours(used["delivered"] + used["booked_soon"] + used["booked_later"] + float(billable_minutes))
            if total > float(allocated) + 0.001:
                issues.append({"code": "over_hours", "message": (
                    f"With every booking up to the agreement end, this support is "
                    f"{round(total - float(allocated), 2):g}h over the {float(allocated):g}h agreed."
                )})
        if str(billed) == str(line["support_item_code"]) and line.get("negotiated_rate") is not None:
            agreed_rate = float(line["negotiated_rate"])
        matched_line = {
            "id": str(line["id"]),
            "service_agreement_id": str(agreement["id"]),
            "agreement_number": agreement.get("agreement_number"),
            "support_item_code": line["support_item_code"],
            "item_name": (by_code.get(str(line["support_item_code"])) or {}).get("name"),
        }

    return {
        "bands": bands,
        "bands_label": bands_svc.bands_label(bands),
        "crosses_bands": len(bands) > 1,
        "suggested_code": suggested,
        "billed_code": billed,
        "billed_band": billed_band,
        "band_warning": band_warning,
        "stored_line_id": stored_id,
        "matched_line": matched_line,
        "line_changed": bool(matched_line and matched_line["id"] != stored_id),
        "agreed_rate": agreed_rate,
        "issues": issues,
    }


def resolve_line_for_shift(
    supabase, *, line_id: str, participant_id: str, org_id: str
) -> dict[str, Any]:
    """The agreement line a new shift links to — it must belong to one of the
    participant's sent or active agreements in this organisation."""
    line = (_rows(
        supabase.table("service_agreement_supports")
        .select("id, support_item_code, service_agreement_id, service_agreements(organization_id, participant_id, status)")
        .eq("id", line_id).limit(1).execute()
    ) or [None])[0]
    agreement = (line or {}).get("service_agreements") or {}
    if (
        not line
        or str(agreement.get("organization_id")) != str(org_id)
        or str(agreement.get("participant_id")) != str(participant_id)
        or agreement.get("status") not in PICKABLE_STATUSES
    ):
        raise HTTPException(status_code=422, detail="That support isn't on this participant's agreement.")
    return line
