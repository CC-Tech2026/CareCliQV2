"""5xx responses carry a plain message; the exception text goes to the log only."""
from __future__ import annotations

import logging

from backend.app.core.errors import internal_error_detail


def test_returns_message_without_exception_text(caplog):
    exc = RuntimeError('duplicate key value violates unique constraint "shifts_pkey"')
    with caplog.at_level(logging.ERROR, logger="carecliq.errors"):
        detail = internal_error_detail("Shift update failed", exc)
    assert detail == "Shift update failed"
    assert "shifts_pkey" not in detail
    assert "shifts_pkey" in caplog.text
    assert caplog.records[0].exc_info is not None
