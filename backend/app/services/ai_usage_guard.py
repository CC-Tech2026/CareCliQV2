"""Caps on how often one person, organisation or address can make CareCliQ
call a paid AI model (OpenAI, Anthropic, Google speech and translation).

Two layers, so a script looping on an endpoint can't run up the AI bill:

1. ``consume_ai_call()`` runs before every model call. The OpenAI and
   Anthropic clients built by ``ai_service`` call it from ``request()``,
   the one method every SDK call goes through, so a new feature that uses
   those clients is covered without remembering to add anything. Google
   speech/translation and Quill call it directly.
2. ``limit_ai_requests(...)`` is a route dependency for the AI endpoints,
   so an over-limit caller gets a clean 429 before any work starts
   (services often catch errors from layer 1 and fall back quietly).

Who is counted comes from a context variable: the client address is set
for every request by ``ClientIPMiddleware``, and ``get_current_user``
replaces it with the signed-in user and their organisation. Work with no
request behind it (the scheduler) only counts toward the global cap.

Counts are kept in memory per API machine, so with N machines running the
effective limit is up to N times the figure here. That still bounds the
spend, which is the point; a shared store can replace ``_Counter`` later.

Every limit can be changed with an environment variable (see ``_LIMITS``).
"""
from __future__ import annotations

import contextvars
import logging
import math
import os
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException, Request, status

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Actor:
    kind: str  # "user" or "ip"
    key: str
    organization_id: Optional[str] = None


_actor: contextvars.ContextVar[Optional[Actor]] = contextvars.ContextVar("ai_usage_actor", default=None)


def set_request_ip(ip: Optional[str]) -> None:
    """Called once per request, before authentication."""
    _actor.set(Actor("ip", ip or "unknown"))


def set_request_user(user_id: Optional[str], organization_id: Optional[str]) -> None:
    """Called by get_current_user once the token checks out."""
    if user_id:
        _actor.set(Actor("user", str(user_id), str(organization_id) if organization_id else None))


def current_actor() -> Optional[Actor]:
    return _actor.get()


def _env_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default
    return max(value, 0)


def _limits() -> dict[str, int]:
    # Read on each call so a changed setting applies after a restart and
    # tests can patch the environment.
    return {
        # Model calls (layer 1). Live Meet & Greet transcription alone
        # makes one call every 8 seconds, about 450 in an hour.
        "user_calls_per_minute": _env_int("AI_USER_CALLS_PER_MINUTE", 60),
        "user_calls_per_day": _env_int("AI_USER_CALLS_PER_DAY", 3000),
        "org_calls_per_day": _env_int("AI_ORG_CALLS_PER_DAY", 30000),
        "ip_calls_per_minute": _env_int("AI_IP_CALLS_PER_MINUTE", 10),
        "ip_calls_per_day": _env_int("AI_IP_CALLS_PER_DAY", 100),
        "global_calls_per_minute": _env_int("AI_GLOBAL_CALLS_PER_MINUTE", 900),
    }


_MINUTE = 60.0
_DAY = 86400.0


class AIRateLimitExceeded(HTTPException):
    """429 with Retry-After. Subclasses HTTPException so a route that lets
    it through answers the caller properly instead of with a 500."""

    def __init__(self, retry_after: float, what: str):
        seconds = max(1, int(math.ceil(retry_after)))
        if seconds >= 3600:
            wait = "tomorrow"
        elif seconds >= 120:
            wait = f"in {seconds // 60} minutes"
        else:
            wait = f"in {seconds} seconds"
        super().__init__(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"{what} has reached its limit for now. Try again {wait}.",
            headers={"Retry-After": str(seconds)},
        )
        self.retry_after = seconds


class _Counter:
    """Sliding-window counts per key, safe to use from worker threads."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._calls_since_prune = 0

    def check(self, checks: list[tuple[str, int, float]], now: Optional[float] = None) -> Optional[float]:
        """Records one hit against every (key, limit, window) when all of
        them have room. Returns None on success, or the seconds until the
        tightest full window frees up (and records nothing)."""
        now = time.monotonic() if now is None else now
        with self._lock:
            wait = 0.0
            for key, limit, window in checks:
                if limit <= 0:
                    continue
                hits = self._hits.setdefault(key, deque())
                while hits and hits[0] <= now - window:
                    hits.popleft()
                if len(hits) >= limit:
                    wait = max(wait, hits[0] + window - now)
            if wait > 0:
                return wait
            for key, limit, _window in checks:
                if limit > 0:
                    self._hits[key].append(now)
            self._calls_since_prune += 1
            if self._calls_since_prune >= 1000:
                self._prune(now)
            return None

    def _prune(self, now: float) -> None:
        self._calls_since_prune = 0
        for key in [k for k, v in self._hits.items() if not v or v[-1] <= now - _DAY]:
            del self._hits[key]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()
            self._calls_since_prune = 0


_calls = _Counter()
_requests = _Counter()


def consume_ai_call(provider: str = "ai") -> None:
    """Count one model call for whoever this request belongs to, or raise
    AIRateLimitExceeded without counting it."""
    limits = _limits()
    actor = _actor.get()
    checks: list[tuple[str, int, float]] = [("global", limits["global_calls_per_minute"], _MINUTE)]
    if actor and actor.kind == "user":
        checks.append((f"user:{actor.key}:m", limits["user_calls_per_minute"], _MINUTE))
        checks.append((f"user:{actor.key}:d", limits["user_calls_per_day"], _DAY))
        if actor.organization_id:
            checks.append((f"org:{actor.organization_id}:d", limits["org_calls_per_day"], _DAY))
    elif actor:
        checks.append((f"ip:{actor.key}:m", limits["ip_calls_per_minute"], _MINUTE))
        checks.append((f"ip:{actor.key}:d", limits["ip_calls_per_day"], _DAY))
    wait = _calls.check(checks)
    if wait is not None:
        logger.warning(
            "AI call blocked by usage limit: provider=%s actor=%s:%s org=%s retry_after=%.0fs",
            provider,
            actor.kind if actor else "background",
            actor.key if actor else "-",
            actor.organization_id if actor else "-",
            wait,
        )
        raise AIRateLimitExceeded(wait, "AI help")


def limit_ai_requests(name: str, per_minute: int, per_day: int, label: str = "AI help"):
    """Route dependency: at most per_minute / per_day requests per signed-in
    user (or per address) to this group of endpoints. Limits can be raised
    with AI_ROUTE_<NAME>_PER_MINUTE / _PER_DAY."""
    env_name = name.upper().replace("-", "_")

    async def dependency(request: Request) -> None:
        minute = _env_int(f"AI_ROUTE_{env_name}_PER_MINUTE", per_minute)
        day = _env_int(f"AI_ROUTE_{env_name}_PER_DAY", per_day)
        who = _route_caller(request)
        wait = _requests.check([
            (f"{name}:{who}:m", minute, _MINUTE),
            (f"{name}:{who}:d", day, _DAY),
        ])
        if wait is not None:
            logger.warning("AI route %s rate limited for %s (retry in %.0fs)", name, who, wait)
            raise AIRateLimitExceeded(wait, label)

    return dependency


def _route_caller(request: Request) -> str:
    """Who a route limit counts against. Router dependencies run before the
    endpoint's get_current_user, so read the signed token here (no database
    call; the endpoint still checks the session properly). Without this,
    everyone in one office behind a shared address would share one limit."""
    from ..core.security import decode_access_token

    header = request.headers.get("authorization") or ""
    if header[:7].lower() == "bearer ":
        payload = decode_access_token(header[7:].strip())
        if payload and payload.get("sub"):
            return f"user:{payload['sub']}"
    actor = _actor.get()
    if actor:
        return f"{actor.kind}:{actor.key}"
    return f"ip:{request.client.host if request.client else 'unknown'}"


def reset_for_tests() -> None:
    _calls.reset()
    _requests.reset()


# ---------------------------------------------------------------------------
# Metered SDK clients
# ---------------------------------------------------------------------------

def metered_openai(**kwargs):
    from openai import OpenAI

    return _metered_class(OpenAI, "openai")(**kwargs)


def metered_anthropic(**kwargs):
    import anthropic

    return _metered_class(anthropic.Anthropic, "anthropic")(**kwargs)


_metered_classes: dict[type, type] = {}


def _metered_class(base: type, provider: str) -> type:
    cls = _metered_classes.get(base)
    if cls is None:
        def request(self, *args, **kwargs):
            consume_ai_call(provider)
            return base.request(self, *args, **kwargs)

        # Subclassing keeps with_options()/copy() metered too: they build
        # self.__class__(...).
        cls = type(f"Metered{base.__name__}", (base,), {"request": request})
        _metered_classes[base] = cls
    return cls
