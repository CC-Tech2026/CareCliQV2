-- =============================================================================
-- CARECLIQV2-87 / CARECLIQV2-35 — Demo shift linked to James Chen draft session
-- Run after 029_shifts.sql. Safe to re-run (upserts by fixed UUIDs).
-- =============================================================================

-- Ensure all shift columns exist (handles partial shifts table from earlier patch)
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS shift_id UUID;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS worker_id UUID;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS participant_id UUID;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMPTZ;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS clocked_in_at TIMESTAMPTZ;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS clocked_out_at TIMESTAMPTZ;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS participant_name TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS participant_dob DATE;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS participant_gender TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS participant_address TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS participant_phone TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS allergies TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS health_flags TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS health_alerts TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS visit_notes TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS access_instructions TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS coordinator_notes TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS entry_instructions TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS active_goals TEXT[];
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled';
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
DECLARE
  v_session_id  uuid := 'a1000001-0000-4000-8000-000000000099';
  v_shift_id    uuid := 'b2000002-0000-4000-8000-000000000088';
  v_patient_id  uuid;
  v_org_id      uuid;
  v_worker_id   uuid;
  v_name        text;
BEGIN
  SELECT s.patient_id, s.organization_id, s.worker_id, p.full_name
  INTO v_patient_id, v_org_id, v_worker_id, v_name
  FROM public.sessions s
  LEFT JOIN public.patients p ON p.id = s.patient_id
  WHERE s.id = v_session_id;

  IF v_org_id IS NULL THEN
    RAISE NOTICE 'Demo session % not found — skip shift seed', v_session_id;
    RETURN;
  END IF;

  INSERT INTO public.shifts (
    id, organization_id, session_id, worker_id, participant_id,
    scheduled_start, scheduled_end, clocked_in_at, clocked_out_at,
    duration_minutes, participant_name, status
  ) VALUES (
    v_shift_id,
    v_org_id,
    v_session_id,
    v_worker_id,
    v_patient_id,
    now() - interval '3 hours',
    now() - interval '1 hour',
    now() - interval '3 hours',
    now() - interval '1 hour 15 minutes',
    135,
    COALESCE(v_name, 'James Chen'),
    'completed'
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    session_id = EXCLUDED.session_id,
    worker_id = EXCLUDED.worker_id,
    participant_id = EXCLUDED.participant_id,
    clocked_in_at = EXCLUDED.clocked_in_at,
    clocked_out_at = EXCLUDED.clocked_out_at,
    duration_minutes = EXCLUDED.duration_minutes,
    status = EXCLUDED.status,
    updated_at = now();

  -- Session documents 120 min; shift actual is 135 min → 15 min (no rule)
  -- For duration_consistency_warning test: set session to 170 min (35 min deviation)
  -- For duration_consistency_error test: set session to 200 min (65 min deviation)
  UPDATE public.sessions
  SET shift_id = v_shift_id,
      duration_minutes = COALESCE(duration_minutes, 120)
  WHERE id = v_session_id;

  RAISE NOTICE 'Shift % linked to session % (shift 135 min vs session duration_minutes)', v_shift_id, v_session_id;
END $$;
