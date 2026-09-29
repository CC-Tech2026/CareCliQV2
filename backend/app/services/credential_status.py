"""Single source of truth for computing a credential's *live* status from
its expiry date.

The `credentials.status` column is only ever written by two things: a
worker's create/update (-> "pending_review") and a coordinator's explicit
review action (-> "valid"/"rejected"/"pending_review"). Nothing recomputes
it on a schedule, so a credential verified "valid" months ago with an
expiry date in the past still reads "valid" straight from the DB forever.
`GET /credentials/me` and `GET /credentials/team` mask this by recomputing
live on every read — but any other consumer that queries `credentials.status`
directly (onboarding-escalation gating, the coordinator credential-alerts
dashboard, the compliance urgent-actions widget) was silently working off
stale data. Everything that needs to know whether a credential is actually
current must call `live_status()` instead of trusting the raw column.
"""

from __future__ import annotations

from datetime import date
from typing import Optional

from ..core.timezone import app_today

# One window for "expiring soon" everywhere — credential lists, alerts, the
# rostering gate's warning and screening recheck reminders.
EXPIRING_WITHIN_DAYS = 60


def live_status(
    expiry_date: str | None,
    stored_status: str | None,
    today: Optional[date] = None,
) -> str:
    """A credential is valid through the end of its expiry date, on the
    office's calendar (app_today follows the request's branch timezone) — not
    the server's clock, which made "expired" flip at a different moment
    depending on where the code happened to run."""
    stored = stored_status or "pending_review"
    if stored in {"rejected", "pending_review"}:
        return stored
    if not expiry_date:
        return stored if stored in {"valid", "expiring", "expired"} else "valid"
    expiry = date.fromisoformat(str(expiry_date)[:10])
    today = today or app_today()
    if expiry < today:
        return "expired"
    if (expiry - today).days <= EXPIRING_WITHIN_DAYS:
        return "expiring"
    return "valid"
