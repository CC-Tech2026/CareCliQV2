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
async def test_list_organizations_works_without_later_columns():
    """CARECLIQV2-353: the list must still work before optional columns
    (org_type 189, access_override_until 273) exist on a database. It
    selects every column, so a missing one is simply absent from the row
    and org_type comes back as None."""
    supabase = MagicMock()

    def _table(name: str):
        table = MagicMock()
        if name == "organizations":
            table.select.return_value.order.return_value.execute.return_value = MagicMock(
                data=[{"organization_id": "org-1", "organization_name": "Sunshine", "status": "active"}]
            )
        else:
            table.select.return_value.in_.return_value.execute.return_value = MagicMock(data=[])
        return table

    supabase.table.side_effect = _table

    with patch("backend.app.api.admin.get_supabase_admin", return_value=supabase),          patch("backend.app.services.admin_console_service.get_supabase_admin", return_value=supabase):
        result = await admin.list_organizations(current_user={"id": "admin-1", "role": "super_admin"})

    assert len(result) == 1
    assert result[0]["organization_id"] == "org-1"
    assert result[0]["org_type"] is None
    assert result[0]["user_count"] == 0 and result[0]["attention"] == []


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
