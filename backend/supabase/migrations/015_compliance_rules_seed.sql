-- 015_compliance_rules_seed.sql
-- Extends compliance_rules with is_blocking and seeds R1–R12 rule definitions.
--
-- is_blocking = true  → a "fail" on this rule prevents status from advancing to "completed".
-- is_blocking = false → failures and warnings are stored and scored but do not hard-block saving.

ALTER TABLE public.compliance_rules
  ADD COLUMN IF NOT EXISTS is_blocking boolean NOT NULL DEFAULT false;

-- R1  is_blocking: times are required for billing integrity
-- R3  is_blocking: filler phrases or <30-word notes are genuinely invalid clinical records
-- R8  is_blocking: scope-of-practice violations are a safety and regulatory hard stop
-- R10 is_blocking: restrictive practice without a linked incident report is a regulatory violation
-- All others: scored and stored as warnings/failures but do not block saving

INSERT INTO public.compliance_rules
  (rule_code, name, description, severity, is_active, is_blocking)
VALUES
  ('R1',  'Session time and duration',
   'Start and end time are required. Duration must be present and must not exceed 8 hours without review.',
   'high',   true, true),

  ('R2',  '48-hour documentation',
   'Progress notes must be completed within 48 hours of the session date per NDIS documentation standards.',
   'high',   true, true),

  ('R3',  'Note quality',
   'Notes under 80 words or containing only generic filler phrases trigger a warning but do not block approval.',
   'medium', true, false),

  ('R4',  'Support type documented',
   'The support type and service category must be specified for every session.',
   'medium', true, true),

  ('R5',  'Goals referenced in note',
   'At least one NDIS goal must be linked and goal language must appear in the note body.',
   'high',   true, true),

  ('R6',  'Objective language',
   'Notes must use objective, observable language and must not contain first-person subjective phrasing.',
   'high',   true, true),

  ('R7',  'Person-first language',
   'Notes must use person-first language and must not contain disrespectful disability terminology.',
   'high',   true, true),

  ('R8',  'Scope of practice',
   'Support workers must not document clinical assessments, diagnoses, or medication administration.',
   'high',   true, true),

  ('R9',  'Incident triggers',
   'Notes containing incident trigger language will auto-create an incident draft for coordinator review.',
   'high',   true, false),

  ('R10', 'Restrictive practice reported',
   'Notes mentioning restrictive practices cannot be approved without a linked incident report.',
   'high',   true, true),

  ('R11', 'Note uniqueness',
   'Notes must not be excessively similar to previous notes for the same worker and participant.',
   'medium', true, false),

  ('R12', 'Participant response',
   'Notes must include language describing how the participant responded during the session.',
   'medium', true, false)

ON CONFLICT (rule_code) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  severity    = EXCLUDED.severity,
  is_active   = EXCLUDED.is_active,
  is_blocking = EXCLUDED.is_blocking;
