"""employee_id_service.py — the auto-generated staff ID scheme
(205_employee_id_scheme.sql): <ROLE prefix><3-digit seq><org abbreviation>,
e.g. SW003HARV, for managing_director/support_coordinator/support_worker
only. Mocked-Supabase style, mirrors test_admin_organizations.py."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from backend.app.services import employee_id_service as svc


# ---------------------------------------------------------------------------
# normalize_org_abbrev
# ---------------------------------------------------------------------------

def test_normalize_org_abbrev_uppercases_and_strips():
    assert svc.normalize_org_abbrev("  harv ") == "HARV"


@pytest.mark.parametrize("bad", ["HAR", "HARVE", "HAR1", "", "  "])
def test_normalize_org_abbrev_rejects_bad_shape(bad):
    with pytest.raises(HTTPException) as exc:
        svc.normalize_org_abbrev(bad)
    assert exc.value.status_code == 422


# ---------------------------------------------------------------------------
# is_org_abbrev_available
# ---------------------------------------------------------------------------

def test_is_org_abbrev_available_false_for_bad_shape_without_querying():
    supabase = MagicMock()
    assert svc.is_org_abbrev_available(supabase, "no") is False
    supabase.table.assert_not_called()


def test_is_org_abbrev_available_true_when_no_match():
    supabase = MagicMock()
    supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = (
        MagicMock(data=[])
    )
    assert svc.is_org_abbrev_available(supabase, "harv") is True


def test_is_org_abbrev_available_false_when_taken():
    supabase = MagicMock()
    supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = (
        MagicMock(data=[{"organization_id": "org-1"}])
    )
    assert svc.is_org_abbrev_available(supabase, "harv") is False


def test_is_org_abbrev_available_excludes_own_org():
    supabase = MagicMock()
    supabase.table.return_value.select.return_value.eq.return_value.neq.return_value.limit.return_value.execute.return_value = (
        MagicMock(data=[])
    )
    assert svc.is_org_abbrev_available(supabase, "harv", exclude_organization_id="org-1") is True
    supabase.table.return_value.select.return_value.eq.return_value.neq.assert_called_once_with(
        "organization_id", "org-1"
    )


# ---------------------------------------------------------------------------
# generate_employee_id
# ---------------------------------------------------------------------------

def test_generate_employee_id_returns_none_for_excluded_role():
    supabase = MagicMock()
    assert svc.generate_employee_id(supabase, "org-1", "allied_health") is None
    assert svc.generate_employee_id(supabase, "org-1", "super_admin") is None
    supabase.table.assert_not_called()


def test_generate_employee_id_returns_none_without_org_abbrev():
    supabase = MagicMock()
    supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = (
        MagicMock(data=[{"org_abbrev": None}])
    )
    assert svc.generate_employee_id(supabase, "org-1", "support_worker") is None
    supabase.rpc.assert_not_called()


def test_generate_employee_id_formats_correctly():
    supabase = MagicMock()
    supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = (
        MagicMock(data=[{"org_abbrev": "HARV"}])
    )
    supabase.rpc.return_value.execute.return_value = MagicMock(data=3)

    result = svc.generate_employee_id(supabase, "org-1", "support_worker")

    assert result == "SW003HARV"
    supabase.rpc.assert_called_once_with(
        "next_employee_seq", {"p_organization_id": "org-1", "p_role": "support_worker"}
    )


def test_generate_employee_id_swallows_errors():
    supabase = MagicMock()
    supabase.table.side_effect = Exception("connection refused")
    assert svc.generate_employee_id(supabase, "org-1", "managing_director") is None


# ---------------------------------------------------------------------------
# set_org_abbrev_and_backfill
# ---------------------------------------------------------------------------

def _dispatch(org_execute_results, member_select_result):
    """A supabase.table(...) stand-in that routes 'organizations' selects
    through a sequence of canned results (existing-check, then the internal
    availability check) and 'organization_members' through its own chains."""
    org_table = MagicMock()
    org_table.select.return_value.eq.return_value.limit.return_value.execute.side_effect = org_execute_results
    org_table.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"organization_id": "org-1", "org_abbrev": "HARV"}]
    )

    member_table = MagicMock()
    member_table.select.return_value.eq.return_value.in_.return_value.is_.return_value.order.return_value.execute.return_value = (
        member_select_result
    )
    member_table.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[{"id": "m-1"}])

    def _table(name: str):
        if name == "organizations":
            return org_table
        if name == "organization_members":
            return member_table
        raise AssertionError(f"Unexpected table requested: {name}")

    return _table


def test_set_org_abbrev_404_when_org_missing():
    supabase = MagicMock()
    supabase.table.side_effect = _dispatch([MagicMock(data=[])], MagicMock(data=[]))

    with pytest.raises(HTTPException) as exc:
        svc.set_org_abbrev_and_backfill(supabase, "org-1", "harv")
    assert exc.value.status_code == 404


def test_set_org_abbrev_409_when_already_set():
    supabase = MagicMock()
    supabase.table.side_effect = _dispatch([MagicMock(data=[{"org_abbrev": "OLDX"}])], MagicMock(data=[]))

    with pytest.raises(HTTPException) as exc:
        svc.set_org_abbrev_and_backfill(supabase, "org-1", "harv")
    assert exc.value.status_code == 409


def test_set_org_abbrev_409_when_candidate_taken():
    supabase = MagicMock()
    # 1st select: existing-check (no abbrev yet). 2nd select: availability
    # check finds another org already holding "HARV".
    supabase.table.side_effect = _dispatch(
        [MagicMock(data=[{"org_abbrev": None}]), MagicMock(data=[{"organization_id": "org-2"}])],
        MagicMock(data=[]),
    )

    with pytest.raises(HTTPException) as exc:
        svc.set_org_abbrev_and_backfill(supabase, "org-1", "harv")
    assert exc.value.status_code == 409


def test_set_org_abbrev_saves_and_backfills_existing_staff():
    supabase = MagicMock()
    supabase.table.side_effect = _dispatch(
        [MagicMock(data=[{"org_abbrev": None}]), MagicMock(data=[])],
        MagicMock(data=[
            {"id": "m-1", "role": "support_worker"},
            {"id": "m-2", "role": "support_coordinator"},
        ]),
    )
    supabase.rpc.return_value.execute.side_effect = [MagicMock(data=1), MagicMock(data=1)]

    result = svc.set_org_abbrev_and_backfill(supabase, "org-1", "harv")

    assert result == {"org_abbrev": "HARV", "backfilled_count": 2}
    assert supabase.rpc.call_count == 2
