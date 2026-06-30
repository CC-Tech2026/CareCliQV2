"""
Static CareCliQ 12-rule catalog with human-readable explanations for UI tooltips.

DB guidance_text takes precedence when available via enrich_rule_results().
"""
from __future__ import annotations

from typing import Any

from .compliance_engine import load_rule_configs

# Mirrors 015_compliance_rules_seed.sql + 016_compliance_rules_config.sql guidance_text.
RULE_CATALOG: dict[str, dict[str, str]] = {
    "R1": {
        "label": "Session time and duration",
        "category": "documentation",
        "explanation": (
            "Record the session date, start time, end time, and total duration for every support "
            "delivery. Without these fields the session cannot be claimed or audited."
        ),
    },
    "R2": {
        "label": "48-hour documentation",
        "category": "documentation",
        "explanation": (
            "Submit your progress note within 48 hours of the session. If submitting late, "
            "acknowledge the delay and document the reason."
        ),
    },
    "R3": {
        "label": "Note quality",
        "category": "documentation",
        "explanation": (
            "Write at least 80 words of specific, observable clinical detail. Avoid vague phrases "
            "like \"good session\" or \"did shopping\" — describe exactly what was done and how."
        ),
    },
    "R4": {
        "label": "Support type documented",
        "category": "documentation",
        "explanation": (
            "Select the NDIS support type (registration group) that matches the service delivered. "
            "Required for claim traceability."
        ),
    },
    "R5": {
        "label": "Goals referenced in note",
        "category": "language",
        "explanation": (
            "Reference at least one active NDIS goal by name, number, or approved goal language. "
            "Describe the participant's progress toward that goal."
        ),
    },
    "R6": {
        "label": "Objective language",
        "category": "language",
        "explanation": (
            "Use objective, observable language only. Replace opinions (\"I think\", \"I believe\") "
            "with documented facts and direct participant statements."
        ),
    },
    "R7": {
        "label": "Person-first language",
        "category": "language",
        "explanation": (
            "Use person-first language throughout. Write \"person who uses a wheelchair\" not "
            "\"wheelchair-bound\". The person always comes before their disability."
        ),
    },
    "R8": {
        "label": "Scope of practice",
        "category": "language",
        "explanation": (
            "Support workers must not document clinical assessments, diagnoses, or medication "
            "administration. If clinical actions occurred, document the referral to the appropriate clinician."
        ),
    },
    "R9": {
        "label": "Incident triggers",
        "category": "safety",
        "explanation": (
            "If an incident occurred, complete the auto-created incident draft immediately. "
            "NDIS serious incidents must be reported to the Commission within 24 hours."
        ),
    },
    "R10": {
        "label": "Restrictive practice reported",
        "category": "safety",
        "explanation": (
            "Restrictive practices must be linked to an approved behaviour support plan and a "
            "submitted incident report. The note cannot be approved until both are complete."
        ),
    },
    "R11": {
        "label": "Note uniqueness",
        "category": "safety",
        "explanation": (
            "Ensure each note is specific to this session. NDIS auditors flag copy-pasted or "
            "templated notes as evidence that genuine support was not delivered."
        ),
    },
    "R12": {
        "label": "Participant response",
        "category": "safety",
        "explanation": (
            "Document how the participant responded using observable language: \"participant reported\", "
            "\"participant demonstrated\", \"participant engaged\", \"participant declined\"."
        ),
    },
    "budget_exceeded": {
        "label": "NDIS budget exceeded",
        "category": "funding",
        "explanation": (
            "The estimated cost of this session exceeds the participant's remaining NDIS plan budget "
            "for the support category. Review funding before claiming."
        ),
    },
    "budget_warning": {
        "label": "NDIS budget low",
        "category": "funding",
        "explanation": (
            "The participant's NDIS plan budget for this support category is within 10% of being fully "
            "utilised. Consider plan review or coordinator escalation."
        ),
    },
    "duration_consistency_warning": {
        "label": "Duration mismatch (advisory)",
        "category": "documentation",
        "explanation": (
            "The documented session duration differs from the linked shift's actual duration by more than "
            "30 minutes. Review for accuracy; score is not affected."
        ),
    },
    "duration_consistency_error": {
        "label": "Duration mismatch (significant)",
        "category": "documentation",
        "explanation": (
            "The documented session duration differs from the linked shift's actual duration by more than "
            "60 minutes. This reduces the compliance score and should be corrected or explained."
        ),
    },
}

RULE_ORDER = [f"R{i}" for i in range(1, 13)]
SUPPLEMENTAL_RULE_ORDER = [
    "budget_exceeded",
    "budget_warning",
    "duration_consistency_warning",
    "duration_consistency_error",
]


def get_rules_catalog() -> list[dict[str, Any]]:
    """Return all 12 rules with labels and explanations for tooltip display."""
    db_configs = load_rule_configs()
    catalog: list[dict[str, Any]] = []
    for code in RULE_ORDER:
        static = RULE_CATALOG.get(code, {})
        db_row = db_configs.get(code) or {}
        catalog.append({
            "rule": code,
            "label": db_row.get("name") or static.get("label") or code,
            "category": db_row.get("category") or static.get("category") or "documentation",
            "explanation": db_row.get("guidance_text") or static.get("explanation") or "",
            "enforcement_tier": db_row.get("enforcement_tier"),
            "is_blocking": db_row.get("is_blocking"),
        })
    return catalog


def enrich_rule_results(rules: list[dict] | None) -> list[dict[str, Any]]:
    """Merge engine rule results with catalog explanations."""
    db_configs = load_rule_configs()
    by_code = {r.get("rule"): r for r in (rules or []) if r.get("rule")}
    enriched: list[dict[str, Any]] = []

    for code in RULE_ORDER:
        result = by_code.get(code)
        static = RULE_CATALOG.get(code, {})
        db_row = db_configs.get(code) or {}

        if result:
            enriched.append({
                **result,
                "label": result.get("label") or db_row.get("name") or static.get("label") or code,
                "category": db_row.get("category") or static.get("category") or "documentation",
                "explanation": db_row.get("guidance_text") or static.get("explanation") or "",
            })
        else:
            enriched.append({
                "rule": code,
                "label": db_row.get("name") or static.get("label") or code,
                "status": "pending",
                "message": "No recent session data for this rule.",
                "severity": db_row.get("severity") or "medium",
                "category": db_row.get("category") or static.get("category") or "documentation",
                "explanation": db_row.get("guidance_text") or static.get("explanation") or "",
                "is_blocking": db_row.get("is_blocking", False),
                "enforcement_tier": db_row.get("enforcement_tier"),
            })

    for code in SUPPLEMENTAL_RULE_ORDER:
        result = by_code.get(code)
        if not result:
            continue
        static = RULE_CATALOG.get(code, {})
        db_row = db_configs.get(code) or {}
        enriched.append({
            **result,
            "label": result.get("label") or db_row.get("name") or static.get("label") or code,
            "category": db_row.get("category") or static.get("category") or "funding",
            "explanation": db_row.get("guidance_text") or static.get("explanation") or "",
        })

    return enriched
