"""Deterministic table/chart block builders for the CareCliQ chatbox ("Quill").

Builds structured "blocks" from each tool's raw return value (the
ToolMessage.artifact — see tools.py's response_format="content_and_artifact"
wiring), never from the LLM's prose. This is the "safety-critical decisions
are made by code, not the LLM" principle applied to numbers shown in a table:
the model narrates, the block data comes straight from the tool's dict.

Block shapes (kept intentionally small — 4 types cover every tool today):
  {"type": "stat", "label": str, "value": number|str, "target": number|None}
  {"type": "table", "title": str, "columns": [str, ...], "rows": [[cell, ...], ...]}
  {"type": "bar_chart", "title": str, "x_key": str, "series": [{"key": str, "label": str}], "data": [dict, ...]}
  {"type": "download", "title": str, "url": str, "count": int|None}
"""

from datetime import datetime
from typing import Any

from ...core.timezone import coerce_timezone, parse_shift_datetime, request_timezone


def _to_local(value: Any, tz_name: Any = None) -> datetime | None:
    """Shift timestamps are stored in UTC; display them in the zone of the
    branch the shift belongs to (``tz_name``), else the asker's branch.
    Formatting the raw UTC value showed a 5:00 PM Adelaide shift as
    07:30 AM, and evening shifts on the wrong calendar day."""
    try:
        zone = coerce_timezone(tz_name) or request_timezone()
        return parse_shift_datetime(str(value)).astimezone(zone)
    except ValueError:
        return None


def _format_shift_date(value: Any, tz_name: Any = None) -> Any:
    """e.g. '2026-08-24T07:30:00+00:00' -> '24 Aug' (local date)"""
    if not value:
        return value
    dt = _to_local(value, tz_name)
    return dt.strftime("%d %b") if dt else value


def _format_shift_time(value: Any, tz_name: Any = None, *, label_zone: bool = False) -> Any:
    """e.g. '2026-08-24T07:30:00+00:00' -> '05:00 PM' (Adelaide, UTC+9:30).
    With ``label_zone`` the abbreviation is appended ('05:00 PM AEST') —
    used when a row's branch differs from the asker's so a Melbourne time
    is never misread as an Adelaide one."""
    if not value:
        return value
    dt = _to_local(value, tz_name)
    if not dt:
        return value
    return dt.strftime("%I:%M %p %Z") if label_zone else dt.strftime("%I:%M %p")



def _blocks_for_compliance_snapshot(a: dict) -> list[dict]:
    blocks = [{
        "type": "stat",
        "label": f"Compliance score ({a.get('scope', 'organisation-wide')})",
        "value": a.get("compliance_score"),
        "target": a.get("compliance_target"),
    }]
    at_risk = a.get("workers_at_risk") or []
    if at_risk:
        blocks.append({
            "type": "table",
            "title": "Workers at risk",
            "columns": ["Worker", "Score", "Sessions"],
            "rows": [[w.get("full_name"), w.get("compliance_score"), w.get("sessions")] for w in at_risk],
        })
    return blocks


def _blocks_for_incident_summary(a: dict) -> list[dict]:
    return [
        {"type": "stat", "label": "Total incidents", "value": a.get("total")},
        {"type": "stat", "label": "Open", "value": a.get("open")},
        {"type": "stat", "label": "Critical severity", "value": a.get("critical")},
        {"type": "stat", "label": "Overdue for NDIS reporting", "value": a.get("overdue")},
    ]


def _blocks_for_rp_flag_count(a: dict) -> list[dict]:
    return [{
        "type": "stat",
        "label": f"RP flags this month ({a.get('scope', 'organisation-wide')})",
        "value": a.get("rp_flag_count_this_month"),
    }]


def _blocks_for_shift_coverage(a: dict) -> list[dict]:
    on_shift = a.get("on_shift_now") or []
    if not on_shift:
        return [{"type": "stat", "label": "On shift right now", "value": 0}]
    asker_zone = a.get("timezone")
    rows = []
    for s in on_shift:
        zone = s.get("timezone") or asker_zone
        other_branch = bool(zone and asker_zone and zone != asker_zone)
        rows.append([
            s.get("worker_name"),
            s.get("participant_name"),
            _format_shift_date(s.get("scheduled_start"), zone),
            _format_shift_time(s.get("scheduled_start"), zone, label_zone=other_branch),
            _format_shift_time(s.get("scheduled_end"), zone, label_zone=other_branch),
        ])
    return [{
        "type": "table",
        "title": "On shift right now",
        "columns": ["Worker", "Participant", "Date", "Start", "End"],
        "rows": rows,
    }]


_STATUS_LABELS = {
    "scheduled": "Scheduled",
    "completed": "Completed",
    "cancelled": "Cancelled",
}


def _blocks_for_shift_schedule(a: dict) -> list[dict]:
    shifts = a.get("shifts") or []
    if not shifts:
        return [{"type": "stat", "label": "Shifts in range", "value": 0}]
    asker_zone = a.get("timezone")
    rows = []
    for s in shifts:
        zone = s.get("timezone") or asker_zone
        other_branch = bool(zone and asker_zone and zone != asker_zone)
        rows.append([
            s.get("worker_name"),
            s.get("participant_name"),
            _format_shift_date(s.get("scheduled_start"), zone),
            _format_shift_time(s.get("scheduled_start"), zone, label_zone=other_branch),
            _format_shift_time(s.get("scheduled_end"), zone, label_zone=other_branch),
            _STATUS_LABELS.get(s.get("status"), s.get("status") or "—"),
        ])
    return [{
        "type": "table",
        "title": f"Shifts — {a.get('date_from')} to {a.get('date_to')}",
        "columns": ["Worker", "Participant", "Date", "Start", "End", "Status"],
        "rows": rows,
    }]


def _blocks_for_goal_achievement_rate(a: dict) -> list[dict]:
    return [{
        "type": "stat",
        "label": f"Goal achievement rate ({a.get('scope', 'organisation-wide')})",
        "value": a.get("goal_achievement_rate_pct"),
    }]


def _blocks_for_retention_rate(a: dict) -> list[dict]:
    return [{"type": "stat", "label": "Retention rate", "value": a.get("retention_rate_pct")}]


def _blocks_for_revenue_summary(a: dict) -> list[dict]:
    this_month = a.get("this_month") or {}
    blocks = [{
        "type": "stat",
        "label": f"Revenue this month ({this_month.get('month', '')})",
        "value": this_month.get("billed_aud"),
    }]
    monthly = a.get("monthly_breakdown") or []
    if len(monthly) > 1:
        blocks.append({
            "type": "bar_chart",
            "title": "Revenue by month (AUD)",
            "x_key": "month",
            "series": [{"key": "billed_aud", "label": "Billed"}],
            "data": [{"month": m.get("month"), "billed_aud": m.get("billed_aud")} for m in reversed(monthly)],
        })
    return blocks


def _blocks_for_search(a: dict) -> list[dict]:
    matches = a.get("matches") or []
    if not matches:
        return []
    rows = []
    for m in matches:
        content = (m.get("content") or "")[:120]
        similarity = m.get("similarity")
        rows.append([content, round(similarity, 2) if isinstance(similarity, (int, float)) else similarity])
    return [{
        "type": "table",
        "title": "Matches",
        "columns": ["Excerpt", "Similarity"],
        "rows": rows,
    }]

def _blocks_for_participant_count(a: dict) -> list[dict]:
    return [{
        "type": "stat",
        "label": f"Participants ({a.get('scope', 'organisation-wide')})",
        "value": a.get("participant_count"),
    }]


def _blocks_for_participant_list(a: dict) -> list[dict]:
    participants = a.get("participants") or []
    if not participants:
        return []
    return [{
        "type": "table",
        "title": "Participants",
        "columns": ["Name"],
        "rows": [[p.get("full_name")] for p in participants],
    }]


def _blocks_for_active_worker_count(a: dict) -> list[dict]:
    return [{
        "type": "stat",
        "label": f"Active workers ({a.get('scope', 'organisation-wide')})",
        "value": a.get("active_worker_count"),
    }]


def _blocks_for_active_worker_list(a: dict) -> list[dict]:
    workers = a.get("workers") or []
    if not workers:
        return []
    return [{
        "type": "table",
        "title": "Active workers",
        "columns": ["Name"],
        "rows": [[w.get("full_name")] for w in workers],
    }]


def _blocks_for_download(a: dict) -> list[dict]:
    if not a.get("file_url"):
        return []
    return [{
        "type": "download",
        "title": a.get("label") or "Download",
        "url": a["file_url"],
        "count": a.get("shift_count"),
    }]


def _blocks_for_session_activity(a: dict) -> list[dict]:
    return [
        {"type": "stat", "label": f"Sessions today ({a.get('scope', 'organisation-wide')})", "value": a.get("sessions_today")},
        {"type": "stat", "label": "Sessions this week", "value": a.get("sessions_this_week")},
    ]


_BUILDERS = {
    "get_compliance_snapshot": _blocks_for_compliance_snapshot,
    "get_incident_summary": _blocks_for_incident_summary,
    "get_rp_flag_count": _blocks_for_rp_flag_count,
    "get_shift_coverage": _blocks_for_shift_coverage,
    "get_shift_schedule": _blocks_for_shift_schedule,
    "get_goal_achievement_rate": _blocks_for_goal_achievement_rate,
    "get_retention_rate": _blocks_for_retention_rate,
    "get_revenue_summary": _blocks_for_revenue_summary,
    "search_session_notes": _blocks_for_search,
    "search_incident_history": _blocks_for_search,
    "get_participant_count": _blocks_for_participant_count,
    "get_participant_list": _blocks_for_participant_list,
    "get_active_worker_count": _blocks_for_active_worker_count,
    "get_active_worker_list": _blocks_for_active_worker_list,
    "get_shift_progress_note": _blocks_for_download,
    "get_participant_progress_notes_zip": _blocks_for_download,
    "get_worker_progress_notes_zip": _blocks_for_download,
    "get_all_progress_notes_zip": _blocks_for_download,
    "get_session_activity": _blocks_for_session_activity,
}


def build_blocks(tool_name: str, artifact: Any) -> list[dict]:
    if not isinstance(artifact, dict) or "error" in artifact:
        return []
    builder = _BUILDERS.get(tool_name)
    if not builder:
        return []
    try:
        return builder(artifact)
    except Exception:
        return []
