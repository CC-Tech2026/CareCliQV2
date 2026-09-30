"""Audit Readiness (stage 1) — managing directors only.

Reports evidence readiness. Nothing here labels a provider "NDIS compliant"
or predicts an audit outcome.
"""

from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..core.access import get_user_id, get_user_organization_id, has_active_grant, is_managing_director
from ..core.security import get_current_user
from ..services import audit_readiness_service as ar
from ..services import vault_service
from ..services.audit_service import log_action
from ..services.supabase_client import get_supabase_admin

router = APIRouter(prefix="/audit-readiness", tags=["audit-readiness"])

SubjectType = Literal["organisation", "worker", "participant"]


def _require_md(user: dict) -> str:
    # Same access as the vault the evidence lives in.
    if not is_managing_director(user) and not has_active_grant(user, "governance_vault", get_supabase_admin()):
        raise HTTPException(status_code=403, detail="Managing director access required.")
    org_id = get_user_organization_id(user)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organisation membership required.")
    return org_id


def _requirement(code: str) -> ar.Requirement:
    req = ar.REQUIREMENTS_BY_CODE.get(code)
    if not req:
        raise HTTPException(status_code=404, detail="Unknown requirement.")
    return req


def _check_subject(org_id: str, req: ar.Requirement, subject_type: str, subject_id: Optional[str]) -> None:
    if subject_type != req.scope:
        raise HTTPException(status_code=422, detail=f"This requirement applies to each {req.scope}, not a {subject_type}.")
    if not ar.subject_exists(org_id, subject_type, subject_id):
        raise HTTPException(status_code=404, detail="That person isn't in your organisation.")


def _profile_payload(profile: ar.AuditProfile) -> dict:
    return {
        "audit_type": profile.audit_type,
        "registration_groups": list(profile.registration_groups),
        "service_flags": list(profile.service_flags),
        "effective_flags": ar.effective_flags(profile),
        "configured": profile.is_configured,
    }


@router.get("/profile")
async def get_profile(current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return {
        "profile": _profile_payload(ar.load_profile(org_id)),
        "options": {
            "audit_types": [{"value": k, "label": v} for k, v in ar.AUDIT_TYPES.items()],
            "registration_groups": [{"code": k, "label": v} for k, v in ar.REGISTRATION_GROUPS.items()],
            "service_flags": [
                {"key": k, "label": v["label"], "implied_by": list(v["implied_by"])}
                for k, v in ar.SERVICE_FLAGS.items()
            ],
        },
    }


class ProfileBody(BaseModel):
    audit_type: Optional[Literal["verification", "certification"]] = None
    registration_groups: list[str] = Field(default_factory=list, max_length=len(ar.REGISTRATION_GROUPS))
    service_flags: list[str] = Field(default_factory=list, max_length=len(ar.SERVICE_FLAGS))


@router.put("/profile")
async def put_profile(body: ProfileBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    user_id = get_user_id(current_user)
    unknown = [g for g in body.registration_groups if g not in ar.REGISTRATION_GROUPS]
    unknown += [f for f in body.service_flags if f not in ar.SERVICE_FLAGS]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown option: {', '.join(unknown)}")
    profile = ar.save_profile(org_id, user_id, body.audit_type, body.registration_groups, body.service_flags)
    await log_action(
        action_type="audit_readiness.profile_updated", entity_type="organization", entity_id=org_id,
        user_id=user_id, organization_id=org_id, after_state=_profile_payload(profile),
    )
    return {"profile": _profile_payload(profile)}


@router.get("/requirements")
async def get_requirements(current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    profile = ar.load_profile(org_id)
    return {"requirements": ar.describe_catalogue(profile, ar.load_settings(org_id))}


class SettingBody(BaseModel):
    is_enabled: bool = True
    review_interval_days: Optional[int] = Field(default=None, ge=1, le=3650)


@router.put("/requirements/{code}/settings")
async def put_requirement_setting(code: str, body: SettingBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    _requirement(code)
    user_id = get_user_id(current_user)
    ar.save_setting(org_id, user_id, code, body.is_enabled, body.review_interval_days)
    await log_action(
        action_type="audit_readiness.requirement_setting_updated", entity_type="audit_requirement", entity_id=code,
        user_id=user_id, organization_id=org_id, after_state=body.model_dump(),
    )
    return {"saved": True}


@router.get("/checklist")
async def get_checklist(current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return ar.get_checklist(org_id)


class LinkBody(BaseModel):
    requirement_code: str
    subject_type: SubjectType
    subject_id: Optional[str] = None
    vault_category: str = Field(min_length=1, max_length=200)
    document_id: str = Field(min_length=1, max_length=200)


@router.post("/evidence-links", status_code=201)
async def post_evidence_link(body: LinkBody, current_user: dict = Depends(get_current_user)):
    """Link a document that's already in the vault. It stays "Awaiting
    review" until someone authorised approves it."""
    org_id = _require_md(current_user)
    req = _requirement(body.requirement_code)
    _check_subject(org_id, req, body.subject_type, body.subject_id)
    doc = vault_service.find_document(org_id, body.vault_category, body.document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="That document isn't in your vault.")
    user_id = get_user_id(current_user)
    link = ar.create_link(
        org_id, user_id, req.code, body.subject_type, body.subject_id,
        doc["source_table"], str(doc["source_id"]), doc["title"], body.vault_category,
    )
    await log_action(
        action_type="audit_readiness.evidence_linked", entity_type="audit_evidence_link", entity_id=str(link.get("id")),
        user_id=user_id, organization_id=org_id,
        details={"requirement_code": req.code, "source_table": doc["source_table"], "source_id": str(doc["source_id"])},
    )
    return {"link": link}


class ReviewBody(BaseModel):
    requirement_code: str
    subject_type: SubjectType
    subject_id: Optional[str] = None
    source_table: str = Field(min_length=1, max_length=100)
    source_id: str = Field(min_length=1, max_length=200)
    decision: Literal["approved", "rejected"]
    note: Optional[str] = Field(default=None, max_length=2000)
    expiry_date: Optional[date] = None


@router.post("/evidence-reviews")
async def post_evidence_review(body: ReviewBody, current_user: dict = Depends(get_current_user)):
    """Approve or reject evidence for an item: a linked vault document, or a
    governance document the checklist found automatically."""
    org_id = _require_md(current_user)
    req = _requirement(body.requirement_code)
    _check_subject(org_id, req, body.subject_type, body.subject_id)
    if body.decision == "rejected" and not (body.note or "").strip():
        raise HTTPException(status_code=422, detail="Say why the evidence was rejected.")
    user_id = get_user_id(current_user)

    link = ar.find_live_link(org_id, req.code, body.subject_type, body.subject_id, body.source_table, body.source_id)
    if not link:
        # Auto-found evidence that needs a person's check can be reviewed
        # without linking it first: governance documents, and onboarding
        # documents uploaded without a signing record.
        doc, category = None, None
        if body.source_table == "governance_documents":
            doc = ar.governance_doc_in_folders(org_id, body.source_id, req.governance_folders)
            category = (doc or {}).get("folder_key")
        elif body.source_table == "worker_onboarding_documents":
            doc = ar.onboarding_doc_for_worker(org_id, body.source_id, body.subject_id, req.onboarding_doc_types)
            category = "consent_onboarding"
        if not doc:
            raise HTTPException(status_code=404, detail="That evidence isn't linked to this item.")
        link = ar.create_link(
            org_id, user_id, req.code, body.subject_type, body.subject_id,
            body.source_table, body.source_id, doc.get("title"), category,
        )

    before = {k: link.get(k) for k in ("review_status", "review_note", "expiry_date")}
    updated = ar.review_link(org_id, user_id, str(link["id"]), body.decision, (body.note or "").strip() or None, body.expiry_date)
    await log_action(
        action_type=f"audit_readiness.evidence_{body.decision}", entity_type="audit_evidence_link", entity_id=str(link["id"]),
        user_id=user_id, organization_id=org_id, before_state=before,
        after_state={k: updated.get(k) for k in ("review_status", "review_note", "expiry_date")},
        details={"requirement_code": req.code},
    )
    return {"link": updated}


@router.delete("/evidence-links/{link_id}")
async def delete_evidence_link(link_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    link = ar.get_link(org_id, link_id)
    if not link:
        raise HTTPException(status_code=404, detail="Evidence link not found.")
    user_id = get_user_id(current_user)
    ar.remove_link(org_id, user_id, link_id)
    await log_action(
        action_type="audit_readiness.evidence_unlinked", entity_type="audit_evidence_link", entity_id=link_id,
        user_id=user_id, organization_id=org_id,
        before_state={k: link.get(k) for k in ("requirement_code", "source_table", "source_id", "review_status")},
    )
    return {"removed": True}


class NaBody(BaseModel):
    requirement_code: str
    subject_type: SubjectType
    subject_id: Optional[str] = None
    reason: str = Field(min_length=10, max_length=2000)


@router.post("/na-decisions", status_code=201)
async def post_na_decision(body: NaBody, current_user: dict = Depends(get_current_user)):
    """Mark an item not applicable. The reason is required and the decision
    is recorded against the managing director who approved it."""
    org_id = _require_md(current_user)
    req = _requirement(body.requirement_code)
    _check_subject(org_id, req, body.subject_type, body.subject_id)
    if len(body.reason.strip()) < 10:
        raise HTTPException(status_code=422, detail="Give a reason of at least 10 characters.")
    user_id = get_user_id(current_user)
    try:
        decision = ar.record_na(org_id, user_id, req.code, body.subject_type, body.subject_id, body.reason)
    except Exception as exc:
        if "uq_audit_na_decisions_live" in str(exc) or "duplicate key" in str(exc):
            raise HTTPException(status_code=409, detail="This item is already marked not applicable.")
        raise
    await log_action(
        action_type="audit_readiness.marked_not_applicable", entity_type="audit_na_decision", entity_id=str(decision.get("id")),
        user_id=user_id, organization_id=org_id,
        after_state={"requirement_code": req.code, "subject_type": body.subject_type,
                     "subject_id": body.subject_id, "reason": body.reason.strip()},
    )
    return {"decision": decision}


class RevokeBody(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=2000)


@router.post("/na-decisions/{decision_id}/revoke")
async def revoke_na_decision(decision_id: str, body: RevokeBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    decision = ar.get_na(org_id, decision_id)
    if not decision:
        raise HTTPException(status_code=404, detail="Decision not found.")
    user_id = get_user_id(current_user)
    ar.revoke_na(org_id, user_id, decision_id, (body.reason or "").strip() or None)
    await log_action(
        action_type="audit_readiness.not_applicable_revoked", entity_type="audit_na_decision", entity_id=decision_id,
        user_id=user_id, organization_id=org_id,
        before_state={"reason": decision.get("reason")}, details={"revoke_reason": body.reason},
    )
    return {"revoked": True}
