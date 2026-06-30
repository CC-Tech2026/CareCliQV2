"""Fixed NDIS funding-line taxonomy shared across plan budgets and (later) goals/tasks.

Single source of truth for the category keys enforced by the
plan_budgets_category_valid CHECK constraint (migration 074).
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
# Kept valid for already-stored data; never offered as a choice for new rows.
LEGACY_CATEGORIES: Dict[str, CategoryMeta] = {
    "core":              {"label": "Core Supports (General)",     "group": "core_supports",    "group_label": "Core Supports"},
    "capacity_building": {"label": "Capacity Building (General)", "group": "capacity_building", "group_label": "Capacity Building"},
    "capital":           {"label": "Capital Supports (General)",  "group": "capital_supports",  "group_label": "Capital Supports"},
}

NDIS_CATEGORIES: Dict[str, CategoryMeta] = {
    # Core Supports
    "core_daily_activities": {"label": "Assistance with Daily Life",          "group": "core_supports", "group_label": "Core Supports"},
    "core_transport":        {"label": "Transport",                          "group": "core_supports", "group_label": "Core Supports"},
    "core_consumables":      {"label": "Consumables",                        "group": "core_supports", "group_label": "Core Supports"},
    "core_social_community": {"label": "Social & Community Participation",   "group": "core_supports", "group_label": "Core Supports"},
    # Capacity Building
    "cb_daily_living":         {"label": "Improved Daily Living",                  "group": "capacity_building", "group_label": "Capacity Building"},
    "cb_relationships":        {"label": "Improved Relationships",                 "group": "capacity_building", "group_label": "Capacity Building"},
    "cb_health_wellbeing":     {"label": "Improved Health & Wellbeing",            "group": "capacity_building", "group_label": "Capacity Building"},
    "cb_life_choices":         {"label": "Improved Life Choices",                  "group": "capacity_building", "group_label": "Capacity Building"},
    "cb_social_community":     {"label": "Improved Social & Community Participation", "group": "capacity_building", "group_label": "Capacity Building"},
    "cb_employment":           {"label": "Finding & Keeping a Job",                "group": "capacity_building", "group_label": "Capacity Building"},
    "cb_learning":              {"label": "Improved Learning",                      "group": "capacity_building", "group_label": "Capacity Building"},
    "cb_support_coordination": {"label": "Support Coordination",                   "group": "capacity_building", "group_label": "Capacity Building"},
    # Capital Supports
    "capital_assistive_tech": {"label": "Assistive Technology", "group": "capital_supports", "group_label": "Capital Supports"},
    "capital_home_mods":      {"label": "Home Modifications",   "group": "capital_supports", "group_label": "Capital Supports"},
}

# Union of selectable + legacy, used for validation and label lookups.
ALL_CATEGORIES: Dict[str, CategoryMeta] = {**LEGACY_CATEGORIES, **NDIS_CATEGORIES}


def category_label(category: str) -> str:
    meta = ALL_CATEGORIES.get(category)
    if meta:
        return meta["label"]
    return category.replace("_", " ").title()


def category_group(category: str) -> str:
    meta = ALL_CATEGORIES.get(category)
    if meta:
        return meta["group"]
    return "core_supports"
