-- Shift verification: reversible, and the budget charge recorded atomically.
--
-- 1. A verification can be reversed (wrong support item, wrong duration).
--    The row is kept as history — reversed_at/by/reason are set — and the
--    shift goes back into the verification queue. Only one *active*
--    verification per shift, so UNIQUE(shift_id) becomes a partial index.
--
-- 2. apply_plan_budget_change() moves plan_budgets.used_amount and writes the
--    matching budget_usage ledger row in one transaction. The app used to
--    read used_amount, add in Python and write it back (two verifications at
--    once could lose one), then insert the ledger row separately (a failure
--    left the budget charged with no ledger record). A reversal is the same
--    call with a negative amount, so the ledger stays append-only.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.shift_verifications
    ADD COLUMN IF NOT EXISTS reversed_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reversed_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

-- 078 declared shift_id UNIQUE inline, so the constraint's name was chosen by
-- Postgres; drop whichever unique constraint covers exactly (shift_id).
DO $$
DECLARE
    c TEXT;
BEGIN
    FOR c IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_attribute att
          ON att.attrelid = con.conrelid AND att.attname = 'shift_id'
        WHERE con.conrelid = 'public.shift_verifications'::regclass
          AND con.contype = 'u'
          AND con.conkey = ARRAY[att.attnum]::smallint[]
    LOOP
        EXECUTE format('ALTER TABLE public.shift_verifications DROP CONSTRAINT %I', c);
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_verifications_active_shift
    ON public.shift_verifications (shift_id)
    WHERE reversed_at IS NULL;

COMMENT ON COLUMN public.shift_verifications.reversed_at IS
    'Set when a coordinator reverses this verification; the budget charge is refunded and the shift returns to the queue.';

CREATE OR REPLACE FUNCTION public.apply_plan_budget_change(
    p_budget_id        UUID,
    p_amount           NUMERIC,
    p_category         TEXT,
    p_hourly_rate      NUMERIC,
    p_duration_minutes INTEGER,
    p_description      TEXT,
    p_verification_id  UUID,
    p_session_id       UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_plan_id  UUID;
    v_new_used NUMERIC;
BEGIN
    UPDATE public.plan_budgets
       SET used_amount = COALESCE(used_amount, 0) + p_amount
     WHERE id = p_budget_id
    RETURNING plan_id, used_amount INTO v_plan_id, v_new_used;

    IF v_plan_id IS NULL THEN
        RAISE EXCEPTION 'plan budget % not found', p_budget_id;
    END IF;

    INSERT INTO public.budget_usage
        (plan_id, session_id, category, amount, hourly_rate, duration_minutes, description, shift_verification_id)
    VALUES
        (v_plan_id, p_session_id, p_category, ROUND(p_amount, 2), ROUND(COALESCE(p_hourly_rate, 0), 2),
         COALESCE(p_duration_minutes, 0), p_description, p_verification_id);

    RETURN v_new_used;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_plan_budget_change(UUID, NUMERIC, TEXT, NUMERIC, INTEGER, TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_plan_budget_change(UUID, NUMERIC, TEXT, NUMERIC, INTEGER, TEXT, UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_plan_budget_change(UUID, NUMERIC, TEXT, NUMERIC, INTEGER, TEXT, UUID, UUID) TO service_role;

COMMIT;
