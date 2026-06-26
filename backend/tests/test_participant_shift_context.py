from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.app.api import participants


@pytest.mark.asyncio
async def test_get_shift_context_requires_coordinator_role():
    with pytest.raises(HTTPException) as exc:
        await participants.get_shift_context(
            participant_id="p-1",
            current_user={"id": "u-1", "organization_id": "org-1", "role": "support_worker"},
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_shift_context_returns_context_for_coordinator():
    expected = {
        "profile": {"preferred_name": "Jamie"},
        "preferences": {"likes_dislikes": "Enjoys puzzles"},
        "context": {"previous_visit_notes": "Hydration prompts worked well."},
    }

    with patch("backend.app.api.participants._require_participant_access", new=AsyncMock(return_value={"id": "p-1"})) as require_access, patch(
        "backend.app.core.access.get_user_organization_id", return_value="org-1"
    ), patch("backend.app.services.shift_service._fetch_participant_context", return_value=expected):
        result = await participants.get_shift_context(
            participant_id="p-1",
            current_user={"id": "u-1", "organization_id": "org-1", "role": "support_coordinator"},
        )

    require_access.assert_awaited_once()
    assert result == expected


@pytest.mark.asyncio
async def test_update_shift_context_requires_coordinator_role():
    body = participants.ShiftContextUpdate(preferred_name="Jamie")
    with pytest.raises(HTTPException) as exc:
        await participants.update_shift_context(
            participant_id="p-1",
            body=body,
            current_user={"id": "u-1", "organization_id": "org-1", "role": "support_worker"},
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_shift_context_updates_patient_and_allergies():
    body = participants.ShiftContextUpdate(
        preferred_name="Jamie",
        communication_guidance="Use short prompts",
        previous_visit_notes="Hydration prompts worked",
        behavioural_notes=[participants.BehaviouralNoteItem(title="Transitions", body="Give 10-minute warning")],
        allergies=[
            participants.AllergyItem(allergen="Peanuts", severity="anaphylactic", notes="EpiPen in kitchen drawer"),
            participants.AllergyItem(allergen="Penicillin", severity="moderate", notes="Rash reaction"),
        ],
    )

    patients_table = MagicMock()
    allergies_table = MagicMock()
    supabase = MagicMock()

    def _table(name: str):
        if name == "patients":
            return patients_table
        if name == "participant_allergies":
            return allergies_table
        raise AssertionError(f"Unexpected table requested: {name}")

    supabase.table.side_effect = _table

    patients_table.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[{"id": "p-1"}])
    allergies_table.delete.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
    allergies_table.insert.return_value.execute.return_value = MagicMock(data=[])

    expected = {
        "profile": {"preferred_name": "Jamie"},
        "context": {"communication_guidance": "Use short prompts"},
    }

    with patch("backend.app.api.participants._require_participant_access", new=AsyncMock(return_value={"id": "p-1"})), patch(
        "backend.app.core.access.get_user_organization_id", return_value="org-1"
    ), patch("backend.app.services.supabase_client.get_supabase_admin", return_value=supabase), patch(
        "backend.app.services.shift_service._fetch_participant_context", return_value=expected
    ):
        result = await participants.update_shift_context(
            participant_id="p-1",
            body=body,
            current_user={"id": "u-1", "organization_id": "org-1", "role": "support_coordinator"},
        )

    patient_payload = patients_table.update.call_args[0][0]
    assert patient_payload["preferred_name"] == "Jamie"
    assert patient_payload["communication_guidance"] == "Use short prompts"
    assert patient_payload["previous_visit_notes"] == "Hydration prompts worked"
    assert "previous_visit_notes_updated_at" in patient_payload
    assert patient_payload["behavioural_notes"][0]["title"] == "Transitions"

    delete_chain = allergies_table.delete.return_value.eq.return_value
    delete_chain.eq.assert_called_once_with("organization_id", "org-1")
    assert allergies_table.insert.call_count == 2
    assert result == expected


def _build_test_app(current_user: dict) -> TestClient:
    app = FastAPI()
    app.include_router(participants.router, prefix="/api")
    app.dependency_overrides[participants.get_current_user] = lambda: current_user
    return TestClient(app)


def test_get_shift_context_http_forbidden_for_non_coordinator():
    client = _build_test_app({"id": "u-1", "organization_id": "org-1", "role": "support_worker"})
    response = client.get("/api/participants/p-1/shift-context")
    assert response.status_code == 403
    assert "Support coordinator access required" in response.text


def test_get_shift_context_http_success_for_coordinator():
    client = _build_test_app({"id": "u-1", "organization_id": "org-1", "role": "support_coordinator"})
    expected = {
        "profile": {"preferred_name": "Jamie"},
        "preferences": {"likes_dislikes": "Enjoys puzzles"},
        "context": {"previous_visit_notes": "Hydration prompts worked well."},
        "background_summary": None,
        "background_summary_updated_at": None,
        "briefing_alerts": [],
    }
    patients_table = MagicMock()
    supabase = MagicMock()
    supabase.table.return_value = patients_table
    patients_table.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"background_summary": None, "background_summary_updated_at": None}]
    )

    with patch("backend.app.api.participants._require_participant_access", new=AsyncMock(return_value={"id": "p-1"})), patch(
        "backend.app.core.access.get_user_organization_id", return_value="org-1"
    ), patch("backend.app.services.supabase_client.get_supabase_admin", return_value=supabase), patch(
        "backend.app.services.briefing_service.list_participant_briefing_alerts", return_value=[]
    ), patch("backend.app.services.shift_service._fetch_participant_context", return_value={
        "profile": {"preferred_name": "Jamie"},
        "preferences": {"likes_dislikes": "Enjoys puzzles"},
        "context": {"previous_visit_notes": "Hydration prompts worked well."},
    }):
        response = client.get("/api/participants/p-1/shift-context")

    assert response.status_code == 200
    assert response.json() == expected


def test_patch_shift_context_http_updates_and_returns_context():
    client = _build_test_app({"id": "u-1", "organization_id": "org-1", "role": "support_coordinator"})

    patients_table = MagicMock()
    allergies_table = MagicMock()
    supabase = MagicMock()

    def _table(name: str):
        if name == "patients":
            return patients_table
        if name == "participant_allergies":
            return allergies_table
        raise AssertionError(f"Unexpected table requested: {name}")

    supabase.table.side_effect = _table
    patients_table.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[{"id": "p-1"}])
    patients_table.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"background_summary": None, "background_summary_updated_at": None}]
    )
    allergies_table.delete.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
    allergies_table.insert.return_value.execute.return_value = MagicMock(data=[])

    expected = {
        "profile": {"preferred_name": "Jamie"},
        "context": {"communication_guidance": "Use short prompts"},
        "background_summary": None,
        "background_summary_updated_at": None,
        "briefing_alerts": [],
    }

    payload = {
        "preferred_name": "Jamie",
        "communication_guidance": "Use short prompts",
        "previous_visit_notes": "Hydration prompts worked",
        "behavioural_notes": [{"title": "Transitions", "body": "Give 10-minute warning"}],
        "allergies": [
            {"allergen": "Peanuts", "severity": "anaphylactic", "notes": "EpiPen in kitchen drawer"},
            {"allergen": "Penicillin", "severity": "moderate", "notes": "Rash reaction"},
        ],
    }

    with patch("backend.app.api.participants._require_participant_access", new=AsyncMock(return_value={"id": "p-1"})), patch(
        "backend.app.core.access.get_user_organization_id", return_value="org-1"
    ), patch("backend.app.services.supabase_client.get_supabase_admin", return_value=supabase), patch(
        "backend.app.services.briefing_service.list_participant_briefing_alerts", return_value=[]
    ), patch("backend.app.services.shift_service._fetch_participant_context", return_value=expected):
        response = client.patch("/api/participants/p-1/shift-context", json=payload)

    assert response.status_code == 200
    assert response.json() == expected

    patient_payload = patients_table.update.call_args[0][0]
    assert patient_payload["preferred_name"] == "Jamie"
    assert patient_payload["communication_guidance"] == "Use short prompts"
    assert patient_payload["previous_visit_notes"] == "Hydration prompts worked"
    assert "previous_visit_notes_updated_at" in patient_payload
    assert allergies_table.insert.call_count == 2
