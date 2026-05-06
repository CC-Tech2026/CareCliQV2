"""
Fetches practitioner settings stored in the Node.js API server's database.

The settings (including the physicalExamSessionTypes compliance option) are
persisted by the Express/Drizzle layer at GET /api/settings/practitioner.
The Python backend calls this endpoint locally to read the current values.

The base URL for the API server can be overridden via the ``API_SERVER_URL``
environment variable (default: ``http://localhost:8080``).
"""
import logging
import os
from typing import Optional, List

import httpx

logger = logging.getLogger(__name__)

_API_SERVER_BASE = os.environ.get("API_SERVER_URL", "http://localhost:8080").rstrip("/")
_SETTINGS_URL = f"{_API_SERVER_BASE}/api/settings/practitioner"


async def get_physical_exam_session_types() -> Optional[List[str]]:
    """Return the practitioner-configured physical-exam session types, or None.

    The returned value is used as a *replacement* for the built-in
    ``PHYSICAL_SESSION_TYPES`` set inside the compliance engine:
    - ``None``  → setting not configured or unreachable; engine uses built-in defaults.
    - non-empty list → engine uses *only* these types (replaces defaults entirely).

    An empty list stored in settings is normalised to ``None`` here so that saving
    an empty list via the UI ("Leave the list empty to use built-in defaults") never
    accidentally disables the body-examination rule.
    """
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(_SETTINGS_URL)
            if resp.status_code != 200:
                logger.warning(
                    "Settings fetch returned %s — using default physical exam types",
                    resp.status_code,
                )
                return None
            data = resp.json()
            compliance = data.get("compliance") or {}
            custom = compliance.get("physicalExamSessionTypes")
            if custom is None:
                return None
            if isinstance(custom, list):
                filtered = [str(t) for t in custom if t]
                # An empty list is treated as "not configured" — fall back to
                # the built-in defaults so the rule is never silently disabled.
                return filtered if filtered else None
            return None
    except Exception as exc:
        logger.warning(
            "Could not fetch practitioner settings (%s) — using built-in physical exam types",
            exc,
        )
        return None
