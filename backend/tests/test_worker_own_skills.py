from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.api import worker as worker_api

WORKER = {"sub": "worker-1", "id": "worker-1", "organization_id": "org-1", "role": "support_worker"}
COORDINATOR = {"sub": "coord-1", "id": "coord-1", "organization_id": "org-1", "role": "support_coordinator"}


def _table(rows_by_call: list[list[dict]]):
    """A worker_skills table mock whose select chain returns each list in turn."""
    table = MagicMock()
    chain = table.select.return_value
    for name in ("eq", "ilike", "limit", "order"):
        getattr(chain, name).return_value = chain
    chain.execute.side_effect = [MagicMock(data=rows) for rows in rows_by_call]
    return table


@pytest.mark.asyncio
async def test_add_own_skill_is_saved_unconfirmed():
    table = _table([[]])
    table.insert.return_value.execute.return_value = MagicMock(data=[{"skill": "Manual handling", "is_certified": False}])
    supabase = MagicMock()
    supabase.table.return_value = table
    with patch.object(worker_api, "get_supabase_admin", return_value=supabase):
        await worker_api.add_worker_own_skill(worker_api.WorkerOwnSkillBody(skill="  Manual   handling "), WORKER)
    inserted = table.insert.call_args.args[0]
    assert inserted["skill"] == "Manual handling"
    assert inserted["is_certified"] is False
    assert inserted["user_id"] == "worker-1"


@pytest.mark.asyncio
async def test_add_own_skill_never_downgrades_a_confirmed_one():
    table = _table([[{"skill": "Manual handling", "is_certified": True}]])
    supabase = MagicMock()
    supabase.table.return_value = table
    with patch.object(worker_api, "get_supabase_admin", return_value=supabase):
        result = await worker_api.add_worker_own_skill(worker_api.WorkerOwnSkillBody(skill="manual handling"), WORKER)
    assert result["is_certified"] is True
    table.insert.assert_not_called()


@pytest.mark.asyncio
async def test_worker_cannot_remove_a_confirmed_skill():
    table = _table([[{"skill": "PEG feeding", "is_certified": True}]])
    supabase = MagicMock()
    supabase.table.return_value = table
    with patch.object(worker_api, "get_supabase_admin", return_value=supabase):
        with pytest.raises(HTTPException) as exc:
            await worker_api.remove_worker_own_skill("PEG feeding", WORKER)
    assert exc.value.status_code == 409
    table.delete.assert_not_called()


@pytest.mark.asyncio
async def test_worker_can_remove_their_own_unconfirmed_skill():
    table = _table([[{"skill": "Cooking", "is_certified": False}]])
    supabase = MagicMock()
    supabase.table.return_value = table
    with patch.object(worker_api, "get_supabase_admin", return_value=supabase):
        await worker_api.remove_worker_own_skill("Cooking", WORKER)
    table.delete.assert_called_once()


@pytest.mark.asyncio
async def test_only_workers_use_own_skill_endpoints():
    with pytest.raises(HTTPException) as exc:
        await worker_api.add_worker_own_skill(worker_api.WorkerOwnSkillBody(skill="Cooking"), COORDINATOR)
    assert exc.value.status_code == 403
