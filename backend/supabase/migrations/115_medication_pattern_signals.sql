-- Medication Management v2 step 4: pattern detection, split into two distinct, correctly
-- scoped signals per the pattern-detection addendum — never conflated into one metric.
--
--   participant_reliability: all workers, one participant, 7-day window. Compliance-facing,
--   audit-exportable, never names a worker.
--
--   worker_coaching: one worker across their caseload, vs the org average, 30-day window.
--   Coaching-facing only — never surfaced in the Compliance Centre or an audit export.
--
-- One append-only table for both, distinguished by signal_type, so it's auditable later that
-- the two were never conflated (every row states exactly which question it answered and at
-- what scope).

BEGIN;

CREATE TABLE IF NOT EXISTS public.medication_pattern_signals (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_type      TEXT NOT NULL CHECK (signal_type IN ('participant_reliability', 'worker_coaching')),
    -- participant_id for participant_reliability, worker (users.id) for worker_coaching.
    scope_id         UUID NOT NULL,
    organization_id  UUID NOT NULL,
    window_start     TIMESTAMPTZ NOT NULL,
    window_end       TIMESTAMPTZ NOT NULL,
    rate_calculated  NUMERIC NOT NULL,
    -- worker_coaching only: the org average rate this worker was compared against.
    comparison_rate  NUMERIC,
    -- worker_coaching only: rate_calculated - comparison_rate.
    deviation        NUMERIC,
    sample_size      INTEGER NOT NULL,
    triggered        BOOLEAN NOT NULL,
    trigger_reason   TEXT,
    calculated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medication_pattern_signals_scope
    ON public.medication_pattern_signals (signal_type, scope_id, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_medication_pattern_signals_org_triggered
    ON public.medication_pattern_signals (organization_id, signal_type, triggered, calculated_at DESC);

-- Pure calculation output — append only, never edited or deleted, same immutability
-- principle as the administration ledger itself.
CREATE OR REPLACE FUNCTION public.medication_pattern_signals_prevent_modify()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'medication_pattern_signals rows are immutable and append-only.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS medication_pattern_signals_no_update ON public.medication_pattern_signals;
CREATE TRIGGER medication_pattern_signals_no_update
    BEFORE UPDATE OR DELETE ON public.medication_pattern_signals
    FOR EACH ROW EXECUTE FUNCTION public.medication_pattern_signals_prevent_modify();

ALTER TABLE public.medication_pattern_signals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'medication_pattern_signals' AND policyname = 'medication_pattern_signals_service_role') THEN
        CREATE POLICY medication_pattern_signals_service_role ON public.medication_pattern_signals FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
