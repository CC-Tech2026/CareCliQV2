-- NDIS Worker Screening structured verification: a screening_number field and
-- last_checked_against_nwsd (the date a coordinator last actually confirmed the
-- worker's status on the NDIS Commission portal directly — distinct from
-- verified_at, which only means the CareCliQ record itself was approved).
-- There is no public NDIS Commission API to check against automatically, so
-- this stays a structured manual review, same shape as the existing
-- credentials.status review flow (see backend/app/api/credentials.py).

BEGIN;

ALTER TABLE public.credentials
    ADD COLUMN IF NOT EXISTS screening_number TEXT,
    ADD COLUMN IF NOT EXISTS last_checked_against_nwsd DATE;

-- Recheck reminders — mirrors medication_dose_reminders (120_medication_dose_reminders.sql):
-- one row per pending recheck, upserted on credential_id, reminder_sent_at stamped once
-- sent so repeated scheduler passes don't re-send.
CREATE TABLE IF NOT EXISTS public.ndis_screening_recheck_reminders (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    credential_id    UUID        NOT NULL REFERENCES public.credentials(id) ON DELETE CASCADE,
    due_at           TIMESTAMPTZ NOT NULL,
    reminder_sent_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ndis_screening_recheck_reminders_unique UNIQUE (credential_id)
);

CREATE INDEX IF NOT EXISTS idx_screening_recheck_pending
    ON public.ndis_screening_recheck_reminders (due_at)
    WHERE reminder_sent_at IS NULL;

ALTER TABLE public.ndis_screening_recheck_reminders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'ndis_screening_recheck_reminders'
        AND policyname = 'ndis_screening_recheck_reminders_service_role'
    ) THEN
        CREATE POLICY ndis_screening_recheck_reminders_service_role
        ON public.ndis_screening_recheck_reminders
        FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

COMMIT;
