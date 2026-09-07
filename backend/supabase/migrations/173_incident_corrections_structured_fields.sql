-- incident_corrections (057_worker_incident_reporting.sql) captured only a single free-text
-- note per correction — no field name, no before value, no after value. "What did this say
-- before the correction" could only be answered by a person reading prose and comparing it to
-- the current row by eye. This adds the structured diff that was missing: which field changed,
-- its value before, and its value after. The incident row itself stays immutable (unchanged
-- from this table's original design) — incident_corrections remains the append-only history,
-- and old_value now walks that history (the prior correction's new_value for the same field,
-- if any) rather than only ever reading the original row.
--
-- note becomes optional context alongside the structured fields, which are now the actual
-- record of what changed.

BEGIN;

ALTER TABLE public.incident_corrections
    ADD COLUMN IF NOT EXISTS field_name TEXT,
    ADD COLUMN IF NOT EXISTS old_value TEXT,
    ADD COLUMN IF NOT EXISTS new_value TEXT;

ALTER TABLE public.incident_corrections
    ALTER COLUMN note DROP NOT NULL;

-- Existing rows predate these columns and are NULL here (a NULL passes a CHECK, so this
-- does not require backfilling them) — this only blocks a future insert from setting either
-- to an empty string. Actual requiredness for new corrections is enforced at the app layer
-- (IncidentCorrectionCreate in schemas/incident.py), the same way note's requiredness always
-- was before it became optional above.
ALTER TABLE public.incident_corrections
    ADD CONSTRAINT incident_corrections_field_name_not_blank
        CHECK (field_name IS NULL OR char_length(trim(field_name)) >= 1);

ALTER TABLE public.incident_corrections
    ADD CONSTRAINT incident_corrections_new_value_not_blank
        CHECK (new_value IS NULL OR char_length(new_value) >= 1);

CREATE INDEX IF NOT EXISTS idx_incident_corrections_incident_field
    ON public.incident_corrections (incident_id, field_name, created_at DESC);

COMMENT ON COLUMN public.incident_corrections.field_name IS
    'Which incident field this correction changed (see CORRECTABLE_INCIDENT_FIELDS in schemas/incident.py).';
COMMENT ON COLUMN public.incident_corrections.old_value IS
    'Effective value of field_name immediately before this correction — the original incident value, or the previous correction''s new_value if this field was corrected before.';
COMMENT ON COLUMN public.incident_corrections.new_value IS
    'Value of field_name after this correction.';

COMMIT;
