from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from backend.app.services import shift_offer_service as svc


def _supabase(offers: list[dict], shifts: list[dict]) -> MagicMock:
    offers_table = MagicMock()
    offers_table.select.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=offers)
    shifts_table = MagicMock()
    shifts_table.select.return_value.in_.return_value.eq.return_value.execute.return_value = MagicMock(data=shifts)
    supabase = MagicMock()
    supabase.table.side_effect = lambda name: {"shift_offers": offers_table, "shifts": shifts_table}[name]
    return supabase


def _iso(hours: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def test_lists_open_offers_soonest_first_with_only_decision_details():
    offers = [
        {"id": "o-later", "shift_id": "s-later", "offered_at": _iso(-2), "responds_by": _iso(20)},
        {"id": "o-soon", "shift_id": "s-soon", "offered_at": _iso(-1), "responds_by": _iso(10)},
        {"id": "o-past", "shift_id": "s-past", "offered_at": _iso(-30), "responds_by": _iso(-5)},
        {"id": "o-cancelled", "shift_id": "s-cancelled", "offered_at": _iso(-1), "responds_by": _iso(5)},
    ]
    base = {"organization_id": "org-1", "participant_id": "p-1", "duration_minutes": 180, "shift_type": "community_access"}
    shifts = [
        {**base, "id": "s-later", "participant_name": "Harold Nguyen", "participant_address": "14 Jetty Road, Glenelg SA 5045",
         "scheduled_start": _iso(72), "scheduled_end": _iso(75), "status": "unassigned"},
        {**base, "id": "s-soon", "participant_name": "Liam Carter", "participant_address": "27 Rundle Mall, Adelaide SA 5000",
         "scheduled_start": _iso(24), "scheduled_end": _iso(27), "status": "unassigned"},
        {**base, "id": "s-past", "participant_name": "Zoe Mitchell", "participant_address": None,
         "scheduled_start": _iso(-3), "scheduled_end": _iso(-1), "status": "unassigned"},
        {**base, "id": "s-cancelled", "participant_name": "Priya Singh", "participant_address": None,
         "scheduled_start": _iso(30), "scheduled_end": _iso(33), "status": "cancelled"},
    ]
    with patch.object(svc, "get_supabase_admin", return_value=_supabase(offers, shifts)):
        result = svc.list_pending_offers(worker_id="w-1", org_id="org-1")

    assert [o["offer_id"] for o in result] == ["o-soon", "o-later"]
    first = result[0]
    assert first["participant_first_name"] == "Liam"
    assert first["suburb"] == "Adelaide"
    # Decision-only: no full name, address or participant id.
    assert "participant_name" not in first
    assert "participant_address" not in first
    assert "participant_id" not in first


def test_no_offers_means_no_shift_lookup():
    supabase = _supabase([], [])
    with patch.object(svc, "get_supabase_admin", return_value=supabase):
        assert svc.list_pending_offers(worker_id="w-1", org_id="org-1") == []
    tables = [call.args[0] for call in supabase.table.call_args_list]
    assert tables == ["shift_offers"]
