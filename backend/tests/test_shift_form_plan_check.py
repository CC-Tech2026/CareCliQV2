"""The shift form's prerequisite check also says whether the participant has
an active NDIS plan, so the form can warn before Assign instead of after."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.app.api import coordinator
from backend.app.services import funding_service

SC = {"sub": "sc-1", "role": "support_coordinator", "organization_id": "org-1"}


def _db(goals: int, tasks: int):
    client = MagicMock()
    goals_q = MagicMock(data=[{"id": f"g{i}"} for i in range(goals)])
    tasks_q = MagicMock(data=[], count=tasks)

    def table(name):
        q = MagicMock()
        chain = q.select.return_value.eq.return_value.eq.return_value
        if name == "ndis_goals":
            chain.eq.return_value.execute.return_value = goals_q
        else:
            chain.execute.return_value = tasks_q
        return q

    client.table.side_effect = table
    return client


@pytest.mark.asyncio
@pytest.mark.parametrize("plan, expected", [({"id": "plan-1"}, True), (None, False)])
async def test_reports_whether_there_is_an_active_plan(plan, expected):
    with patch.object(coordinator, "get_supabase_admin", return_value=_db(1, 2)), \
         patch.object(funding_service, "get_plan_for_participant", new=AsyncMock(return_value=plan)):
        result = await coordinator.check_goals_and_tasks("p-1", SC)
    assert result["has_valid"] is True
    assert result["has_active_plan"] is expected
