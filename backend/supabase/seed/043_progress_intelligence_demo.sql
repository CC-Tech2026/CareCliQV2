-- =============================================================================
-- CARECLIQV2 Progress Intelligence — Supabase SQL Editor seed
-- Tickets: 72, 74, 76, 78, 79, 33
--
-- HOW TO USE
--   1. Run migration 028 first (progress_delta column):
--        backend/supabase/migrations/028_progress_delta.sql
--   2. Copy this ENTIRE file into Supabase → SQL Editor → Run
--
-- MODES (pick one by uncommenting at bottom, default = Sunshine Demo extension)
--   A) Sunshine Demo (041) — uses Mia Roberts + demo logins
--   B) Any org — attaches seed to YOUR first organization + first worker
--
-- DEMO LOGINS (mode A only — from 041_demo_data.sql)
--   Coordinator: sarah@sunshine-demo.com  / Sarahsunshine#2026
--   Worker:      amara@sunshine-demo.com  / Amarasunshine#2026
--
-- TEST URLS (after seed)
--   /dev/progress-test
--   Participant ID (Mia): 30000000-0000-4000-8000-000000000001
--   Draft session (live approve): 50000000-0000-4000-8000-000000000099
-- =============================================================================

-- ── 0. Column guard ───────────────────────────────────────────────────────────
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS progress_delta JSONB;

-- ── 1. Shared helper: upsert one session with progress_delta ────────────────
CREATE OR REPLACE FUNCTION pg_temp._upsert_progress_session(
  p_id uuid,
  p_patient_id uuid,
  p_org_id uuid,
  p_worker_id uuid,
  p_session_date timestamptz,
  p_session_type text,
  p_duration int,
  p_note text,
  p_status text,
  p_compliance_score numeric,
  p_goals jsonb,
  p_progress_delta jsonb
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.sessions (
    id, patient_id, organization_id, worker_id,
    session_date, session_type, duration_minutes,
    notes, translated_english_note, compliance_input_text,
    detected_language, translation_status, translation_provider,
    translation_confidence, status, compliance_score, compliance_status,
    goals_addressed, progress_delta,
    created_by, owner_user_id, updated_at
  ) VALUES (
    p_id, p_patient_id, p_org_id, p_worker_id,
    p_session_date, p_session_type, p_duration,
    p_note, p_note, p_note,
    'en', 'not_required', 'none',
    1.0, p_status, p_compliance_score,
    CASE WHEN p_compliance_score >= 85 THEN 'compliant'
         WHEN p_compliance_score >= 60 THEN 'at_risk'
         ELSE 'non_compliant' END,
    p_goals, p_progress_delta,
    p_worker_id, p_worker_id, now()
  )
  ON CONFLICT (id) DO UPDATE SET
    patient_id           = EXCLUDED.patient_id,
    organization_id      = EXCLUDED.organization_id,
    worker_id            = EXCLUDED.worker_id,
    session_date         = EXCLUDED.session_date,
    session_type         = EXCLUDED.session_type,
    duration_minutes     = EXCLUDED.duration_minutes,
    notes                = EXCLUDED.notes,
    translated_english_note = EXCLUDED.notes,
    compliance_input_text   = EXCLUDED.notes,
    status               = EXCLUDED.status,
    compliance_score     = EXCLUDED.compliance_score,
    compliance_status    = EXCLUDED.compliance_status,
    goals_addressed      = EXCLUDED.goals_addressed,
    progress_delta       = EXCLUDED.progress_delta,
    updated_at           = now();
END;
$$;

-- =============================================================================
-- MODE A — Sunshine Demo extension (041_demo_data.sql)
-- =============================================================================
DO $$
DECLARE
  v_org    uuid := '20000000-0000-4000-8000-000000000001';
  v_worker uuid := '10000000-0000-4000-8000-000000000102';
  v_mia    uuid := '30000000-0000-4000-8000-000000000001';
  v_noah   uuid := '30000000-0000-4000-8000-000000000002';
  v_james  uuid := '30000000-0000-4000-8000-000000000010';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org) THEN
    RAISE NOTICE 'Sunshine Demo org not found — skip MODE A or run 041_demo_data.sql first.';
    RETURN;
  END IF;

  -- James Ellis — dedicated progress-trajectory participant (ticket examples)
  INSERT INTO public.patients (
    id, organization_id, full_name, ndis_number, date_of_birth,
    plan_status, plan_start_date, plan_end_date,
    total_budget, used_budget, primary_disability, goals,
    assigned_worker_id, created_by, owner_user_id
  ) VALUES (
    v_james, v_org, 'James Ellis', 'NDIS-PROG-010', '2008-03-14',
    'active', '2026-01-01', '2026-12-31',
    45000.00, 5200.00, 'Intellectual Disability',
    '[
      {"id":"goal_james_1","title":"Independent dressing — shirt and pants","status":"active","category":"capacity_building"},
      {"id":"goal_james_2","title":"Morning routine sequencing","status":"active","category":"core"}
    ]'::jsonb,
    v_worker, v_worker, v_worker
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    goals = EXCLUDED.goals,
    assigned_worker_id = EXCLUDED.assigned_worker_id,
    organization_id = EXCLUDED.organization_id;

  -- Assign James to worker (practitioner_allocations if table exists)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'practitioner_allocations'
  ) THEN
    INSERT INTO public.practitioner_allocations (
      patient_id, user_id, allocated_role, organization_id, assigned_by, is_active
    ) VALUES (
      v_james, v_worker, 'support_worker', v_org, v_worker, true
    )
    ON CONFLICT (patient_id, user_id) DO UPDATE SET is_active = true;
  END IF;

  -- ── James: 5-week dressing trajectory (for CARECLIQV2-79 prior context) ───
  PERFORM pg_temp._upsert_progress_session(
    '50000000-0000-4000-8000-000000000001', v_james, v_org, v_worker,
    now() - interval '35 days', 'daily_living', 60,
    'James required full hand-over-hand support to fasten shirt buttons. Verbal prompts given for sequence: underwear, shirt, pants. Completed with maximum assistance.',
    'completed', 87,
    '["goal_james_1"]'::jsonb,
    '[{"goal_id":"goal_james_1","prompt_level":"full","independence_rating":1,"skill_step":"button fastening","delta_summary":"James required full hand-over-hand support for shirt buttons — baseline for dressing goal."}]'::jsonb
  );

  PERFORM pg_temp._upsert_progress_session(
    '50000000-0000-4000-8000-000000000002', v_james, v_org, v_worker,
    now() - interval '28 days', 'daily_living', 55,
    'James attempted shirt buttons with hand-over-hand support. Needed repeated verbal prompts for each step. Engaged throughout session.',
    'completed', 88,
    '["goal_james_1"]'::jsonb,
    '[{"goal_id":"goal_james_1","prompt_level":"full","independence_rating":2,"skill_step":"button fastening","delta_summary":"James still needed full physical prompting but showed improved engagement compared to last session."}]'::jsonb
  );

  PERFORM pg_temp._upsert_progress_session(
    '50000000-0000-4000-8000-000000000003', v_james, v_org, v_worker,
    now() - interval '21 days', 'daily_living', 50,
    'James completed top button with partial verbal prompting only. Lower buttons still required hand-over-hand. Participant smiled when praised.',
    'completed', 89,
    '["goal_james_1"]'::jsonb,
    '[{"goal_id":"goal_james_1","prompt_level":"partial","independence_rating":2,"skill_step":"button fastening","delta_summary":"Improvement from full to partial prompting on top button — first measurable step toward independence."}]'::jsonb
  );

  PERFORM pg_temp._upsert_progress_session(
    '50000000-0000-4000-8000-000000000004', v_james, v_org, v_worker,
    now() - interval '14 days', 'daily_living', 45,
    'James fastened three shirt buttons with partial verbal prompts. Needed minimal touch cue for last button. Dressed independently except shoes.',
    'completed', 91,
    '["goal_james_1"]'::jsonb,
    '[{"goal_id":"goal_james_1","prompt_level":"partial","independence_rating":3,"skill_step":"button fastening","delta_summary":"James is now completing most buttons with partial prompting — improvement from last week''s full prompting."}]'::jsonb
  );

  PERFORM pg_temp._upsert_progress_session(
    '50000000-0000-4000-8000-000000000005', v_james, v_org, v_worker,
    now() - interval '7 days', 'daily_living', 40,
    'James dressed independently except socks. Used visual schedule. Required one verbal reminder for shirt tail. Outcome: completed routine in 18 minutes.',
    'completed', 93,
    '["goal_james_1","goal_james_2"]'::jsonb,
    '[
      {"goal_id":"goal_james_1","prompt_level":"partial","independence_rating":4,"skill_step":"full dressing sequence","delta_summary":"James now completes dressing with partial prompting only — significant improvement from prompt level 3 to 2 over five sessions."},
      {"goal_id":"goal_james_2","prompt_level":"partial","independence_rating":3,"skill_step":"morning sequence","delta_summary":"James followed visual schedule with minimal verbal cues for morning routine."}
    ]'::jsonb
  );

  -- High-scoring RAG source sessions (CARECLIQV2-33)
  PERFORM pg_temp._upsert_progress_session(
    '50000000-0000-4000-8000-000000000006', v_james, v_org, v_worker,
    now() - interval '3 days', 'daily_living', 45,
    'James previously demonstrated ability to select weather-appropriate clothing from two options. Today he chose long pants independently and explained why. Documented choice and control.',
    'completed', 94,
    '["goal_james_1"]'::jsonb,
    '[{"goal_id":"goal_james_1","prompt_level":"independent","independence_rating":4,"skill_step":"clothing selection","delta_summary":"James independently selected appropriate clothing — strong example for future note improvement RAG."}]'::jsonb
  );

  -- DRAFT session — test live approval + preview-progress (CARECLIQV2-78)
  PERFORM pg_temp._upsert_progress_session(
    '50000000-0000-4000-8000-000000000099', v_james, v_org, v_worker,
    now(), 'daily_living', 0,
    'James worked on dressing today. Needed some help with buttons.',
    'draft', NULL,
    '["goal_james_1"]'::jsonb,
    NULL
  );

  -- Low-compliance session — test RAG improve-note on session detail
  PERFORM pg_temp._upsert_progress_session(
    '50000000-0000-4000-8000-000000000098', v_james, v_org, v_worker,
    now() - interval '1 day', 'daily_living', 30,
    'Helped with dressing.',
    'completed', 58,
    '["goal_james_1"]'::jsonb,
    NULL
  );

  -- ── Mia Roberts: patch existing + add morning-routine trajectory ───────────
  IF EXISTS (SELECT 1 FROM public.patients WHERE id = v_mia) THEN
    PERFORM pg_temp._upsert_progress_session(
      '50000000-0000-4000-8000-000000000011', v_mia, v_org, v_worker,
      now() - interval '30 days', 'daily_living', 50,
      'Mia required full support to complete teeth brushing and hair brushing. Visual schedule introduced.',
      'completed', 86,
      '["goal_mia_1"]'::jsonb,
      '[{"goal_id":"goal_mia_1","prompt_level":"full","independence_rating":1,"skill_step":"morning hygiene","delta_summary":"Mia needed full support for morning hygiene tasks."}]'::jsonb
    );

    PERFORM pg_temp._upsert_progress_session(
      '50000000-0000-4000-8000-000000000012', v_mia, v_org, v_worker,
      now() - interval '15 days', 'daily_living', 45,
      'Mia brushed teeth with partial verbal prompting. Completed hair brushing with gesture cues only.',
      'completed', 88,
      '["goal_mia_1"]'::jsonb,
      '[{"goal_id":"goal_mia_1","prompt_level":"partial","independence_rating":3,"skill_step":"morning hygiene","delta_summary":"Mia moved from full to partial prompting on hygiene — morning routine improving."}]'::jsonb
    );

    -- Patch original 041 community session
    UPDATE public.sessions SET
      progress_delta = '[{"goal_id":"goal_mia_2","prompt_level":"partial","independence_rating":3,"skill_step":"community ordering","delta_summary":"Mia practised ordering lunch with partial prompting and used visual supports independently twice."}]'::jsonb,
      goals_addressed = '["goal_mia_2"]'::jsonb
    WHERE id = '40000000-0000-4000-8000-000000000001';

    UPDATE public.sessions SET
      progress_delta = '[{"goal_id":"goal_noah_1","prompt_level":"partial","independence_rating":3,"skill_step":"grasp control","delta_summary":"Noah demonstrated improved grasp control with adaptive pencil grip during OT session."}]'::jsonb
    WHERE id = '40000000-0000-4000-8000-000000000002';
  END IF;

  RAISE NOTICE 'MODE A complete — James Ellis participant: %', v_james;
  RAISE NOTICE 'Draft session for /sessions/%/live : 50000000-0000-4000-8000-000000000099', '50000000-0000-4000-8000-000000000099';
END $$;

-- =============================================================================
-- MODE B — Attach to YOUR first org (uncomment to use instead of / after A)
-- =============================================================================
/*
DO $$
DECLARE
  v_org    uuid;
  v_worker uuid;
  v_coord  uuid;
  v_patient uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at NULLS LAST LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No organization found. Create an org first or run 041_demo_data.sql';
  END IF;

  SELECT user_id INTO v_worker
  FROM public.organization_members
  WHERE organization_id = v_org AND role = 'support_worker' AND is_active = true
  LIMIT 1;

  IF v_worker IS NULL THEN
    SELECT id INTO v_worker FROM public.users
    WHERE organization_id = v_org AND role = 'support_worker' LIMIT 1;
  END IF;

  IF v_worker IS NULL THEN
    RAISE EXCEPTION 'No support worker found for org %', v_org;
  END IF;

  INSERT INTO public.patients (
    id, organization_id, full_name, ndis_number, plan_status,
    primary_disability, goals, assigned_worker_id, created_by, owner_user_id
  ) VALUES (
    v_patient, v_org, 'James Ellis (Progress Test)', 'NDIS-TEST-PROG',
    'active', 'Intellectual Disability',
    '[{"id":"goal_james_1","title":"Independent dressing","status":"active"}]'::jsonb,
    v_worker, v_worker, v_worker
  );

  PERFORM pg_temp._upsert_progress_session(
    gen_random_uuid(), v_patient, v_org, v_worker,
    now() - interval '14 days', 'daily_living', 50,
    'James required full prompting for dressing. Documented baseline.',
    'completed', 88, '["goal_james_1"]'::jsonb,
    '[{"goal_id":"goal_james_1","prompt_level":"full","independence_rating":2,"skill_step":"dressing","delta_summary":"Baseline — full prompting required."}]'::jsonb
  );

  PERFORM pg_temp._upsert_progress_session(
    gen_random_uuid(), v_patient, v_org, v_worker,
    now() - interval '7 days', 'daily_living', 45,
    'James completed dressing with partial verbal prompts only.',
    'completed', 90, '["goal_james_1"]'::jsonb,
    '[{"goal_id":"goal_james_1","prompt_level":"partial","independence_rating":3,"skill_step":"dressing","delta_summary":"Improvement from full to partial prompting."}]'::jsonb
  );

  PERFORM pg_temp._upsert_progress_session(
    gen_random_uuid(), v_patient, v_org, v_worker,
    now(), 'daily_living', 0,
    'James worked on dressing today.',
    'draft', NULL, '["goal_james_1"]'::jsonb, NULL
  );

  RAISE NOTICE 'MODE B complete — org: %, patient: %, worker: %', v_org, v_patient, v_worker;
END $$;
*/

-- ── 2. Verification query (run result in SQL editor) ──────────────────────────
SELECT
  p.full_name AS participant,
  s.id AS session_id,
  s.session_date::date,
  s.status,
  s.compliance_score,
  s.goals_addressed,
  s.progress_delta
FROM public.sessions s
JOIN public.patients p ON p.id = s.patient_id
WHERE s.id::text LIKE '50000000%'
   OR s.patient_id = '30000000-0000-4000-8000-000000000010'
ORDER BY p.full_name, s.session_date;
