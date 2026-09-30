"""Public e-signing of service agreements — the participant or their nominee,
no login. The link token is the credential; see
service_agreement_esign_service.py for the flow."""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from ..services import service_agreement_esign_service as esign

router = APIRouter(prefix="/agreement-sign", tags=["agreement-sign"])

# Light per-IP throttle on the code endpoints, on top of the per-link
# attempt limit, so one address can't churn through codes.
_WINDOW_SECONDS = 60
_MAX_PER_WINDOW = 20
_hits: dict[str, deque] = defaultdict(deque)


def _throttle(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    hits = _hits[ip]
    while hits and now - hits[0] > _WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= _MAX_PER_WINDOW:
        raise HTTPException(status_code=429, detail="Too many requests. Wait a minute and try again.")
    hits.append(now)


class CodeBody(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class SignBody(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    signature_png: str
    understood: bool = False


@router.get("/{token}")
async def view(token: str):
    return esign.public_view(token)


@router.post("/{token}/send-code")
async def send_code(token: str, request: Request):
    _throttle(request)
    return esign.send_code(token)


@router.post("/{token}/verify-code")
async def verify_code(token: str, body: CodeBody, request: Request):
    _throttle(request)
    return esign.verify_code(token, body.code)


@router.get("/{token}/document")
async def document(token: str):
    filename, pdf = esign.document(token)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"', "Cache-Control": "no-store"},
    )


@router.post("/{token}")
async def sign(token: str, body: SignBody, request: Request):
    return await esign.sign(
        token, full_name=body.full_name, signature_png=body.signature_png, understood=body.understood,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
