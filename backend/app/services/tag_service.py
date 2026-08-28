"""Worker-Participant Matching Enhancement, Phase 1 (Foundation).

Structured tag taxonomy (categories + tags) and assignment of those tags to
participants and workers. This is the data foundation the Phase 2 ranking
service will read from - no scoring logic lives here, just CRUD.

visible_to_coordinator_only worker tags are visible to every coordinator/MD
in the organisation, not scoped to a worker's assigned coordinator - see the
comment on worker_tags in migration 144_participant_worker_tags.sql for why.
"""

from __future__ import annotations

from typing import Any, Optional

from .supabase_client import get_supabase_admin


def list_tag_catalog(organization_id: str, active_only: bool = True) -> list[dict[str, Any]]:
    """Categories with their nested tags, for this org."""
    supabase = get_supabase_admin()

    cat_query = supabase.table("tag_categories").select("id, name, is_active, matching_role").eq(
        "organization_id", organization_id
    )
    if active_only:
        cat_query = cat_query.eq("is_active", True)
    categories = (cat_query.order("name").execute().data) or []
    if not categories:
        return []

    cat_ids = [c["id"] for c in categories]
    tag_query = (
        supabase.table("tags")
        .select("id, category_id, label, is_active")
        .eq("organization_id", organization_id)
        .in_("category_id", cat_ids)
    )
    if active_only:
        tag_query = tag_query.eq("is_active", True)
    tags = (tag_query.order("label").execute().data) or []

    tags_by_category: dict[str, list[dict[str, Any]]] = {}
    for t in tags:
        tags_by_category.setdefault(t["category_id"], []).append(
            {"id": t["id"], "label": t["label"], "is_active": t["is_active"]}
        )

    return [
        {
            "id": c["id"],
            "name": c["name"],
            "is_active": c["is_active"],
            "matching_role": c.get("matching_role"),
            "tags": tags_by_category.get(c["id"], []),
        }
        for c in categories
    ]


def create_tag_category(organization_id: str, name: str, matching_role: Optional[str] = None) -> dict[str, Any]:
    supabase = get_supabase_admin()
    payload: dict[str, Any] = {"organization_id": organization_id, "name": name.strip(), "is_active": True}
    if matching_role:
        payload["matching_role"] = matching_role
    resp = (
        supabase.table("tag_categories")
        .upsert(payload, on_conflict="organization_id,name")
        .execute()
    )
    return (resp.data or [{}])[0]


def set_tag_category_matching_role(organization_id: str, category_id: str, matching_role: Optional[str]) -> None:
    supabase = get_supabase_admin()
    supabase.table("tag_categories").update({"matching_role": matching_role}).eq("id", category_id).eq(
        "organization_id", organization_id
    ).execute()


def category_ids_for_role(organization_id: str, matching_role: str) -> list[str]:
    supabase = get_supabase_admin()
    resp = (
        supabase.table("tag_categories")
        .select("id")
        .eq("organization_id", organization_id)
        .eq("matching_role", matching_role)
        .eq("is_active", True)
        .execute()
    )
    return [r["id"] for r in (resp.data or [])]


def set_tag_category_active(organization_id: str, category_id: str, is_active: bool) -> None:
    supabase = get_supabase_admin()
    supabase.table("tag_categories").update({"is_active": is_active}).eq("id", category_id).eq(
        "organization_id", organization_id
    ).execute()


def create_tag(organization_id: str, category_id: str, label: str) -> dict[str, Any]:
    supabase = get_supabase_admin()
    resp = (
        supabase.table("tags")
        .upsert(
            {"organization_id": organization_id, "category_id": category_id, "label": label.strip(), "is_active": True},
            on_conflict="organization_id,category_id,label",
        )
        .execute()
    )
    return (resp.data or [{}])[0]


def set_tag_active(organization_id: str, tag_id: str, is_active: bool) -> None:
    supabase = get_supabase_admin()
    supabase.table("tags").update({"is_active": is_active}).eq("id", tag_id).eq("organization_id", organization_id).execute()


def _tags_with_label(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach label/category_id by joining against `tags` - participant_tags/worker_tags
    rows only carry tag_id, and callers always want the label for display."""
    if not rows:
        return []
    supabase = get_supabase_admin()
    tag_ids = list({r["tag_id"] for r in rows})
    tags = (
        supabase.table("tags").select("id, label, category_id").in_("id", tag_ids).execute().data
    ) or []
    tags_by_id = {t["id"]: t for t in tags}
    out = []
    for r in rows:
        tag = tags_by_id.get(r["tag_id"], {})
        out.append({**r, "label": tag.get("label"), "category_id": tag.get("category_id")})
    return out


def list_participant_tags(participant_id: str) -> list[dict[str, Any]]:
    supabase = get_supabase_admin()
    rows = (
        supabase.table("participant_tags")
        .select("id, tag_id, added_by_user_id, added_at, notes")
        .eq("participant_id", participant_id)
        .execute()
        .data
    ) or []
    return _tags_with_label(rows)


def add_participant_tag(participant_id: str, tag_id: str, added_by_user_id: Optional[str], notes: Optional[str] = None) -> dict[str, Any]:
    supabase = get_supabase_admin()
    payload = {
        "participant_id": participant_id,
        "tag_id": tag_id,
        "added_by_user_id": added_by_user_id,
        "notes": notes,
    }
    resp = supabase.table("participant_tags").upsert(payload, on_conflict="participant_id,tag_id").execute()
    return (resp.data or [payload])[0]


def remove_participant_tag(participant_id: str, tag_id: str) -> None:
    supabase = get_supabase_admin()
    supabase.table("participant_tags").delete().eq("participant_id", participant_id).eq("tag_id", tag_id).execute()


def list_worker_tags(worker_id: str, *, include_private: bool) -> list[dict[str, Any]]:
    """include_private=False is for surfaces the tagged worker themselves doesn't
    control visibility over (there are none today - every worker sees their own
    tags in full) - kept as a parameter so a future non-coordinator worker-facing
    view (e.g. a participant browsing worker profiles) can safely default to False
    without a separate code path being written from scratch."""
    supabase = get_supabase_admin()
    query = (
        supabase.table("worker_tags")
        .select("id, tag_id, added_by_user_id, added_at, notes, visible_to_coordinator_only")
        .eq("worker_id", worker_id)
    )
    if not include_private:
        query = query.eq("visible_to_coordinator_only", False)
    rows = query.execute().data or []
    return _tags_with_label(rows)


def add_worker_tag(
    worker_id: str,
    tag_id: str,
    added_by_user_id: Optional[str],
    notes: Optional[str] = None,
    visible_to_coordinator_only: bool = False,
) -> dict[str, Any]:
    supabase = get_supabase_admin()
    payload = {
        "worker_id": worker_id,
        "tag_id": tag_id,
        "added_by_user_id": added_by_user_id,
        "notes": notes,
        "visible_to_coordinator_only": visible_to_coordinator_only,
    }
    resp = supabase.table("worker_tags").upsert(payload, on_conflict="worker_id,tag_id").execute()
    return (resp.data or [payload])[0]


def remove_worker_tag(worker_id: str, tag_id: str) -> None:
    supabase = get_supabase_admin()
    supabase.table("worker_tags").delete().eq("worker_id", worker_id).eq("tag_id", tag_id).execute()


def set_matching_opt_in(worker_id: str, opt_in: bool) -> None:
    supabase = get_supabase_admin()
    supabase.table("users").update({"matching_opt_in": opt_in}).eq("id", worker_id).execute()
