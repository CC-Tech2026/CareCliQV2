-- verify_shift() -> _upsert_task_completions_for_verified_shift() only ever
-- created a task_completions row per linked shift_tasks entry. Tasks are
-- optional at shift creation ("Tasks to work on (optional)" in
-- ShiftAssignmentModal), so a normal shift with none selected verified fine
-- (shift_verifications row inserted, budget deducted) but produced zero
-- task_completions rows — silently skipped, logged only as a warning. Since
-- the whole invoicing pipeline (get_completed_tasks_for_period ->
-- aggregate_line_items -> create_invoice) reads exclusively from
-- task_completions, that shift could then never be invoiced: "No verified
-- task completions found for the selected period" with no way to fix it,
-- because task_id was NOT NULL so there was nowhere to record it.
--
-- Confirmed live via direct insert probe (2026-09-25): the NOT NULL
-- constraint from 073_task_pricing_evidence_invoicing.sql is still in force.
--
-- This drops it so a verified shift with no linked tasks can be billed as
-- one completion for the shift itself (task_id null), instead of vanishing
-- from the pipeline. See the accompanying code change in
-- _upsert_task_completions_for_verified_shift().

ALTER TABLE public.task_completions
    ALTER COLUMN task_id DROP NOT NULL;
