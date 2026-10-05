"""How strictly an organisation holds shifts to the service agreement
(migration 239): warn, reason (the default), strict."""
from __future__ import annotations

from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import agreement_support_service as supports
from backend.app.services import shift_verification_service as svc

# Imported before the shared fixture patches it, so this is the real one.
REAL_CHECK_LEVEL = supports.check_level


class _Q:
    def __init__(self, rows=None, error=None):
        self.rows, self.error = rows or [], error

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        if self.error:
            raise self.error
        return MagicMock(data=self.rows)


def _db(rows=None, error=None):
    db = MagicMock()
    db.table.return_value = _Q(rows, error)
    return db


def test_the_level_defaults_to_reason():
    with patch.object(supports, "get_supabase_admin", return_value=_db([{"agreement_check_level": "strict"}])):
        assert REAL_CHECK_LEVEL("org-1") == "strict"
    with patch.object(supports, "get_supabase_admin", return_value=_db([{"agreement_check_level": None}])):
        assert REAL_CHECK_LEVEL("org-1") == "reason"
    # Before migration 239: the column doesn't exist yet.
    with patch.object(supports, "get_supabase_admin", return_value=_db(error=RuntimeError("42703"))):
        assert REAL_CHECK_LEVEL("org-1") == "reason"


# ── Strict: rostering ────────────────────────────────────────────────────

SIGNED = {"id": "sa-1", "start_date": "2026-07-01", "end_date": "2027-06-30", "service_agreement_supports": [{"id": "l1"}]}


def test_only_strict_holds_rostering_back():
    with patch.object(supports, "check_level", return_value="reason"):
        assert supports.rostering_gate("p-1", "org-1") is None
    with patch.object(supports, "check_level", return_value="strict"), \
         patch.object(supports, "get_supabase_admin", return_value=_db([SIGNED, {**SIGNED, "id": "sa-2", "service_agreement_supports": []}])):
        # An agreement with no supports doesn't count.
        assert [a["id"] for a in supports.rostering_gate("p-1", "org-1")] == ["sa-1"]
    assert supports.covers_any([SIGNED], date(2026, 10, 5))
    assert not supports.covers_any([SIGNED], date(2027, 7, 1))
    assert not supports.covers_any([], date(2026, 10, 5))


def test_strict_refuses_a_shift_no_signed_agreement_covers():
    from backend.app.api import coordinator

    start = datetime(2027, 7, 5, 0, 0, tzinfo=timezone.utc)
    with patch.object(coordinator.agreement_support_service, "rostering_gate", return_value=[SIGNED]), \
         patch.object(coordinator.shift_task_service, "local_shift_date", return_value=date(2027, 7, 5)):
        with pytest.raises(HTTPException) as err:
            coordinator._agreement_line_for_new_shift(
                MagicMock(), line_id=None, participant_id="p-1", org_id="org-1", start=start, end=start, expected_code=None,
            )
    assert err.value.status_code == 409 and "No signed service agreement covers 2027-07-05" in err.value.detail
    with patch.object(coordinator.agreement_support_service, "rostering_gate", return_value=[SIGNED]), \
         patch.object(coordinator.shift_task_service, "local_shift_date", return_value=date(2026, 10, 5)):
        assert coordinator._agreement_line_for_new_shift(
            MagicMock(), line_id=None, participant_id="p-1", org_id="org-1", start=start, end=start, expected_code=None,
        ) == ({}, [])


# ── Warn: verification ───────────────────────────────────────────────────

SHIFT = {
    "id": "shift-1", "organization_id": "org-1", "participant_id": "p-1", "worker_id": "w-1", "status": "completed",
    "session_id": "session-1", "tasks": [], "scheduled_start": "2026-10-05T09:00:00+10:30",
    "scheduled_end": "2026-10-05T12:00:00+10:30", "clocked_in_at": "2026-10-05T09:00:00+10:30",
    "clocked_out_at": "2026-10-05T12:00:00+10:30",
}
ISSUES = {"issues": [{"code": "no_agreement", "message": "This participant has no sent or signed service agreement."}],
          "agreed_rate": None, "billed_band": None, "band_warning": None, "line_changed": False, "matched_line": None}


async def _verify(level, **kw):
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[dict(SHIFT)])
    db.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[{"id": "ver-1"}])
    price = {"item_code": "01_011_0107_1_1", "effective_price": 65.0, "price_source": "platform",
             "support_purpose": "Core Supports", "unit": "H"}
    with patch.object(svc, "get_supabase_admin", return_value=db), \
         patch.object(svc, "_active_verification", return_value=None), \
         patch.object(svc, "_get_session_for_shift", return_value={"id": "session-1", "compliance_input_text": "Helped."}), \
         patch.object(svc, "get_plan_for_participant", new=AsyncMock(return_value={"id": "plan-1", "plan_budgets": [{"id": "b", "category": "core", "used_amount": 0}]})), \
         patch.object(svc.ndis_pricing_service, "resolve_price", new=AsyncMock(return_value=price)), \
         patch.object(svc, "_agreement_assessment", return_value=dict(ISSUES)), \
         patch.object(svc, "_price_limit", return_value=None), \
         patch.object(svc, "_upsert_task_completions_for_verified_shift", return_value=[]), \
         patch.object(svc, "_apply_budget_change", return_value=0.0), \
         patch.object(svc.agreement_support_service, "check_level", return_value=level):
        return await svc.verify_shift("shift-1", "coord-1", "01_011_0107_1_1", "org-1", **kw)


@pytest.mark.asyncio
async def test_warn_bills_without_a_reason_but_still_records_the_issue():
    result = await _verify("warn")
    assert result["agreement"]["issues"][0]["code"] == "no_agreement"
    assert result["agreement"]["check_level"] == "warn" and result["agreement"]["reason"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("level", ["reason", "strict"])
async def test_reason_and_strict_still_need_a_reason(level):
    with pytest.raises(ValueError, match="Give a reason"):
        await _verify(level)
    assert (await _verify(level, agreement_reason="Agreement is a signed PDF only."))["agreement"]["reason"]


# ── Settings ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_only_the_managing_director_changes_the_level():
    from backend.app.api import settings

    coordinator_user = {"id": "u-c", "organization_id": "org-1", "role": "support_coordinator"}
    with pytest.raises(HTTPException) as err:
        await settings.save_agreement_checks(settings.AgreementChecksBody(level="warn"), current_user=coordinator_user)
    assert err.value.status_code == 403

    md = {"id": "u-md", "organization_id": "org-1", "role": "managing_director"}
    db = MagicMock()
    with patch.object(settings, "get_supabase_admin", return_value=db), \
         patch.object(settings, "log_action", new=AsyncMock()) as audit:
        assert await settings.save_agreement_checks(settings.AgreementChecksBody(level="warn"), current_user=md) == {"level": "warn"}
    db.table.return_value.update.assert_called_once_with({"agreement_check_level": "warn"})
    assert audit.await_args.kwargs["before_state"] == {"level": "reason"}
    with pytest.raises(Exception):
        settings.AgreementChecksBody(level="loose")
