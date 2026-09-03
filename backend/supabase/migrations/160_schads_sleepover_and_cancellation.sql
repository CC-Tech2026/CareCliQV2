-- 160_schads_sleepover_and_cancellation.sql
-- SCHADS Award pay engine — Phase 2: sleepovers and employer-cancellation pay.
--
-- Sleepover rules verified against the Fair Work Full Bench decision
-- [2025] FWCFB 292 (effective an employee's first full pay period on/after
-- 1 June 2026): up to 12h ordinary hours around a sleepover, max 8h ordinary
-- in either the pre- or post-sleepover work period, overtime beyond that,
-- and work actually performed during the sleepover paid at overtime rates.
--
-- Cancellation-pay rule verified against SCHADS clause 25.5(f): an assigned
-- shift cancelled by the provider with less than 12 hours' notice before
-- the scheduled start must be paid in full to a full-time or part-time
-- worker (not casuals).

BEGIN;

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS is_sleepover boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.shift_segments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    segment_type text NOT NULL CHECK (segment_type IN ('active_work', 'sleepover_block', 'call_out')),
    segment_start timestamptz NOT NULL,
    segment_end timestamptz NOT NULL,
    note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT shift_segments_valid_span CHECK (segment_start < segment_end)
);

CREATE INDEX IF NOT EXISTS idx_shift_segments_shift
    ON public.shift_segments(shift_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.pay_transactions'::regclass
          AND conname = 'pay_transactions_segment_fk'
    ) THEN
        ALTER TABLE public.pay_transactions
            ADD CONSTRAINT pay_transactions_segment_fk
            FOREIGN KEY (segment_id)
            REFERENCES public.shift_segments(id)
            ON DELETE SET NULL;
    END IF;
END;
$$;

ALTER TABLE public.pay_transactions
    DROP CONSTRAINT IF EXISTS pay_transactions_component_type_valid;

ALTER TABLE public.pay_transactions
    ADD CONSTRAINT pay_transactions_component_type_valid CHECK (component_type IN (
        'base_pay', 'penalty_saturday', 'penalty_sunday', 'penalty_public_holiday', 'penalty_evening',
        'casual_loading', 'overtime_1_5x', 'overtime_2x', 'minimum_engagement_topup',
        'on_call_allowance', 'travel_allowance', 'first_aid_allowance', 'uniform_allowance', 'laundry_allowance',
        'sleepover_allowance', 'broken_shift_allowance', 'shift_cancellation_payment', 'reversal'
    ));

COMMIT;
