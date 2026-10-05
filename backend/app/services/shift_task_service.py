"""Which care-plan tasks go on a shift — one set of rules for every way a
shift is created (single, bulk/recurring, unassigned) and for the worker's
clock-in fallback.

A participant's active templates apply to a shift when:
- the shift type matches (a template with no shift type, or "all", fits any);
- for "specific_weekdays", the shift's *local* weekday is listed (0=Sunday);
- for "one_off", it hasn't already been on another shift;
- for "recurring" + "daily" / "weekly", it isn't already on another shift
  that day / that week (Monday–Sunday, local time);
- when the shift delivers an agreement line, the template is for that
  support (one of its support item codes is in the line's support group) or
  for any support (no codes).

Each template has one participant_tasks row per participant (found by
task_template_id, migration 234), linked to every shift it's on through
shift_tasks — completion is tracked on the link, never on the task itself.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Iterable, Optional

from ..core.timezone import parse_shift_datetime, participant_timezone

logger = logging.getLogger(__name__)

ANY_SHIFT_TYPES = {"", "all", "any", "anytime"}


def local_shift_date(scheduled_start: Any, participant_id: str, org_id: str) -> Optional[date]:
    """The calendar day the shift starts on in the participant's branch zone
    (the UTC date files an Adelaide 9 am shift under the day before)."""
    if not scheduled_start:
        return None
    try:
        start = scheduled_start if isinstance(scheduled_start, datetime) else parse_shift_datetime(str(scheduled_start))
        tz = participant_timezone({"participant_id": participant_id}, organization_id=org_id)
        return start.astimezone(tz).date()
    except Exception:
        return None


def template_fits_shift(template: dict[str, Any], shift_type: Optional[str], local_date: Optional[date]) -> bool:
    """Shift type and weekday rules. Frequency (one-off/daily/weekly) needs the
    template's history and is checked in generate_template_tasks."""
    wanted = (shift_type or "").strip().lower()
    primary = (template.get("primary_shift_type") or "").strip().lower()
    additional = [str(s).strip().lower() for s in (template.get("additional_shift_types") or [])]
    if wanted and not (primary in ANY_SHIFT_TYPES or primary == wanted or wanted in additional):
        return False
    if (template.get("recurrence_type") or "one_off") == "specific_weekdays":
        if local_date is None:
            return False
        sunday_first = (local_date.weekday() + 1) % 7  # template weekdays: 0=Sunday
        return sunday_first in [int(d) for d in (template.get("recurrence_weekdays") or [])]
    return True


def _already_used(template: dict[str, Any], uses: list[date], local_date: Optional[date]) -> bool:
    """uses: local dates of other (not cancelled) shifts this template's task is on."""
    kind = template.get("recurrence_type") or "one_off"
    if kind == "one_off":
        return bool(uses)
    if kind == "recurring" and local_date is not None:
        frequency = template.get("recurrence_frequency")
        if frequency == "daily":
            return local_date in uses
        if frequency == "weekly":
            week = local_date.isocalendar()[:2]
            return any(d.isocalendar()[:2] == week for d in uses)
    return False


def _rows(resp: Any) -> list[dict[str, Any]]:
    data = getattr(resp, "data", None)
    return [r for r in data if isinstance(r, dict)] if isinstance(data, list) else []


def _task_uses(supabase, task_ids: list[str], org_id: str, exclude_shift_id: str, participant_id: str) -> dict[str, list[date]]:
    """task id -> local dates of the other, non-cancelled shifts it's linked to."""
    if not task_ids:
        return {}
    links = _rows(
        supabase.table("shift_tasks").select("task_id, shift_id")
        .in_("task_id", task_ids).eq("organization_id", org_id).execute()
    )
    shift_ids = sorted({str(link["shift_id"]) for link in links if str(link.get("shift_id")) != exclude_shift_id})
    if not shift_ids:
        return {}
    shifts = {
        str(s["id"]): s for s in _rows(
            supabase.table("shifts").select("id, scheduled_start, status")
            .in_("id", shift_ids).eq("organization_id", org_id).execute()
        )
        if s.get("status") != "cancelled"
    }
    uses: dict[str, list[date]] = {}
    for link in links:
        shift = shifts.get(str(link.get("shift_id")))
        if not shift:
            continue
        day = local_shift_date(shift.get("scheduled_start"), participant_id, org_id)
        if day is not None:
            uses.setdefault(str(link["task_id"]), []).append(day)
    return uses


def _task_fields(template: dict[str, Any], participant_id: str, org_id: str) -> dict[str, Any]:
    return {
        "participant_id": participant_id,
        "organization_id": org_id,
        "name": template.get("name"),
        "description": template.get("description"),
        "goal_id": template.get("linked_goal_id"),
        "is_mandatory": bool(template.get("is_mandatory")),
        "evidence_required": template.get("evidence_required") or "none",
    }


def _template_tasks(supabase, templates: list[dict[str, Any]], participant_id: str, org_id: str) -> dict[str, str]:
    """template id -> its participant task id, creating any that don't exist
    yet. Raises if migration 234 (task_template_id) isn't applied."""
    ids = [str(t["id"]) for t in templates]
    existing = _rows(
        supabase.table("participant_tasks").select("id, task_template_id")
        .eq("participant_id", participant_id).eq("organization_id", org_id)
        .in_("task_template_id", ids).order("created_at", desc=True).execute()
    )
    by_template: dict[str, str] = {}
    for row in existing:  # newest first; keep one per template
        by_template.setdefault(str(row["task_template_id"]), str(row["id"]))
    missing = [t for t in templates if str(t["id"]) not in by_template]
    if missing:
        now = datetime.now().astimezone().isoformat()
        created = _rows(
            supabase.table("participant_tasks").insert([
                {**_task_fields(t, participant_id, org_id), "task_template_id": str(t["id"]),
                 "status": "pending", "created_at": now, "updated_at": now}
                for t in missing
            ]).execute()
        )
        for row in created:
            if row.get("task_template_id") and row.get("id"):
                by_template[str(row["task_template_id"])] = str(row["id"])
    return by_template


def link_tasks(supabase, shift_id: str, org_id: str, task_ids: Iterable[str], start_order: int = 1) -> list[str]:
    """Link tasks to a shift, skipping any already linked. Returns the newly linked ids."""
    wanted = list(dict.fromkeys(str(t) for t in task_ids if t))
    if not wanted:
        return []
    linked = {
        str(r["task_id"]) for r in _rows(
            supabase.table("shift_tasks").select("task_id").eq("shift_id", shift_id).execute()
        )
    }
    new = [t for t in wanted if t not in linked]
    if new:
        supabase.table("shift_tasks").insert([
            {"shift_id": shift_id, "task_id": task_id, "organization_id": org_id,
             "sort_order": start_order + idx, "completed": False}
            for idx, task_id in enumerate(new)
        ]).execute()
    return new


def generate_template_tasks(
    supabase,
    *,
    participant_id: str,
    shift_id: str,
    shift_type: Optional[str],
    scheduled_start: Any,
    org_id: str,
    support_line_id: Optional[str] = None,
) -> list[str]:
    """Link the participant's applicable template tasks to a new shift.
    Returns the linked task ids (in template order)."""
    templates = _rows(
        supabase.table("participant_task_templates").select("*")
        .eq("participant_id", participant_id).eq("organization_id", org_id)
        .eq("status", "active").order("sort_order").execute()
    )
    local_date = local_shift_date(scheduled_start, participant_id, org_id)
    from . import agreement_support_service

    support_codes = agreement_support_service.line_support_codes(supabase, support_line_id)
    fitting = [
        t for t in templates
        if template_fits_shift(t, shift_type, local_date)
        and agreement_support_service.fits_support(t.get("support_item_codes"), support_codes)
    ]
    if not fitting:
        return []

    try:
        task_by_template = _template_tasks(supabase, fitting, participant_id, org_id)
    except Exception as exc:
        # Migration 234 not applied: the old behaviour (a new task per shift,
        # no one-off/daily/weekly tracking) rather than no tasks at all.
        logger.warning("participant_tasks.task_template_id unavailable, creating per-shift tasks: %s", exc)
        now = datetime.now().astimezone().isoformat()
        created = _rows(
            supabase.table("participant_tasks").insert([
                {**_task_fields(t, participant_id, org_id), "status": "pending", "created_at": now, "updated_at": now}
                for t in fitting
            ]).execute()
        )
        return link_tasks(supabase, shift_id, org_id, [str(r["id"]) for r in created if r.get("id")])

    uses = _task_uses(supabase, list(task_by_template.values()), org_id, shift_id, participant_id)
    chosen = [
        task_by_template[str(t["id"])] for t in fitting
        if str(t["id"]) in task_by_template
        and not _already_used(t, uses.get(task_by_template[str(t["id"])], []), local_date)
    ]
    link_tasks(supabase, shift_id, org_id, chosen)
    return chosen


def attach_tasks_to_new_shift(
    supabase,
    *,
    shift: dict[str, Any],
    org_id: str,
    selected_task_ids: Optional[list[str]] = None,
) -> dict[str, Any]:
    """Template tasks plus whatever the coordinator ticked, deduplicated.
    Never fails shift creation: problems come back as a warning."""
    shift_id = str(shift["id"])
    generated: list[str] = []
    warning = None
    try:
        generated = generate_template_tasks(
            supabase,
            participant_id=str(shift.get("participant_id") or ""),
            shift_id=shift_id,
            shift_type=shift.get("shift_type"),
            scheduled_start=shift.get("scheduled_start"),
            org_id=org_id,
            support_line_id=shift.get("service_agreement_support_id"),
        )
    except Exception as exc:
        logger.warning("Task generation for shift %s failed: %s", shift_id, exc)
        warning = "Care plan tasks couldn't be added to this shift."
    selected: list[str] = []
    if selected_task_ids:
        try:
            selected = link_tasks(supabase, shift_id, org_id, selected_task_ids, start_order=len(generated) + 1)
        except Exception as exc:
            logger.warning("Saving selected tasks for shift %s failed: %s", shift_id, exc)
            warning = f"Failed to save selected shift tasks: {exc}"
    return {"generated": generated, "selected": selected, "warning": warning}
