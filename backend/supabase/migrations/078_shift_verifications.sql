-- Migration 078: Shift verification gate (Fix #6 — budget deduction review)
--
-- record_session_budget_usage() used to deduct plan_budgets.used_amount
-- automatically on session save, with no review and hardcoded rates. That
-- call site is already disabled. This table is the audit record for the
-- replacement: a coordinator must explicitly confirm a completed shift,
-- with the automated checks that ran (and their results) snapshotted here,
-- before any budget deduction happens. One row per shift, created only on
-- confirm — the pending queue itself is computed live from shifts/sessions,
-- not pre-populated.

BEGIN;

CREATE TABLE IF NOT EXISTS public.shift_verifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id uuid NOT NULL UNIQUE REFERENCES public.shifts(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    participant_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,

    -- Snapshot of evidence/compliance/hours-sanity/force-ended results at
    -- the moment of confirmation — the audit trail a coordinator saw.
    checks_run jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- Catalogue rows are effective-dated/versioned, so the resolved price
    -- is snapshotted rather than FK'd (same pattern task_completions uses).
    price_item_code text,
    support_category text,
    hourly_rate_applied numeric,
    billed_amount numeric,

    verified_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    verified_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_verifications_org
    ON public.shift_verifications (organization_id);
CREATE INDEX IF NOT EXISTS idx_shift_verifications_participant
    ON public.shift_verifications (participant_id);

COMMENT ON TABLE public.shift_verifications IS
    'Coordinator-confirmed verification of a completed shift before budget deduction (CARECLIQV2 Fix #6). One row per shift.';
COMMENT ON COLUMN public.shift_verifications.checks_run IS
    'Snapshot of automated check results (evidence/compliance, hours sanity, force_ended) shown to the coordinator at confirm time.';

ALTER TABLE public.shift_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shift_verifications_select ON public.shift_verifications;
CREATE POLICY shift_verifications_select ON public.shift_verifications
    FOR SELECT
    USING (organization_id = (SELECT cs_user_org_id()));

DROP POLICY IF EXISTS shift_verifications_insert ON public.shift_verifications;
CREATE POLICY shift_verifications_insert ON public.shift_verifications
    FOR INSERT
    WITH CHECK (organization_id = (SELECT cs_user_org_id()));

DROP POLICY IF EXISTS shift_verifications_update ON public.shift_verifications;
CREATE POLICY shift_verifications_update ON public.shift_verifications
    FOR UPDATE
    USING (organization_id = (SELECT cs_user_org_id()));

DROP POLICY IF EXISTS shift_verifications_delete ON public.shift_verifications;
CREATE POLICY shift_verifications_delete ON public.shift_verifications
    FOR DELETE
    USING (organization_id = (SELECT cs_user_org_id()));

COMMIT;
