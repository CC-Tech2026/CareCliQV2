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


class _Upsert:
    """Stands in for supabase .table(...).upsert(...).execute()."""

    def __init__(self, error=None):
        self.error = error
        self.saved = None

    def table(self, name):
        return self

    def upsert(self, record, on_conflict=None):
        self.saved = record
        return self

    def execute(self):
        if self.error:
            raise self.error
        return self


def _stored_prefs(monkeypatch, client):
    monkeypatch.setattr(
        "backend.app.services.accessibility_service.get_accessibility_preferences",
        lambda user_id, device_id: {**DEFAULT_PREFS, "device_id": device_id},
    )
    monkeypatch.setattr("backend.app.services.accessibility_service.get_supabase_admin", lambda: client)


@pytest.mark.parametrize("layout", ["topbar", "floating", "sidebar", "docked", "bottombar"])
def test_every_menu_layout_can_be_chosen(monkeypatch, layout):
    client = _Upsert()
    _stored_prefs(monkeypatch, client)
    prefs = save_accessibility_preferences("user-1", "account-preferences", nav_layout=layout)
    assert prefs["nav_layout"] == layout
    assert client.saved["nav_layout"] == layout


def test_floating_menu_on_a_database_without_the_migration_says_so(monkeypatch):
    client = _Upsert(Exception(
        'new row for relation "user_accessibility_preferences" violates check constraint '
        '"user_accessibility_preferences_nav_layout_check" (23514)'
    ))
    _stored_prefs(monkeypatch, client)
    with pytest.raises(HTTPException) as exc:
        save_accessibility_preferences("user-1", "account-preferences", nav_layout="floating")
    assert exc.value.status_code == 409
    assert "floating menu" in exc.value.detail


def test_unknown_layout_is_still_rejected(monkeypatch):
    _stored_prefs(monkeypatch, _Upsert())
    with pytest.raises(HTTPException) as exc:
        save_accessibility_preferences("user-1", "account-preferences", nav_layout="dock")
    assert exc.value.status_code == 422
