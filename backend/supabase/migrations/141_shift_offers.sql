-- Shift reassignment Phase 2 — ranked, one-at-a-time offer/accept-decline.
--
-- One row per offer ATTEMPT, not one row per shift: matches the
-- remind-then-escalate convention already used by offer_letter_reminder_service.py
-- and onboarding_escalation_service.py — append a new row on each escalation
-- (decline or timeout) rather than mutate one row, so the full sequence
-- (who was asked, in what order, what they did) stays auditable.

BEGIN;

CREATE TABLE IF NOT EXISTS public.shift_offers (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id        UUID        NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    worker_id       UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    rank            SMALLINT    NOT NULL DEFAULT 1,
    status          TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'superseded')),
    -- Remaining ranked worker ids to try after this one, captured once when
    -- the coordinator sends the offer — decline/expiry pops the next id off
    -- this array rather than re-running the matching query each time.
    candidate_queue JSONB       NOT NULL DEFAULT '[]'::jsonb,
    offered_by      UUID        NOT NULL REFERENCES public.users(id),
    offered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    responds_by     TIMESTAMPTZ NOT NULL,
    responded_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_shift_offers_shift_id ON public.shift_offers (shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_offers_worker_pending
    ON public.shift_offers (worker_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_shift_offers_expiry_scan
    ON public.shift_offers (responds_by) WHERE status = 'pending';

ALTER TABLE public.shift_offers ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'shift_offers'
          AND policyname = 'shift_offers_service_role_all'
    ) THEN
        CREATE POLICY shift_offers_service_role_all ON public.shift_offers
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- The alerts table has no shift reference today (only patient_id/session_id) —
-- needed so a shift-offer notification's Accept/Decline actions know which
-- shift they're acting on.
ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.shifts(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_alerts_shift_id ON public.alerts (shift_id);

COMMIT;
