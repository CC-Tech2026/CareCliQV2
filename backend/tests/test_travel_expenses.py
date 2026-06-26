"""Unit tests for travel expense helpers (CARECLIQV2-292)."""

import pytest
from fastapi import HTTPException

from backend.app.services.travel_expense_service import (
    RECEIPT_REQUIRED_CENTS,
    _cents_from_km,
    _guard_editable,
    auto_save_mileage_on_clock_in,
)


async def _async_return(value):
    return value


def test_cents_from_km_rounds_half_up():
    assert _cents_from_km(10.0, 88) == 880
    assert _cents_from_km(12.345, 88) == 1086
    assert _cents_from_km(0.5, 88) == 44


def test_receipt_threshold_is_ten_dollars():
    assert RECEIPT_REQUIRED_CENTS == 1000


def test_guard_editable_allows_draft():
    _guard_editable({"status": "draft"})


def test_guard_editable_blocks_submitted():
    with pytest.raises(HTTPException) as exc:
        _guard_editable({"status": "submitted"})
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_auto_save_mileage_on_clock_in_skips_without_home(monkeypatch):
    monkeypatch.setattr(
        "backend.app.services.travel_expense_service.get_worker_home_address",
        lambda worker_id: None,
    )
    result = await auto_save_mileage_on_clock_in(
        shift_id="shift-1",
        worker_id="worker-1",
        organization_id="org-1",
        participant_address="12 King St, Adelaide SA",
    )
    assert result is None


@pytest.mark.asyncio
async def test_auto_save_mileage_on_clock_in_persists_estimate(monkeypatch):
    monkeypatch.setattr(
        "backend.app.services.travel_expense_service.get_worker_home_address",
        lambda worker_id: "1 Home St, Adelaide SA",
    )
    monkeypatch.setattr(
        "backend.app.services.travel_expense_service.estimate_shift_mileage",
        lambda home, destination: _async_return({"available": True, "distance_km": 12.5}),
    )

    captured: dict[str, object] = {}

    async def fake_upsert(**kwargs):
        captured.update(kwargs)
        return {"id": "exp-1", **kwargs}

    monkeypatch.setattr(
        "backend.app.services.travel_expense_service.upsert_mileage_expense",
        fake_upsert,
    )

    result = await auto_save_mileage_on_clock_in(
        shift_id="shift-1",
        worker_id="worker-1",
        organization_id="org-1",
        participant_address="12 King St, Adelaide SA",
    )

    assert result is not None
    assert captured["claimed_km"] == 12.5
    assert captured["calculated_km"] == 12.5


@pytest.mark.asyncio
async def test_auto_save_mileage_on_clock_in_uses_override(monkeypatch):
    monkeypatch.setattr(
        "backend.app.services.travel_expense_service.get_worker_home_address",
        lambda worker_id: "1 Home St, Adelaide SA",
    )
    monkeypatch.setattr(
        "backend.app.services.travel_expense_service.estimate_shift_mileage",
        lambda home, destination: _async_return({"available": True, "distance_km": 12.5}),
    )

    captured: dict[str, object] = {}

    async def fake_upsert(**kwargs):
        captured.update(kwargs)
        return {"id": "exp-1", **kwargs}

    monkeypatch.setattr(
        "backend.app.services.travel_expense_service.upsert_mileage_expense",
        fake_upsert,
    )

    result = await auto_save_mileage_on_clock_in(
        shift_id="shift-1",
        worker_id="worker-1",
        organization_id="org-1",
        participant_address="12 King St, Adelaide SA",
        claimed_km_override=18.0,
    )

    assert result is not None
    assert captured["claimed_km"] == 18.0
    assert captured["calculated_km"] == 12.5
