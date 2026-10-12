"""Renaming and deleting folders an MD created in the vault."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import vault_service

ORG = "org-1"


class _Query:
    """Records filters and updates; returns canned rows."""

    def __init__(self, table: str, store: dict):
        self.table, self.store, self.update_payload = table, store, None

    def select(self, *_a, **_k):
        return self

    def update(self, payload):
        self.update_payload = payload
        return self

    def eq(self, *_a, **_k):
        return self

    def is_(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        if self.update_payload is not None:
            self.store.setdefault("updates", []).append((self.table, self.update_payload))
            rows = self.store.get(f"{self.table}:updated", [])
        else:
            rows = self.store.get(f"{self.table}:rows", [])
        return SimpleNamespace(data=rows)


def _supabase(store: dict):
    client = MagicMock()
    client.table.side_effect = lambda name: _Query(name, store)
    return client


def test_delete_soft_deletes_the_folder_and_its_files():
    store = {
        "vault_custom_folders:rows": [{"id": "f1"}],
        "vault_custom_folder_documents:updated": [{"id": "d1"}, {"id": "d2"}],
    }
    vault_service._ttl_cache[f"custom_folders:{ORG}"] = (0.0, [{"id": "f1"}])
    with patch.object(vault_service, "get_supabase_admin", return_value=_supabase(store)):
        removed = vault_service.delete_custom_folder(ORG, "f1")

    assert removed == 2
    tables = [table for table, payload in store["updates"]]
    assert tables == ["vault_custom_folder_documents", "vault_custom_folders"]
    assert all("deleted_at" in payload for _, payload in store["updates"])  # nothing hard-deleted
    assert f"custom_folders:{ORG}" not in vault_service._ttl_cache


def test_delete_and_rename_refuse_folders_that_arent_there():
    with patch.object(vault_service, "get_supabase_admin", return_value=_supabase({})):
        with pytest.raises(HTTPException) as deleted:
            vault_service.delete_custom_folder(ORG, "missing")
        with pytest.raises(HTTPException) as renamed:
            vault_service.rename_custom_folder(ORG, "missing", "New name")
    assert deleted.value.status_code == 404
    assert renamed.value.status_code == 404


def test_rename_trims_and_requires_a_name():
    store = {"vault_custom_folders:rows": [{"id": "f1"}]}
    with patch.object(vault_service, "get_supabase_admin", return_value=_supabase(store)):
        result = vault_service.rename_custom_folder(ORG, "f1", "  Board minutes  ")
        with pytest.raises(HTTPException):
            vault_service.rename_custom_folder(ORG, "f1", "   ")
    assert result["label"] == "Board minutes"
    assert store["updates"] == [("vault_custom_folders", {"label": "Board minutes"})]
