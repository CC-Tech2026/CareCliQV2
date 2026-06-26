"""Unit tests for accessibility preferences (CARECLIQV2-290)."""

import pytest
from fastapi import HTTPException

from backend.app.services.accessibility_service import (
    DEFAULT_PREFS,
    get_accessibility_preferences,
    save_accessibility_preferences,
)


def test_get_accessibility_preferences_defaults_without_db(monkeypatch):
    def boom(*args, **kwargs):
        raise Exception("relation does not exist")

    monkeypatch.setattr(
        "backend.app.services.accessibility_service.get_supabase_admin",
        lambda: type("X", (), {"table": lambda self, name: type("T", (), {"select": boom})()})(),
    )
    prefs = get_accessibility_preferences("user-1", "device-1")
    assert prefs["font_size"] == DEFAULT_PREFS["font_size"]
    assert prefs["device_id"] == "device-1"


def test_save_accessibility_preferences_rejects_invalid_font(monkeypatch):
    monkeypatch.setattr(
        "backend.app.services.accessibility_service.get_accessibility_preferences",
        lambda user_id, device_id: {**DEFAULT_PREFS, "device_id": device_id},
    )
    with pytest.raises(HTTPException) as exc:
        save_accessibility_preferences("user-1", "device-1", font_size="huge")
    assert exc.value.status_code == 422
