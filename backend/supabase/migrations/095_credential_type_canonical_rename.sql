-- Migration 095: Rename credential_type values to canonical snake_case
-- Purpose: credentials.credential_type is free text with no enum/CHECK
-- constraint. The Staff compliance table needs a fixed set of canonical
-- values to match against. Only exact conceptual matches are renamed here —
-- values with no clean equivalent (Police Check, Other, AHPRA Registration,
-- Professional Indemnity Insurance, First Aid/CPR combined, Discipline-specific
-- Certificate) are left untouched; they simply won't populate the new fixed
-- columns, same as today. No new CHECK constraint is added — credential_type
-- stays free text so "Other" and anything else org-specific keeps working.

BEGIN;

UPDATE public.credentials SET credential_type = 'ndis_screening' WHERE credential_type = 'NDIS Worker Screening';
UPDATE public.credentials SET credential_type = 'first_aid'      WHERE credential_type = 'First Aid';
UPDATE public.credentials SET credential_type = 'cpr'            WHERE credential_type = 'CPR';
UPDATE public.credentials SET credential_type = 'wwcc'           WHERE credential_type = 'Working With Children';
UPDATE public.credentials SET credential_type = 'drivers_licence' WHERE credential_type = 'Driver Licence';
UPDATE public.credentials SET credential_type = 'police_check'   WHERE credential_type = 'Police Check';

COMMIT;
