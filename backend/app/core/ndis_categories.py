"""Legacy NDIS budget-bucket fallback + group-mapping helpers.

The real, fundable category list for an organization comes from its loaded
NDIS pricing schedule (ndis_price_items.category_number, with registration_group
as a fallback label — see list_organization_categories' docstring for why
there's no dedicated category-name column live) — see
ndis_pricing_service.list_organization_categories and
funding_service.list_available_categories. This module only covers:

  - the 3 broad legacy buckets used before per-category tracking existed,
    kept valid for already-stored plan_budgets rows and offered as a
    fallback for organizations that haven't loaded a pricing schedule yet.
  - mapping an ndis_price_items.support_purpose string to the coarse
    Core/Capacity/Capital group used for UI sectioning.
"""

from typing import Dict, TypedDict


class CategoryMeta(TypedDict):
    label: str
    group: str
    group_label: str


GROUP_LABELS: Dict[str, str] = {
    "core_supports": "Core Supports",
    "capacity_building": "Capacity Building",
    "capital_supports": "Capital Supports",
}

# Legacy broad-bucket values from before per-category tracking existed.
# Kept valid for already-stored data, and as a fallback when an organization
# has no pricing schedule loaded (so the NDIS Plan tab still has something
# to offer).
LEGACY_CATEGORIES: Dict[str, CategoryMeta] = {
    "core":              {"label": "Core Supports (General)",     "group": "core_supports",    "group_label": "Core Supports"},
    "capacity_building": {"label": "Capacity Building (General)", "group": "capacity_building", "group_label": "Capacity Building"},
    "capital":           {"label": "Capital Supports (General)",  "group": "capital_supports",  "group_label": "Capital Supports"},
}


def category_label(category: str) -> str:
    meta = LEGACY_CATEGORIES.get(category)
    if meta:
        return meta["label"]
    return category.replace("_", " ").title()


def category_group(category: str) -> str:
    meta = LEGACY_CATEGORIES.get(category)
    if meta:
        return meta["group"]
    return "core_supports"


def support_purpose_to_group(support_purpose: str) -> str:
    """Map an ndis_price_items.support_purpose string to a coarse UI group."""
    purpose = (support_purpose or "").strip().lower()
    if "capital" in purpose:
        return "capital_supports"
    if "capacity" in purpose:
        return "capacity_building"
    return "core_supports"
