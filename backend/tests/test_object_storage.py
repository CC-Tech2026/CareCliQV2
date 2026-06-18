"""Tests for evidence storage provider resolution."""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from backend.app.services import object_storage


@pytest.fixture(autouse=True)
def _reset_storage_cache():
    object_storage.reset_evidence_storage_cache()
    yield
    object_storage.reset_evidence_storage_cache()


def test_resolve_provider_defaults_to_supabase():
    with patch.dict(os.environ, {}, clear=True):
        object_storage.settings.evidence_storage_provider = "supabase"
        object_storage.settings.evidence_storage_s3_enabled = False
        object_storage.settings.evidence_storage_azure_enabled = False
        assert object_storage.resolve_evidence_storage_provider() == "supabase"


def test_resolve_provider_s3_enabled_flag():
    object_storage.settings.evidence_storage_provider = ""
    object_storage.settings.evidence_storage_s3_enabled = True
    object_storage.settings.evidence_storage_azure_enabled = False
    assert object_storage.resolve_evidence_storage_provider() == "s3"


def test_resolve_provider_azure_enabled_flag():
    object_storage.settings.evidence_storage_provider = ""
    object_storage.settings.evidence_storage_s3_enabled = False
    object_storage.settings.evidence_storage_azure_enabled = True
    assert object_storage.resolve_evidence_storage_provider() == "azure"


def test_resolve_provider_explicit_overrides_flags():
    object_storage.settings.evidence_storage_provider = "azure"
    object_storage.settings.evidence_storage_s3_enabled = True
    object_storage.settings.evidence_storage_azure_enabled = False
    assert object_storage.resolve_evidence_storage_provider() == "azure"
