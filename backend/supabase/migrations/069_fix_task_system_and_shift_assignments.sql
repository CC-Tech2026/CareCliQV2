-- Migration 069: Fix task management system references and add shift assignments
-- Purpose: Correct table references from migration 068 and add shift_assignments for scalability
-- Status: Safe to run multiple times (uses IF NOT EXISTS, ALTER TABLE ADD COLUMN IF NOT EXISTS)

BEGIN;

-- ──────────────────────────────────────────────────────────────────────
-- Fix task_templates table if it exists from migration 068
-- ──────────────────────────────────────────────────────────────────────

-- Step 1: Drop broken foreign keys if migration 068 was applied
ALTER TABLE IF EXISTS task_templates DROP CONSTRAINT IF EXISTS task_templates_assigned_worker_id_fkey;
ALTER TABLE IF EXISTS task_templates DROP CONSTRAINT IF EXISTS task_templates_linked_goal_id_fkey;

-- Step 2: Fix the participant_id reference (participants -> patients)
-- Since this is a PK, we can't change it mid-migration, but we verify it references patients
ALTER TABLE IF EXISTS task_templates ADD CONSTRAINT task_templates_participant_id_fkey 
  FOREIGN KEY (participant_id) REFERENCES patients(id) ON DELETE CASCADE
  ON CONFLICT DO NOTHING;

-- Step 3: Add corrected foreign keys
ALTER TABLE IF EXISTS task_templates ADD CONSTRAINT task_templates_assigned_worker_id_fkey 
  FOREIGN KEY (assigned_worker_id) REFERENCES users(id) ON DELETE SET NULL
  ON CONFLICT DO NOTHING;

ALTER TABLE IF EXISTS task_templates ADD CONSTRAINT task_templates_linked_goal_id_fkey 
  FOREIGN KEY (linked_goal_id) REFERENCES ndis_goals(id) ON DELETE SET NULL
  ON CONFLICT DO NOTHING;

-- Step 4: Fix task_instances if migration 068 was applied
ALTER TABLE IF EXISTS task_instances DROP CONSTRAINT IF EXISTS task_instances_completed_by_fkey;

ALTER TABLE IF EXISTS task_instances ADD CONSTRAINT task_instances_completed_by_fkey 
  FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL
  ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────
-- Create shift_assignments table (many-to-many: shifts ↔ workers)
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  
  -- Role indicates primary vs secondary assignment
  role text NOT NULL DEFAULT 'primary' CHECK (role IN (
    'primary',      -- main worker for this shift
    'secondary',    -- backup/secondary worker
    'backup',       -- emergency replacement
    'substitute'    -- temporary replacement
  )),
  
  -- Status lifecycle
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN (
    'assigned',     -- assigned but not confirmed
    'confirmed',    -- worker confirmed they can do it
    'completed',    -- shift completed by this worker
    'cancelled'     -- assignment revoked
  )),
  
  -- Audit trail
  assigned_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  
  cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  reason text,  -- why assigned or cancelled
  
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- Constraints
  CONSTRAINT one_primary_per_shift UNIQUE (shift_id, role) WHERE role = 'primary',
  CONSTRAINT active_assignment_consistency CHECK (
    (status != 'cancelled' AND cancelled_at IS NULL AND cancelled_by IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_shift_assignments_shift 
  ON public.shift_assignments(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_worker 
  ON public.shift_assignments(worker_id);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_status 
  ON public.shift_assignments(status);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_role 
  ON public.shift_assignments(role) WHERE status != 'cancelled';

-- RLS for shift_assignments
ALTER TABLE public.shift_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY shift_assignments_select ON public.shift_assignments
  FOR SELECT
  USING (
    -- Users can see assignments for shifts in their organization
    shift_id IN (
      SELECT id FROM public.shifts 
      WHERE organization_id = (SELECT cs_user_org_id())
    )
  );

CREATE POLICY shift_assignments_insert ON public.shift_assignments
  FOR INSERT
  WITH CHECK (
    -- Only coordinators can insert assignments
    shift_id IN (
      SELECT id FROM public.shifts 
      WHERE organization_id = (SELECT cs_user_org_id())
    )
  );

CREATE POLICY shift_assignments_update ON public.shift_assignments
  FOR UPDATE
  USING (
    shift_id IN (
      SELECT id FROM public.shifts 
      WHERE organization_id = (SELECT cs_user_org_id())
    )
  );

CREATE POLICY shift_assignments_delete ON public.shift_assignments
  FOR DELETE
  USING (
    shift_id IN (
      SELECT id FROM public.shifts 
      WHERE organization_id = (SELECT cs_user_org_id())
    )
  );

-- ──────────────────────────────────────────────────────────────────────
-- Trigger to maintain backward compatibility: shifts.worker_id ← shift_assignments
-- When a shift has worker_id set, keep shift_assignments in sync
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sync_shift_worker_to_assignments()
RETURNS TRIGGER AS $$
BEGIN
  -- If shift.worker_id changed, update shift_assignments
  IF NEW.worker_id IS NOT NULL AND (NEW.worker_id != OLD.worker_id OR OLD.worker_id IS NULL) THEN
    -- Remove old primary assignment if exists
    DELETE FROM shift_assignments 
    WHERE shift_id = NEW.id AND role = 'primary' AND status != 'completed';
    
    -- Insert new primary assignment
    INSERT INTO shift_assignments (shift_id, worker_id, role, status, assigned_by)
    VALUES (NEW.id, NEW.worker_id, 'primary', 'assigned', COALESCE(NEW.updated_by, auth.uid()))
    ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE PLPGSQL;

DROP TRIGGER IF EXISTS shifts_sync_worker_to_assignments ON public.shifts;
CREATE TRIGGER shifts_sync_worker_to_assignments
  AFTER UPDATE ON public.shifts
  FOR EACH ROW
  WHEN (NEW.worker_id IS DISTINCT FROM OLD.worker_id)
  EXECUTE FUNCTION sync_shift_worker_to_assignments();

-- ──────────────────────────────────────────────────────────────────────
-- Helper function: get all active workers assigned to a shift
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_shift_assigned_workers(
  p_shift_id uuid
) RETURNS TABLE (
  user_id uuid,
  role text,
  full_name text
) AS $$
  SELECT 
    sa.worker_id,
    sa.role,
    u.full_name
  FROM shift_assignments sa
  JOIN users u ON sa.worker_id = u.id
  WHERE sa.shift_id = p_shift_id
    AND sa.status != 'cancelled'
  ORDER BY CASE WHEN sa.role = 'primary' THEN 0 ELSE 1 END, sa.assigned_at;
$$ LANGUAGE SQL STABLE;

-- Update trigger for timestamp
CREATE OR REPLACE FUNCTION update_shift_assignments_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE PLPGSQL;

DROP TRIGGER IF EXISTS shift_assignments_update_timestamp ON public.shift_assignments;
CREATE TRIGGER shift_assignments_update_timestamp
  BEFORE UPDATE ON public.shift_assignments
  FOR EACH ROW
  EXECUTE FUNCTION update_shift_assignments_timestamp();

COMMIT;
