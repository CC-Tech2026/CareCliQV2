"""Domain constants for billing period plan management locks (CARECLIQV2-326)."""

from __future__ import annotations

from typing import Literal, Optional

PlanManagementType = Literal["NDIA-managed", "plan-managed", "self-managed"]

VALID_PLAN_MANAGEMENT_TYPES: frozenset[str] = frozenset({
    "NDIA-managed",
    "plan-managed",
    "self-managed",
})

_LEGACY_PLAN_MANAGEMENT_MAP: dict[str, PlanManagementType] = {
    "ndia-managed": "NDIA-managed",
    "ndia_managed": "NDIA-managed",
    "ndia managed": "NDIA-managed",
    "plan-managed": "plan-managed",
    "plan_managed": "plan-managed",
    "plan managed": "plan-managed",
    "self-managed": "self-managed",
    "self_managed": "self-managed",
    "self managed": "self-managed",
}


def normalize_plan_management_type(value: Optional[str]) -> Optional[PlanManagementType]:
    """Map legacy / free-text values to canonical plan management types."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text in VALID_PLAN_MANAGEMENT_TYPES:
        return text  # type: ignore[return-value]
    mapped = _LEGACY_PLAN_MANAGEMENT_MAP.get(text.lower())
    if mapped:
        return mapped
    lower = text.lower()
    if "ndia" in lower:
        return "NDIA-managed"
    if "plan" in lower and "manage" in lower:
        return "plan-managed"
    if "self" in lower and "manage" in lower:
        return "self-managed"
    return None


def plan_management_type_label(value: Optional[str]) -> str:
    """Human-readable label for API / UI responses."""
    normalized = normalize_plan_management_type(value)
    if normalized == "NDIA-managed":
        return "NDIA-managed"
    if normalized == "plan-managed":
        return "Plan-managed"
    if normalized == "self-managed":
        return "Self-managed"
    return value or "Not recorded"
