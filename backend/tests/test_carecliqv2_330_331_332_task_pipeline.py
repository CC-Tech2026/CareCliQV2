"""CARECLIQV2-330 / 331 / 332 — shift_tasks checklist pipeline tests."""

from __future__ import annotations

import copy
from datetime import date
from unittest.mock import MagicMock, patch

import pytest

from backend.app.services import invoice_service, shift_service
from backend.app.services.shift_verification_service import (
    _upsert_task_completions_for_verified_shift,
)


def test_load_tasks_from_shift_tasks_maps_goal_and_evidence():
    """Worker checklist is built from shift_tasks → participant_tasks (TDB-004)."""
    link_table = MagicMock()
    link_table.select.return_value.eq.return_value.eq.return_value.order.return_value.execute.return_value = MagicMock(
        data=[
            {
                "id": "st-1",
                "task_id": "pt-goal-1",
                "completed": False,
                "completed_at": None,
                "note": "",
                "sort_order": 1,
                "marked_na": False,
                "na_reason": None,
            }
        ]
    )
    pt_table = MagicMock()
    pt_table.select.return_value.in_.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[
            {
                "id": "pt-goal-1",
                "name": "Community outing",
                "description": "Support community access",
                "is_mandatory": True,
                "goal_id": "goal-1",
                "evidence_required": "photo_and_notes",
                "priority": "high",
                "category": "community_access",
                "status": "pending",
            }
        ]
    )
    goals_table = MagicMock()
    goals_table.select.return_value.in_.return_value.execute.return_value = MagicMock(
        data=[{"id": "goal-1", "name": "Build independence", "title": None}]
    )

    def table_side_effect(name: str):
        if name == "shift_tasks":
            return link_table
        if name == "participant_tasks":
            return pt_table
        if name == "ndis_goals":
            return goals_table
        return MagicMock()

    mock_sb = MagicMock()
    mock_sb.table.side_effect = table_side_effect

    with patch.object(shift_service, "get_supabase_admin", return_value=mock_sb):
        tasks = shift_service._load_tasks_from_shift_tasks("shift-1", "org-1")

    assert len(tasks) == 1
    task = tasks[0]
    assert task["task_id"] == "pt-goal-1"
    assert task["label"] == "Community outing"
    assert task["mandatory"] is True
    assert task["evidence_required"] == "photo_and_notes"
    assert task["goal_id"] == "goal-1"
    assert task["goal_title"] == "Build independence"
    assert task["shift_task_id"] == "st-1"


def test_resolve_checklist_prefers_shift_tasks_over_fallback():
    """DEFAULT/FALLBACK must not be sole source when shift_tasks exist (TDB-004 AC)."""
    normalized = [
        {
            "task_id": "pt-1",
            "type": "participant",
            "label": "Coordinator task",
            "completed": False,
            "order": 1,
            "mandatory": True,
            "evidence_required": "notes",
            "goal_id": "goal-1",
            "goal_title": "Goal A",
        }
    ]
    shift = {
        "id": "shift-1",
        "participant_id": "patient-1",
        "shift_type": "morning",
        "tasks": copy.deepcopy(shift_service.FALLBACK_SHIFT_TASKS),
    }

    with patch.object(
        shift_service, "_load_tasks_from_shift_tasks", return_value=normalized
    ):
        resolved = shift_service._resolve_shift_checklist_tasks(
            shift, "org-1", prefer_existing_jsonb=True
        )

    assert len(resolved) == 1
    assert resolved[0]["label"] == "Coordinator task"
    assert {t["task_id"] for t in resolved} != {
        t["task_id"] for t in shift_service.FALLBACK_SHIFT_TASKS
    }


def test_resolve_checklist_falls_back_when_shift_tasks_empty():
    shift = {
        "id": "shift-1",
        "participant_id": "patient-1",
        "shift_type": "morning",
        "tasks": [],
    }
    with patch.object(shift_service, "_load_tasks_from_shift_tasks", return_value=[]), patch.object(
        shift_service,
        "_load_tasks_from_templates",
        return_value=copy.deepcopy(shift_service.FALLBACK_SHIFT_TASKS),
    ):
        resolved = shift_service._resolve_shift_checklist_tasks(shift, "org-1")

    assert len(resolved) == len(shift_service.FALLBACK_SHIFT_TASKS)


def test_upsert_task_completions_sets_verified_status():
    """CARECLIQV2-332: verification writes task_completions status=verified."""
    shift = {"id": "shift-1", "scheduled_start": "2026-07-01T09:00:00+00:00"}
    inserted_payloads: list[dict] = []

    class _Exec:
        def __init__(self, data):
            self.data = data

    class _Chain:
        def __init__(self, data=None):
            self._data = data if data is not None else []

        def select(self, *a, **k):
            return self

        def eq(self, *a, **k):
            return self

        def in_(self, *a, **k):
            return self

        def update(self, *a, **k):
            return self

        def insert(self, payload):
            inserted_payloads.append(payload)
            self._data = [{**payload, "id": f"tc-{len(inserted_payloads)}"}]
            return self

        def execute(self):
            return _Exec(self._data)

    def table_side_effect(name: str):
        if name == "shift_tasks":
            return _Chain([{"task_id": "pt-1"}, {"task_id": "pt-2"}])
        if name == "participant_tasks":
            return _Chain(
                [
                    {"id": "pt-1", "participant_id": "patient-1"},
                    {"id": "pt-2", "participant_id": "patient-1"},
                ]
            )
        if name == "task_completions":
            # First select existing → empty; then inserts return rows
            return _Chain([])
        return _Chain([])

    supabase = MagicMock()
    supabase.table.side_effect = table_side_effect

    rows = _upsert_task_completions_for_verified_shift(
        supabase,
        shift=shift,
        participant_id="patient-1",
        organization_id="org-1",
        coordinator_id="coord-1",
        price_item_code="01_011_0107_1_1",
        billed_amount=100.0,
        actual_minutes=120,
        verified_at="2026-07-01T12:00:00+00:00",
    )

    assert len(rows) == 2
    assert all(r.get("status") == "verified" for r in rows)
    assert all(r.get("evidence_verified") is True for r in rows)
    assert len(inserted_payloads) == 2


def test_get_completed_tasks_for_period_returns_verified_rows():
    """CARECLIQV2-332 AC: invoice period query returns real verified completions."""
    completions_table = MagicMock()
    completions_table.select.return_value.eq.return_value.eq.return_value.eq.return_value.gte.return_value.lte.return_value.order.return_value.execute.return_value = MagicMock(
        data=[
            {
                "id": "tc-1",
                "task_id": "pt-1",
                "completion_date": "2026-07-02",
                "duration_minutes": 60,
                "evidence_type": "notes",
                "evidence_verified": True,
                "price_item_code": "01_011_0107_1_1",
                "billed_amount": 50.0,
            }
        ]
    )
    pt_table = MagicMock()
    pt_table.select.return_value.in_.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"id": "pt-1", "name": "Community outing", "shift_type": "morning", "category": "community_access", "support_category": "CORE"}]
    )
    price_table = MagicMock()
    price_table.select.return_value.in_.return_value.eq.return_value.is_.return_value.execute.return_value = MagicMock(
        data=[]
    )

    def table_side_effect(name: str):
        if name == "task_completions":
            return completions_table
        if name == "participant_tasks":
            return pt_table
        if name == "ndis_price_items":
            return price_table
        return MagicMock()

    supabase = MagicMock()
    supabase.table.side_effect = table_side_effect

    rows = invoice_service.get_completed_tasks_for_period(
        supabase,
        participant_id="patient-1",
        organization_id="org-1",
        period_start=date(2026, 7, 1),
        period_end=date(2026, 7, 31),
        status="verified",
    )

    assert len(rows) == 1
    assert rows[0]["id"] == "tc-1"
    assert rows[0]["participant_tasks"]["name"] == "Community outing"


@pytest.mark.asyncio
async def test_generate_tasks_from_templates_links_shift_tasks_without_shift_id_on_pt():
    """CARECLIQV2-330/331: generated participant_tasks have no shift_id; links go to shift_tasks."""
    from backend.app.api.coordinator import _generate_tasks_from_templates

    templates_table = MagicMock()
    templates_table.select.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[
            {
                "name": "Hygiene support",
                "description": "Assist with hygiene",
                "linked_goal_id": "goal-1",
                "is_mandatory": True,
                "evidence_required": "photo",
                "primary_shift_type": "morning",
                "additional_shift_types": [],
                "recurrence_type": "recurring",
            }
        ]
    )
    inserted_pt = []
    inserted_st = []

    pt_table = MagicMock()

    def pt_insert(payload):
        inserted_pt.extend(payload if isinstance(payload, list) else [payload])
        rows = [
            {**row, "id": f"pt-{idx}"}
            for idx, row in enumerate(payload if isinstance(payload, list) else [payload], start=1)
        ]
        return MagicMock(execute=MagicMock(return_value=MagicMock(data=rows)))

    pt_table.insert.side_effect = pt_insert

    st_table = MagicMock()

    def st_insert(payload):
        inserted_st.extend(payload if isinstance(payload, list) else [payload])
        return MagicMock(execute=MagicMock(return_value=MagicMock(data=payload if isinstance(payload, list) else [payload])))

    st_table.insert.side_effect = st_insert

    def table_side_effect(name: str):
        if name == "participant_task_templates":
            return templates_table
        if name == "participant_tasks":
            return pt_table
        if name == "shift_tasks":
            return st_table
        return MagicMock()

    supabase = MagicMock()
    supabase.table.side_effect = table_side_effect

    created_ids = await _generate_tasks_from_templates(
        supabase,
        participant_id="patient-1",
        shift_id="shift-1",
        shift_type="morning",
        shift_date=date(2026, 7, 17),
        org_id="org-1",
    )

    assert created_ids == ["pt-1"]
    assert "shift_id" not in inserted_pt[0]
    assert inserted_st[0]["shift_id"] == "shift-1"
    assert inserted_st[0]["task_id"] == "pt-1"
    assert inserted_st[0]["completed"] is False
