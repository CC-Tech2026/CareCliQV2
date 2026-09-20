"""Phase 3 — verifies each MD-exclusive gate found in the capability catalog
is actually wired to `is_managing_director(user) or has_active_grant(user,
"<capability>", supabase)`, with the *correct* capability string, and that
the OR is additive (an MD with no grant at all still passes; a coordinator
with no grant, or a grant for a different capability, still gets denied).

has_active_grant() itself is already exhaustively tested (real elapsed time,
cross-org, cross-user, cross-capability) in test_access_grants.py — this
file's job is only to catch a wiring mistake: the wrong capability string,
an accidentally-inverted condition, or an endpoint the OR never reached.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

MD = {"id": "md-1", "organization_id": "org-1", "role": "managing_director"}
COORDINATOR = {"id": "coord-1", "organization_id": "org-1", "role": "support_coordinator"}


def _grant_check(expected_capability: str, *, allow: bool):
    """A has_active_grant stand-in that only returns True for the expected
    capability — so a wiring mistake (wrong capability string) shows up as
    a test failure (the real capability gets denied, or a wrong one is
    accidentally accepted), not a silent pass."""
    def check(user, capability, supabase):
        return allow and capability == expected_capability
    return check


# ── md_vault.py — 24 routes, all through one _require_md ──────────────────

def test_md_vault_require_md():
    from backend.app.api import md_vault

    with patch.object(md_vault, "get_supabase_admin", return_value=MagicMock()):
        # MD always passes, even with zero grants.
        with patch.object(md_vault, "has_active_grant", _grant_check("governance_vault", allow=False)):
            assert md_vault._require_md(MD) == "org-1"

        # Coordinator with the correct grant passes.
        with patch.object(md_vault, "has_active_grant", _grant_check("governance_vault", allow=True)):
            assert md_vault._require_md(COORDINATOR) == "org-1"

        # Coordinator with a grant for a *different* capability is still denied.
        with patch.object(md_vault, "has_active_grant", _grant_check("executive_dashboard", allow=True)):
            with pytest.raises(HTTPException) as exc:
                md_vault._require_md(COORDINATOR)
            assert exc.value.status_code == 403

        # Coordinator with no grant at all is denied.
        with patch.object(md_vault, "has_active_grant", return_value=False):
            with pytest.raises(HTTPException):
                md_vault._require_md(COORDINATOR)


# ── md_onboarding.py — 15 routes, all through one _require_md ─────────────

def test_md_onboarding_require_md():
    from backend.app.api import md_onboarding

    with patch.object(md_onboarding, "get_supabase_admin", return_value=MagicMock()):
        with patch.object(md_onboarding, "has_active_grant", _grant_check("onboarding_program_design", allow=False)):
            md_onboarding._require_md(MD)  # does not raise

        with patch.object(md_onboarding, "has_active_grant", _grant_check("onboarding_program_design", allow=True)):
            md_onboarding._require_md(COORDINATOR)  # does not raise

        with patch.object(md_onboarding, "has_active_grant", _grant_check("staff_invitations", allow=True)):
            with pytest.raises(HTTPException):
                md_onboarding._require_md(COORDINATOR)


# ── dashboards.py — GET /dashboard/managing-director ───────────────────────

@pytest.mark.asyncio
async def test_executive_dashboard_gate():
    """md_dashboard does a lot of real downstream aggregation past its
    permission check — rather than mocking all of that just to prove the
    gate itself, make the next line past the gate raise a sentinel and
    assert *that* sentinel (not a 403) is what comes out for a coordinator
    holding the right grant, versus a genuine 403 for the wrong one."""
    from backend.app.api import dashboards

    sentinel = RuntimeError("past the gate")

    with patch.object(dashboards, "get_supabase_admin", return_value=MagicMock()), patch.object(
        dashboards, "get_user_organization_id", side_effect=sentinel
    ):
        with patch.object(dashboards, "has_active_grant", _grant_check("executive_dashboard", allow=True)):
            with pytest.raises(RuntimeError):
                await dashboards.md_dashboard(COORDINATOR)

        with patch.object(dashboards, "has_active_grant", _grant_check("governance_vault", allow=True)):
            with pytest.raises(HTTPException) as exc:
                await dashboards.md_dashboard(COORDINATOR)
            assert exc.value.status_code == 403
            assert "Managing Director access required" in str(exc.value.detail)


# ── coordinator.py — delete_worker_account / assign_coordinator / set_training_module_lock ──

@pytest.mark.asyncio
async def test_delete_worker_account_gate():
    from backend.app.api import coordinator as coord

    mock_supabase = MagicMock()
    mock_supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data={"id": "worker-1", "email": "w@example.com", "organization_id": "org-1", "role": "support_worker"}
    )
    with patch.object(coord, "get_supabase_admin", return_value=mock_supabase), patch.object(
        coord.privacy_service, "request_worker_deletion_by_admin", return_value={"ok": True}
    ), patch.object(coord.audit_service, "log_action", return_value=True):
        with patch.object(coord, "has_active_grant", _grant_check("delete_staff_account", allow=True)):
            result = await coord.delete_worker_account("worker-1", COORDINATOR)
            assert result == {"ok": True}

        with patch.object(coord, "has_active_grant", _grant_check("executive_dashboard", allow=True)):
            with pytest.raises(HTTPException) as exc:
                await coord.delete_worker_account("worker-1", COORDINATOR)
            assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_assign_coordinator_gate_denies_wrong_capability():
    from backend.app.api import coordinator as coord

    mock_supabase = MagicMock()
    with patch.object(coord, "get_supabase_admin", return_value=mock_supabase):
        with patch.object(coord, "has_active_grant", _grant_check("governance_vault", allow=True)):
            with pytest.raises(HTTPException) as exc:
                await coord.assign_coordinator(
                    "worker-1", coord.AssignCoordinatorBody(coordinator_id=None), COORDINATOR
                )
            assert exc.value.status_code == 403


def test_lock_training_module_gate_denies_wrong_capability():
    import asyncio
    from backend.app.api import coordinator as coord

    with patch.object(coord, "get_supabase_admin", return_value=MagicMock()):
        with patch.object(coord, "has_active_grant", _grant_check("governance_vault", allow=True)):
            with pytest.raises(HTTPException) as exc:
                asyncio.run(
                    coord.set_training_module_lock(
                        "module-1", coord.TrainingModuleLockBody(is_locked=True, lock_reason="test"), COORDINATOR
                    )
                )
            assert exc.value.status_code == 403


# ── employee_onboarding.py — _require_hire_manager ─────────────────────────

def test_employee_onboarding_require_hire_manager():
    from backend.app.api import employee_onboarding as eo

    with patch.object(eo, "get_supabase_admin", return_value=MagicMock()):
        with patch.object(eo, "has_active_grant", _grant_check("hire_paperwork", allow=False)):
            assert eo._require_hire_manager(MD) == ("org-1", None)

        with patch.object(eo, "has_active_grant", _grant_check("hire_paperwork", allow=True)):
            assert eo._require_hire_manager(COORDINATOR) == ("org-1", None)

        with patch.object(eo, "has_active_grant", _grant_check("staff_invitations", allow=True)):
            with pytest.raises(HTTPException):
                eo._require_hire_manager(COORDINATOR)


# ── applicants.py — _require_board_access (offer/reject is_hire_manager flag) ──

def test_applicants_board_access_hire_manager_flag():
    from backend.app.api import applicants

    with patch.object(applicants, "get_supabase_admin", return_value=MagicMock()):
        # Coordinator with no grant: on the board, but not a hire manager.
        with patch.object(applicants, "has_active_grant", return_value=False):
            org_id, user_id, is_hire_manager = applicants._require_board_access(COORDINATOR)
            assert is_hire_manager is False

        # Coordinator with the correct grant: now a hire manager for this call.
        with patch.object(applicants, "has_active_grant", _grant_check("applicant_offer_reject", allow=True)):
            _org_id, _user_id, is_hire_manager = applicants._require_board_access(COORDINATOR)
            assert is_hire_manager is True

        # Coordinator with a grant for something else: still not a hire manager.
        with patch.object(applicants, "has_active_grant", _grant_check("governance_vault", allow=True)):
            _org_id, _user_id, is_hire_manager = applicants._require_board_access(COORDINATOR)
            assert is_hire_manager is False

        # MD is always a hire manager, regardless of grants.
        with patch.object(applicants, "has_active_grant", return_value=False):
            _org_id, _user_id, is_hire_manager = applicants._require_board_access(MD)
            assert is_hire_manager is True


# ── invitations.py — create_invite ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_invite_gate_denies_wrong_capability():
    from backend.app.api import invitations

    with patch.object(invitations, "get_supabase_admin", return_value=MagicMock()), patch.object(
        invitations, "require_recent_reauth", return_value=None
    ):
        with patch.object(invitations, "has_active_grant", _grant_check("governance_vault", allow=True)):
            with pytest.raises(HTTPException) as exc:
                await invitations.create_invite(
                    MagicMock(email="new@example.com", role="support_worker", onboarding_id=None),
                    MagicMock(),
                    MagicMock(),
                    COORDINATOR,
                )
            assert exc.value.status_code == 403


# ── organization_branding.py — _require_md ─────────────────────────────────

def test_organization_branding_require_md():
    from backend.app.api import organization_branding as branding

    with patch.object(branding, "get_supabase_admin", return_value=MagicMock()):
        with patch.object(branding, "has_active_grant", _grant_check("org_branding", allow=False)):
            assert branding._require_md(MD) == "org-1"

        with patch.object(branding, "has_active_grant", _grant_check("org_branding", allow=True)):
            assert branding._require_md(COORDINATOR) == "org-1"

        with patch.object(branding, "has_active_grant", _grant_check("platform_billing", allow=True)):
            with pytest.raises(HTTPException):
                branding._require_md(COORDINATOR)


# ── platform_billing.py — _require_md ──────────────────────────────────────

def test_platform_billing_require_md():
    from backend.app.api import platform_billing as pb

    with patch.object(pb, "get_supabase_admin", return_value=MagicMock()):
        with patch.object(pb, "has_active_grant", _grant_check("platform_billing", allow=False)):
            assert pb._require_md(MD) == "org-1"

        with patch.object(pb, "has_active_grant", _grant_check("platform_billing", allow=True)):
            assert pb._require_md(COORDINATOR) == "org-1"

        with patch.object(pb, "has_active_grant", _grant_check("org_branding", allow=True)):
            with pytest.raises(HTTPException):
                pb._require_md(COORDINATOR)
