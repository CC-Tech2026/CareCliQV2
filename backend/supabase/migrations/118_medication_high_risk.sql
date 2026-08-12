-- Medication Safety Addendum step 2: high-risk medication flag (APINCH categories) and the
-- photo-verification columns on the administration ledger it gates in step 3.

BEGIN;

ALTER TABLE public.medications
    ADD COLUMN IF NOT EXISTS is_high_risk BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS high_risk_category TEXT
        CHECK (high_risk_category IN (
            'anti_infective', 'potassium_electrolyte', 'insulin',
            'narcotic_opioid', 'chemotherapy', 'anticoagulant', 'other'
        ));

ALTER TABLE public.medication_administrations
    ADD COLUMN IF NOT EXISTS verification_photo_url TEXT,
    ADD COLUMN IF NOT EXISTS verification_photo_taken_at TIMESTAMPTZ;

COMMIT;
