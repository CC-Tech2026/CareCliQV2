"""Crash reports from the web app.

The frontend's error boundaries and global error listeners POST here so a
blank screen in someone's browser shows up in the server logs instead of
going unnoticed. Reports are only logged — nothing is stored — and the
endpoint works signed out (a crash can happen on the login page), so it is
rate limited per IP and every field is truncated.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from ..core.security import _bearer_scheme, decode_access_token

logger = logging.getLogger("carecliq.client_errors")
router = APIRouter(prefix="/client-errors", tags=["client-errors"])

_MAX_REPORTS = 20
_WINDOW_SECONDS = 60.0
_reports: dict[str, list[float]] = defaultdict(list)


def _check_rate_limit(ip: str) -> None:
    now = time.monotonic()
    recent = [t for t in _reports[ip] if t > now - _WINDOW_SECONDS]
    if len(recent) >= _MAX_REPORTS:
        _reports[ip] = recent
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many error reports.")
    recent.append(now)
    _reports[ip] = recent


class ClientErrorReport(BaseModel):
    kind: str = Field(default="error", max_length=40)
    message: str = Field(max_length=2000)
    stack: Optional[str] = Field(default=None, max_length=8000)
    component_stack: Optional[str] = Field(default=None, max_length=8000)
    url: Optional[str] = Field(default=None, max_length=1000)
    user_agent: Optional[str] = Field(default=None, max_length=500)


def _reporter(credentials: Optional[HTTPAuthorizationCredentials]) -> dict:
    if not credentials:
        return {}
    try:
        user = decode_access_token(credentials.credentials) or {}
    except Exception:
        return {}
    return {
        "user_id": user.get("sub") or user.get("id"),
        "role": user.get("role"),
        "organization_id": user.get("organization_id"),
    }


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
async def report_client_error(
    body: ClientErrorReport,
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> None:
    _check_rate_limit(request.client.host if request.client else "unknown")
    who = _reporter(credentials)
    logger.error(
        "Client %s: %s | url=%s user=%s role=%s org=%s ua=%s\nstack: %s\ncomponent stack: %s",
        body.kind,
        body.message,
        body.url,
        who.get("user_id"),
        who.get("role"),
        who.get("organization_id"),
        body.user_agent,
        body.stack or "-",
        body.component_stack or "-",
    )
