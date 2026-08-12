-- 088: Seed system-default task templates for all existing organisations
-- These are platform-provided core support templates (is_custom = FALSE, participant_id = NULL).
-- Org-scoped queries: WHERE participant_id = $1 OR (is_custom = FALSE AND organization_id = $org)
--
-- CareCliQ supports Core supports delivery only.
-- Capacity Building and Capital Supports are out of scope for task, goal, and billing functionality.
-- These seeds reflect Core supports categories only:
--   Assistance with daily life, Social and community participation, Transport.
-- Evidence types map to the canonical set: none / photo / notes / photo_and_notes / voice / photo_and_voice


BEGIN;

-- 1) De-duplicate existing system defaults (keep earliest row per org+name)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, name
      ORDER BY created_at NULLS LAST, id
    ) AS rn
  FROM public.participant_task_templates
  WHERE is_custom = FALSE
    AND participant_id IS NULL
)
DELETE FROM public.participant_task_templates p
USING ranked r
WHERE p.id = r.id
  AND r.rn > 1;

-- 2) Enforce uniqueness for system defaults
-- This prevents race-condition duplicates across concurrent runs.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ptt_system_default_org_name
  ON public.participant_task_templates (organization_id, name)
  WHERE is_custom = FALSE AND participant_id IS NULL;

COMMIT;

-----------------------------------------------------------------------
BEGIN;

ALTER TABLE public.participant_task_templates
  DROP CONSTRAINT IF EXISTS participant_task_templates_category_check;

ALTER TABLE public.participant_task_templates
  DROP CONSTRAINT IF EXISTS valid_category;

ALTER TABLE public.participant_task_templates
  ADD CONSTRAINT participant_task_templates_category_check
  CHECK (
    category IS NULL OR category = ANY (
      ARRAY[
        'personal_care'::text,
        'meal_prep'::text,
        'medication'::text,
        'domestic_assistance'::text,
        'community_access'::text,
        'documentation'::text,
        'health_wellness'::text,
        'transport'::text,
        'other'::text
      ]
    )
  );

INSERT INTO public.participant_task_templates (
  participant_id,
  organization_id,
  created_by,
  name,
  description,
  is_mandatory,
  is_custom,
  is_active,
  status,
  category,
  evidence_required,
  primary_shift_type,
  additional_shift_types,
  recurrence_type,
  priority,
  sort_order
)
SELECT
  NULL,
  o.organization_id,
  NULL,
  t.name,
  t.description,
  t.is_mandatory,
  FALSE,
  TRUE,
  'active',
  t.category,
  t.evidence_required,
  t.primary_shift_type,
  t.additional_shift_types,
  'recurring',
  'high',
  t.sort_order
FROM public.organizations o
CROSS JOIN (VALUES
  (
    'Personal Hygiene',
    'Support participant with showering, grooming, and dressing. Observe and note level of independence.',
    TRUE,
    'personal_care',
    'none',
    'morning',
    ARRAY[]::TEXT[],
    1
  ),
  (
    'Meal Preparation',
    'Support participant to prepare or assist with meal. Record what was eaten and any dietary concerns.',
    TRUE,
    'meal_prep',
    'notes',
    'morning',
    ARRAY['afternoon']::TEXT[],
    2
  ),
  (
    'Medication Administration',
    'Administer medication per dosette box or medication chart. Photo the administration. Record time, dosage, and participant response. Escalate any refusals or reactions immediately.',
    TRUE,
    'medication',
    'photo_and_notes',
    'morning',
    ARRAY['afternoon', 'night']::TEXT[],
    3
  ),
  (
    'Health & Wellness Check',
    'Observe and record participant''s physical and emotional wellbeing at the start of shift: mood, sleep quality, any pain or discomfort, skin integrity (pressure areas), appetite, and hydration. Flag any concerns to the coordinator immediately.',
    TRUE,
    'health_wellness',
    'notes',
    'morning',
    ARRAY['afternoon']::TEXT[],
    4
  ),
  (
    'Domestic Assistance',
    'Assist with cleaning, laundry, or household tasks. Encourage participant involvement where possible.',
    FALSE,
    'domestic_assistance',
    'none',
    'afternoon',
    ARRAY[]::TEXT[],
    5
  ),
  (
    'Community Access',
    'Support participant to access community activities. Record destination, duration, participation level, and any notable interactions.',
    FALSE,
    'community_access',
    'notes',
    'afternoon',
    ARRAY[]::TEXT[],
    6
  ),
  (
    'Social Interaction Support',
    'Support participant to initiate or maintain social interactions. Record who they interacted with, for how long, and their level of confidence and engagement.',
    FALSE,
    'community_access',
    'notes',
    'afternoon',
    ARRAY[]::TEXT[],
    7
  ),
  (
    'Transport',
    'Transport participant to appointment or activity. Record destination, departure and return times.',
    FALSE,
    'transport',
    'none',
    'afternoon',
    ARRAY[]::TEXT[],
    8
  ),
  (
    'Documentation / Notes',
    'Record factual, observable shift summary. Include: participant mood, activities completed, any incidents or concerns, and goals progress if relevant. Use objective language only.',
    TRUE,
    'documentation',
    'notes',
    'morning',
    ARRAY['afternoon', 'night']::TEXT[],
    9
  ),
  (
    'Progress Note',
    'End-of-shift progress note. Summarise what was delivered, how the participant responded, and any changes from their baseline. Link to goals where relevant.',
    TRUE,
    'documentation',
    'notes',
    'morning',
    ARRAY['afternoon', 'night']::TEXT[],
    10
  )
) AS t(
  name,
  description,
  is_mandatory,
  category,
  evidence_required,
  primary_shift_type,
  additional_shift_types,
  sort_order
)
ON CONFLICT (organization_id, name)
WHERE is_custom = FALSE AND participant_id IS NULL
DO UPDATE SET
  description = EXCLUDED.description,
  is_mandatory = EXCLUDED.is_mandatory,
  is_active = EXCLUDED.is_active,
  status = EXCLUDED.status,
  category = EXCLUDED.category,
  evidence_required = EXCLUDED.evidence_required,
  primary_shift_type = EXCLUDED.primary_shift_type,
  additional_shift_types = EXCLUDED.additional_shift_types,
  recurrence_type = EXCLUDED.recurrence_type,
  priority = EXCLUDED.priority,
  sort_order = EXCLUDED.sort_order,
  updated_at = now()
RETURNING name, category, organization_id;

COMMIT;