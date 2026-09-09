"""Super Admin organisation management (backend/app/api/admin.py) — focused
on update_organization_type, the new endpoint that lets a Super Admin set
which service(s) a provider delivers (Aged Care / Disability / both).
Mirrors test_bug_reports.py's approach: call the route function directly
with a mocked supabase client, no HTTP layer."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.api import admin


@pytest.mark.asyncio
async def test_update_organization_type_requires_super_admin():
    with pytest.raises(HTTPException) as exc:
        await admin.update_organization_type(
            organization_id="org-1",
            body=admin.OrganizationTypeUpdate(org_type="disability"),
            current_user={"id": "u-1", "role": "managing_director"},
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_organization_type_saves_and_returns_it():
    supabase = MagicMock()
    supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"organization_id": "org-1", "org_type": "aged_care_disability"}]
    )

    with patch("backend.app.api.admin.get_supabase_admin", return_value=supabase):
        result = await admin.update_organization_type(
            organization_id="org-1",
            body=admin.OrganizationTypeUpdate(org_type="aged_care_disability"),
            current_user={"id": "admin-1", "role": "super_admin"},
        )

    assert result == {"ok": True, "org_type": "aged_care_disability"}
    supabase.table.return_value.update.assert_called_once_with({"org_type": "aged_care_disability"})


@pytest.mark.asyncio
async def test_update_organization_type_404_when_not_found():
    supabase = MagicMock()
    supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[])

    with patch("backend.app.api.admin.get_supabase_admin", return_value=supabase):
        with pytest.raises(HTTPException) as exc:
            await admin.update_organization_type(
                organization_id="does-not-exist",
                body=admin.OrganizationTypeUpdate(org_type="disability"),
                current_user={"id": "admin-1", "role": "super_admin"},
            )
    assert exc.value.status_code == 404


def test_organization_type_rejects_invalid_value():
    with pytest.raises(ValueError):
        admin.OrganizationTypeUpdate(org_type="aged_care_and_disability_typo")


@pytest.mark.asyncio
async def test_list_organizations_degrades_gracefully_when_org_type_column_missing():
    """CARECLIQV2-353 — the list must still work before
    189_organization_org_type.sql has actually run against this database,
    same reasoning as bug_report_service.py's severity-column handling.
    The first select (including org_type) fails with a missing-column
    error; the retry without it must succeed, with org_type coming back
    as None rather than the row missing the key entirely."""
    supabase = MagicMock()
    # supabase.table("organizations") is called twice — once for the
    # initial select (which fails) and once for the retry (which
    # succeeds) — and since _table below builds a fresh mock per call,
    # a call counter is what distinguishes which invocation this is.
    org_table_calls = {"count": 0}

    def _table(name: str):
        table = MagicMock()
        if name == "organizations":
            org_table_calls["count"] += 1
            if org_table_calls["count"] == 1:
                table.select.return_value.order.return_value.execute.side_effect = Exception(
                    '{"message": "column organizations.org_type does not exist", "code": "42703"}'
                )
            else:
                table.select.return_value.order.return_value.execute.return_value = MagicMock(
                    data=[{"organization_id": "org-1", "organization_name": "Sunshine", "status": "active"}]
                )
        elif name == "users":
            table.select.return_value.in_.return_value.execute.return_value = MagicMock(data=[])
        else:
            raise AssertionError(f"Unexpected table requested: {name}")
        return table

    supabase.table.side_effect = _table

    with patch("backend.app.api.admin.get_supabase_admin", return_value=supabase):
        result = await admin.list_organizations(current_user={"id": "admin-1", "role": "super_admin"})

    assert len(result) == 1
    assert result[0]["organization_id"] == "org-1"
    assert result[0]["org_type"] is None


@pytest.mark.asyncio
async def test_list_organizations_reraises_unrelated_errors():
    """A failure that isn't the missing org_type column must not be
    silently swallowed by the retry logic."""
    supabase = MagicMock()
    supabase.table.return_value.select.return_value.order.return_value.execute.side_effect = Exception(
        "connection refused"
    )

    with patch("backend.app.api.admin.get_supabase_admin", return_value=supabase):
        with pytest.raises(HTTPException) as exc:
            await admin.list_organizations(current_user={"id": "admin-1", "role": "super_admin"})
    assert exc.value.status_code == 500
