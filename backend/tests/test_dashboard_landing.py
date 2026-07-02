"""Tests for worker dashboard landing aggregation (CARECLIQV2-104)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.services import dashboard_landing_service as landing


def _shift(**overrides):
    base = {
        "id": "shift-1",
        "participant_id": "p-1",
        "participant_name": "Alex Rivera",
        "participant_address": "12 King St, Adelaide SA",
        "scheduled_start": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(),
        "scheduled_end": (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat(),
        "status": "scheduled",
        "visual_state": "scheduled",
        "has_risk_alerts": False,
        "risks_acknowledged": True,
    }
    base.update(overrides)
    return base


def test_pick_next_shift_prefers_in_progress():
    active = _shift(id="active", status="in_progress", scheduled_start=datetime.now(timezone.utc).isoformat())
    future = _shift(id="future", scheduled_start=(datetime.now(timezone.utc) + timedelta(hours=3)).isoformat())
    picked = landing._pick_next_shift([active, future], [])
    assert picked is not None
    assert picked["id"] == "active"


def test_shift_summary_includes_time_label():
    summary = landing._shift_summary(_shift())
    assert summary["participant_name"] == "Alex Rivera"
    assert summary["time_label"]
    assert summary["date_label"]


@pytest.mark.asyncio
async def test_build_worker_landing_dashboard_composes_payload():
    user = {
        "id": "worker-1",
        "organization_id": "org-1",
        "full_name": "Sam Taylor",
        "role": "support_worker",
    }
    today = [_shift()]
    upcoming = [_shift(id="shift-2", scheduled_start=(datetime.now(timezone.utc) + timedelta(days=1)).isoformat())]

    with patch.object(landing.shift_service, "_fetch_worker_shift_rows", return_value=today + upcoming), patch.object(
        landing.shift_service,
        "filter_shift_rows",
        side_effect=lambda rows, name, _today: today if name == "today" else (upcoming if name == "upcoming" else []),
    ), patch.object(
        landing.shift_service,
        "build_worker_shift_cards",
        side_effect=lambda rows, *_args, **_kwargs: rows,
    ), patch.object(landing, "_worker_compliance_alerts", return_value=[]), patch.object(
        landing.session_service,
        "get_sessions_for_dashboard",
        new=AsyncMock(return_value=[]),
    ):
        payload = await landing.build_worker_landing_dashboard(user)

    assert payload["worker"]["first_name"] == "Sam"
    assert len(payload["today_shifts"]) == 1
    assert payload["next_shift"]["id"] == "shift-1"
    assert payload["stats"]["shifts_today"] == 1
