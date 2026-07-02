"""Support worker dashboard landing aggregation (CARECLIQV2-97 / CARECLIQV2-104)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from ..core.access import get_user_id, get_user_organization_id
from ..core.timezone import APP_TIMEZONE, app_today, shift_local_date
from . import session_service, shift_service
from .supabase_client import get_supabase_admin


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        text = str(value).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except (TypeError, ValueError):
        return None


def _shift_duration_minutes(shift: dict[str, Any]) -> int:
    start = _parse_iso_datetime(shift.get("scheduled_start"))
    end = _parse_iso_datetime(shift.get("scheduled_end"))
    if start and end:
        return max(0, int((end - start).total_seconds() // 60))
    fallback = shift.get("duration_minutes")
    try:
        return max(0, int(fallback)) if fallback is not None else 0
    except (TypeError, ValueError):
        return 0


def _shift_summary(shift: dict[str, Any]) -> dict[str, Any]:
    start = shift.get("scheduled_start")
    start_dt = _parse_iso_datetime(start)
    date_label = start_dt.date().isoformat() if start_dt else None
    time_label = None
    if start_dt:
        time_label = start_dt.strftime("%H:%M")
    end_dt = _parse_iso_datetime(shift.get("scheduled_end"))
    if start_dt and end_dt:
        time_label = f"{start_dt.strftime('%H:%M')} – {end_dt.strftime('%H:%M')}"

    return {
        "id": shift.get("id"),
        "participant_id": shift.get("participant_id"),
        "participant_name": shift.get("participant_name") or "Participant",
        "scheduled_start": start,
        "scheduled_end": shift.get("scheduled_end"),
        "date_label": date_label,
        "time_label": time_label,
        "status": shift.get("status") or "scheduled",
        "visual_state": shift.get("visual_state") or "scheduled",
        "participant_address": shift.get("participant_address"),
        "duration_minutes": _shift_duration_minutes(shift),
        "has_risk_alerts": bool(shift.get("has_risk_alerts")),
        "risks_acknowledged": bool(shift.get("risks_acknowledged")),
    }


def _pick_next_shift(today_shifts: list[dict[str, Any]], upcoming_shifts: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    active: list[tuple[datetime, dict[str, Any]]] = []
    future: list[tuple[datetime, dict[str, Any]]] = []

    for shift in today_shifts + upcoming_shifts:
        status = (shift.get("status") or "scheduled").lower()
        if status in {"cancelled", "completed"}:
            continue
        start_dt = _parse_iso_datetime(shift.get("scheduled_start")) or now
        if status == "in_progress" or (start_dt <= now and status == "scheduled"):
            active.append((start_dt, shift))
        elif start_dt > now:
            future.append((start_dt, shift))

    if active:
        active.sort(key=lambda item: item[0])
        return active[0][1]
    if future:
        future.sort(key=lambda item: item[0])
        return future[0][1]
    return None


def _worker_compliance_alerts(user_id: str) -> list[dict[str, Any]]:
    supabase = get_supabase_admin()
    try:
        cred_res = (
            supabase.table("credentials")
            .select("id, credential_type, title, expiry_date, status, user_id")
            .eq("user_id", user_id)
            .execute()
        )
        rows = cred_res.data or []
    except Exception:
        return []

    today = date.today()
    alerts: list[dict[str, Any]] = []

    def _live_status(row: dict[str, Any]) -> str:
        exp = row.get("expiry_date")
        status = row.get("status") or "valid"
        if status in ("rejected", "pending_review"):
            return status
        if not exp:
            return status
        try:
            expiry = date.fromisoformat(str(exp)[:10])
            if expiry < today:
                return "expired"
            if (expiry - today).days <= 30:
                return "expiring"
        except (TypeError, ValueError):
            pass
        return "valid"

    for row in rows:
        live = _live_status(row)
        if live not in ("expired", "expiring", "pending_review", "rejected"):
            continue
        label = row.get("title") or row.get("credential_type") or "Credential"
        severity = "critical" if live in ("expired", "rejected") else "high"
        if live == "pending_review":
            severity = "medium"
        alerts.append({
            "id": f"cred-{row.get('id')}",
            "title": label,
            "detail": f"Your {label} requires attention ({live.replace('_', ' ')}).",
            "severity": severity,
            "due_date": row.get("expiry_date"),
            "action_label": "Review Credentials",
            "action_url": "/credentials",
            "source": "credentials",
        })

    alerts.sort(
        key=lambda item: {"critical": 0, "high": 1, "medium": 2, "info": 3}.get(item["severity"], 4)
    )
    return alerts[:12]


def _needs_compliance_fix(session: dict[str, Any]) -> bool:
    score = session.get("compliance_score")
    translation_status = session.get("translation_status")
    if translation_status in {"failed", "pending", "unsupported"}:
        return True
    if score is not None and float(score) < 85:
        return True
    notes = session.get("compliance_input_text") or session.get("translated_english_note") or session.get("notes") or ""
    return len(str(notes).strip()) < 20


def _session_action_item(session: dict[str, Any], kind: str, title: str) -> dict[str, Any]:
    participant = session.get("participants") or {}
    participant_name = participant.get("full_name") or session.get("participant_name") or "Participant"
    session_type = str(session.get("session_type") or "session").replace("_", " ")
    if kind == "incomplete_session" and title == "Complete session documentation":
        title = f"Complete {session_type} documentation"
    elif kind == "compliance_fix" and title == "Fix compliance notes":
        title = f"Fix {session_type} compliance notes"
    return {
        "id": f"{kind}:{session.get('id')}",
        "kind": kind,
        "title": title,
        "detail": f"{participant_name} · {str(session.get('session_date') or '')[:10]}",
        "severity": "high" if kind == "compliance_fix" else "medium",
        "action_url": f"/sessions/{session.get('id')}" if session.get("id") else "/sessions",
        "reference_id": session.get("id"),
    }


def _shift_action_items(shifts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for shift in shifts:
        if shift.get("has_risk_alerts") and not shift.get("risks_acknowledged"):
            items.append({
                "id": f"risk_ack:{shift.get('id')}",
                "kind": "risk_acknowledgement",
                "title": "Acknowledge participant risks",
                "detail": f"{shift.get('participant_name') or 'Participant'} · before clock-in",
                "severity": "critical",
                "action_url": f"/my-shift/{shift.get('id')}",
                "reference_id": shift.get("id"),
            })
    return items


async def build_worker_landing_dashboard(current_user: dict[str, Any]) -> dict[str, Any]:
    worker_id = get_user_id(current_user) or ""
    org_id = get_user_organization_id(current_user) or ""
    full_name = current_user.get("full_name") or current_user.get("email") or "Support Worker"
    first_name = str(full_name).split(" ")[0] if full_name else "there"

    today_iso = app_today()
    all_rows = shift_service._fetch_worker_shift_rows(worker_id, org_id)
    counts = shift_service.count_shifts_by_filter(all_rows, today_iso)

    today_rows = shift_service.filter_shift_rows(all_rows, "today", today_iso)
    upcoming_rows = shift_service.filter_shift_rows(all_rows, "upcoming", today_iso)
    completed_today_rows = [
        row
        for row in shift_service.filter_shift_rows(all_rows, "completed", today_iso)
        if shift_local_date(row.get("scheduled_start")) == today_iso
    ]

    today_shifts_raw = []
    upcoming_shifts_raw = []
    active_card_count = len(today_rows) + len(upcoming_rows)
    if active_card_count:
        active_cards = shift_service.build_worker_shift_cards(
            today_rows + upcoming_rows,
            org_id,
            worker_id,
        )
        today_shifts_raw = active_cards[: len(today_rows)]
        upcoming_shifts_raw = active_cards[len(today_rows) :]
    completed_shifts_raw = shift_service.build_worker_shift_cards(
        completed_today_rows,
        org_id,
        worker_id,
        light=True,
    ) if completed_today_rows else []

    today_summaries = [_shift_summary(shift) for shift in today_shifts_raw]
    today_summaries.sort(key=lambda item: item.get("scheduled_start") or "")

    next_shift_raw = _pick_next_shift(today_shifts_raw, upcoming_shifts_raw)
    next_shift = _shift_summary(next_shift_raw) if next_shift_raw else None

    completed_today_shifts = completed_shifts_raw
    completed_today = len(completed_today_shifts)
    all_today_for_stats = today_shifts_raw + completed_today_shifts
    minutes_scheduled = sum(_shift_duration_minutes(shift) for shift in all_today_for_stats)

    sessions = await session_service.get_sessions_for_dashboard(100, current_user)
    incomplete = [s for s in sessions if s.get("status") not in {"completed", "cancelled"}]
    pending_fixes = [s for s in sessions if _needs_compliance_fix(s)]

    action_items = _shift_action_items(today_shifts_raw + upcoming_shifts_raw[:3])
    for session in incomplete[:6]:
        action_items.append(_session_action_item(session, "incomplete_session", "Complete session documentation"))
    for session in pending_fixes[:6]:
        if len(action_items) >= 12:
            break
        action_items.append(_session_action_item(session, "compliance_fix", "Fix compliance notes"))

    compliance_alerts = _worker_compliance_alerts(worker_id)

    return {
        "worker": {
            "id": worker_id,
            "full_name": full_name,
            "first_name": first_name,
        },
        "greeting_context": {
            "date_label": app_today().strftime("%A, %d %B"),
            "timezone": str(APP_TIMEZONE),
        },
        "today_shifts": today_summaries,
        "next_shift": next_shift,
        "action_items": action_items[:12],
        "compliance_alerts": compliance_alerts,
        "stats": {
            "shifts_today": len(all_today_for_stats),
            "completed_today": completed_today,
            "hours_scheduled_minutes": minutes_scheduled,
            "shift_counts": counts,
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
