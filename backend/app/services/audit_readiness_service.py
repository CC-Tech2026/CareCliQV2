"""Audit Readiness (stage 1): requirement catalogue, applicability and status.

This reports *evidence readiness* — whether the records an auditor is likely
to ask for exist, are current and have been checked by someone authorised.
It never says a provider is "NDIS compliant" and can't predict an audit
outcome: the auditor decides scope from the provider's registration, and
the requirements here are a working checklist, not the Practice Standards.

How it fits together:

- REQUIREMENTS is the default catalogue. Each requirement applies to the
  organisation, to every active support worker, or to every active
  participant, and says which existing CareCliQ records can evidence it.
- An organisation's audit profile (audit type, registration groups, the
  services it delivers) decides which requirements apply. Organisations can
  switch a requirement off or set their own review interval.
- Evidence is never uploaded here. It's either found automatically in
  existing records (credentials, training, induction, NDIS plans, service
  agreements, consent, governance documents) or linked by hand to any
  document already in the vault. One record can evidence several items.
- Records that already go through their own approval (credentials, training
  completions) take their status from it. Everything else — governance
  documents, hand-linked vault documents — stays "Awaiting review" until an
  authorised person approves the link.
- "Not applicable" needs a recorded reason and is stamped with who approved
  it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Literal, Optional

from ..core.timezone import app_today
from .credential_status import EXPIRING_WITHIN_DAYS, live_status
from .credential_verification_service import canonical_credential_type
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

Scope = Literal["organisation", "worker", "participant"]
ItemStatus = Literal["missing", "awaiting_review", "current", "due_soon", "overdue", "not_applicable"]

DUE_SOON_DAYS = EXPIRING_WITHIN_DAYS

AUDIT_TYPES = {
    "verification": "Verification audit",
    "certification": "Certification audit",
}

# NDIS registration groups (code -> name).
REGISTRATION_GROUPS: dict[str, str] = {
    "0101": "Accommodation / tenancy assistance",
    "0102": "Assistance to access and maintain employment or higher education",
    "0103": "Assistive products for personal care and safety",
    "0104": "High intensity daily personal activities",
    "0105": "Personal mobility equipment",
    "0106": "Assistance in coordinating or managing life stages, transitions and supports",
    "0107": "Daily personal activities",
    "0108": "Assistance with travel / transport arrangements",
    "0109": "Vehicle modifications",
    "0110": "Specialist positive behaviour support",
    "0111": "Home modification design and construction",
    "0112": "Assistive equipment for recreation",
    "0113": "Vision equipment",
    "0114": "Community nursing care",
    "0115": "Assistance with daily life tasks in a group or shared living arrangement",
    "0116": "Innovative community participation",
    "0117": "Development of daily living and life skills",
    "0118": "Early intervention supports for early childhood",
    "0119": "Specialised hearing services",
    "0120": "Household tasks",
    "0121": "Interpreting and translation",
    "0122": "Hearing equipment",
    "0123": "Assistive products for household tasks",
    "0124": "Communication and information equipment",
    "0125": "Participation in community, social and civic activities",
    "0126": "Exercise physiology and personal well-being activities",
    "0127": "Management of funding for supports in participant's plan",
    "0128": "Therapeutic supports",
    "0129": "Specialised driver training",
    "0130": "Assistance animals",
    "0131": "Specialist disability accommodation",
    "0132": "Specialist support coordination",
    "0133": "Specialised supported employment",
    "0134": "Hearing services",
    "0135": "Customised prosthetics",
    "0136": "Group and centre based activities",
}

# Services that switch conditional requirements on. A flag is on when the
# organisation ticks it or holds a registration group that implies it.
SERVICE_FLAGS: dict[str, dict[str, Any]] = {
    "children": {
        "label": "Supports for children or young people",
        "implied_by": ("0118",),
    },
    "transport": {
        "label": "Transport of participants",
        "implied_by": ("0108",),
    },
    "behaviour_support": {
        "label": "Behaviour support or regulated restrictive practices",
        "implied_by": ("0110",),
    },
    "mealtime": {
        "label": "Mealtime support for participants with swallowing risks",
        "implied_by": (),
    },
    "medication": {
        "label": "Medication administration or prompting",
        "implied_by": (),
    },
}

AREAS: dict[str, str] = {
    "staff": "Staff and key personnel",
    "participant": "Participant files",
    "governance": "Governance and policies",
    "quality": "Quality and improvement",
    "insurance": "Insurance and transport",
}


@dataclass(frozen=True)
class Requirement:
    code: str
    area: str
    scope: Scope
    title: str
    description: str
    source: str
    evidence_hint: str
    critical: bool = False
    # Evidence found automatically in existing records. Every requirement
    # also accepts hand-linked vault documents.
    credential_types: tuple[str, ...] = ()
    training_keywords: tuple[str, ...] = ()
    induction: bool = False
    onboarding_doc_types: tuple[str, ...] = ()  # worker_onboarding_documents.document_type
    governance_folders: tuple[str, ...] = ()
    participant_sources: tuple[str, ...] = ()  # "agreement" | "ndis_plan" | "consent"
    # Applicability. None = every audit type.
    audit_types: Optional[tuple[str, ...]] = None
    requires_flags: tuple[str, ...] = ()  # any one of these
    # Months/days before the evidence should be re-checked, from its issue or
    # approval date. None = only its own expiry date matters. Organisations
    # can set their own.
    default_review_days: Optional[int] = None
    # Identity documents and similar — never bundled into an export without
    # someone explicitly choosing to include them (stage 3).
    sensitive: bool = False


_CORE = ("certification",)

REQUIREMENTS: tuple[Requirement, ...] = (
    # ── Staff and key personnel (one item per active support worker) ─────
    Requirement(
        code="STAFF-SCREENING", area="staff", scope="worker", critical=True,
        title="NDIS Worker Screening clearance",
        description="A current NDIS Worker Screening clearance for workers in risk-assessed roles.",
        source="NDIS (Practice Standards — Worker Screening) Rules 2018",
        evidence_hint="The worker's NDIS screening credential, approved by a coordinator.",
        credential_types=("ndis_screening",),
    ),
    Requirement(
        code="STAFF-POLICE", area="staff", scope="worker",
        title="Police check",
        description=(
            "A police check where your policy or role requires one. A police check is a point-in-time "
            "record: set your own recheck interval rather than treating it as expiring."
        ),
        source="Your recruitment and screening policy; state and role requirements",
        evidence_hint="The worker's police check credential.",
        credential_types=("police_check",),
    ),
    Requirement(
        code="STAFF-WWCC", area="staff", scope="worker", critical=True,
        title="Working with Children Check",
        description="A current Working with Children Check in the state where the worker supports children.",
        source="State and territory working with children legislation",
        evidence_hint="The worker's WWCC credential.",
        credential_types=("wwcc",), requires_flags=("children",),
    ),
    Requirement(
        code="STAFF-IDENTITY", area="staff", scope="worker", sensitive=True,
        title="Identity and right to work",
        description=(
            "Evidence the worker's identity and right to work were checked, using the identification "
            "combinations your policy accepts."
        ),
        source="NDIS Practice Standards — Human resource management",
        evidence_hint="An identity document from the worker's onboarding or applicant file.",
    ),
    Requirement(
        code="STAFF-CONTRACT", area="staff", scope="worker",
        title="Contract and position description",
        description="A signed employment contract or offer letter and the position description for the role.",
        source="NDIS Practice Standards — Human resource management",
        evidence_hint="The signed offer letter or contract in the worker's onboarding documents.",
        onboarding_doc_types=("offer_letter", "service_agreement"),
    ),
    Requirement(
        code="STAFF-INDUCTION", area="staff", scope="worker",
        title="Orientation and induction",
        description="Completion of your mandatory induction, including the NDIS Code of Conduct.",
        source="NDIS Practice Standards — Human resource management",
        evidence_hint="Completed mandatory induction items in CareCliQ.",
        induction=True,
    ),
    Requirement(
        code="STAFF-FIRSTAID", area="staff", scope="worker",
        title="First aid",
        description="Current first aid certification where the role requires it.",
        source="Your training requirements for the role",
        evidence_hint="The worker's first aid credential.",
        credential_types=("first_aid",),
    ),
    Requirement(
        code="STAFF-CPR", area="staff", scope="worker",
        title="CPR",
        description="Current CPR certification where the role requires it.",
        source="Your training requirements for the role",
        evidence_hint="The worker's CPR credential.",
        credential_types=("cpr",),
    ),
    Requirement(
        code="STAFF-INFECTION", area="staff", scope="worker",
        title="Infection prevention and control training",
        description="Completed infection prevention and control training.",
        source="NDIS Practice Standards — Human resource management",
        evidence_hint="A confirmed completion of a training module about infection control.",
        training_keywords=("infection",),
    ),
    Requirement(
        code="STAFF-DRIVER", area="staff", scope="worker",
        title="Driver licence",
        description="A current driver licence for workers who transport participants.",
        source="Your transport policy",
        evidence_hint="The worker's driver licence credential.",
        credential_types=("drivers_licence",), requires_flags=("transport",),
    ),
    Requirement(
        code="STAFF-PERFORMANCE", area="staff", scope="worker", audit_types=_CORE,
        title="Performance review",
        description="A documented performance review within your review cycle.",
        source="NDIS Practice Standards — Human resource management",
        evidence_hint="The latest performance review, linked from the vault.",
        default_review_days=365,
    ),
    # ── Participant files (one item per active participant) ──────────────
    Requirement(
        code="PART-AGREEMENT", area="participant", scope="participant", critical=True,
        title="Service agreement",
        description="A signed, in-date service agreement covering the supports delivered.",
        source="NDIS Practice Standards — Service agreements with participants",
        evidence_hint="A signed service agreement on the participant's plan.",
        participant_sources=("agreement",),
    ),
    Requirement(
        code="PART-PLAN", area="participant", scope="participant",
        title="Current NDIS plan",
        description="The participant's current NDIS plan on file.",
        source="NDIS Practice Standards — Support planning",
        evidence_hint="An in-date NDIS plan in CareCliQ.",
        participant_sources=("ndis_plan",),
    ),
    Requirement(
        code="PART-CONSENT", area="participant", scope="participant",
        title="Consent",
        description="Recorded consent, including for sharing information.",
        source="NDIS Practice Standards — Privacy and dignity; Information management",
        evidence_hint="Consent confirmed at a plan meeting, or a signed consent form in the vault.",
        participant_sources=("consent",),
    ),
    Requirement(
        code="PART-RISK", area="participant", scope="participant", audit_types=_CORE,
        title="Risk assessment",
        description="A current risk assessment for the participant's supports.",
        source="NDIS Practice Standards — Support planning",
        evidence_hint="The participant's risk assessment, linked from the vault.",
        default_review_days=365,
    ),
    Requirement(
        code="PART-SUPPORT-PLAN", area="participant", scope="participant", audit_types=_CORE,
        title="Support plan",
        description="A support plan reviewed with the participant within your review cycle.",
        source="NDIS Practice Standards — Support planning",
        evidence_hint="The participant's support plan, linked from the vault.",
        default_review_days=365,
    ),
    Requirement(
        code="PART-EMERGENCY", area="participant", scope="participant", audit_types=_CORE,
        title="Individual emergency plan",
        description="A plan for how the participant's supports continue in an emergency.",
        source="NDIS Practice Standards — Emergency and disaster management",
        evidence_hint="The participant's emergency plan, linked from the vault.",
    ),
    Requirement(
        code="PART-BSP", area="participant", scope="participant", requires_flags=("behaviour_support",),
        title="Behaviour support plan",
        description="Where the participant has one, their current behaviour support plan.",
        source="NDIS (Restrictive Practices and Behaviour Support) Rules 2018",
        evidence_hint="The behaviour support plan, linked from the vault. Mark not applicable if the participant has none.",
    ),
    Requirement(
        code="PART-MEALTIME", area="participant", scope="participant", requires_flags=("mealtime",),
        title="Mealtime management plan",
        description="Where the participant needs mealtime support, their current mealtime management plan.",
        source="NDIS Practice Standards — Mealtime management",
        evidence_hint="The mealtime management plan, linked from the vault.",
    ),
    Requirement(
        code="PART-MEDICATION", area="participant", scope="participant", requires_flags=("medication",),
        title="Medication management plan",
        description="Where you support the participant with medication, a current medication management plan.",
        source="NDIS Practice Standards — Medication management",
        evidence_hint="A medication management plan from the medication records, linked from the vault.",
    ),
    # ── Governance and policies (organisation) ───────────────────────────
    Requirement(
        code="GOV-POLICIES", area="governance", scope="organisation", audit_types=_CORE,
        title="Governance and operational policies",
        description="Controlled governance and operational management policies and procedures.",
        source="NDIS Practice Standards — Governance and operational management",
        evidence_hint="A document in the vault's Governance & Operational Management folder.",
        governance_folders=("governance_operational",), default_review_days=365,
    ),
    Requirement(
        code="GOV-RISK", area="governance", scope="organisation", critical=True,
        title="Risk management",
        description="A documented risk management system.",
        source="NDIS Practice Standards — Risk management",
        evidence_hint="A document in the vault's Risk Management folder.",
        governance_folders=("risk_management",), default_review_days=365,
    ),
    Requirement(
        code="GOV-QUALITY", area="governance", scope="organisation", audit_types=_CORE,
        title="Quality management",
        description="A documented quality management system.",
        source="NDIS Practice Standards — Quality management",
        evidence_hint="A document in the vault's Quality Management folder.",
        governance_folders=("quality_management",), default_review_days=365,
    ),
    Requirement(
        code="GOV-INFORMATION", area="governance", scope="organisation", audit_types=_CORE,
        title="Information management and privacy",
        description="Policies for managing participant information, privacy and records.",
        source="NDIS Practice Standards — Information management",
        evidence_hint="A document in the vault's Information Management folder.",
        governance_folders=("information_management",), default_review_days=365,
    ),
    Requirement(
        code="GOV-COMPLAINTS", area="governance", scope="organisation", critical=True,
        title="Complaints management system",
        description="A documented complaints management and resolution system.",
        source="NDIS (Complaints Management and Resolution) Rules 2018",
        evidence_hint="A document in the vault's Feedback & Complaints Management folder.",
        governance_folders=("feedback_complaints",), default_review_days=365,
    ),
    Requirement(
        code="GOV-INCIDENTS", area="governance", scope="organisation", critical=True,
        title="Incident management system",
        description="A documented incident management system, including reportable incidents.",
        source="NDIS (Incident Management and Reportable Incidents) Rules 2018",
        evidence_hint="A document in the vault's Incident Management System folder.",
        governance_folders=("incident_management_system",), default_review_days=365,
    ),
    Requirement(
        code="GOV-HR", area="governance", scope="organisation", critical=True,
        title="Human resource management",
        description="Documented recruitment, screening, induction and supervision processes.",
        source="NDIS Practice Standards — Human resource management",
        evidence_hint="A document in the vault's Human Resource Management folder.",
        governance_folders=("human_resource_management",), default_review_days=365,
    ),
    Requirement(
        code="GOV-CONTINUITY", area="governance", scope="organisation", audit_types=_CORE,
        title="Continuity of supports",
        description="Arrangements to keep supports going when planned or unplanned changes happen.",
        source="NDIS Practice Standards — Continuity of supports",
        evidence_hint="A document in the vault's Continuity of Supports folder.",
        governance_folders=("continuity_of_supports",), default_review_days=365,
    ),
    Requirement(
        code="GOV-EMERGENCY", area="governance", scope="organisation", audit_types=_CORE,
        title="Emergency and disaster management",
        description="Emergency and disaster management planning.",
        source="NDIS Practice Standards — Emergency and disaster management",
        evidence_hint="A document in the vault's Emergency & Disaster Management folder.",
        governance_folders=("emergency_disaster_management",), default_review_days=365,
    ),
    Requirement(
        code="GOV-ORG-CHART", area="governance", scope="organisation", audit_types=_CORE,
        title="Organisation chart and delegations",
        description="An organisation chart and the delegations of key personnel.",
        source="NDIS Practice Standards — Governance and operational management",
        evidence_hint="Your organisation chart, linked from the vault.",
        default_review_days=365,
    ),
    Requirement(
        code="GOV-CONFLICTS", area="governance", scope="organisation", audit_types=_CORE,
        title="Conflict of interest register",
        description="Declared conflicts of interest and how they're managed.",
        source="NDIS Practice Standards — Governance and operational management",
        evidence_hint="Your conflict of interest register, linked from the vault.",
        default_review_days=365,
    ),
    # ── Quality and improvement (organisation) ───────────────────────────
    Requirement(
        code="QUAL-INTERNAL-AUDIT", area="quality", scope="organisation", audit_types=_CORE,
        title="Internal audit",
        description="Your latest internal audit report and forward audit schedule.",
        source="NDIS Practice Standards — Quality management",
        evidence_hint="The internal audit report, linked from the vault.",
        default_review_days=365,
    ),
    Requirement(
        code="QUAL-IMPROVEMENT", area="quality", scope="organisation", audit_types=_CORE,
        title="Continuous improvement register",
        description="Improvement actions drawn from feedback, complaints, incidents and audits.",
        source="NDIS Practice Standards — Quality management",
        evidence_hint="Your continuous improvement register, linked from the vault.",
        default_review_days=180,
    ),
    # ── Insurance and transport (organisation) ───────────────────────────
    Requirement(
        code="INS-PUBLIC-LIABILITY", area="insurance", scope="organisation", critical=True,
        title="Public liability insurance",
        description="A current public liability insurance certificate of currency.",
        source="NDIS Practice Standards — Risk management",
        evidence_hint="The certificate of currency, linked from the vault with its expiry date.",
    ),
    Requirement(
        code="INS-PROFESSIONAL-INDEMNITY", area="insurance", scope="organisation",
        title="Professional indemnity insurance",
        description="Professional indemnity cover where your services need it.",
        source="NDIS Practice Standards — Risk management",
        evidence_hint="The certificate of currency, linked from the vault with its expiry date.",
    ),
    Requirement(
        code="INS-WORKERS-COMP", area="insurance", scope="organisation",
        title="Workers compensation",
        description="Workers compensation cover for employees, as your state requires.",
        source="State and territory workers compensation legislation",
        evidence_hint="The policy or certificate of currency, linked from the vault with its expiry date.",
    ),
    Requirement(
        code="INS-VEHICLE", area="insurance", scope="organisation", requires_flags=("transport",),
        title="Vehicle registration and insurance",
        description="Registration and insurance for vehicles used to transport participants.",
        source="Your transport policy",
        evidence_hint="Registration and insurance papers, linked from the vault with their expiry dates.",
    ),
)

REQUIREMENTS_BY_CODE: dict[str, Requirement] = {r.code: r for r in REQUIREMENTS}

# Better evidence wins when several records could satisfy an item.
_STATUS_RANK = {"current": 4, "due_soon": 3, "awaiting_review": 2, "overdue": 1, "missing": 0}

INACTIVE_PARTICIPANT_STATUSES = frozenset({"inactive", "exited", "archived", "closed", "ended", "deceased"})


# ── Profile and applicability ────────────────────────────────────────────


@dataclass(frozen=True)
class AuditProfile:
    audit_type: Optional[str] = None
    registration_groups: tuple[str, ...] = ()
    service_flags: tuple[str, ...] = ()

    @property
    def is_configured(self) -> bool:
        return bool(self.audit_type) and bool(self.registration_groups)


def effective_flags(profile: AuditProfile) -> dict[str, str]:
    """flag -> why it's on ("selected" or "registration group 0108")."""
    out: dict[str, str] = {}
    groups = set(profile.registration_groups)
    for key, meta in SERVICE_FLAGS.items():
        if key in profile.service_flags:
            out[key] = "you deliver this service"
            continue
        implied = [g for g in meta["implied_by"] if g in groups]
        if implied:
            out[key] = f"you're registered for group {implied[0]}"
    return out


def applicability(req: Requirement, profile: AuditProfile) -> tuple[bool, str]:
    """Whether a requirement applies, and a plain-English reason why."""
    if req.audit_types and profile.audit_type and profile.audit_type not in req.audit_types:
        return False, f"Not part of a {AUDIT_TYPES[profile.audit_type].lower()}."
    if req.requires_flags:
        flags = effective_flags(profile)
        hit = next((f for f in req.requires_flags if f in flags), None)
        if not hit:
            labels = " or ".join(SERVICE_FLAGS[f]["label"].lower() for f in req.requires_flags)
            return False, f"Only applies if you provide {labels}."
        return True, f"Applies because {flags[hit]} ({SERVICE_FLAGS[hit]['label'].lower()})."
    if req.audit_types and not profile.audit_type:
        return True, "Included until you set your audit type."
    if req.audit_types:
        return True, f"Part of a {AUDIT_TYPES[profile.audit_type].lower()}."
    return True, "Applies to every registered provider."


# ── Evidence and status ──────────────────────────────────────────────────


@dataclass
class Evidence:
    source_table: str
    source_id: str
    title: str
    kind: Literal["auto", "linked"]
    status: str  # an ItemStatus other than not_applicable, or "rejected"
    detail: str = ""
    date: Optional[str] = None
    due_date: Optional[str] = None
    vault_category: Optional[str] = None
    # Needs an authorised person's approval before it counts as current.
    reviewable: bool = False
    link_id: Optional[str] = None
    review_status: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[str] = None
    review_note: Optional[str] = None

    def as_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


def _to_date(value: Any) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def date_status(due: Optional[date], today: date) -> str:
    if due is None:
        return "current"
    if due < today:
        return "overdue"
    if (due - today).days <= DUE_SOON_DAYS:
        return "due_soon"
    return "current"


def _worse(a: str, b: str) -> str:
    return a if _STATUS_RANK.get(a, 0) < _STATUS_RANK.get(b, 0) else b


def _earliest(*dates: Optional[date]) -> Optional[date]:
    present = [d for d in dates if d]
    return min(present) if present else None


def reviewed_status(
    link: Optional[dict],
    review_days: Optional[int],
    today: date,
) -> tuple[str, Optional[date], str]:
    """Status of evidence that only counts once someone approves it."""
    if not link or link.get("review_status") == "awaiting_review":
        return "awaiting_review", None, "Needs review by an authorised person."
    if link.get("review_status") == "rejected":
        return "rejected", None, link.get("review_note") or "Rejected at review."
    reviewed_on = _to_date(link.get("reviewed_at"))
    review_due = reviewed_on + timedelta(days=review_days) if reviewed_on and review_days else None
    expiry = _to_date(link.get("expiry_date"))
    due = _earliest(review_due, expiry)
    status = date_status(due, today)
    if status == "overdue":
        detail = "Expired." if due == expiry else "Review is overdue."
    elif status == "due_soon":
        detail = "Expires soon." if due == expiry else "Review due soon."
    else:
        detail = "Approved."
    return status, due, detail


def credential_evidence(cred: dict, review_days: Optional[int], today: date) -> Evidence:
    live = live_status(cred.get("expiry_date"), cred.get("status"), today=today)
    expiry = _to_date(cred.get("expiry_date"))
    issued = _to_date(cred.get("issue_date"))
    recheck = issued + timedelta(days=review_days) if issued and review_days else None
    status = {
        "valid": "current", "expiring": "due_soon", "expired": "overdue",
        "pending_review": "awaiting_review", "rejected": "rejected",
    }.get(live, "awaiting_review")
    detail = {
        "current": "Approved.", "due_soon": "Expires soon.", "overdue": "Expired.",
        "awaiting_review": "Waiting for a coordinator to approve it.",
        "rejected": "Rejected at review.",
    }[status]
    due = expiry
    if recheck and status in ("current", "due_soon"):
        recheck_state = date_status(recheck, today)
        if _STATUS_RANK[recheck_state] < _STATUS_RANK[status]:
            status = recheck_state
            detail = "Recheck is overdue." if recheck_state == "overdue" else "Recheck due soon."
        due = _earliest(expiry, recheck)
    return Evidence(
        source_table="credentials", source_id=str(cred["id"]),
        title=cred.get("title") or str(cred.get("credential_type") or "Credential"),
        kind="auto", status=status, detail=detail,
        date=str(cred.get("issue_date") or "") or None,
        due_date=due.isoformat() if due else None,
        vault_category="worker_credentials",
    )


def training_evidence(completion: dict, module_title: str, review_days: Optional[int], today: date) -> Evidence:
    state = completion.get("status")
    completed = _to_date(completion.get("completed_at"))
    if state == "confirmed":
        due = completed + timedelta(days=review_days) if completed and review_days else None
        status = date_status(due, today)
        detail = {"current": "Completion confirmed.", "due_soon": "Refresher due soon.", "overdue": "Refresher overdue."}[status]
    elif state == "rejected":
        status, due, detail = "rejected", None, "Completion rejected."
    else:
        status, due, detail = "awaiting_review", None, "Waiting for the completion to be confirmed."
    return Evidence(
        source_table="worker_training_completions", source_id=str(completion["id"]),
        title=module_title, kind="auto", status=status, detail=detail,
        date=completed.isoformat() if completed else None,
        due_date=due.isoformat() if due else None,
    )


def best_status(evidence: Iterable[Evidence]) -> tuple[str, Optional[Evidence]]:
    best: Optional[Evidence] = None
    for ev in evidence:
        if ev.status not in _STATUS_RANK or ev.status == "missing":
            continue
        if best is None or _STATUS_RANK[ev.status] > _STATUS_RANK[best.status]:
            best = ev
    return (best.status, best) if best else ("missing", None)


def next_action(status: str, req: Requirement, best: Optional[Evidence]) -> str:
    if status == "missing":
        return f"Add or link evidence. {req.evidence_hint}"
    if status == "awaiting_review":
        return "Check the evidence and approve or reject it."
    if status == "due_soon":
        when = f" before {best.due_date}" if best and best.due_date else ""
        return f"Renew or re-review{when}."
    if status == "overdue":
        return "Replace or re-review the evidence — it's no longer current."
    if status == "not_applicable":
        return "No action. Revoke the decision if circumstances change."
    return "No action needed."


# ── Loading ──────────────────────────────────────────────────────────────


def _rows(query) -> list[dict]:
    try:
        return [r for r in (query.execute().data or []) if isinstance(r, dict)]
    except Exception as exc:  # an optional table shouldn't take the page down
        logger.warning("audit readiness query failed: %s", exc)
        return []


def load_profile(org_id: str, supabase=None) -> AuditProfile:
    supabase = supabase or get_supabase_admin()
    rows = _rows(
        supabase.table("organization_audit_profiles")
        .select("audit_type, registration_groups, service_flags")
        .eq("organization_id", org_id)
        .limit(1)
    )
    if not rows:
        return AuditProfile()
    row = rows[0]
    return AuditProfile(
        audit_type=row.get("audit_type"),
        registration_groups=tuple(row.get("registration_groups") or ()),
        service_flags=tuple(row.get("service_flags") or ()),
    )


def save_profile(
    org_id: str,
    user_id: Optional[str],
    audit_type: Optional[str],
    registration_groups: list[str],
    service_flags: list[str],
) -> AuditProfile:
    groups = sorted({g for g in registration_groups if g in REGISTRATION_GROUPS})
    flags = sorted({f for f in service_flags if f in SERVICE_FLAGS})
    get_supabase_admin().table("organization_audit_profiles").upsert(
        {
            "organization_id": org_id,
            "audit_type": audit_type if audit_type in AUDIT_TYPES else None,
            "registration_groups": groups,
            "service_flags": flags,
            "updated_by": user_id,
            "updated_at": datetime.utcnow().isoformat() + "Z",
        },
        on_conflict="organization_id",
    ).execute()
    return load_profile(org_id)


def load_settings(org_id: str, supabase=None) -> dict[str, dict]:
    supabase = supabase or get_supabase_admin()
    return {
        r["requirement_code"]: r
        for r in _rows(
            supabase.table("audit_requirement_settings")
            .select("requirement_code, is_enabled, review_interval_days")
            .eq("organization_id", org_id)
        )
    }


def save_setting(
    org_id: str,
    user_id: Optional[str],
    code: str,
    is_enabled: bool,
    review_interval_days: Optional[int],
) -> None:
    get_supabase_admin().table("audit_requirement_settings").upsert(
        {
            "organization_id": org_id,
            "requirement_code": code,
            "is_enabled": is_enabled,
            "review_interval_days": review_interval_days,
            "updated_by": user_id,
            "updated_at": datetime.utcnow().isoformat() + "Z",
        },
        on_conflict="organization_id,requirement_code",
    ).execute()


def review_days_for(req: Requirement, settings: dict[str, dict]) -> Optional[int]:
    setting = settings.get(req.code)
    if setting and "review_interval_days" in setting:
        return setting.get("review_interval_days")
    return req.default_review_days


def describe_catalogue(profile: AuditProfile, settings: dict[str, dict]) -> list[dict[str, Any]]:
    out = []
    for req in REQUIREMENTS:
        applies, why = applicability(req, profile)
        setting = settings.get(req.code) or {}
        out.append({
            "code": req.code,
            "area": req.area,
            "area_label": AREAS[req.area],
            "scope": req.scope,
            "title": req.title,
            "description": req.description,
            "source": req.source,
            "evidence_hint": req.evidence_hint,
            "critical": req.critical,
            "sensitive": req.sensitive,
            "applies": applies,
            "applies_reason": why,
            "enabled": setting.get("is_enabled", True),
            "review_interval_days": review_days_for(req, settings),
            "default_review_interval_days": req.default_review_days,
        })
    return out


@dataclass
class OrgData:
    """Everything the checklist is computed from, fetched once."""
    org_name: str = "Organisation"
    workers: list[dict] = field(default_factory=list)
    participants: list[dict] = field(default_factory=list)
    credentials: list[dict] = field(default_factory=list)
    training_modules: dict[str, str] = field(default_factory=dict)  # id -> title
    training_completions: list[dict] = field(default_factory=list)
    mandatory_induction_items: set[str] = field(default_factory=set)
    induction_completions: list[dict] = field(default_factory=list)
    onboarding_documents: list[dict] = field(default_factory=list)
    ndis_plans: list[dict] = field(default_factory=list)  # keyed by patient_id (pre-rename column)
    service_agreements: list[dict] = field(default_factory=list)
    consents: list[dict] = field(default_factory=list)
    governance_documents: list[dict] = field(default_factory=list)
    links: list[dict] = field(default_factory=list)
    na_decisions: list[dict] = field(default_factory=list)
    user_names: dict[str, str] = field(default_factory=dict)


def load_org_data(org_id: str) -> OrgData:
    sb = get_supabase_admin()
    data = OrgData()
    org = _rows(sb.table("organizations").select("organization_name").eq("organization_id", org_id).limit(1))
    if org and org[0].get("organization_name"):
        data.org_name = org[0]["organization_name"]
    users = _rows(sb.table("users").select("id, full_name, role, is_active").eq("organization_id", org_id))
    data.user_names = {str(u["id"]): u.get("full_name") or "Unknown" for u in users}
    data.workers = [u for u in users if u.get("role") == "support_worker" and u.get("is_active") is not False]
    data.participants = [
        p for p in _rows(sb.table("participants").select("id, full_name, plan_status").eq("organization_id", org_id))
        if str(p.get("plan_status") or "active").lower() not in INACTIVE_PARTICIPANT_STATUSES
    ]
    data.credentials = _rows(
        sb.table("credentials")
        .select("id, user_id, credential_type, title, status, issue_date, expiry_date")
        .eq("organization_id", org_id)
    )
    data.training_modules = {
        str(m["id"]): m.get("title") or "Training module"
        for m in _rows(sb.table("training_modules").select("id, title").eq("organization_id", org_id))
    }
    data.training_completions = _rows(
        sb.table("worker_training_completions")
        .select("id, worker_id, module_id, status, completed_at")
        .eq("organization_id", org_id)
    )
    data.mandatory_induction_items = {
        str(i["id"])
        for i in _rows(
            sb.table("induction_items").select("id")
            .eq("organization_id", org_id).eq("is_active", True).eq("is_mandatory", True)
        )
    }
    data.induction_completions = _rows(
        sb.table("worker_induction_completions")
        .select("id, worker_id, item_id, completed_at")
        .eq("organization_id", org_id)
    )
    data.onboarding_documents = _rows(
        sb.table("worker_onboarding_documents")
        .select("id, worker_id, document_type, title, created_at, signed_at")
        .eq("organization_id", org_id)
    )
    data.ndis_plans = _rows(
        sb.table("ndis_plans")
        .select("id, patient_id, plan_number, plan_start, plan_end, status, agreement_status, agreement_signed_at")
        .eq("organization_id", org_id)
    )
    data.service_agreements = _rows(
        sb.table("service_agreements")
        .select("id, participant_id, agreement_number, status, start_date, end_date, signed_date")
        .eq("organization_id", org_id)
        .not_.is_("participant_id", "null")  # still on an onboarding intake
    )
    data.consents = _rows(
        sb.table("plan_meeting_sessions")
        .select("id, participant_id, consent_confirmed_at")
        .eq("organization_id", org_id)
        .not_.is_("consent_confirmed_at", "null")
    )
    data.governance_documents = _rows(
        sb.table("governance_documents")
        .select("id, title, folder_key, created_at")
        .eq("organization_id", org_id)
        .is_("deleted_at", "null")
        .is_("superseded_at", "null")
    )
    data.links = _rows(
        sb.table("audit_evidence_links").select("*")
        .eq("organization_id", org_id).is_("removed_at", "null")
    )
    data.na_decisions = _rows(
        sb.table("audit_na_decisions").select("*")
        .eq("organization_id", org_id).is_("revoked_at", "null")
    )
    return data


# ── Building the checklist ───────────────────────────────────────────────


def _subject_key(subject_type: str, subject_id: Optional[str]) -> tuple[str, str]:
    return subject_type, str(subject_id or "")


def _auto_evidence(
    req: Requirement,
    subject_type: str,
    subject_id: Optional[str],
    data: OrgData,
    review_days: Optional[int],
    today: date,
) -> list[Evidence]:
    out: list[Evidence] = []
    if subject_type == "worker":
        wanted = {canonical_credential_type(t) for t in req.credential_types}
        if wanted:
            for cred in data.credentials:
                if str(cred.get("user_id")) == subject_id and canonical_credential_type(cred.get("credential_type")) in wanted:
                    out.append(credential_evidence(cred, review_days, today))
        if req.training_keywords:
            modules = {
                mid: title for mid, title in data.training_modules.items()
                if any(k in title.lower() for k in req.training_keywords)
            }
            for comp in data.training_completions:
                if str(comp.get("worker_id")) == subject_id and str(comp.get("module_id")) in modules:
                    out.append(training_evidence(comp, modules[str(comp["module_id"])], review_days, today))
        if req.onboarding_doc_types:
            for doc in data.onboarding_documents:
                if str(doc.get("worker_id")) != subject_id or doc.get("document_type") not in req.onboarding_doc_types:
                    continue
                signed = doc.get("signed_at")
                out.append(Evidence(
                    source_table="worker_onboarding_documents", source_id=str(doc["id"]),
                    title=doc.get("title") or "Onboarding document", kind="auto",
                    # Signed through the hiring flow counts; an upload with no
                    # signing record needs someone to check it.
                    status="current" if signed else "awaiting_review",
                    reviewable=not signed,
                    detail="Signed through CareCliQ onboarding." if signed else "",
                    date=str(signed or doc.get("created_at") or "")[:10] or None,
                    vault_category="consent_onboarding",
                ))
        if req.induction and data.mandatory_induction_items:
            done = [c for c in data.induction_completions
                    if str(c.get("worker_id")) == subject_id and str(c.get("item_id")) in data.mandatory_induction_items]
            total = len(data.mandatory_induction_items)
            finished = len({str(c["item_id"]) for c in done})
            last = max((str(c.get("completed_at") or "") for c in done), default="") or None
            out.append(Evidence(
                source_table="worker_induction_completions", source_id=f"induction:{subject_id}",
                title="Mandatory induction", kind="auto",
                status="current" if finished >= total else "missing",
                detail=f"{finished} of {total} mandatory items completed.",
                date=last[:10] if last else None,
            ))
    elif subject_type == "participant":
        if "agreement" in req.participant_sources:
            for sa in data.service_agreements:
                if str(sa.get("participant_id")) != subject_id:
                    continue
                state = sa.get("status")
                end = _to_date(sa.get("end_date"))
                if state == "active":
                    status = date_status(end, today)
                    detail = {"current": "Signed and active.", "due_soon": "Ends soon.", "overdue": "Past its end date."}[status]
                elif state in ("expired", "ended"):
                    status, detail = "overdue", "Agreement has ended."
                else:
                    status, detail = "missing", "Not signed yet."
                out.append(Evidence(
                    source_table="service_agreements", source_id=str(sa["id"]),
                    title=f"Service agreement {sa['agreement_number']}" if sa.get("agreement_number") else "Service agreement",
                    kind="auto", status=status, detail=detail, vault_category="consent_onboarding",
                    date=str(sa.get("signed_date") or sa.get("start_date") or "") or None,
                    due_date=end.isoformat() if end else None,
                ))
            for plan in data.ndis_plans:
                if str(plan.get("patient_id")) != subject_id:
                    continue
                state = plan.get("agreement_status")
                end = _to_date(plan.get("plan_end"))
                if state == "signed":
                    status = date_status(end, today)
                    detail = {"current": "Signed.", "due_soon": "Plan ends soon — renew the agreement.", "overdue": "Plan has ended."}[status]
                elif state == "expired":
                    status, detail = "overdue", "Agreement has expired."
                else:
                    status, detail = "missing", "Not signed yet."
                number = plan.get("plan_number")
                out.append(Evidence(
                    source_table="ndis_plans", source_id=str(plan["id"]),
                    title=f"Service agreement on NDIS plan {number}" if number else "Service agreement on NDIS plan",
                    kind="auto", status=status, detail=detail,
                    date=str(plan.get("agreement_signed_at") or "")[:10] or None,
                    due_date=end.isoformat() if end else None,
                    vault_category="ndis_plans",
                ))
        if "ndis_plan" in req.participant_sources:
            for plan in data.ndis_plans:
                if str(plan.get("patient_id")) != subject_id:
                    continue
                if str(plan.get("status") or "").lower() in ("draft", "cancelled"):
                    continue
                end = _to_date(plan.get("plan_end"))
                status = date_status(end, today)
                number = plan.get("plan_number")
                out.append(Evidence(
                    source_table="ndis_plans", source_id=str(plan["id"]),
                    title=f"NDIS plan {number}" if number else "NDIS plan",
                    kind="auto", status=status,
                    detail={"current": "In date.", "due_soon": "Plan ends soon.", "overdue": "Plan has ended."}[status],
                    date=str(plan.get("plan_start") or "") or None,
                    due_date=end.isoformat() if end else None,
                    vault_category="ndis_plans",
                ))
        if "consent" in req.participant_sources:
            for consent in data.consents:
                if str(consent.get("participant_id")) != subject_id:
                    continue
                given = _to_date(consent.get("consent_confirmed_at"))
                due = given + timedelta(days=review_days) if given and review_days else None
                status = date_status(due, today)
                out.append(Evidence(
                    source_table="plan_meeting_sessions", source_id=str(consent["id"]),
                    title="Consent confirmed at plan meeting", kind="auto", status=status,
                    detail={"current": "Recorded.", "due_soon": "Re-confirm soon.", "overdue": "Re-confirmation overdue."}[status],
                    date=given.isoformat() if given else None,
                    due_date=due.isoformat() if due else None,
                    vault_category="consent_onboarding",
                ))
    elif subject_type == "organisation" and req.governance_folders:
        for doc in data.governance_documents:
            if doc.get("folder_key") in req.governance_folders:
                out.append(Evidence(
                    source_table="governance_documents", source_id=str(doc["id"]),
                    title=doc.get("title") or "Policy document", kind="auto",
                    status="awaiting_review", reviewable=True,
                    date=str(doc.get("created_at") or "")[:10] or None,
                    vault_category=str(doc.get("folder_key")),
                ))
    return out


def _apply_links(
    auto: list[Evidence],
    links: list[dict],
    review_days: Optional[int],
    today: date,
    user_names: dict[str, str],
) -> list[Evidence]:
    """Merge hand-made links (and reviews of auto-found documents) into the
    auto-found evidence. Records that carry their own approval keep their
    own status; a rejected link still removes them from counting."""
    by_source = {(e.source_table, e.source_id): e for e in auto}
    out = list(auto)
    for link in links:
        key = (str(link.get("source_table")), str(link.get("source_id")))
        ev = by_source.get(key)
        if ev is None:
            ev = Evidence(
                source_table=key[0], source_id=key[1],
                title=link.get("source_title") or "Linked document",
                kind="linked", status="awaiting_review", reviewable=True,
                date=str(link.get("linked_at") or "")[:10] or None,
                vault_category=link.get("vault_category"),
            )
            out.append(ev)
            by_source[key] = ev
        ev.link_id = str(link["id"])
        ev.review_status = link.get("review_status")
        ev.review_note = link.get("review_note")
        ev.reviewed_at = link.get("reviewed_at")
        ev.reviewed_by = user_names.get(str(link.get("reviewed_by") or "")) if link.get("reviewed_by") else None
        if ev.reviewable:
            status, due, detail = reviewed_status(link, review_days, today)
            ev.status, ev.detail = status, detail
            ev.due_date = due.isoformat() if due else None
        elif link.get("review_status") == "rejected":
            ev.status, ev.detail = "rejected", link.get("review_note") or "Rejected at review."
    for ev in out:
        if ev.reviewable and ev.link_id is None:
            ev.detail = "Needs review by an authorised person."
    return out


def build_checklist(
    data: OrgData,
    profile: AuditProfile,
    settings: dict[str, dict],
    today: Optional[date] = None,
) -> list[dict[str, Any]]:
    today = today or app_today()
    links_by_item: dict[tuple, list[dict]] = {}
    for link in data.links:
        key = (link.get("requirement_code"),) + _subject_key(link.get("subject_type"), link.get("subject_id"))
        links_by_item.setdefault(key, []).append(link)
    na_by_item = {
        (d.get("requirement_code"),) + _subject_key(d.get("subject_type"), d.get("subject_id")): d
        for d in data.na_decisions
    }

    subjects: dict[str, list[tuple[Optional[str], str]]] = {
        "organisation": [(None, data.org_name)],
        "worker": [(str(w["id"]), w.get("full_name") or "Unknown worker") for w in data.workers],
        "participant": [(str(p["id"]), p.get("full_name") or "Unknown participant") for p in data.participants],
    }

    items: list[dict[str, Any]] = []
    for req in REQUIREMENTS:
        if not settings.get(req.code, {}).get("is_enabled", True):
            continue
        applies, why = applicability(req, profile)
        if not applies:
            continue
        review_days = review_days_for(req, settings)
        for subject_id, subject_name in subjects[req.scope]:
            key = (req.code,) + _subject_key(req.scope, subject_id)
            auto = _auto_evidence(req, req.scope, subject_id, data, review_days, today)
            evidence = _apply_links(auto, links_by_item.get(key, []), review_days, today, data.user_names)
            status, best = best_status(evidence)
            na = na_by_item.get(key)
            if na:
                status = "not_applicable"
            items.append({
                "id": f"{req.code}:{req.scope}:{subject_id or 'org'}",
                "requirement_code": req.code,
                "area": req.area,
                "title": req.title,
                "critical": req.critical,
                "subject_type": req.scope,
                "subject_id": subject_id,
                "subject_name": subject_name,
                "status": status,
                "applies_reason": why,
                "due_date": best.due_date if best and status != "not_applicable" else None,
                "next_action": next_action(status, req, best),
                "evidence": [e.as_dict() for e in evidence],
                "not_applicable": (
                    {
                        "id": str(na["id"]),
                        "reason": na.get("reason"),
                        "approved_by": data.user_names.get(str(na.get("approved_by") or "")),
                        "approved_at": na.get("approved_at"),
                    }
                    if na else None
                ),
            })
    return items


def summarise(items: list[dict[str, Any]]) -> dict[str, Any]:
    counts = {s: 0 for s in ("current", "due_soon", "awaiting_review", "overdue", "missing", "not_applicable")}
    by_area: dict[str, dict[str, int]] = {a: {"total": 0, "ready": 0, "gaps": 0} for a in AREAS}
    critical_gaps = 0
    for item in items:
        counts[item["status"]] += 1
        if item["status"] == "not_applicable":
            continue
        area = by_area[item["area"]]
        area["total"] += 1
        if item["status"] in ("current", "due_soon"):
            area["ready"] += 1
        if item["status"] in ("missing", "overdue"):
            area["gaps"] += 1
            if item["critical"]:
                critical_gaps += 1
    applicable = sum(v for k, v in counts.items() if k != "not_applicable")
    ready = counts["current"] + counts["due_soon"]
    return {
        "total": len(items),
        "applicable": applicable,
        "counts": counts,
        "readiness_percent": round(100 * ready / applicable) if applicable else None,
        "critical_gaps": critical_gaps,
        "by_area": [{"area": k, "label": AREAS[k], **v} for k, v in by_area.items()],
    }


def get_checklist(org_id: str) -> dict[str, Any]:
    profile = load_profile(org_id)
    settings = load_settings(org_id)
    data = load_org_data(org_id)
    items = build_checklist(data, profile, settings)
    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "profile_configured": profile.is_configured,
        "summary": summarise(items),
        "items": items,
    }


# ── Writes ───────────────────────────────────────────────────────────────


def subject_exists(org_id: str, subject_type: str, subject_id: Optional[str]) -> bool:
    if subject_type == "organisation":
        return subject_id is None
    if not subject_id:
        return False
    sb = get_supabase_admin()
    if subject_type == "worker":
        rows = _rows(sb.table("users").select("id").eq("id", subject_id).eq("organization_id", org_id).limit(1))
    else:
        rows = _rows(sb.table("participants").select("id").eq("id", subject_id).eq("organization_id", org_id).limit(1))
    return bool(rows)


def find_live_link(
    org_id: str, code: str, subject_type: str, subject_id: Optional[str], source_table: str, source_id: str,
) -> Optional[dict]:
    query = (
        get_supabase_admin().table("audit_evidence_links").select("*")
        .eq("organization_id", org_id).eq("requirement_code", code)
        .eq("subject_type", subject_type).eq("source_table", source_table).eq("source_id", source_id)
        .is_("removed_at", "null")
    )
    query = query.is_("subject_id", "null") if subject_id is None else query.eq("subject_id", subject_id)
    rows = _rows(query.limit(1))
    return rows[0] if rows else None


def governance_doc_in_folders(org_id: str, doc_id: str, folders: tuple[str, ...]) -> Optional[dict]:
    if not folders:
        return None
    rows = _rows(
        get_supabase_admin().table("governance_documents").select("id, title, folder_key")
        .eq("organization_id", org_id).eq("id", doc_id)
        .is_("deleted_at", "null").limit(1)
    )
    return rows[0] if rows and rows[0].get("folder_key") in folders else None


def onboarding_doc_for_worker(
    org_id: str, doc_id: str, worker_id: Optional[str], types: tuple[str, ...],
) -> Optional[dict]:
    if not types or not worker_id:
        return None
    rows = _rows(
        get_supabase_admin().table("worker_onboarding_documents").select("id, title, worker_id, document_type")
        .eq("organization_id", org_id).eq("id", doc_id).limit(1)
    )
    if rows and str(rows[0].get("worker_id")) == str(worker_id) and rows[0].get("document_type") in types:
        return rows[0]
    return None


def create_link(
    org_id: str,
    user_id: Optional[str],
    code: str,
    subject_type: str,
    subject_id: Optional[str],
    source_table: str,
    source_id: str,
    source_title: Optional[str],
    vault_category: Optional[str],
) -> dict:
    existing = find_live_link(org_id, code, subject_type, subject_id, source_table, source_id)
    if existing:
        return existing
    resp = get_supabase_admin().table("audit_evidence_links").insert({
        "organization_id": org_id,
        "requirement_code": code,
        "subject_type": subject_type,
        "subject_id": subject_id,
        "source_table": source_table,
        "source_id": source_id,
        "source_title": (source_title or "")[:300] or None,
        "vault_category": vault_category,
        "linked_by": user_id,
    }).execute()
    return (resp.data or [{}])[0]


def get_link(org_id: str, link_id: str) -> Optional[dict]:
    rows = _rows(
        get_supabase_admin().table("audit_evidence_links").select("*")
        .eq("organization_id", org_id).eq("id", link_id).is_("removed_at", "null").limit(1)
    )
    return rows[0] if rows else None


def review_link(
    org_id: str,
    user_id: Optional[str],
    link_id: str,
    decision: Literal["approved", "rejected"],
    note: Optional[str],
    expiry_date: Optional[date],
) -> dict:
    resp = (
        get_supabase_admin().table("audit_evidence_links")
        .update({
            "review_status": decision,
            "review_note": note,
            "expiry_date": expiry_date.isoformat() if expiry_date else None,
            "reviewed_by": user_id,
            "reviewed_at": datetime.utcnow().isoformat() + "Z",
        })
        .eq("organization_id", org_id).eq("id", link_id)
        .execute()
    )
    return (resp.data or [{}])[0]


def remove_link(org_id: str, user_id: Optional[str], link_id: str) -> None:
    get_supabase_admin().table("audit_evidence_links").update({
        "removed_by": user_id,
        "removed_at": datetime.utcnow().isoformat() + "Z",
    }).eq("organization_id", org_id).eq("id", link_id).execute()


def record_na(
    org_id: str, user_id: Optional[str], code: str, subject_type: str, subject_id: Optional[str], reason: str,
) -> dict:
    resp = get_supabase_admin().table("audit_na_decisions").insert({
        "organization_id": org_id,
        "requirement_code": code,
        "subject_type": subject_type,
        "subject_id": subject_id,
        "reason": reason.strip(),
        "approved_by": user_id,
    }).execute()
    return (resp.data or [{}])[0]


def get_na(org_id: str, decision_id: str) -> Optional[dict]:
    rows = _rows(
        get_supabase_admin().table("audit_na_decisions").select("*")
        .eq("organization_id", org_id).eq("id", decision_id).is_("revoked_at", "null").limit(1)
    )
    return rows[0] if rows else None


def revoke_na(org_id: str, user_id: Optional[str], decision_id: str, reason: Optional[str]) -> None:
    get_supabase_admin().table("audit_na_decisions").update({
        "revoked_by": user_id,
        "revoked_at": datetime.utcnow().isoformat() + "Z",
        "revoke_reason": reason,
    }).eq("organization_id", org_id).eq("id", decision_id).execute()
