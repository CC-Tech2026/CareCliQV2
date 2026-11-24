"""Refuse request bodies over MAX_REQUEST_BODY_BYTES (default 50 MB).

Upload endpoints check their own size limits, but only after
``await file.read()`` has loaded the whole file into memory. The API
machine has 1 GB, so a single multi-gigabyte upload could take it down
for everyone. The largest real upload is a 25 MB meeting recording.

A declared Content-Length over the limit is refused before anything is
read; a body sent without one (chunked) is counted as it arrives and cut
off at the limit.
"""
from __future__ import annotations

import json
import os

DEFAULT_MAX_BYTES = 50 * 1024 * 1024


def _max_bytes() -> int:
    try:
        return max(int(os.environ.get("MAX_REQUEST_BODY_BYTES", "") or DEFAULT_MAX_BYTES), 1)
    except ValueError:
        return DEFAULT_MAX_BYTES


class _TooLarge(Exception):
    pass


class BodySizeLimitMiddleware:
    def __init__(self, app, max_bytes: int | None = None):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = self.max_bytes or _max_bytes()

        for name, value in scope.get("headers") or ():
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    declared = 0
                if declared > limit:
                    await _send_413(send, limit)
                    return
                break

        received = 0
        response_started = False

        async def counting_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _TooLarge()
            return message

        async def tracking_send(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except _TooLarge:
            if not response_started:
                await _send_413(send, limit)


async def _send_413(send, limit: int) -> None:
    body = json.dumps({"detail": f"This upload is too large. The limit is {limit // (1024 * 1024)} MB."}).encode()
    await send({
        "type": "http.response.start",
        "status": 413,
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
    })
    await send({"type": "http.response.body", "body": body})
