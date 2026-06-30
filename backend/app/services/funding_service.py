"""
NDIS Funding Tracker Service

Manages NDIS plan budgets, budget category tracking, and session cost calculations.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import json
import logging

from .supabase_client import get_supabase_admin
from . import ndis_pricing_service
from ..core.ndis_categories import LEGACY_CATEGORIES, support_purpose_to_group

logger = logging.getLogger(__name__)

# NDIS Support Category → billing category mapping
SESSION_TYPE_CATEGORY_MAP: Dict[str, str] = {
    # Core Supports
    "support worker": "core",
    "daily activities": "core",
    "personal care": "core",
    "community access": "core",
    "social support": "core",
    "transport": "core",
    "progress note": "core",
    "home care": "core",
    "respite": "core",
    # Capacity Building
    "occupational therapy": "capacity_building",
    "speech pathology": "capacity_building",
    "speech therapy": "capacity_building",
    "physiotherapy": "capacity_building",
    "psychology": "capacity_building",
    "behaviour support": "capacity_building",
    "behaviour therapy": "capacity_building",
    "plan management": "capacity_building",
    "support coordination": "capacity_building",
    "skill development": "capacity_building",
    "life skills": "capacity_building",
    "employment support": "capacity_building",
    # Capital
    "assistive technology": "capital",
    "home modification": "capital",
    "equipment": "capital",
}

CATEGORY_HOURLY_RATES: Dict[str, float] = {
    "core": 67.56,
    "capacity_building": 193.99,
    "capital": 0.0,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_rows(data: Any) -> List[Dict[str, Any]]:
    """Ensure Supabase data is always returned as list[dict]."""
    if not isinstance(data, list):
        return []

    return [r for r in data if isinstance(r, dict)]


def _safe_row(data: Any) -> Optional[Dict[str, Any]]:
    """Ensure Supabase single-row response is dict."""
    return data if isinstance(data, dict) else None


def _normalize_plan(row: Dict[str, Any]) -> Dict[str, Any]:
    if not row:
        return {}

    out = dict(row)

    if "total_funding" in out:
        try:
            out["total_funding"] = float(out.get("total_funding") or 0)
        except Exception:
            out["total_funding"] = 0.0

    budgets = out.get("plan_budgets")

    if not isinstance(budgets, list):
        out["plan_budgets"] = []
    else:
        cleaned_budgets: List[Dict[str, Any]] = []

        for budget in budgets:
            if not isinstance(budget, dict):
                continue

            cleaned_budgets.append(
                {
                    **budget,
                    "allocated_amount": float(budget.get("allocated_amount") or 0),
                    "used_amount": float(budget.get("used_amount") or 0),
                }
            )

        out["plan_budgets"] = cleaned_budgets

    return out


# ---------------------------------------------------------------------------
# Session Cost Helpers
# ---------------------------------------------------------------------------


def get_support_category(session_type: str) -> str:
    """Map a session type string to an NDIS support category."""
    if not session_type:
        return "core"

    key = session_type.lower().strip()

    for pattern, category in SESSION_TYPE_CATEGORY_MAP.items():
        if pattern in key:
            return category

    return "core"


_CATEGORY_LABELS: Dict[str, str] = {
    "core": "Core Supports",
    "capacity_building": "Capacity Building",
    "capital": "Capital Supports",
}


def resolve_session_budget_category(session: dict) -> str:
    """Map session fields to plan_budgets.category (core | capacity_building | capital)."""
    raw = str(session.get("support_category") or "").strip().lower()
    if raw in ("core", "capacity_building", "capital"):
        return raw
    if "capacity" in raw:
        return "capacity_building"
    if "capital" in raw:
        return "capital"
    if "core" in raw:
        return "core"
    return get_support_category(str(session.get("session_type") or ""))


def build_budget_alignment_context(
    session: dict,
    plan: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Build NDIS plan budget context for CARECLIQV2-36 compliance rules.

    Returns None when the participant has no active plan (rules should be skipped).
    """
    if not plan:
        return None

    duration = int(session.get("duration_minutes") or 0)
    session_type = str(session.get("session_type") or "")
    cost_info = calculate_session_cost(duration, session_type)
    category = resolve_session_budget_category(session)

    raw_budgets = plan.get("plan_budgets")
    budgets = [b for b in raw_budgets if isinstance(b, dict)] if isinstance(raw_budgets, list) else []

    cat_budget: Optional[Dict[str, Any]] = None
    for budget in budgets:
        if str(budget.get("category") or "") == category:
            cat_budget = budget
            break

    if not cat_budget:
        return {
            "has_plan": True,
            "has_category_budget": False,
            "category": category,
            "category_label": _CATEGORY_LABELS.get(category, category.replace("_", " ").title()),
            "session_cost": float(cost_info.get("cost") or 0),
        }

    allocated = float(cat_budget.get("allocated_amount") or 0)
    used = float(cat_budget.get("used_amount") or 0)
    remaining = round(allocated - used, 2)

    return {
        "has_plan": True,
        "has_category_budget": allocated > 0,
        "category": category,
        "category_label": _CATEGORY_LABELS.get(category, category.replace("_", " ").title()),
        "allocated": allocated,
        "used": used,
        "remaining": remaining,
        "session_cost": float(cost_info.get("cost") or 0),
        "percent_remaining": round((remaining / allocated) * 100, 1) if allocated > 0 else 0.0,
    }


def calculate_session_cost(
    duration_minutes: int,
    session_type: str,
    hourly_rate_override: Optional[float] = None,
) -> Dict[str, Any]:
    """Calculate the cost of a session."""

    category = get_support_category(session_type)

    hourly_rate = (
        hourly_rate_override
        if hourly_rate_override is not None
        else CATEGORY_HOURLY_RATES.get(category, 67.56)
    )

    cost = round((duration_minutes / 60) * hourly_rate, 2)

    return {
        "category": category,
        "hourly_rate": hourly_rate,
        "duration_minutes": duration_minutes,
        "cost": cost,
    }


# ---------------------------------------------------------------------------
# NDIS Plans
# ---------------------------------------------------------------------------


async def get_plan_for_participant(
    participant_id: str,
) -> Optional[Dict[str, Any]]:
    """Get active NDIS plan for participant."""

    try:
        supabase = get_supabase_admin()

        result = (
            supabase.table("ndis_plans")
            .select("*, plan_budgets(*)")
            .eq("patient_id", participant_id)
            .eq("status", "active")
            .order("plan_start", desc=True)
            .limit(1)
            .execute()
        )

        rows = _safe_rows(result.data)

        if not rows:
            return None

        return _normalize_plan(rows[0])

    except Exception as e:
        logger.warning(
            "Could not fetch NDIS plan for %s: %s",
            participant_id,
            e,
        )
        return None


async def get_latest_plan_for_participant(
    participant_id: str,
) -> Optional[Dict[str, Any]]:
    """Get the most recent NDIS plan regardless of status."""

    try:
        supabase = get_supabase_admin()

        result = (
            supabase.table("ndis_plans")
            .select("*, plan_budgets(*)")
            .eq("patient_id", participant_id)
            .order("plan_start", desc=True)
            .limit(1)
            .execute()
        )

        rows = _safe_rows(result.data)

        if not rows:
            return None

        return _normalize_plan(rows[0])

    except Exception as e:
        logger.warning(
            "Could not fetch latest NDIS plan for %s: %s",
            participant_id,
            e,
        )
        return None


async def get_all_plans_for_participant(
    participant_id: str,
) -> List[Dict[str, Any]]:
    """Get all plans for participant."""

    try:
        supabase = get_supabase_admin()

        result = (
            supabase.table("ndis_plans")
            .select("*, plan_budgets(*)")
            .eq("patient_id", participant_id)
            .order("plan_start", desc=True)
            .execute()
        )

        rows = _safe_rows(result.data)

        return [_normalize_plan(row) for row in rows]

    except Exception as e:
        logger.warning(
            "Could not fetch plans for %s: %s",
            participant_id,
            e,
        )
        return []


async def create_or_update_plan(
    participant_id: str,
    plan_data: Dict[str, Any],
) -> Dict[str, Any]:
    """Create or update participant plan."""

    supabase = get_supabase_admin()

    payload = {k: v for k, v in dict(plan_data).items() if v is not None}
    payload["patient_id"] = participant_id

    for field in ("plan_start", "plan_end"):
        if payload.get(field):
            payload[field] = str(payload[field])[:10]

    existing = await get_latest_plan_for_participant(participant_id)

    if existing:
        result = (
            supabase.table("ndis_plans")
            .update(payload)
            .eq("id", existing["id"])
            .execute()
        )
    else:
        payload.setdefault("status", "active")

        patient_resp = (
            supabase.table("patients")
            .select("organization_id")
            .eq("id", participant_id)
            .maybe_single()
            .execute()
        )
        patient_row = patient_resp.data if patient_resp else None
        if isinstance(patient_row, dict) and patient_row.get("organization_id"):
            payload["organization_id"] = patient_row["organization_id"]

        result = supabase.table("ndis_plans").insert(payload).execute()

    rows = _safe_rows(result.data)

    if not rows:
        return {}

    return _normalize_plan(rows[0])


async def list_available_categories(org_id: str) -> List[Dict[str, Any]]:
    """Fundable categories an org's coordinator can pick for a plan budget.

    Prefers the org's actually-loaded NDIS pricing schedule (real, billable
    categories) and only falls back to the 3 legacy broad buckets when the
    org hasn't loaded one yet.
    """
    priced = await ndis_pricing_service.list_organization_categories(org_id)

    if priced:
        return [
            {
                "category": item["category_number"],
                "category_name": item["category_name"],
                "category_group": support_purpose_to_group(item["support_purpose"]),
                "source": "pricing",
            }
            for item in priced
        ]

    return [
        {
            "category": key,
            "category_name": meta["label"],
            "category_group": meta["group"],
            "source": "legacy",
        }
        for key, meta in LEGACY_CATEGORIES.items()
    ]


async def upsert_plan_budget(
    plan_id: str,
    category: str,
    allocated: float,
    category_group: str,
    category_name: str,
) -> Dict[str, Any]:
    """Upsert budget category for plan."""

    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc).isoformat()

    existing = (
        supabase.table("plan_budgets")
        .select("id, used_amount")
        .eq("plan_id", plan_id)
        .eq("category", category)
        .execute()
    )

    existing_rows = _safe_rows(existing.data)

    if existing_rows:
        row = existing_rows[0]

        result = (
            supabase.table("plan_budgets")
            .update(
                {
                    "allocated_amount": allocated,
                    "category_group": category_group,
                    "category_name": category_name,
                    "updated_at": now,
                }
            )
            .eq("id", row["id"])
            .execute()
        )
    else:
        result = (
            supabase.table("plan_budgets")
            .insert(
                {
                    "plan_id": plan_id,
                    "category": category,
                    "category_group": category_group,
                    "category_name": category_name,
                    "allocated_amount": allocated,
                    "used_amount": 0.0,
                    "updated_at": now,
                }
            )
            .execute()
        )

    rows = _safe_rows(result.data)

    return rows[0] if rows else {}


async def delete_plan_budget(plan_id: str, category: str) -> bool:
    """Remove a budget category from a plan. Returns whether a row was deleted."""

    supabase = get_supabase_admin()

    result = (
        supabase.table("plan_budgets")
        .delete()
        .eq("plan_id", plan_id)
        .eq("category", category)
        .execute()
    )

    return bool(_safe_rows(result.data))


# ---------------------------------------------------------------------------
# Budget Usage
# ---------------------------------------------------------------------------


async def record_session_budget_usage(
    session_id: str,
    participant_id: str,
    duration_minutes: int,
    session_type: str,
) -> Optional[Dict[str, Any]]:
    """
    Record budget usage from a session.
    """

    try:
        cost_info = calculate_session_cost(
            duration_minutes=duration_minutes,
            session_type=session_type,
        )

        plan = await get_plan_for_participant(participant_id)

        if not plan:
            logger.info(
                "No active plan for participant %s",
                participant_id,
            )
            return cost_info

        plan_id = str(plan["id"])

        supabase = get_supabase_admin()

        supabase.table("budget_usage").insert(
            {
                "plan_id": plan_id,
                "session_id": session_id,
                "category": cost_info["category"],
                "amount": cost_info["cost"],
                "hourly_rate": cost_info["hourly_rate"],
                "duration_minutes": duration_minutes,
                "description": (
                    f"Session: {session_type or 'Support'} ({duration_minutes} min)"
                ),
            }
        ).execute()

        budget_result = (
            supabase.table("plan_budgets")
            .select("id, used_amount")
            .eq("plan_id", plan_id)
            .eq("category", cost_info["category"])
            .execute()
        )

        budget_rows = _safe_rows(budget_result.data)

        if budget_rows:
            row = budget_rows[0]

            current_used = float(row.get("used_amount") or 0)

            new_used = round(
                current_used + float(cost_info["cost"]),
                2,
            )

            supabase.table("plan_budgets").update(
                {
                    "used_amount": new_used,
                }
            ).eq("id", row["id"]).execute()

        return cost_info

    except Exception as e:
        logger.error(
            "Error recording budget usage for session %s: %s",
            session_id,
            e,
        )
        return None


async def get_budget_summary(
    participant_id: str,
) -> Dict[str, Any]:
    """Get participant budget summary."""

    plan = await get_plan_for_participant(participant_id)

    if not plan:
        plan = await get_latest_plan_for_participant(participant_id)

    if not plan:
        return {
            "has_plan": False,
            "budgets": [],
        }

    # budgets may be Any | None, so normalize it first
    raw_budgets = plan.get("plan_budgets")

    budgets: List[Dict[str, Any]] = (
        [b for b in raw_budgets if isinstance(b, dict)]
        if isinstance(raw_budgets, list)
        else []
    )

    budget_items: List[Dict[str, Any]] = []

    for budget in budgets:
        if not isinstance(budget, dict):
            continue

        allocated = float(budget.get("allocated_amount") or 0)
        used = float(budget.get("used_amount") or 0)
        category = budget.get("category", "")

        budget_items.append(
            {
                "category": category,
                "category_label": budget.get("category_name")
                or _CATEGORY_LABELS.get(category, str(category).title()),
                "category_group": budget.get("category_group") or "core_supports",
                "allocated": allocated,
                "used": used,
                "remaining": round(allocated - used, 2),
                "percent_used": (
                    round((used / allocated) * 100, 1) if allocated > 0 else 0
                ),
                "overspent": used > allocated,
            }
        )

    total_allocated = round(sum(b["allocated"] for b in budget_items), 2)
    total_used = round(sum(b["used"] for b in budget_items), 2)

    return {
        "has_plan": True,
        "plan_id": plan.get("id"),
        "plan_number": plan.get("plan_number", ""),
        "plan_start": plan.get("plan_start"),
        "plan_end": plan.get("plan_end"),
        "status": plan.get("status"),
        "total_funding": plan.get("total_funding", 0),
        "budgets": budget_items,
        # Rollup across categories — the source of truth for "Budget Remaining"
        # style stat cards, distinct from total_funding (the plan's overall cap).
        "total_allocated": total_allocated,
        "total_used": total_used,
        "total_remaining": round(total_allocated - total_used, 2),
    }


async def get_budget_usage_history(
    participant_id: str,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """Get participant budget usage history."""

    try:
        supabase = get_supabase_admin()

        plan = await get_plan_for_participant(participant_id)

        if not plan:
            return []

        result = (
            supabase.table("budget_usage")
            .select("*")
            .eq("plan_id", plan["id"])
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )

        return _safe_rows(result.data)

    except Exception as e:
        logger.warning(
            "Error fetching budget usage for %s: %s",
            participant_id,
            e,
        )
        return []


# ---------------------------------------------------------------------------
# Compliance Audit Logs
# ---------------------------------------------------------------------------


async def create_compliance_audit_log(
    session_id: str,
    compliance_result: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """Create compliance audit log."""

    try:
        supabase = get_supabase_admin()

        result = (
            supabase.table("compliance_audit_logs")
            .insert(
                {
                    "session_id": session_id,
                    "compliance_score": compliance_result.get("score", 0),
                    "rules_checked": compliance_result.get("total_rules", 0),
                    "rules_passed": compliance_result.get("passed", 0),
                    "rules_warnings": compliance_result.get("warnings", 0),
                    "rules_failed": compliance_result.get("failed", 0),
                    "failed_rules": json.dumps(
                        compliance_result.get("failed_rules", [])
                    ),
                    "all_rules": json.dumps(compliance_result.get("rules", [])),
                }
            )
            .execute()
        )

        rows = _safe_rows(result.data)

        return rows[0] if rows else None

    except Exception as e:
        logger.error(
            "Error creating compliance audit log for session %s: %s",
            session_id,
            e,
        )
        return None


async def get_compliance_audit_logs(
    session_id: str,
) -> List[Dict[str, Any]]:
    """Get compliance audit logs."""

    try:
        supabase = get_supabase_admin()

        result = (
            supabase.table("compliance_audit_logs")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at", desc=True)
            .execute()
        )

        rows: List[Dict[str, Any]] = []

        for row in _safe_rows(result.data):
            for field in ("failed_rules", "all_rules"):
                value = row.get(field)

                if isinstance(value, str):
                    try:
                        row[field] = json.loads(value)
                    except Exception:
                        row[field] = []

            rows.append(row)

        return rows

    except Exception as e:
        logger.warning(
            "Error fetching audit logs for session %s: %s",
            session_id,
            e,
        )
        return []
