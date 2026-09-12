"""Merge-field foundation for the branded document-template pipeline
(vault_service.py's policy_documents/organization_document_templates).

A template today only ever gets org-letterhead fields (see
vault_service._render_policy_html). This module generalizes that into a
small, explicit, namespaced registry so a future record-bound document type
(a participant service agreement, an HR letter to a specific worker, ...)
can declare which data it needs via organization_document_templates.merge_scope
and have it resolved the same way — without adding another one-off dict
builder each time. 'participant'/'plan' now has a real caller —
participant_profile_export_service.py's PDF export — 'worker' is still
unconsumed scaffolding.

Every loader filters by organization_id in the query itself — never trust a
bare participant_id/worker_id without also checking it belongs to the
calling org (this project's recurring highest-priority check).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from .organization_branding_service import get_letterhead
from .supabase_client import get_supabase_admin


@dataclass(frozen=True)
class MergeFieldSource:
    key: str
    label: str
    # field key -> human-readable label, for a future "insert field" picker
    # once a scope beyond 'org' actually has a generation flow to plug into.
    fields: dict[str, str]
    loader: Callable[[str, str | None], dict[str, Any] | None]


def _load_org(organization_id: str, _record_id: str | None) -> dict[str, Any]:
    return get_letterhead(organization_id)


_PARTICIPANT_COLUMNS = (
    "full_name, preferred_name, ndis_number, date_of_birth, email, phone, address, "
    "primary_disability, case_manager_name, case_manager_phone, emergency_contact, "
    "likes_dislikes, sensory_preferences, cultural_preferences, preferred_activities, "
    "communication_guidance, behavioural_notes, current_conditions, "
    "gp_name, gp_phone, gp_practice"
)


def _load_participant(organization_id: str, patient_id: str | None) -> dict[str, Any] | None:
    if not patient_id:
        return None
    resp = (
        get_supabase_admin()
        .table("patients")
        .select(_PARTICIPANT_COLUMNS)
        .eq("id", patient_id)
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    return row or None


def _load_plan(organization_id: str, patient_id: str | None) -> dict[str, Any] | None:
    if not patient_id:
        return None
    resp = (
        get_supabase_admin()
        .table("ndis_plans")
        .select("plan_number, plan_start, plan_end, total_funding, status, plan_management_type")
        .eq("patient_id", patient_id)
        .eq("organization_id", organization_id)
        .order("plan_start", desc=True)
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    return row or None


def _load_worker(organization_id: str, worker_id: str | None) -> dict[str, Any] | None:
    if not worker_id:
        return None
    resp = (
        get_supabase_admin()
        .table("users")
        .select("full_name, email, role")
        .eq("id", worker_id)
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    return row or None


MERGE_FIELD_SOURCES: dict[str, MergeFieldSource] = {
    "org": MergeFieldSource(
        key="org",
        label="Organisation",
        fields={
            "provider_name": "Organisation name",
            "logo_url": "Logo",
            "abn": "ABN",
            "address": "Address",
            "phone": "Phone",
            "email": "Email",
            "ndis_provider_number": "NDIS provider number",
        },
        loader=_load_org,
    ),
    "participant": MergeFieldSource(
        key="participant",
        label="Participant",
        fields={
            "full_name": "Full name",
            "preferred_name": "Preferred name",
            "ndis_number": "NDIS number",
            "date_of_birth": "Date of birth",
            "email": "Email",
            "phone": "Phone",
            "address": "Address",
            "primary_disability": "Primary disability",
            "case_manager_name": "Case manager name",
            "case_manager_phone": "Case manager phone",
            "emergency_contact": "Emergency contact",
            "likes_dislikes": "Likes / dislikes",
            "sensory_preferences": "Sensory preferences",
            "cultural_preferences": "Cultural preferences",
            "preferred_activities": "Preferred activities",
            "communication_guidance": "Communication guidance",
            "behavioural_notes": "Behavioural notes",
            "current_conditions": "Current conditions",
            "gp_name": "GP name",
            "gp_phone": "GP phone",
            "gp_practice": "GP practice",
        },
        loader=_load_participant,
    ),
    "plan": MergeFieldSource(
        key="plan",
        label="NDIS Plan",
        fields={
            "plan_number": "Plan number",
            "plan_start": "Plan start date",
            "plan_end": "Plan end date",
            "total_funding": "Total funding",
            "status": "Status",
            "plan_management_type": "Plan management type",
        },
        loader=_load_plan,
    ),
    "worker": MergeFieldSource(
        key="worker",
        label="Worker",
        fields={
            "full_name": "Full name",
            "email": "Email",
            "role": "Role",
        },
        loader=_load_worker,
    ),
}


def resolve_merge_context(
    organization_id: str,
    *,
    participant_id: str | None = None,
    worker_id: str | None = None,
) -> dict[str, Any]:
    """Assembles the namespaced dict a template is rendered with. A
    namespace is only ever queried when the matching id is supplied — a
    render that passes neither id (every policy-document render today) adds
    zero extra DB calls beyond the org lookup it already made."""
    context: dict[str, Any] = {
        "org": MERGE_FIELD_SOURCES["org"].loader(organization_id, None),
        "participant": MERGE_FIELD_SOURCES["participant"].loader(organization_id, participant_id),
        "plan": MERGE_FIELD_SOURCES["plan"].loader(organization_id, participant_id),
        "worker": MERGE_FIELD_SOURCES["worker"].loader(organization_id, worker_id),
        "generated": {"generated_at": datetime.now(timezone.utc).strftime("%d %b %Y")},
    }
    return context
