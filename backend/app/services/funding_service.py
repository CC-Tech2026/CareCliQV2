"""
NDIS Funding Tracker Service

Manages NDIS plan budgets, budget category tracking, and session cost calculations.

Support categories:
- core              : Core Supports (daily activities, personal care, community access)
- capacity_building : Capacity Building (therapy, specialist support)
- capital           : Capital Supports (assistive technology, home modifications)
"""
from typing import Optional, List
from .supabase_client import get_supabase_admin
import logging

logger = logging.getLogger(__name__)

# NDIS Support Category → billing category mapping
SESSION_TYPE_CATEGORY_MAP = {
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

# Simplified NDIS hourly rates (AUD)
CATEGORY_HOURLY_RATES = {
    "core": 67.56,                # Support Worker weekday rate
    "capacity_building": 193.99,  # Specialist support rate
    "capital": 0.0,               # Capital items are not hourly
}


def get_support_category(session_type: str) -> str:
    """Map a session type string to an NDIS support category."""
    if not session_type:
        return "core"
    key = session_type.lower().strip()
    for pattern, category in SESSION_TYPE_CATEGORY_MAP.items():
        if pattern in key:
            return category
    return "core"


def calculate_session_cost(
    duration_minutes: int,
    session_type: str,
    hourly_rate_override: Optional[float] = None,
) -> dict:
    """Calculate the cost of a session."""
    category = get_support_category(session_type)
    hourly_rate = hourly_rate_override or CATEGORY_HOURLY_RATES.get(category, 67.56)
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

async def get_plan_for_participant(participant_id: str) -> Optional[dict]:
    """Get the active NDIS plan for a participant."""
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
        if result.data:
            return _normalize_plan(result.data[0])
        return None
    except Exception as e:
        logger.warning(f"Could not fetch NDIS plan for {participant_id}: {e}")
        return None


async def get_all_plans_for_participant(participant_id: str) -> List[dict]:
    """Get all NDIS plans for a participant (including expired)."""
    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table("ndis_plans")
            .select("*, plan_budgets(*)")
            .eq("patient_id", participant_id)
            .order("plan_start", desc=True)
            .execute()
        )
        return [_normalize_plan(p) for p in (result.data or [])]
    except Exception as e:
        logger.warning(f"Could not fetch plans for {participant_id}: {e}")
        return []


async def create_or_update_plan(participant_id: str, plan_data: dict) -> dict:
    """Create or update an NDIS plan for a participant."""
    supabase = get_supabase_admin()
    plan_data["patient_id"] = participant_id

    for date_field in ("plan_start", "plan_end"):
        if date_field in plan_data and plan_data[date_field]:
            plan_data[date_field] = str(plan_data[date_field])[:10]

    existing = await get_plan_for_participant(participant_id)
    if existing:
        plan_id = existing["id"]
        result = (
            supabase.table("ndis_plans")
            .update(plan_data)
            .eq("id", plan_id)
            .execute()
        )
    else:
        plan_data.setdefault("status", "active")
        result = supabase.table("ndis_plans").insert(plan_data).execute()

    return _normalize_plan(result.data[0]) if result.data else {}


async def upsert_plan_budget(plan_id: str, category: str, allocated: float) -> dict:
    """Set the allocated amount for a budget category within a plan."""
    supabase = get_supabase_admin()
    existing = (
        supabase.table("plan_budgets")
        .select("id, used_amount")
        .eq("plan_id", plan_id)
        .eq("category", category)
        .execute()
    )
    if existing.data:
        row = existing.data[0]
        result = (
            supabase.table("plan_budgets")
            .update({"allocated_amount": allocated})
            .eq("id", row["id"])
            .execute()
        )
    else:
        result = (
            supabase.table("plan_budgets")
            .insert({
                "plan_id": plan_id,
                "category": category,
                "allocated_amount": allocated,
                "used_amount": 0.0,
            })
            .execute()
        )
    return result.data[0] if result.data else {}


# ---------------------------------------------------------------------------
# Budget usage
# ---------------------------------------------------------------------------

async def record_session_budget_usage(
    session_id: str,
    participant_id: str,
    duration_minutes: int,
    session_type: str,
) -> Optional[dict]:
    """
    Calculate session cost and record it as a budget_usage entry.
    Returns a dict with cost information, or None if plan not found.
    """
    try:
        cost_info = calculate_session_cost(duration_minutes, session_type)
        plan = await get_plan_for_participant(participant_id)
        if not plan:
            logger.info(f"No active plan for participant {participant_id} — skipping budget tracking")
            return cost_info

        plan_id = plan["id"]
        supabase = get_supabase_admin()

        supabase.table("budget_usage").insert({
            "plan_id": plan_id,
            "session_id": session_id,
            "category": cost_info["category"],
            "amount": cost_info["cost"],
            "hourly_rate": cost_info["hourly_rate"],
            "duration_minutes": duration_minutes,
            "description": f"Session: {session_type or 'Support'} ({duration_minutes} min)",
        }).execute()

        budget_row = (
            supabase.table("plan_budgets")
            .select("id, used_amount")
            .eq("plan_id", plan_id)
            .eq("category", cost_info["category"])
            .execute()
        )
        if budget_row.data:
            row = budget_row.data[0]
            new_used = round(float(row.get("used_amount") or 0) + cost_info["cost"], 2)
            supabase.table("plan_budgets").update({"used_amount": new_used}).eq("id", row["id"]).execute()

        return cost_info
    except Exception as e:
        logger.error(f"Error recording budget usage for session {session_id}: {e}")
        return None


async def get_budget_summary(participant_id: str) -> dict:
    """Get a structured budget summary for a participant."""
    plan = await get_plan_for_participant(participant_id)
    if not plan:
        return {"has_plan": False, "budgets": []}

    budgets = plan.get("plan_budgets") or []
    return {
        "has_plan": True,
        "plan_id": plan["id"],
        "plan_number": plan.get("plan_number", ""),
        "plan_start": plan.get("plan_start"),
        "plan_end": plan.get("plan_end"),
        "status": plan.get("status"),
        "total_funding": plan.get("total_funding", 0),
        "budgets": [
            {
                "category": b["category"],
                "category_label": {
                    "core": "Core Supports",
                    "capacity_building": "Capacity Building",
                    "capital": "Capital Supports",
                }.get(b["category"], b["category"].title()),
                "allocated": float(b.get("allocated_amount") or 0),
                "used": float(b.get("used_amount") or 0),
                "remaining": round(
                    float(b.get("allocated_amount") or 0)
                    - float(b.get("used_amount") or 0),
                    2,
                ),
                "percent_used": round(
                    (float(b.get("used_amount") or 0) / float(b.get("allocated_amount") or 1)) * 100, 1
                ) if (b.get("allocated_amount") or 0) > 0 else 0,
            }
            for b in budgets
        ],
    }


async def get_budget_usage_history(participant_id: str, limit: int = 50) -> List[dict]:
    """Get budget usage history for a participant."""
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
        return result.data or []
    except Exception as e:
        logger.warning(f"Error fetching budget usage for {participant_id}: {e}")
        return []


# ---------------------------------------------------------------------------
# Compliance audit log
# ---------------------------------------------------------------------------

async def create_compliance_audit_log(
    session_id: str,
    compliance_result: dict,
) -> Optional[dict]:
    """Store a compliance audit log entry for a session."""
    try:
        supabase = get_supabase_admin()
        import json
        result = supabase.table("compliance_audit_logs").insert({
            "session_id": session_id,
            "compliance_score": compliance_result.get("score", 0),
            "rules_checked": compliance_result.get("total_rules", 0),
            "rules_passed": compliance_result.get("passed", 0),
            "rules_warnings": compliance_result.get("warnings", 0),
            "rules_failed": compliance_result.get("failed", 0),
            "failed_rules": json.dumps(compliance_result.get("failed_rules", [])),
            "all_rules": json.dumps(compliance_result.get("rules", [])),
        }).execute()
        return result.data[0] if result.data else None
    except Exception as e:
        logger.error(f"Error creating compliance audit log for session {session_id}: {e}")
        return None


async def get_compliance_audit_logs(session_id: str) -> List[dict]:
    """Get compliance audit history for a session."""
    try:
        supabase = get_supabase_admin()
        import json
        result = (
            supabase.table("compliance_audit_logs")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at", desc=True)
            .execute()
        )
        rows = []
        for row in (result.data or []):
            for field in ("failed_rules", "all_rules"):
                val = row.get(field)
                if isinstance(val, str):
                    try:
                        row[field] = json.loads(val)
                    except Exception:
                        row[field] = []
            rows.append(row)
        return rows
    except Exception as e:
        logger.warning(f"Error fetching audit logs for session {session_id}: {e}")
        return []


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

def _normalize_plan(row: dict) -> dict:
    if not row:
        return row
    out = dict(row)
    if "total_funding" in out:
        out["total_funding"] = float(out["total_funding"] or 0)
    return out
