"""Tests for Supabase Sydney region validation."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from backend.app.core.supabase_region import (
    REQUIRED_SUPABASE_REGION,
    SupabaseRegionError,
    extract_project_ref,
    is_local_supabase_url,
    validate_supabase_region,
)


def test_extract_project_ref_from_hosted_url():
    assert extract_project_ref("https://abc123xyz.supabase.co") == "abc123xyz"


def test_extract_project_ref_rejects_non_supabase_host():
    assert extract_project_ref("https://example.com") is None


def test_is_local_supabase_url():
    assert is_local_supabase_url("http://127.0.0.1:54321") is True
    assert is_local_supabase_url("http://localhost:54321") is True
    assert is_local_supabase_url("https://abc123xyz.supabase.co") is False


def test_validate_skips_local_url():
    validate_supabase_region(
        supabase_url="http://127.0.0.1:54321",
        declared_region="",
        access_token=None,
    )


def test_validate_skips_when_disabled():
    validate_supabase_region(
        supabase_url="https://abc123xyz.supabase.co",
        declared_region="",
        access_token=None,
        region_check_mode="disabled",
    )


def test_validate_requires_declared_region_without_token():
    with pytest.raises(SupabaseRegionError, match="SUPABASE_REGION"):
        validate_supabase_region(
            supabase_url="https://abc123xyz.supabase.co",
            declared_region="",
            access_token="",
        )


def test_validate_accepts_declared_sydney_region():
    validate_supabase_region(
        supabase_url="https://abc123xyz.supabase.co",
        declared_region=REQUIRED_SUPABASE_REGION,
        access_token="",
    )


def test_validate_rejects_wrong_declared_region():
    with pytest.raises(SupabaseRegionError, match="SUPABASE_REGION"):
        validate_supabase_region(
            supabase_url="https://abc123xyz.supabase.co",
            declared_region="us-east-1",
            access_token="",
        )


def test_validate_uses_management_api_when_token_present():
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"region": REQUIRED_SUPABASE_REGION}
    response.raise_for_status = MagicMock()

    with patch("backend.app.core.supabase_region.httpx.Client") as client_cls:
        client = MagicMock()
        client.__enter__.return_value = client
        client.get.return_value = response
        client_cls.return_value = client

        validate_supabase_region(
            supabase_url="https://abc123xyz.supabase.co",
            declared_region=REQUIRED_SUPABASE_REGION,
            access_token="pat-test-token",
        )

        client.get.assert_called_once()
        assert "abc123xyz" in client.get.call_args.args[0]


def test_validate_rejects_management_api_wrong_region():
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"region": "us-east-1"}
    response.raise_for_status = MagicMock()

    with patch("backend.app.core.supabase_region.httpx.Client") as client_cls:
        client = MagicMock()
        client.__enter__.return_value = client
        client.get.return_value = response
        client_cls.return_value = client

        with pytest.raises(SupabaseRegionError, match="us-east-1"):
            validate_supabase_region(
                supabase_url="https://abc123xyz.supabase.co",
                declared_region=REQUIRED_SUPABASE_REGION,
                access_token="pat-test-token",
            )


def test_validate_invalid_management_token():
    response = MagicMock()
    response.status_code = 401

    with patch("backend.app.core.supabase_region.httpx.Client") as client_cls:
        client = MagicMock()
        client.__enter__.return_value = client
        client.get.return_value = response
        client_cls.return_value = client

        with pytest.raises(SupabaseRegionError, match="invalid or expired"):
            validate_supabase_region(
                supabase_url="https://abc123xyz.supabase.co",
                declared_region=REQUIRED_SUPABASE_REGION,
                access_token="bad-token",
            )
