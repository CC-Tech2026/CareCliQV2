-- The service agreement line a shift delivers (step 3a, agreement-led shifts).
--
-- Chosen when the shift is rostered: it sets the expected NDIS item and is
-- what hours are counted against. At verification (step 3c) the line is
-- re-matched from the actual date and times, so this is the rostering
-- forecast, not a final answer.
--
-- ON DELETE SET NULL: draft agreements replace their lines on every edit,
-- but shifts only ever link to lines on sent or active agreements.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS service_agreement_support_id UUID
        REFERENCES public.service_agreement_supports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shifts_service_agreement_support
    ON public.shifts (service_agreement_support_id)
    WHERE service_agreement_support_id IS NOT NULL;

COMMENT ON COLUMN public.shifts.service_agreement_support_id IS
    'The service agreement line this shift delivers, chosen at rostering; re-matched from actual times at verification.';

-- 217's table comment said negotiated_rate would populate the organisation
-- price list. It must not: the agreed rate stays on the line.
COMMENT ON TABLE public.service_agreement_supports IS
    'One row per support line in a service agreement''s Schedule of Supports. negotiated_rate is this participant''s agreed rate for the line''s own item code and stays on the line; it is never written into ndis_price_items.';

COMMIT;
