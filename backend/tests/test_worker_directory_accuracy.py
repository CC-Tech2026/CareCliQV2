"""
Live, read-only verification that the Coordinator (/team,
/api/coordinator/worker-stats) and Managing Director (/api/dashboard/
managing-director staff_directory) worker lists are genuinely
database-backed - no hardcoded/mock rows, no fabricated stats.

Unlike the rest of this suite, this test calls the real service functions
against the real Supabase database (same pattern as the multitenant
isolation suite's INTEGRATION_REAL_DB=1 mode) and cross-checks every
returned worker against an independent, direct DB query. It skips
gracefully if no org with a coordinator + MD + 2 support workers exists,
so it never fails a run against an empty/unseeded database.
"""
from __future__ import annotations

import os

import pytest

from backend.app.services.supabase_client import get_supabase_admin
from backend.app.api.coordinator import _team, worker_stats
from backend.app.api.dashboards import md_dashboard

# Opt-in only — matches test_multitenant_isolation.py's INTEGRATION_REAL_DB=1
# convention. Without this, CI (which has no reachable Supabase instance)
# fails with a raw connection error instead of skipping: the doc-block above
# already promised this gate, the code just never implemented it.
pytestmark = pytest.mark.skipif(
    os.environ.get("INTEGRATION_REAL_DB") != "1",
    reason="Live-DB test — set INTEGRATION_REAL_DB=1 with real Supabase credentials to run it.",
)


def _find_test_org() -> tuple[str, str, str] | None:
    supabase = get_supabase_admin()
    members = (
        supabase.table("organization_members")
        .select("organization_id, user_id, role, is_active")
        .execute()
    ).data or []
    by_org: dict[str, list[dict]] = {}
    for m in members:
        by_org.setdefault(m["organization_id"], []).append(m)

    for org_id, rows in by_org.items():
        roles = {r["role"] for r in rows}
        active_workers = [r for r in rows if r["role"] == "support_worker" and r.get("is_active")]
        if "support_coordinator" not in roles or len(active_workers) < 2:
            continue
        md_users = (
            supabase.table("users")
            .select("id")
            .eq("organization_id", org_id)
            .eq("role", "managing_director")
            .execute()
        ).data or []
        if not md_users:
            continue
        coordinator_id = next(r["user_id"] for r in rows if r["role"] == "support_coordinator")
        return org_id, coordinator_id, md_users[0]["id"]
    return None


@pytest.mark.asyncio
async def test_coordinator_and_md_worker_lists_are_real_db_data():
    found = _find_test_org()
    if not found:
        pytest.skip("No seeded org with coordinator + MD + 2 support workers to test against")
    org_id, coordinator_id, md_id = found

    supabase = get_supabase_admin()

    # ---- Ground truth: independent direct DB query ----
    truth_members = (
        supabase.table("organization_members")
        .select("user_id, role, is_active, joined_at, employee_id")
        .eq("organization_id", org_id)
        .execute()
    ).data or []
    truth_user_ids = [m["user_id"] for m in truth_members]
    truth_profiles = {
        p["id"]: p
        for p in (
            supabase.table("users")
            .select("id, email, full_name, role, is_active, last_login")
            .in_("id", truth_user_ids)
            .eq("organization_id", org_id)
            .execute()
        ).data or []
    }
    # Org-scoped membership rows only - a member whose users.organization_id points
    # elsewhere isn't really on this org's roster (matches the backend's own
    # cross-check in both _team_members and the retention-rate query).
    org_scoped_members = [m for m in truth_members if truth_profiles.get(m["user_id"])]
    truth_total_count = len(org_scoped_members)
    truth_active_count = sum(1 for m in org_scoped_members if m.get("is_active"))

    # ---- Coordinator: _team() backs both /api/coordinator/team and /team ----
    coordinator_user = {"id": coordinator_id, "organization_id": org_id, "role": "support_coordinator"}
    coord_team = await _team(org_id, coordinator_user=coordinator_user)
    assert coord_team, "coordinator._team() returned no members for a seeded org"
    for row in coord_team:
        truth = truth_profiles.get(row["id"])
        assert truth is not None, f"_team returned user {row['id']} not present in direct users query"
        assert row["full_name"] == (truth.get("full_name") or truth.get("email") or "Team member")
        assert row["email"] == truth.get("email")

    # ---- Coordinator: worker_stats() session aggregation isn't fabricated ----
    stats = await worker_stats(coordinator_user)
    assert stats
    sample = stats[0]
    real_sessions = (
        supabase.table("sessions").select("id", count="exact").eq("worker_id", sample["id"]).execute()
    )
    real_count = real_sessions.count if real_sessions.count is not None else len(real_sessions.data or [])
    # worker_id may also live under support_worker_id/owner_user_id - the endpoint
    # checks all three, so only a LOWER api count than this single-column query
    # is a genuine bug (undercounting); a higher one is expected and fine.
    assert sample["total_sessions"] >= real_count, (
        f"worker_stats undercounts sessions for {sample['id']}: "
        f"API={sample['total_sessions']}, DB worker_id-only count={real_count}"
    )

    # ---- MD: staff_directory + retention rate must match direct DB truth ----
    md_user = {"id": md_id, "organization_id": org_id, "role": "managing_director"}
    md_data = await md_dashboard(md_user)
    directory = md_data["staff_directory"]

    assert md_data["active_staff"] == truth_active_count
    expected_retention = round((truth_active_count / truth_total_count) * 100, 1) if truth_total_count else 100.0
    assert abs(md_data["staff_retention_rate"] - expected_retention) < 0.2

    for row in directory:
        truth = truth_profiles.get(row["id"])
        assert truth is not None, f"MD staff_directory has user {row['id']} not in direct DB query"
        assert row["full_name"] == (truth.get("full_name") or "Team Member")

    # MD must see the FULL org roster (not team-scoped) - this is the explicit
    # "MD should have all the details" requirement, asserted directly rather
    # than just trusting the docstring on md_dashboard/_team.
    md_directory_ids = {r["id"] for r in directory}
    expected_active_ids = {m["user_id"] for m in org_scoped_members if m.get("is_active")}
    missing = expected_active_ids - md_directory_ids
    assert not missing, f"MD staff_directory is missing active org member(s): {missing}"
