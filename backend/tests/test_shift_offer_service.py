"""Ranked shift-offer queue: send -> accept/decline -> auto-advance/expire.

Mocks get_supabase_admin per-call in the exact sequence each code path
issues .execute() calls, following the _chainable_table_mock pattern in
test_ccq_108_report_isolation.py but with per-call side_effect lists since
these flows chain select -> update -> insert on the same table within one
call and need distinct results at each step.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.app.services import shift_offer_service as svc


def _chain(execute_results):
    """A MagicMock supporting any filter chain, returning `execute_results`
    (a list of MagicMock(data=...)) in order across successive .execute() calls."""
    chain = MagicMock()
    chain.select.return_value = chain
    chain.insert.return_value = chain
    chain.update.return_value = chain
    chain.eq.return_value = chain
    chain.lt.return_value = chain
    chain.is_.return_value = chain
    chain.order.return_value = chain
    chain.limit.return_value = chain
    chain.execute.side_effect = list(execute_results)
    return chain


def _supabase(table_calls: dict[str, list]):
    """table_calls: {table_name: [execute_result, execute_result, ...]} —
    each table's chain replays its results in call order."""
    chains = {name: _chain(results) for name, results in table_calls.items()}
    mock = MagicMock()
    mock.table.side_effect = lambda name: chains[name]
    return mock


SHIFT = {"id": "shift-1", "organization_id": "org-1", "worker_id": None, "scheduled_start": "2026-08-24T09:00:00+00:00"}
PENDING_OFFER = {
    "id": "offer-1", "shift_id": "shift-1", "organization_id": "org-1",
    "worker_id": "worker-1", "rank": 1, "status": "pending",
    "candidate_queue": ["worker-2", "worker-3"], "offered_by": "coord-1",
}


class TestSendOffer:
    def test_supersedes_existing_pending_then_creates_rank_one(self):
        supabase = _supabase({
            "shift_offers": [MagicMock(data=[]), MagicMock(data=[{**PENDING_OFFER, "rank": 1}])],
        })
        with patch.object(svc, "get_supabase_admin", return_value=supabase), \
             patch.object(svc, "_fetch_shift", return_value=SHIFT), \
             patch.object(svc, "notify_shift_offer", new=AsyncMock()) as notify:
            import asyncio
            result = asyncio.run(svc.send_offer(
                shift_id="shift-1", worker_id="worker-1", candidate_queue=["worker-2"],
                offered_by="coord-1", org_id="org-1",
            ))
        assert result["rank"] == 1
        notify.assert_awaited_once()
        assert notify.await_args.kwargs["worker_id"] == "worker-1"
        assert notify.await_args.kwargs["rank"] == 1

    def test_rejects_when_shift_already_has_worker(self):
        with patch.object(svc, "_fetch_shift", return_value={**SHIFT, "worker_id": "someone-else"}):
            import asyncio
            with pytest.raises(svc.ShiftOfferError):
                asyncio.run(svc.send_offer(
                    shift_id="shift-1", worker_id="worker-1", candidate_queue=[],
                    offered_by="coord-1", org_id="org-1",
                ))


class TestDeclineOffer:
    def test_decline_with_remaining_queue_creates_next_offer(self):
        supabase = _supabase({
            "shift_offers": [
                MagicMock(data=[PENDING_OFFER]),          # _get_pending_offer select
                MagicMock(data=[{**PENDING_OFFER, "status": "declined"}]),  # decline update
                MagicMock(data=[{**PENDING_OFFER, "id": "offer-2", "worker_id": "worker-2", "rank": 2}]),  # next-offer insert
            ],
        })
        with patch.object(svc, "get_supabase_admin", return_value=supabase), \
             patch.object(svc, "get_shift_by_id", return_value=SHIFT), \
             patch.object(svc, "notify_shift_offer", new=AsyncMock()) as notify_offer, \
             patch.object(svc, "notify_shift_offer_exhausted", new=AsyncMock()) as notify_exhausted:
            import asyncio
            asyncio.run(svc.decline_offer(shift_id="shift-1", worker_id="worker-1", org_id="org-1"))

        notify_offer.assert_awaited_once()
        assert notify_offer.await_args.kwargs["worker_id"] == "worker-2"
        assert notify_offer.await_args.kwargs["rank"] == 2
        notify_exhausted.assert_not_awaited()

    def test_decline_with_empty_queue_notifies_coordinators_exhausted(self):
        exhausted_offer = {**PENDING_OFFER, "candidate_queue": []}
        supabase = _supabase({
            "shift_offers": [
                MagicMock(data=[exhausted_offer]),
                MagicMock(data=[{**exhausted_offer, "status": "declined"}]),
            ],
        })
        with patch.object(svc, "get_supabase_admin", return_value=supabase), \
             patch.object(svc, "get_shift_by_id", return_value=SHIFT), \
             patch.object(svc, "notify_shift_offer", new=AsyncMock()) as notify_offer, \
             patch.object(svc, "notify_shift_offer_exhausted", new=AsyncMock()) as notify_exhausted:
            import asyncio
            asyncio.run(svc.decline_offer(shift_id="shift-1", worker_id="worker-1", org_id="org-1"))

        notify_offer.assert_not_awaited()
        notify_exhausted.assert_awaited_once()

    def test_decline_raises_when_no_pending_offer(self):
        supabase = _supabase({"shift_offers": [MagicMock(data=[])]})
        with patch.object(svc, "get_supabase_admin", return_value=supabase):
            import asyncio
            with pytest.raises(svc.ShiftOfferError):
                asyncio.run(svc.decline_offer(shift_id="shift-1", worker_id="worker-1", org_id="org-1"))


class TestAcceptOffer:
    def test_accept_assigns_shift_and_supersedes_other_pending(self):
        supabase = _supabase({
            "shift_offers": [
                MagicMock(data=[PENDING_OFFER]),                              # _get_pending_offer
                MagicMock(data=[{**PENDING_OFFER, "status": "accepted"}]),    # mark this offer accepted
                MagicMock(data=[]),                                          # supersede remaining pending
            ],
            "shifts": [MagicMock(data=[{**SHIFT, "worker_id": "worker-1", "status": "scheduled"}])],
        })
        with patch.object(svc, "get_supabase_admin", return_value=supabase), \
             patch.object(svc, "get_shift_by_id", return_value=SHIFT):
            import asyncio
            result = asyncio.run(svc.accept_offer(shift_id="shift-1", worker_id="worker-1", org_id="org-1"))

        assert result["worker_id"] == "worker-1"
        assert result["status"] == "scheduled"

    def test_accept_rolls_back_offer_when_shift_already_assigned_elsewhere(self):
        supabase = _supabase({
            "shift_offers": [
                MagicMock(data=[PENDING_OFFER]),
                MagicMock(data=[{**PENDING_OFFER, "status": "accepted"}]),
                MagicMock(data=[{**PENDING_OFFER, "status": "pending"}]),  # rollback update
            ],
            "shifts": [MagicMock(data=[])],  # lost the race — no row matched the is_(worker_id, null) guard
        })
        with patch.object(svc, "get_supabase_admin", return_value=supabase), \
             patch.object(svc, "get_shift_by_id", return_value=SHIFT):
            import asyncio
            with pytest.raises(svc.ShiftOfferError):
                asyncio.run(svc.accept_offer(shift_id="shift-1", worker_id="worker-1", org_id="org-1"))

    def test_accept_rejects_when_shift_already_shows_a_worker(self):
        with patch.object(svc, "get_shift_by_id", return_value=SHIFT), \
             patch.object(svc, "_fetch_shift", return_value={**SHIFT, "worker_id": "someone-else"}), \
             patch.object(svc, "get_supabase_admin", return_value=_supabase({
                 "shift_offers": [MagicMock(data=[PENDING_OFFER])],
             })):
            import asyncio
            with pytest.raises(svc.ShiftOfferError):
                asyncio.run(svc.accept_offer(shift_id="shift-1", worker_id="worker-1", org_id="org-1"))


class TestRunShiftOfferPass:
    def test_expired_offer_with_queue_advances_to_next_candidate(self):
        supabase = _supabase({
            "shift_offers": [
                MagicMock(data=[PENDING_OFFER]),                                     # initial expired-scan select
                MagicMock(data=[{**PENDING_OFFER, "status": "expired"}]),            # expire update
                MagicMock(data=[{**PENDING_OFFER, "id": "offer-2", "worker_id": "worker-2", "rank": 2}]),  # next-offer insert
            ],
        })
        with patch.object(svc, "get_supabase_admin", return_value=supabase), \
             patch.object(svc, "get_shift_by_id", return_value=SHIFT), \
             patch.object(svc, "notify_shift_offer", new=AsyncMock()) as notify_offer, \
             patch.object(svc, "notify_shift_offer_exhausted", new=AsyncMock()) as notify_exhausted:
            import asyncio
            stats = asyncio.run(svc.run_shift_offer_pass())

        assert stats == {"expired": 1, "advanced": 1, "exhausted": 0}
        notify_offer.assert_awaited_once()
        notify_exhausted.assert_not_awaited()

    def test_expired_offer_with_empty_queue_notifies_exhausted(self):
        exhausted_offer = {**PENDING_OFFER, "candidate_queue": []}
        supabase = _supabase({
            "shift_offers": [
                MagicMock(data=[exhausted_offer]),
                MagicMock(data=[{**exhausted_offer, "status": "expired"}]),
            ],
        })
        with patch.object(svc, "get_supabase_admin", return_value=supabase), \
             patch.object(svc, "get_shift_by_id", return_value=SHIFT), \
             patch.object(svc, "notify_shift_offer", new=AsyncMock()) as notify_offer, \
             patch.object(svc, "notify_shift_offer_exhausted", new=AsyncMock()) as notify_exhausted:
            import asyncio
            stats = asyncio.run(svc.run_shift_offer_pass())

        assert stats == {"expired": 1, "advanced": 0, "exhausted": 1}
        notify_offer.assert_not_awaited()
        notify_exhausted.assert_awaited_once()

    def test_skips_advance_when_shift_already_assigned(self):
        """Coordinator direct-assigned the shift while an offer was still
        pending elsewhere — expiry should still record but must not create
        a new offer against an already-filled shift."""
        supabase = _supabase({
            "shift_offers": [
                MagicMock(data=[PENDING_OFFER]),
                MagicMock(data=[{**PENDING_OFFER, "status": "expired"}]),
            ],
        })
        already_assigned_shift = {**SHIFT, "worker_id": "worker-9"}
        with patch.object(svc, "get_supabase_admin", return_value=supabase), \
             patch.object(svc, "get_shift_by_id", return_value=already_assigned_shift), \
             patch.object(svc, "notify_shift_offer", new=AsyncMock()) as notify_offer, \
             patch.object(svc, "notify_shift_offer_exhausted", new=AsyncMock()) as notify_exhausted:
            import asyncio
            stats = asyncio.run(svc.run_shift_offer_pass())

        assert stats == {"expired": 1, "advanced": 0, "exhausted": 0}
        notify_offer.assert_not_awaited()
        notify_exhausted.assert_not_awaited()
