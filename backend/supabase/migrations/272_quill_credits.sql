-- ============================================================
-- Quill credits: a monthly allowance per person, paid top-ups,
-- and a record of what every answer cost
-- ============================================================
-- Until now Quill was only rate limited (calls per minute and per day,
-- kept in memory per machine), so nothing tracked what it actually cost
-- CareCliQ or stopped one organisation using far more than its plan pays
-- for. Every answer now records its token use and its cost, and is
-- charged in credits against the asker's monthly allowance, then against
-- credits they bought. services/quill_credits.py holds the rules.
--
-- Both tables are read and written only by the API with the service
-- role (no browser access, same as migration 270). No foreign key to
-- organizations: see the migration notes on its key column.

CREATE TABLE IF NOT EXISTS public.quill_credit_usage (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL,
    user_id             uuid NOT NULL,
    thread_id           text,
    -- The first day of the allowance month this answer counted toward.
    period_start        date NOT NULL,
    provider            text,
    model               text,
    model_calls         integer NOT NULL DEFAULT 0,
    input_tokens        integer NOT NULL DEFAULT 0,
    cached_input_tokens integer NOT NULL DEFAULT 0,
    output_tokens       integer NOT NULL DEFAULT 0,
    -- What the provider charges CareCliQ, in US dollars.
    cost_usd            numeric(12, 6) NOT NULL DEFAULT 0,
    -- What the person was charged. Taken from the allowance first, then
    -- from bought credits (from_topup is the bought part).
    credits             numeric(10, 2) NOT NULL DEFAULT 0,
    from_topup          numeric(10, 2) NOT NULL DEFAULT 0,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quill_credit_usage_user_period_idx
    ON public.quill_credit_usage (user_id, period_start);
CREATE INDEX IF NOT EXISTS quill_credit_usage_org_period_idx
    ON public.quill_credit_usage (organization_id, period_start);
CREATE INDEX IF NOT EXISTS quill_credit_usage_period_idx
    ON public.quill_credit_usage (period_start);

-- One row per paid credit pack. Bought credits belong to the person who
-- bought them, are spent only once their monthly allowance is used up,
-- and last 12 months.
CREATE TABLE IF NOT EXISTS public.quill_credit_topups (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             uuid NOT NULL,
    user_id                     uuid NOT NULL,
    credits                     integer NOT NULL CHECK (credits > 0),
    amount_cents                integer NOT NULL,
    currency                    text NOT NULL DEFAULT 'aud',
    stripe_checkout_session_id  text NOT NULL UNIQUE,
    stripe_payment_intent_id    text,
    expires_at                  timestamptz NOT NULL,
    created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quill_credit_topups_user_idx
    ON public.quill_credit_topups (user_id, expires_at);

ALTER TABLE public.quill_credit_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quill_credit_topups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.quill_credit_usage FROM anon, authenticated;
REVOKE ALL ON public.quill_credit_topups FROM anon, authenticated;

-- The sums the credit check needs, in one call. Summed in the database
-- because an organisation's month can run past the 1,000-row page the
-- API returns by default.
CREATE OR REPLACE FUNCTION public.quill_credit_totals(
    p_user_id uuid,
    p_org_id uuid,
    p_period date,
    p_topup_since timestamptz
)
RETURNS TABLE (
    user_included   numeric,
    org_included    numeric,
    org_cost_usd    numeric,
    user_topup_used numeric,
    global_cost_usd numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT
        COALESCE(SUM(u.credits - u.from_topup) FILTER (WHERE u.user_id = p_user_id AND u.period_start = p_period), 0),
        COALESCE(SUM(u.credits - u.from_topup) FILTER (WHERE u.organization_id = p_org_id AND u.period_start = p_period), 0),
        COALESCE(SUM(u.cost_usd) FILTER (WHERE u.organization_id = p_org_id AND u.period_start = p_period), 0),
        COALESCE((
            SELECT SUM(t.from_topup) FROM public.quill_credit_usage t
            WHERE t.user_id = p_user_id AND p_topup_since IS NOT NULL AND t.created_at >= p_topup_since
        ), 0),
        COALESCE(SUM(u.cost_usd) FILTER (WHERE u.period_start = p_period), 0)
    FROM public.quill_credit_usage u
    WHERE u.period_start = p_period;
$$;

REVOKE ALL ON FUNCTION public.quill_credit_totals(uuid, uuid, date, timestamptz) FROM PUBLIC, anon, authenticated;
