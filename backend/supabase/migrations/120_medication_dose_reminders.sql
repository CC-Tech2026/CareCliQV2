-- Medication Safety Addendum step 4: proactive pre-dose reminders, separate from the existing
-- overdue-dose escalation (medication_reminder_service.run_medication_reminder_pass), which
-- remains unchanged as the safety net for when this fails. This is what moves the system from
-- reactive (alerting after a dose is already missed) to catching it before it happens.
--
-- UNIQUE(medication_id, shift_id, scheduled_time) is not in the original addendum spec but is
-- required here: rows are upserted on every reminder-pass run (see
-- medication_reminder_service.evaluate_shift_medication_reminders), so nothing else prevents
-- duplicate rows for the same scheduled dose across repeated passes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.medication_dose_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medication_id UUID NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    scheduled_time TIMESTAMPTZ NOT NULL,
    reminder_sent_at TIMESTAMPTZ,
    lead_minutes INTEGER NOT NULL DEFAULT 15,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT medication_dose_reminders_unique UNIQUE (medication_id, shift_id, scheduled_time)
);

CREATE INDEX IF NOT EXISTS idx_dose_reminders_pending
    ON public.medication_dose_reminders (scheduled_time)
    WHERE reminder_sent_at IS NULL;

ALTER TABLE public.medication_dose_reminders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'medication_dose_reminders' AND policyname = 'medication_dose_reminders_service_role') THEN
        CREATE POLICY medication_dose_reminders_service_role ON public.medication_dose_reminders FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
