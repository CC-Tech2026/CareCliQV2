from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from backend.app.api import hub


@pytest.mark.asyncio
async def test_participant_alerts_include_profile_id_without_silent_limit():
    participants = [{"id": f"p-{i}", "full_name": f"Person {i}"} for i in range(12)]
    with patch.object(hub.participant_service, "get_participants_list_light", AsyncMock(return_value=participants)):
        alerts = await hub._participant_quiet_alerts("org-1", {}, [])
    assert len(alerts) == 12
    assert {a["participant_id"] for a in alerts} == {p["id"] for p in participants}
    assert all("ever" not in a["detail"] for a in alerts)


@pytest.mark.asyncio
async def test_unfilled_shifts_use_local_portable_time_and_exclude_cancelled():
    start = (datetime.now(timezone.utc) + timedelta(hours=2)).replace(second=0, microsecond=0)
    rows = [{"id": "shift-1", "scheduled_start": start.isoformat(), "worker_id": None, "status": "unassigned", "participant_name": "Alex"},
            {"id": "shift-2", "scheduled_start": start.isoformat(), "worker_id": None, "status": "cancelled"}]
    db = MagicMock()
    query = db.table.return_value.select.return_value
    query.eq.return_value = query
    query.gte.return_value = query
    query.lte.return_value = query
    query.execute.return_value.data = rows
    with patch.object(hub, "get_supabase_admin", return_value=db):
        alerts = await hub._unfilled_shift_alerts("org-1")
    local = start.astimezone(hub.request_timezone())
    assert len(alerts) == 1
    assert local.strftime("%I:%M%p").lstrip("0").lower() in alerts[0]["detail"]
    assert alerts[0]["due_date"] == local.date().isoformat()
    query.eq.assert_any_call("organization_id", "org-1")
