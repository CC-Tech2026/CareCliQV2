"""organization_abbrev.py — the MD-only retrofit endpoint that lets a
pre-existing org (created before 205_employee_id_scheme.sql) set its
org_abbrev, which also backfills employee_id for its existing staff.
Mocked-Supabase style, mirrors test_admin_organizations.py."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.api import organization_abbrev as api


@pytest.mark.asyncio
async def test_get_status_requires_org_membership():
    with pytest.raises(HTTPException) as exc:
        await api.get_org_abbrev_status(current_user={"id": "u-1", "role": "managing_director"})
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_status_returns_current_abbrev():
    supabase = MagicMock()
    supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = (
        MagicMock(data=[{"org_abbrev": "HARV"}])
    )
    with patch("backend.app.api.organization_abbrev.get_supabase_admin", return_value=supabase):
        result = await api.get_org_abbrev_status(
            current_user={"id": "u-1", "role": "support_worker", "organization_id": "org-1"}
        )
    assert result == {"org_abbrev": "HARV"}


@pytest.mark.asyncio
async def test_set_org_abbrev_requires_managing_director():
    with patch("backend.app.api.organization_abbrev.has_active_grant", return_value=False):
        with pytest.raises(HTTPException) as exc:
            await api.set_org_abbrev(
                body=api.SetOrgAbbrevBody(org_abbrev="harv"),
                current_user={"id": "u-1", "role": "support_coordinator", "organization_id": "org-1"},
            )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_set_org_abbrev_delegates_to_service():
    with patch(
        "backend.app.api.organization_abbrev.set_org_abbrev_and_backfill",
        return_value={"org_abbrev": "HARV", "backfilled_count": 3},
    ) as mock_set:
        result = await api.set_org_abbrev(
            body=api.SetOrgAbbrevBody(org_abbrev="harv"),
            current_user={"id": "md-1", "role": "managing_director", "organization_id": "org-1"},
        )
    assert result == {"org_abbrev": "HARV", "backfilled_count": 3}
    mock_set.assert_called_once()
    assert mock_set.call_args.args[1:] == ("org-1", "harv")
