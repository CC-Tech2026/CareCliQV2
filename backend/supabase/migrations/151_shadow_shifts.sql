-- Support Worker Onboarding Journey, Phase 6: shadow shifts.
--
-- Before a new worker takes their first shift solo, they attend one alongside
-- their buddy or another senior worker. worker_id stays the trainee doing the
-- actual shift (still gated by the normal training/induction/credential
-- checks in coordinator.py::assign_shift - a shadow shift doesn't bypass
-- those, it's a support structure for an otherwise-ready worker's early
-- shifts, not a way to roster someone who isn't ready yet).
-- shadow_of_worker_id is the senior worker they're shadowing.
--
-- Pay: same rate as a normal shift for now - no rate-modifier column. This is
-- a SCHADS/payroll question flagged separately, not resolved here; don't
-- infer a rate decision from this migration's absence of one.

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS is_shadow_shift boolean NOT NULL DEFAULT false;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS shadow_of_worker_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
