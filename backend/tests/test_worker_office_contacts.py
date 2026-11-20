from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.api import worker as worker_api

WORKER = {"sub": "worker-1", "id": "worker-1", "organization_id": "org-1", "role": "support_worker"}


def _supabase(org_row: dict | None, me_row: dict | None, coordinator_row: dict | None):
    def make(rows_by_call):
        t = MagicMock()
        chain = t.select.return_value
        chain.eq.return_value = chain
        chain.limit.return_value = chain
        chain.execute.side_effect = [MagicMock(data=rows) for rows in rows_by_call]
        return t

    tables = {
        "organizations": make([[org_row] if org_row else []]),
        # The users table is read twice: the worker's own row, then the coordinator.
        "users": make([[me_row] if me_row else [], [coordinator_row] if coordinator_row else []]),
    }
    supabase = MagicMock()
    supabase.table.side_effect = lambda name: tables[name]
    return supabase


@pytest.mark.asyncio
async def test_office_contacts_returns_office_and_own_coordinator():
    supabase = _supabase(
        {"display_name": "Harbourside Care", "contact_number": " 08 8000 0000 ", "email": "office@example.com"},
        {"coordinator_id": "coord-1"},
        {"full_name": "Casey Coordinator", "phone": "0400 000 000", "email": "casey@example.com", "organization_id": "org-1"},
    )
    with patch.object(worker_api, "get_supabase_admin", return_value=supabase):
        result = await worker_api.worker_office_contacts(WORKER)
    assert result["office"] == {"name": "Harbourside Care", "phone": "08 8000 0000", "email": "office@example.com"}
    assert result["coordinator"]["name"] == "Casey Coordinator"


@pytest.mark.asyncio
async def test_office_contacts_hides_a_coordinator_from_another_organisation():
    supabase = _supabase(
        {"organization_name": "Harbourside Care", "contact_number": None, "email": None},
        {"coordinator_id": "coord-9"},
        {"full_name": "Someone Else", "phone": "0400 999 999", "email": "x@example.com", "organization_id": "org-2"},
    )
    with patch.object(worker_api, "get_supabase_admin", return_value=supabase):
        result = await worker_api.worker_office_contacts(WORKER)
    assert result["coordinator"] is None
    assert result["office"]["phone"] is None


@pytest.mark.asyncio
async def test_office_contacts_is_for_workers_only():
    with pytest.raises(HTTPException) as exc:
        await worker_api.worker_office_contacts({"sub": "c", "organization_id": "org-1", "role": "support_coordinator"})
    assert exc.value.status_code == 403
