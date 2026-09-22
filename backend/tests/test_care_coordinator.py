from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.api import coordinator, participants


def _table_router(tables: dict[str, MagicMock]):
    def _table(name: str):
        if name in tables:
            return tables[name]
        raise AssertionError(f"Unexpected table requested: {name}")

    return _table


@pytest.mark.asyncio
async def test_update_shift_context_rejects_care_coordinator_not_in_org():
    """care_coordinator_id must resolve to a real coordinator/MD in the same org."""
    users_table = MagicMock()
    users_table.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data=None
    )
    supabase = MagicMock()
    supabase.table.side_effect = _table_router({"users": users_table})

    body = participants.ShiftContextUpdate(care_coordinator_id="not-a-coordinator")
    with patch(
        "backend.app.api.participants._require_participant_access", new=AsyncMock(return_value={"id": "p-1"})
    ), patch("backend.app.core.access.get_user_organization_id", return_value="org-1"), patch(
        "backend.app.services.supabase_client.get_supabase_admin", return_value=supabase
    ):
        with pytest.raises(HTTPException) as exc:
            await participants.update_shift_context(
                participant_id="p-1",
                body=body,
                current_user={"id": "u-1", "organization_id": "org-1", "role": "support_coordinator"},
            )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_update_shift_context_writes_valid_care_coordinator_id():
    users_table = MagicMock()
    users_table.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data={"id": "coord-1", "role": "support_coordinator"}
    )
    patients_table = MagicMock()
    patients_table.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[{"id": "p-1"}])
    supabase = MagicMock()
    supabase.table.side_effect = _table_router({"users": users_table, "patients": patients_table})

    body = participants.ShiftContextUpdate(care_coordinator_id="coord-1")
    with patch(
        "backend.app.api.participants._require_participant_access", new=AsyncMock(return_value={"id": "p-1"})
    ), patch("backend.app.core.access.get_user_organization_id", return_value="org-1"), patch(
        "backend.app.services.supabase_client.get_supabase_admin", return_value=supabase
    ), patch("backend.app.services.shift_service._fetch_participant_context", return_value={}):
        await participants.update_shift_context(
            participant_id="p-1",
            body=body,
            current_user={"id": "u-1", "organization_id": "org-1", "role": "support_coordinator"},
        )

    patient_payload = patients_table.update.call_args[0][0]
    assert patient_payload["care_coordinator_id"] == "coord-1"


def test_resolve_care_coordinator_id_uses_explicit_valid_override():
    users_table = MagicMock()
    users_table.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data={"id": "md-1", "role": "managing_director"}
    )
    supabase = MagicMock()
    supabase.table.side_effect = _table_router({"users": users_table})

    result = coordinator._resolve_care_coordinator_id(supabase, "p-1", "org-1", override="md-1")
    assert result == "md-1"


def test_resolve_care_coordinator_id_rejects_invalid_override():
    users_table = MagicMock()
    users_table.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data={"id": "worker-1", "role": "support_worker"}
    )
    supabase = MagicMock()
    supabase.table.side_effect = _table_router({"users": users_table})

    with pytest.raises(HTTPException) as exc:
        coordinator._resolve_care_coordinator_id(supabase, "p-1", "org-1", override="worker-1")
    assert exc.value.status_code == 422


def test_resolve_care_coordinator_id_falls_back_to_participant_default():
    patients_table = MagicMock()
    patients_table.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data={"care_coordinator_id": "coord-default"}
    )
    supabase = MagicMock()
    supabase.table.side_effect = _table_router({"patients": patients_table})

    result = coordinator._resolve_care_coordinator_id(supabase, "p-1", "org-1", override=None)
    assert result == "coord-default"


def test_resolve_care_coordinator_id_returns_none_when_participant_has_no_default():
    patients_table = MagicMock()
    patients_table.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data={"care_coordinator_id": None}
    )
    supabase = MagicMock()
    supabase.table.side_effect = _table_router({"patients": patients_table})

    result = coordinator._resolve_care_coordinator_id(supabase, "p-1", "org-1", override=None)
    assert result is None


def test_insert_shift_falls_back_through_legacy_columns_then_care_coordinator():
    """Three-tier fallback: full payload -> drop shift_type/created_by/etc ->
    only then drop care_coordinator_id too. A deployment missing the older
    columns must not also silently lose care_coordinator_id."""
    supabase = MagicMock()
    shifts_table = MagicMock()
    supabase.table.return_value = shifts_table

    call_payloads = []

    def _insert(payload):
        call_payloads.append(dict(payload))
        mock_execute = MagicMock()
        if len(call_payloads) < 2:
            mock_execute.execute.side_effect = Exception("column shifts.shift_type does not exist")
        else:
            mock_execute.execute.return_value = MagicMock(data=[payload])
        return mock_execute

    shifts_table.insert.side_effect = _insert

    payload = {
        "id": "shift-1",
        "shift_type": "standard_support",
        "created_by": "u-1",
        "is_shadow_shift": False,
        "shadow_of_worker_id": None,
        "care_coordinator_id": "coord-1",
    }
    result = coordinator._insert_shift_with_legacy_fallback(supabase, payload)

    assert len(call_payloads) == 2
    assert "shift_type" not in call_payloads[1]
    assert "created_by" not in call_payloads[1]
    assert call_payloads[1]["care_coordinator_id"] == "coord-1"
    assert result.data == [call_payloads[1]]


def test_insert_shift_drops_care_coordinator_only_as_last_resort():
    supabase = MagicMock()
    shifts_table = MagicMock()
    supabase.table.return_value = shifts_table

    call_payloads = []

    def _insert(payload):
        call_payloads.append(dict(payload))
        mock_execute = MagicMock()
        if len(call_payloads) < 3:
            mock_execute.execute.side_effect = Exception("column does not exist")
        else:
            mock_execute.execute.return_value = MagicMock(data=[payload])
        return mock_execute

    shifts_table.insert.side_effect = _insert

    payload = {
        "id": "shift-1",
        "shift_type": "standard_support",
        "created_by": "u-1",
        "care_coordinator_id": "coord-1",
    }
    result = coordinator._insert_shift_with_legacy_fallback(supabase, payload)

    assert len(call_payloads) == 3
    assert "care_coordinator_id" not in call_payloads[2]
    assert result.data == [call_payloads[2]]
