"""Shared test defaults."""
from __future__ import annotations

from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def _agreement_check_level_default():
    """Shift creation and verification read the organisation's agreement
    check level (migration 239). Tests get the default, "reason", without a
    database call; tests about the setting patch it themselves."""
    from backend.app.services import agreement_support_service

    with patch.object(agreement_support_service, "check_level", return_value="reason"):
        yield
