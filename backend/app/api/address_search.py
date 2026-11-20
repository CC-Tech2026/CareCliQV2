"""Address suggestions while typing (any signed-in user)."""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..core.access import get_user_id
from ..core.security import get_current_user
from ..services import address_search_service as search

router = APIRouter(prefix="/address", tags=["address-search"])

# Typing sends a request every few letters; this stops a stuck script, not people.
PER_MINUTE = 90
_recent: dict[str, deque[float]] = defaultdict(deque)


def _throttle(user_id: str) -> None:
    now = time.monotonic()
    hits = _recent[user_id]
    while hits and hits[0] < now - 60:
        hits.popleft()
    if len(hits) >= PER_MINUTE:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many address searches, try again in a minute")
    hits.append(now)


@router.get("/suggest")
async def suggest_addresses(
    q: str = Query("", max_length=200),
    session: str = Query("", max_length=64),
    current_user: dict = Depends(get_current_user),
):
    """{available, suggestions: [{id, main, secondary, description, address?}]}.
    available is false when the server can't search; the field then works
    as plain typing."""
    _throttle(str(get_user_id(current_user) or "anon"))
    try:
        suggestions = await search.suggest(q, session)
    except search.AddressSearchUnavailable:
        return {"available": False, "suggestions": []}
    return {"available": True, "suggestions": suggestions}


@router.get("/details")
async def address_details(
    id: str = Query(..., max_length=400),
    session: str = Query("", max_length=64),
    current_user: dict = Depends(get_current_user),
):
    """The picked suggestion as {formatted, street, suburb, state, postcode, country, lat, lng}."""
    _throttle(str(get_user_id(current_user) or "anon"))
    try:
        return {"address": await search.details(id, session)}
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown address")
    except search.AddressSearchUnavailable:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Address lookup is unavailable")
