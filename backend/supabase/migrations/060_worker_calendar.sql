-- CARECLIQV2-281 — Worker calendar: confirmation status + iCal feed tokens

BEGIN;

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS confirmation_status TEXT NOT NULL DEFAULT 'confirmed';

DO $$
BEGIN
    ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_confirmation_status_check;
    ALTER TABLE public.shifts ADD CONSTRAINT shifts_confirmation_status_check
        CHECK (confirmation_status IN ('tentative', 'confirmed'));
EXCEPTION WHEN others THEN NULL;
END;
$$;

COMMENT ON COLUMN public.shifts.confirmation_status IS
    'Worker calendar display: tentative (hatched) vs confirmed (solid). CARECLIQV2-281.';

UPDATE public.shifts SET confirmation_status = 'confirmed' WHERE confirmation_status IS NULL;

CREATE TABLE IF NOT EXISTS public.worker_calendar_feed_tokens (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    token_hash      TEXT        NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_accessed_at TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    CONSTRAINT uq_worker_calendar_feed_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_worker_calendar_feed_token_hash
    ON public.worker_calendar_feed_tokens (token_hash)
    WHERE revoked_at IS NULL;

COMMIT;
