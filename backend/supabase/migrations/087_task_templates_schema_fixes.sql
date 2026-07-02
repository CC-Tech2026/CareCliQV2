-- 087: Fix participant_task_templates schema (idempotent)
-- 1. Allow participant_id to be NULL for system/org-scoped default templates
-- 2. Replace evidence_required constraint with canonical values
-- 3. Add health_wellness + transport to category constraint
-- 4. Sync is_active from status and keep them in sync via trigger (is_active deprecated)
-- CareCliQ — Core support delivery only: Capacity Building and Capital Supports are out of scope.

BEGIN;

-- ── 1. Make participant_id nullable (system defaults have no participant) ─────
ALTER TABLE public.participant_task_templates
  ALTER COLUMN participant_id DROP NOT NULL;

-- Ensure constraint is re-creatable on reruns
ALTER TABLE public.participant_task_templates
  DROP CONSTRAINT IF EXISTS system_template_or_participant;

-- Constraint: NULL participant_id is only valid for system rows (is_custom = FALSE)
ALTER TABLE public.participant_task_templates
  ADD CONSTRAINT system_template_or_participant CHECK (
    participant_id IS NOT NULL OR is_custom = FALSE
  );

-- ── 2. Replace evidence_required constraint ───────────────────────────────────
-- Old values: photo, voice, text, photo+voice, optional
-- New values: none, photo, notes, photo_and_notes, voice, photo_and_voice

ALTER TABLE public.participant_task_templates
  DROP CONSTRAINT IF EXISTS participant_task_templates_evidence_required_check;

-- Migrate old values → canonical values (safe to rerun)
UPDATE public.participant_task_templates
SET evidence_required = 'none'
WHERE evidence_required = 'optional';

UPDATE public.participant_task_templates
SET evidence_required = 'notes'
WHERE evidence_required = 'text';

UPDATE public.participant_task_templates
SET evidence_required = 'photo_and_voice'
WHERE evidence_required = 'photo+voice';

-- Re-add canonical constraint
ALTER TABLE public.participant_task_templates
  ADD CONSTRAINT participant_task_templates_evidence_required_check
  CHECK (
    evidence_required IN (
      'none',
      'photo',
      'notes',
      'photo_and_notes',
      'voice',
      'photo_and_voice'
    )
  );

-- ── 3. Extend category constraint to include health_wellness and transport ────
ALTER TABLE public.participant_task_templates
  DROP CONSTRAINT IF EXISTS valid_category;

ALTER TABLE public.participant_task_templates
  ADD CONSTRAINT valid_category
  CHECK (
    category IS NULL OR category IN (
      'personal_care',
      'meal_prep',
      'medication',
      'community_access',
      'documentation',
      'health_wellness',
      'transport',
      'other'
    )
  );

-- ── 4. Sync is_active from status for all existing rows ──────────────────────
UPDATE public.participant_task_templates
SET is_active = (status = 'active')
WHERE is_active IS DISTINCT FROM (status = 'active');

-- Trigger function: keep is_active in sync with status going forward
CREATE OR REPLACE FUNCTION public.sync_task_template_is_active()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.is_active := (NEW.status = 'active');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_task_template_is_active
ON public.participant_task_templates;

CREATE TRIGGER trg_sync_task_template_is_active
  BEFORE INSERT OR UPDATE OF status ON public.participant_task_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_task_template_is_active();

-- ── 5. Index for org-scoped system-default queries ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_task_templates_system_defaults
  ON public.participant_task_templates (organization_id, status)
  WHERE is_custom = FALSE AND participant_id IS NULL;

COMMIT;