-- 6-digit mobile join codes for staff invitations

BEGIN;

ALTER TABLE public.invitations
    ADD COLUMN IF NOT EXISTS short_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_short_code_pending
    ON public.invitations (short_code)
    WHERE short_code IS NOT NULL AND accepted_at IS NULL;

COMMIT;
