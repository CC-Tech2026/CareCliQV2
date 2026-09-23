-- Drawn signature images (PNG data URLs) for the Service Agreement step,
-- captured with the same SignatureCanvas component used for shift sign-off.
-- Kept alongside the existing typed provider_signed_name/family_signed_name
-- (the typed name is still the record; the drawing is visual evidence).

BEGIN;

ALTER TABLE public.participant_intakes
    ADD COLUMN IF NOT EXISTS provider_signature_png TEXT,
    ADD COLUMN IF NOT EXISTS family_signature_png   TEXT;

COMMIT;
