from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.api import users as users_api


WORKER = {"id": "worker-1", "organization_id": "org-1", "role": "support_worker"}


@pytest.mark.asyncio
async def test_get_my_profile_includes_summary_and_experience_years():
    profile_row = {
        "id": "worker-1",
        "email": "worker@example.com",
        "full_name": "Wanda Worker",
        "role": "support_worker",
        "organization_id": "org-1",
        "profile_summary": "Experienced in community access support.",
        "profile_experience_years": 5,
        "profile_photo_path": None,
    }
    mock_supabase = MagicMock()

    def table_side_effect(name: str):
        table = MagicMock()
        if name == "users":
            table.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
                data=profile_row
            )
        elif name == "organization_members":
            table.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
                data=None
            )
        return table

    mock_supabase.table.side_effect = table_side_effect

    with patch.object(users_api, "get_supabase_admin", return_value=mock_supabase):
        result = await users_api.get_my_profile(WORKER)

    assert result["profile_summary"] == "Experienced in community access support."
    assert result["profile_experience_years"] == 5


@pytest.mark.asyncio
async def test_update_my_profile_saves_summary_and_experience_years():
    mock_supabase = MagicMock()
    mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"id": "worker-1", "profile_summary": "Updated summary", "profile_experience_years": 3}]
    )

    with patch.object(users_api, "get_supabase_admin", return_value=mock_supabase):
        result = await users_api.update_my_profile(
            {"profile_summary": "Updated summary", "profile_experience_years": "3"},
            WORKER,
        )

    update_call = mock_supabase.table.return_value.update.call_args
    assert update_call.args[0]["profile_summary"] == "Updated summary"
    assert update_call.args[0]["profile_experience_years"] == 3  # coerced to int
    assert result["profile_summary"] == "Updated summary"


@pytest.mark.asyncio
async def test_update_my_profile_rejects_invalid_experience_years():
    mock_supabase = MagicMock()
    with patch.object(users_api, "get_supabase_admin", return_value=mock_supabase):
        with pytest.raises(HTTPException) as exc:
            await users_api.update_my_profile({"profile_experience_years": "not-a-number"}, WORKER)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_update_my_profile_rejects_out_of_range_experience_years():
    mock_supabase = MagicMock()
    with patch.object(users_api, "get_supabase_admin", return_value=mock_supabase):
        with pytest.raises(HTTPException) as exc:
            await users_api.update_my_profile({"profile_experience_years": 999}, WORKER)
    assert exc.value.status_code == 422
