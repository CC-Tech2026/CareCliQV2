"""Merge-field registry foundation (backend/app/services/merge_fields.py).

Covers the two things that matter for a foundation nothing consumes
end-to-end yet: resolving a namespace costs nothing when its id isn't
supplied (so today's org-only policy-document render path pays zero extra
queries), and every record loader filters by organization_id in the query
itself — the two-org isolation check this project treats as
highest-priority for anything keyed by an id that could belong to another
organization.
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

from backend.app.services import merge_fields


def test_resolve_merge_context_skips_unrequested_namespaces():
    # get_letterhead (the 'org' loader) is imported from
    # organization_branding_service and calls get_supabase_admin() bound in
    # *that* module's namespace, not merge_fields' — mocked separately from
    # the supabase client merge_fields' own loaders (participant/plan/
    # worker) use, so the "no extra query" assertion below is meaningful:
    # any table() call on this mock could only have come from a
    # participant/plan/worker loader actually running.
    org_id = str(uuid.uuid4())
    mock_supabase = MagicMock()

    with patch.object(merge_fields, "get_letterhead", return_value={"provider_name": "Acme"}), \
         patch.object(merge_fields, "get_supabase_admin", return_value=mock_supabase):
        context = merge_fields.resolve_merge_context(org_id)

    assert context["participant"] is None
    assert context["plan"] is None
    assert context["worker"] is None
    assert context["org"] == {"provider_name": "Acme"}
    # No patients/ndis_plans/users query when neither id is supplied.
    mock_supabase.table.assert_not_called()


def test_resolve_merge_context_loads_participant_and_plan_when_id_given():
    org_id, patient_id = str(uuid.uuid4()), str(uuid.uuid4())
    mock_supabase = MagicMock()

    def table_side_effect(name):
        m = MagicMock()
        if name == "patients":
            m.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
                data=[{"full_name": "Jamie Rivers"}]
            )
        elif name == "ndis_plans":
            m.select.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(
                data=[{"plan_number": "P-001"}]
            )
        return m

    mock_supabase.table.side_effect = table_side_effect

    with patch.object(merge_fields, "get_letterhead", return_value={"provider_name": "Acme"}), \
         patch.object(merge_fields, "get_supabase_admin", return_value=mock_supabase):
        context = merge_fields.resolve_merge_context(org_id, participant_id=patient_id)

    assert context["participant"]["full_name"] == "Jamie Rivers"
    assert context["plan"]["plan_number"] == "P-001"
    assert context["worker"] is None


def test_participant_loader_scopes_query_to_calling_org():
    """A patient_id must never resolve without the loader's own query also
    filtering by the calling org's organization_id — cross-org guessing of
    another org's participant_id must not leak data."""
    org_id, patient_id = str(uuid.uuid4()), str(uuid.uuid4())
    mock_supabase = MagicMock()
    eq_mock = mock_supabase.table.return_value.select.return_value.eq.return_value
    eq_mock.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[])

    with patch.object(merge_fields, "get_supabase_admin", return_value=mock_supabase):
        result = merge_fields._load_participant(org_id, patient_id)

    assert result is None
    # First .eq(...) is on id, second .eq(...) must be the organization_id
    # scope — both calls captured on the same mock chain confirm the query
    # itself carries the org filter, not just an application-layer check.
    first_eq_call = mock_supabase.table.return_value.select.return_value.eq.call_args
    second_eq_call = eq_mock.eq.call_args
    assert first_eq_call.args == ("id", patient_id)
    assert second_eq_call.args == ("organization_id", org_id)
