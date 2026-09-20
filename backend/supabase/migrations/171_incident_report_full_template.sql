-- Full 6-section incident report template (organisation's paper/PDF form) implemented
-- in the Log Incident form. Adds the fields not already covered by earlier migrations.
--
-- Already covered by existing columns (not duplicated here):
--   incident_date            -> Date/Time of Incident
--   reported_date            -> Date/Time Report Completed (server-set, read-only)
--   location                 -> Location
--   incident_type            -> Type of Incident (allowed values extended below)
--   witnesses                -> Witnesses (names and contact details)
--   participant_harmed       -> "Was the participant injured or harmed?" (057_worker_incident_reporting.sql)
--   injury_nature,
--   injury_medical_attention -> Nature of injury / medical attention (170_incident_injury_details.sql)
--   worker_actions            -> Immediate actions taken

BEGIN;

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS incident_type_other TEXT,
    ADD COLUMN IF NOT EXISTS support_workers_present TEXT,
    ADD COLUMN IF NOT EXISTS other_persons_involved TEXT,
    ADD COLUMN IF NOT EXISTS emergency_services_called TEXT
        CHECK (emergency_services_called IN ('triple_zero', 'sa_ambulance_only', 'no')),
    ADD COLUMN IF NOT EXISTS family_notified TEXT
        CHECK (family_notified IN ('yes', 'not_yet', 'not_applicable')),
    ADD COLUMN IF NOT EXISTS family_notified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS md_notified TEXT
        CHECK (md_notified IN ('yes', 'not_yet')),
    ADD COLUMN IF NOT EXISTS md_notified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reportable_categories TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS staff_declaration_name TEXT,
    ADD COLUMN IF NOT EXISTS staff_declaration_signature TEXT,
    ADD COLUMN IF NOT EXISTS staff_declaration_at TIMESTAMPTZ;

COMMENT ON COLUMN public.incidents.incident_type_other IS
    'Free-text description when incident_type = other.';
COMMENT ON COLUMN public.incidents.support_workers_present IS
    'Names of support worker(s) present at the incident (Section 2).';
COMMENT ON COLUMN public.incidents.other_persons_involved IS
    'Other persons involved: names and roles (Section 2).';
COMMENT ON COLUMN public.incidents.emergency_services_called IS
    'Section 4: triple_zero (000), sa_ambulance_only, or no.';
COMMENT ON COLUMN public.incidents.family_notified IS
    'Section 4: whether the participant''s family/representative was notified.';
COMMENT ON COLUMN public.incidents.md_notified IS
    'Section 4: whether the Managing Director was notified.';
COMMENT ON COLUMN public.incidents.reportable_categories IS
    'Section 5 checklist: subset of unexpected_death, serious_injury, abuse_neglect,
     unlawful_contact, sexual_misconduct, unauthorised_restrictive_practice, or none.
     Coordinator self-assessment; the Managing Director makes the final determination
     via the existing ndis_reportable_override mechanism (107_incident_data_model_gaps.sql).
     Ticking any category here (other than none) also sets ndis_reportable = true.';
COMMENT ON COLUMN public.incidents.staff_declaration_name IS
    'Section 6: staff member name on the declaration.';
COMMENT ON COLUMN public.incidents.staff_declaration_signature IS
    'Section 6: typed-name e-signature (or, later, a drawn/uploaded signature reference).';
COMMENT ON COLUMN public.incidents.staff_declaration_at IS
    'Section 6: server-set timestamp when the declaration was signed.';

COMMIT;
