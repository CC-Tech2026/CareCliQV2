"""Server-error messages that don't leak internals to the browser.

`HTTPException(500, detail=f"Shift update failed: {exc}")` used to send raw
database/driver error text to the user. Use
`detail=internal_error_detail("Shift update failed", exc)` instead: the full
exception (with traceback) goes to the server log, the user gets the message.
"""

from __future__ import annotations

import logging

logger = logging.getLogger("carecliq.errors")


def internal_error_detail(message: str, exc: BaseException) -> str:
    logger.error("%s: %s", message, exc, exc_info=exc)
    return message
