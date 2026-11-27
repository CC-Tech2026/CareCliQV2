"""Follow-up questions offered under a Quill answer.

Picked by code from which tools answered the question, never written by the
model, so every suggestion is a question Quill's tools can actually answer
(the old welcome screen offered "Any compliance items expiring soon?" when no
tool could). Director-only questions are offered only to the director.
"""

# tool name -> follow-ups, most useful first. Each entry is (question, director_only).
_FOLLOW_UPS: dict[str, list[tuple[str, bool]]] = {
    "get_financial_overview": [
        ("How does this quarter look?", True),
        ("Show this financial year", True),
        ("How is revenue trending by month?", True),
    ],
    "get_revenue_summary": [
        ("Are we making a profit this month?", True),
        ("How much is overdue?", True),
    ],
    "get_expiring_credentials": [
        ("What expires in the next 90 days?", False),
        ("Which workers are below the compliance threshold?", False),
    ],
    "get_compliance_snapshot": [
        ("Which credentials expire in the next 30 days?", False),
        ("How many incidents are open?", False),
    ],
    "get_incident_summary": [
        ("Find past incidents about falls", False),
        ("What's our compliance score?", False),
    ],
    "get_shift_coverage": [
        ("What shifts are on tomorrow?", False),
        ("How many sessions happened this week?", False),
    ],
    "get_shift_schedule": [
        ("Who's on shift right now?", False),
        ("What's on next week?", False),
    ],
    "get_participant_overview": [
        ("Which credentials expire in the next 30 days?", False),
        ("How are we tracking financially this month?", True),
    ],
    "get_participant_count": [("List our participants", False)],
    "get_participant_list": [("How many active workers do we have?", False)],
    "get_active_worker_count": [("List our active workers", False)],
    "get_active_worker_list": [("Which credentials expire in the next 30 days?", False)],
    "get_session_activity": [("Who's on shift right now?", False)],
    "get_retention_rate": [("How many active workers do we have?", False)],
    "get_open_incidents": [
        ("Write an incident report template", False),
        ("Any complaints waiting on a response?", False),
    ],
    "get_complaints": [("List the open incidents", False)],
    "get_plan_reviews_due": [
        ("Write a plan review checklist", False),
        ("Which shifts have no worker yet?", False),
    ],
    "get_unpaid_invoices": [
        ("Draft a friendly payment reminder letter", True),
        ("Are we making a profit this month?", True),
    ],
    "get_unfilled_shifts": [("Who's on shift right now?", False)],
    "get_worker_overview": [("Which credentials expire in the next 30 days?", False)],
    "draft_document": [
        ("Write a monthly report for the board", True),
        ("Make a shift handover template", False),
    ],
}

MAX_FOLLOW_UPS = 3


def follow_ups(tool_names: list[str], *, is_director: bool, asked: str) -> list[str]:
    """Up to three questions to offer next, from the tools used (in the
    order they ran), skipping the question just asked and duplicates."""
    asked_key = (asked or "").strip().lower().rstrip("?")
    out: list[str] = []
    for name in tool_names:
        for question, director_only in _FOLLOW_UPS.get(name, []):
            if director_only and not is_director:
                continue
            if question.lower().rstrip("?") == asked_key or question in out:
                continue
            out.append(question)
            if len(out) == MAX_FOLLOW_UPS:
                return out
    return out
