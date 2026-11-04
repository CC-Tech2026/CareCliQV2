"""Where each of a worker's finished shifts stands with the office.

After clock-out a shift is waiting for review until a coordinator or the
managing director verifies it. If they ask for changes (an action-required
message in the shift's conversation), it's back with the worker, who can add
notes and send it back. Verified shifts leave the worker's overview and stay
in their history. The conversation is the shift's thread with the office;
the worker app shows it with the shift record.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from ..core.timezone import participant_timezone
from . import conversation_service
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

ReviewStatus = Literal["changes_requested", "awaiting_review", "verified"]

# How far back the overview looks for shifts still waiting on the office.
REVIEW_WINDOW_DAYS = 90
SENT_BACK_DEFAULT = "I've added the changes you asked for. Ready for review."

_STATUS_ORDER = {"changes_requested": 0, "awaiting_review": 1, "verified": 2}


def _missing_schema(exc: Exception) -> bool:
    text = str(exc).lower()
    return "pgrst" in text or "does not exist" in text or "42703" in text or "42p01" in text or "could not find" in text


def _verified_shift_ids(shift_ids: list[str]) -> set[str]:
    """Shifts with a verification that hasn't been reversed."""
    if not shift_ids:
        return set()
    supabase = get_supabase_admin()
    try:
        rows = (
            supabase.table("shift_verifications").select("shift_id")
            .in_("shift_id", shift_ids).is_("reversed_at", "null").execute()
        ).data or []
    except Exception as exc:
        if not _missing_schema(exc):
            raise
        try:
            rows = supabase.table("shift_verifications").select("shift_id").in_("shift_id", shift_ids).execute().data or []
        except Exception:
            rows = []
    return {str(r.get("shift_id")) for r in rows}


def _conversation_states(worker_id: str, shift_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Per shift: its conversation, open change requests from the office,
    unread office messages, and when the worker last sent it back."""
    if not shift_ids:
        return {}
    supabase = get_supabase_admin()
    try:
        convs = (
            supabase.table("conversations").select("id, shift_id, status, coordinator_id")
            .eq("worker_id", worker_id).in_("shift_id", shift_ids).execute()
        ).data or []
    except Exception as exc:
        if _missing_schema(exc):
            return {}
        raise
    if not convs:
        return {}
    by_conv = {str(c["id"]): c for c in convs}
    try:
        msgs = (
            supabase.table("conversation_messages")
            .select("id, conversation_id, sender_id, requires_action, actioned_at, read_at, created_at")
            .in_("conversation_id", list(by_conv)).execute()
        ).data or []
    except Exception as exc:
        if not _missing_schema(exc):
            raise
        msgs = []

    states: dict[str, dict[str, Any]] = {}
    for conv in convs:
        states[str(conv.get("shift_id"))] = {
            "conversation_id": str(conv["id"]),
            "conversation_status": conv.get("status") or "active",
            "coordinator_id": conv.get("coordinator_id"),
            "open_requests": 0,
            "unread_messages": 0,
            "last_request_at": None,
            "requester_id": None,
        }
    for msg in msgs:
        conv = by_conv.get(str(msg.get("conversation_id")))
        if not conv:
            continue
        state = states[str(conv.get("shift_id"))]
        from_office = str(msg.get("sender_id")) != str(worker_id)
        if not from_office:
            continue
        if msg.get("requires_action") and not msg.get("actioned_at"):
            state["open_requests"] += 1
            created = msg.get("created_at")
            if created and (state["last_request_at"] is None or created > state["last_request_at"]):
                state["last_request_at"] = created
                state["requester_id"] = msg.get("sender_id")
        if not msg.get("read_at"):
            state["unread_messages"] += 1
    return states


def review_status(shift_id: str, verified: set[str], states: dict[str, dict[str, Any]]) -> ReviewStatus:
    if shift_id in verified:
        return "verified"
    if (states.get(shift_id) or {}).get("open_requests"):
        return "changes_requested"
    return "awaiting_review"


def list_worker_shift_reviews(worker_id: str, organization_id: str, *, include_verified: bool = False) -> dict[str, Any]:
    """The worker's finished shifts and where each stands, changes requested
    first. Verified shifts are left out unless asked for (history)."""
    since = (datetime.now(timezone.utc) - timedelta(days=REVIEW_WINDOW_DAYS)).isoformat()
    supabase = get_supabase_admin()
    try:
        query = (
            supabase.table("shifts")
            .select(
                "id, organization_id, participant_id, participant_name, scheduled_start, scheduled_end, "
                "clocked_in_at, clocked_out_at, session_id, status"
            )
            .eq("worker_id", worker_id)
            .eq("organization_id", organization_id)
            .eq("status", "completed")
            .order("scheduled_start", desc=True)
            .limit(200)
        )
        if not include_verified:
            query = query.gte("scheduled_start", since)
        shifts = query.execute().data or []
    except Exception as exc:
        if _missing_schema(exc):
            return {"shifts": [], "counts": {"changes_requested": 0, "awaiting_review": 0, "verified": 0}}
        raise

    shift_ids = [str(s["id"]) for s in shifts if s.get("id")]
    verified = _verified_shift_ids(shift_ids)
    states = _conversation_states(worker_id, shift_ids)

    session_ids = [str(s["session_id"]) for s in shifts if s.get("session_id")]
    scores: dict[str, Any] = {}
    if session_ids:
        try:
            for row in supabase.table("sessions").select("id, compliance_score").in_("id", session_ids).execute().data or []:
                scores[str(row["id"])] = row.get("compliance_score")
        except Exception as exc:
            if not _missing_schema(exc):
                raise

    items: list[dict[str, Any]] = []
    counts = {"changes_requested": 0, "awaiting_review": 0, "verified": 0}
    for shift in shifts:
        sid = str(shift["id"])
        status = review_status(sid, verified, states)
        counts[status] += 1
        if status == "verified" and not include_verified:
            continue
        state = states.get(sid) or {}
        items.append({
            "shift_id": sid,
            "session_id": shift.get("session_id"),
            "participant_id": shift.get("participant_id"),
            "participant_name": shift.get("participant_name"),
            "scheduled_start": shift.get("scheduled_start"),
            "scheduled_end": shift.get("scheduled_end"),
            "clocked_in_at": shift.get("clocked_in_at"),
            "clocked_out_at": shift.get("clocked_out_at"),
            "timezone": str(participant_timezone(shift, organization_id=organization_id)),
            "compliance_score": scores.get(str(shift.get("session_id"))) if shift.get("session_id") else None,
            "review_status": status,
            "open_requests": state.get("open_requests", 0),
            "unread_messages": state.get("unread_messages", 0),
            "conversation_id": state.get("conversation_id"),
        })
    items.sort(key=lambda i: (_STATUS_ORDER[i["review_status"]], -_ts(i.get("scheduled_start"))))
    return {"shifts": items, "counts": counts}


def _ts(value: Any) -> float:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return 0.0


def _worker_shift(shift_id: str, worker_id: str, organization_id: str) -> Optional[dict[str, Any]]:
    from .shift_service import get_shift_by_id

    shift = get_shift_by_id(shift_id)
    if not shift:
        return None
    if str(shift.get("worker_id") or "") != str(worker_id) or str(shift.get("organization_id") or "") != str(organization_id):
        return None
    return shift


def _office_messages_from_shift(shift_id: str) -> list[dict[str, Any]]:
    """Messages the worker sent to the office during the shift (Message
    office), shown in the same thread so nothing about the shift is elsewhere."""
    try:
        rows = (
            get_supabase_admin().table("shift_office_messages")
            .select("id, worker_id, message, priority, created_at")
            .eq("shift_id", shift_id).order("created_at").execute()
        ).data or []
    except Exception as exc:
        if _missing_schema(exc):
            return []
        raise
    return [
        {
            "id": f"office-{r['id']}",
            "sender_id": r.get("worker_id"),
            "from_worker": True,
            "body": r.get("message") or "",
            "kind": "during_shift",
            "priority": r.get("priority"),
            "created_at": r.get("created_at"),
        }
        for r in rows
    ]


def _feedback_for_shift(shift_id: str) -> list[dict[str, Any]]:
    try:
        return (
            get_supabase_admin().table("shift_feedback")
            .select("id, strengths, areas_to_improve, action_items, submitted_at, acknowledged_at")
            .eq("shift_id", shift_id).order("submitted_at").execute()
        ).data or []
    except Exception as exc:
        if _missing_schema(exc):
            return []
        raise


def _sender_names(user_ids: set[str]) -> dict[str, str]:
    if not user_ids:
        return {}
    try:
        rows = get_supabase_admin().table("users").select("id, full_name").in_("id", list(user_ids)).execute().data or []
    except Exception:
        return {}
    return {str(r["id"]): (r.get("full_name") or "").strip() for r in rows}


def get_worker_shift_thread(shift_id: str, worker_id: str, organization_id: str) -> Optional[dict[str, Any]]:
    """The shift's review status and its whole conversation with the office,
    oldest first, marking the office's messages read."""
    shift = _worker_shift(shift_id, worker_id, organization_id)
    if not shift:
        return None
    verified = _verified_shift_ids([shift_id])
    states = _conversation_states(worker_id, [shift_id])
    state = states.get(shift_id) or {}
    status = review_status(shift_id, verified, states)

    messages: list[dict[str, Any]] = []
    conversation_id = state.get("conversation_id")
    if conversation_id:
        for m in conversation_service.get_conversation_messages(conversation_id, worker_id):
            from_worker = str(m.get("sender_id")) == str(worker_id)
            messages.append({
                "id": m.get("id"),
                "sender_id": m.get("sender_id"),
                "from_worker": from_worker,
                "body": m.get("body") or "",
                "attachment_url": m.get("attachment_url"),
                "kind": "change_request" if m.get("requires_action") and not from_worker else "message",
                "resolved": bool(m.get("actioned_at")) if m.get("requires_action") else None,
                "created_at": m.get("created_at"),
            })
        conversation_service.mark_conversation_read(conversation_id, worker_id)
    messages.extend(_office_messages_from_shift(shift_id))

    names = _sender_names({str(m["sender_id"]) for m in messages if m.get("sender_id") and not m.get("from_worker")})
    for m in messages:
        if not m.get("from_worker"):
            m["sender_name"] = names.get(str(m.get("sender_id"))) or None
    messages.sort(key=lambda m: _ts(m.get("created_at")))

    score = None
    if shift.get("session_id"):
        try:
            rows = get_supabase_admin().table("sessions").select("compliance_score").eq("id", str(shift["session_id"])).execute().data or []
            score = rows[0].get("compliance_score") if rows else None
        except Exception as exc:
            if not _missing_schema(exc):
                raise

    return {
        "shift_id": shift_id,
        "compliance_score": score,
        "review_status": status,
        "open_requests": state.get("open_requests", 0),
        # Notes can be added only while the office has asked for changes;
        # otherwise a finished shift is read-only.
        "can_add_notes": status == "changes_requested",
        "can_message": status != "verified",
        "conversation_id": conversation_id,
        "messages": messages,
        "feedback": _feedback_for_shift(shift_id),
    }


def _open_conversation(shift: dict[str, Any], worker_id: str, organization_id: str) -> dict[str, Any]:
    conv = conversation_service.get_or_create_shift_conversation(
        organization_id=organization_id,
        worker_id=worker_id,
        shift_id=str(shift["id"]),
        coordinator_id=str(shift.get("created_by") or "") or None,
        participant_id=str(shift.get("participant_id") or "") or None,
        participant_name=shift.get("participant_name"),
    )
    if not conv:
        raise ValueError("Could not open the conversation for this shift.")
    return conv


def post_worker_message(shift_id: str, worker_id: str, organization_id: str, body: str) -> Optional[dict[str, Any]]:
    """The worker writes to the office about a finished shift."""
    shift = _worker_shift(shift_id, worker_id, organization_id)
    if not shift:
        return None
    if _verified_shift_ids([shift_id]):
        raise PermissionError("This shift has been verified. Contact the office for any changes.")
    conv = _open_conversation(shift, worker_id, organization_id)
    msg = conversation_service.send_conversation_message(
        conversation_id=str(conv["id"]), sender_id=worker_id, body=body,
    )
    return {"message": msg, "conversation": conv, "notify_id": conv.get("coordinator_id") or shift.get("created_by")}


def send_back_for_review(shift_id: str, worker_id: str, organization_id: str, note: Optional[str]) -> Optional[dict[str, Any]]:
    """The worker has made the changes: close the open requests and tell the
    office, so the shift is waiting for review again."""
    shift = _worker_shift(shift_id, worker_id, organization_id)
    if not shift:
        return None
    states = _conversation_states(worker_id, [shift_id])
    state = states.get(shift_id) or {}
    if not state.get("open_requests"):
        raise ValueError("There are no changes requested on this shift.")
    conversation_id = state["conversation_id"]
    now = datetime.now(timezone.utc).isoformat()
    get_supabase_admin().table("conversation_messages").update({"actioned_at": now}).eq(
        "conversation_id", conversation_id
    ).eq("requires_action", True).is_("actioned_at", "null").neq("sender_id", worker_id).execute()
    msg = conversation_service.send_conversation_message(
        conversation_id=conversation_id, sender_id=worker_id, body=(note or "").strip() or SENT_BACK_DEFAULT,
    )
    # Whoever asked for the changes hears they're done.
    return {
        "message": msg,
        "conversation_id": conversation_id,
        "notify_id": state.get("requester_id") or state.get("coordinator_id"),
    }


def office_review_states(shift_ids: list[str]) -> dict[str, str]:
    """For the office's verification queue: "changes_requested" while the
    worker still has requests open, "sent_back" once they've answered every
    request, nothing for a shift no one has asked about."""
    if not shift_ids:
        return {}
    supabase = get_supabase_admin()
    try:
        convs = supabase.table("conversations").select("id, shift_id").in_("shift_id", shift_ids).execute().data or []
        if not convs:
            return {}
        shift_by_conv = {str(c["id"]): str(c.get("shift_id")) for c in convs}
        msgs = (
            supabase.table("conversation_messages").select("conversation_id, actioned_at")
            .in_("conversation_id", list(shift_by_conv)).eq("requires_action", True).execute()
        ).data or []
    except Exception as exc:
        if _missing_schema(exc):
            return {}
        raise
    states: dict[str, str] = {}
    for m in msgs:
        shift_id = shift_by_conv.get(str(m.get("conversation_id")))
        if not shift_id:
            continue
        if not m.get("actioned_at"):
            states[shift_id] = "changes_requested"
        else:
            states.setdefault(shift_id, "sent_back")
    return states
