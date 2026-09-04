"""Public email capture on the pre-launch countdown page (/get-started,
shown until the 7 October 2026 launch instant - see get-started.tsx)."""

from __future__ import annotations

import logging
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/launch-waitlist", tags=["launch-waitlist"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class WaitlistSignupBody(BaseModel):
    email: str


@router.post("")
async def join_launch_waitlist(body: WaitlistSignupBody):
    email = body.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    try:
        get_supabase_admin().table("launch_waitlist_signups").upsert(
            {"email": email}, on_conflict="email",
        ).execute()
    except Exception as exc:
        logger.error("launch_waitlist_signups insert failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not save your email. Please try again.")
    return {"message": "You're on the list — we'll email you when CareCliQ launches."}
