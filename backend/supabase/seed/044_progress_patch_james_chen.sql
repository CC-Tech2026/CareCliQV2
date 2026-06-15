-- =============================================================================
-- CARECLIQV2 — Patch EXISTING James participant (works on any Supabase project)
-- Use this if 043 returned nothing / only 1 row with progress_delta NULL
--
-- Copy-paste into Supabase SQL Editor → Run
-- =============================================================================

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS progress_delta JSONB;

DO $$
DECLARE
  v_patient   uuid;
  v_org       uuid;
  v_worker    uuid;
  v_goal_id   text := 'goal_james_dressing_1';
  v_goals     jsonb;
BEGIN
  -- Find James (James Chen, James Ellis, etc.)
  SELECT id, organization_id, goals
  INTO v_patient, v_org, v_goals
  FROM public.patients
  WHERE full_name ILIKE '%James%'
  ORDER BY created_at DESC NULLS LAST
  LIMIT 1;

  IF v_patient IS NULL THEN
    RAISE EXCEPTION 'No participant named James found. Create one first or change the WHERE clause.';
  END IF;

  -- Ensure at least one dressing goal exists on the participant
  IF v_goals IS NULL OR jsonb_array_length(v_goals) = 0 THEN
    v_goals := jsonb_build_array(
      jsonb_build_object(
        'id', v_goal_id,
        'title', 'Independent dressing — shirt and pants',
        'status', 'active',
        'category', 'capacity_building'
      )
    );
  ELSE
    v_goal_id := COALESCE(v_goals->0->>'id', v_goal_id);
  END IF;

  UPDATE public.patients
  SET goals = v_goals
  WHERE id = v_patient
    AND (goals IS NULL OR jsonb_array_length(goals) = 0);

  -- Worker from latest session, else assigned_worker_id, else any org worker
  SELECT COALESCE(s.worker_id, s.support_worker_id, s.created_by)
  INTO v_worker
  FROM public.sessions s
  WHERE s.patient_id = v_patient
  ORDER BY s.session_date DESC NULLS LAST
  LIMIT 1;

  IF v_worker IS NULL THEN
    SELECT assigned_worker_id INTO v_worker FROM public.patients WHERE id = v_patient;
  END IF;

  IF v_worker IS NULL THEN
    SELECT user_id INTO v_worker
    FROM public.organization_members
    WHERE organization_id = v_org AND role = 'support_worker' AND is_active = true
    LIMIT 1;
  END IF;

  IF v_worker IS NULL THEN
    SELECT id INTO v_worker FROM public.users
    WHERE organization_id = v_org AND role = 'support_worker'
    LIMIT 1;
  END IF;

  RAISE NOTICE 'Patching participant: % | org: % | worker: % | goal: %',
    v_patient, v_org, v_worker, v_goal_id;

  -- ── Historical trajectory (5 sessions) ─────────────────────────────────────
  INSERT INTO public.sessions (
    id, patient_id, organization_id, worker_id,
    session_date, session_type, duration_minutes,
    notes, translated_english_note, compliance_input_text,
    detected_language, translation_status,
    status, compliance_score, compliance_status,
    goals_addressed, progress_delta,
    created_by, owner_user_id, updated_at
  ) VALUES
  (
    'a1000001-0000-4000-8000-000000000001'::uuid,
    v_patient, v_org, v_worker,
    now() - interval '35 days', 'daily_living', 60,
    'James required full hand-over-hand support to fasten shirt buttons. Verbal prompts given for dressing sequence.',
    'James required full hand-over-hand support to fasten shirt buttons. Verbal prompts given for dressing sequence.',
    'James required full hand-over-hand support to fasten shirt buttons. Verbal prompts given for dressing sequence.',
    'en', 'not_required',
    'completed', 87, 'compliant',
    jsonb_build_array(v_goal_id),
    jsonb_build_array(jsonb_build_object(
      'goal_id', v_goal_id,
      'prompt_level', 'full',
      'independence_rating', 1,
      'skill_step', 'button fastening',
      'delta_summary', 'James required full hand-over-hand support for shirt buttons — baseline for dressing goal.'
    )),
    v_worker, v_worker, now()
  ),
  (
    'a1000001-0000-4000-8000-000000000002'::uuid,
    v_patient, v_org, v_worker,
    now() - interval '28 days', 'daily_living', 55,
    'James attempted shirt buttons with hand-over-hand support. Needed repeated verbal prompts. Engaged throughout.',
    'James attempted shirt buttons with hand-over-hand support. Needed repeated verbal prompts. Engaged throughout.',
    'James attempted shirt buttons with hand-over-hand support. Needed repeated verbal prompts. Engaged throughout.',
    'en', 'not_required',
    'completed', 88, 'compliant',
    jsonb_build_array(v_goal_id),
    jsonb_build_array(jsonb_build_object(
      'goal_id', v_goal_id,
      'prompt_level', 'full',
      'independence_rating', 2,
      'skill_step', 'button fastening',
      'delta_summary', 'James still needed full physical prompting but showed improved engagement vs last session.'
    )),
    v_worker, v_worker, now()
  ),
  (
    'a1000001-0000-4000-8000-000000000003'::uuid,
    v_patient, v_org, v_worker,
    now() - interval '21 days', 'daily_living', 50,
    'James completed top button with partial verbal prompting. Lower buttons still required hand-over-hand.',
    'James completed top button with partial verbal prompting. Lower buttons still required hand-over-hand.',
    'James completed top button with partial verbal prompting. Lower buttons still required hand-over-hand.',
    'en', 'not_required',
    'completed', 89, 'compliant',
    jsonb_build_array(v_goal_id),
    jsonb_build_array(jsonb_build_object(
      'goal_id', v_goal_id,
      'prompt_level', 'partial',
      'independence_rating', 2,
      'skill_step', 'button fastening',
      'delta_summary', 'Improvement from full to partial prompting on top button.'
    )),
    v_worker, v_worker, now()
  ),
  (
    'a1000001-0000-4000-8000-000000000004'::uuid,
    v_patient, v_org, v_worker,
    now() - interval '14 days', 'daily_living', 45,
    'James fastened three shirt buttons with partial verbal prompts. Needed minimal touch cue for last button.',
    'James fastened three shirt buttons with partial verbal prompts. Needed minimal touch cue for last button.',
    'James fastened three shirt buttons with partial verbal prompts. Needed minimal touch cue for last button.',
    'en', 'not_required',
    'completed', 91, 'compliant',
    jsonb_build_array(v_goal_id),
    jsonb_build_array(jsonb_build_object(
      'goal_id', v_goal_id,
      'prompt_level', 'partial',
      'independence_rating', 3,
      'skill_step', 'button fastening',
      'delta_summary', 'James is completing most buttons with partial prompting — improvement from last week''s full prompting.'
    )),
    v_worker, v_worker, now()
  ),
  (
    'a1000001-0000-4000-8000-000000000005'::uuid,
    v_patient, v_org, v_worker,
    now() - interval '7 days', 'daily_living', 40,
    'James dressed independently except socks. Used visual schedule. One verbal reminder for shirt tail.',
    'James dressed independently except socks. Used visual schedule. One verbal reminder for shirt tail.',
    'James dressed independently except socks. Used visual schedule. One verbal reminder for shirt tail.',
    'en', 'not_required',
    'completed', 93, 'compliant',
    jsonb_build_array(v_goal_id),
    jsonb_build_array(jsonb_build_object(
      'goal_id', v_goal_id,
      'prompt_level', 'partial',
      'independence_rating', 4,
      'skill_step', 'full dressing sequence',
      'delta_summary', 'James now completes dressing with partial prompting only — significant improvement over five sessions.'
    )),
    v_worker, v_worker, now()
  ),
  (
    'a1000001-0000-4000-8000-000000000006'::uuid,
    v_patient, v_org, v_worker,
    now() - interval '3 days', 'daily_living', 45,
    'James previously demonstrated ability to select weather-appropriate clothing. Today chose long pants independently and explained why.',
    'James previously demonstrated ability to select weather-appropriate clothing. Today chose long pants independently and explained why.',
    'James previously demonstrated ability to select weather-appropriate clothing. Today chose long pants independently and explained why.',
    'en', 'not_required',
    'completed', 94, 'compliant',
    jsonb_build_array(v_goal_id),
    jsonb_build_array(jsonb_build_object(
      'goal_id', v_goal_id,
      'prompt_level', 'independent',
      'independence_rating', 4,
      'skill_step', 'clothing selection',
      'delta_summary', 'James independently selected appropriate clothing — high-scoring note for RAG improve.'
    )),
    v_worker, v_worker, now()
  ),
  (
    'a1000001-0000-4000-8000-000000000099'::uuid,
    v_patient, v_org, v_worker,
    now(), 'daily_living', 0,
    'James worked on dressing today. Needed some help with buttons.',
    'James worked on dressing today. Needed some help with buttons.',
    'James worked on dressing today. Needed some help with buttons.',
    'en', 'not_required',
    'draft', NULL, 'draft',
    jsonb_build_array(v_goal_id),
    NULL,
    v_worker, v_worker, now()
  )
  ON CONFLICT (id) DO UPDATE SET
    patient_id            = EXCLUDED.patient_id,
    organization_id       = EXCLUDED.organization_id,
    worker_id             = EXCLUDED.worker_id,
    session_date          = EXCLUDED.session_date,
    notes                 = EXCLUDED.notes,
    translated_english_note = EXCLUDED.notes,
    compliance_input_text   = EXCLUDED.notes,
    status                = EXCLUDED.status,
    compliance_score      = EXCLUDED.compliance_score,
    compliance_status     = EXCLUDED.compliance_status,
    goals_addressed       = EXCLUDED.goals_addressed,
    progress_delta        = EXCLUDED.progress_delta,
    updated_at            = now();

  -- Patch James Chen's existing session (your screenshot row)
  UPDATE public.sessions SET
    progress_delta = jsonb_build_array(jsonb_build_object(
      'goal_id', v_goal_id,
      'prompt_level', 'partial',
      'independence_rating', 3,
      'skill_step', 'community participation',
      'delta_summary', 'James engaged in session activities with partial prompting — documented progress toward NDIS goals.'
    )),
    goals_addressed = jsonb_build_array(v_goal_id),
    compliance_input_text = COALESCE(compliance_input_text, notes, translated_english_note),
    translated_english_note = COALESCE(translated_english_note, notes),
    status = COALESCE(NULLIF(status, ''), 'completed')
  WHERE patient_id = v_patient
    AND progress_delta IS NULL
    AND id NOT IN (
      'a1000001-0000-4000-8000-000000000001'::uuid,
      'a1000001-0000-4000-8000-000000000002'::uuid,
      'a1000001-0000-4000-8000-000000000003'::uuid,
      'a1000001-0000-4000-8000-000000000004'::uuid,
      'a1000001-0000-4000-8000-000000000005'::uuid,
      'a1000001-0000-4000-8000-000000000006'::uuid,
      'a1000001-0000-4000-8000-000000000099'::uuid
    );

  RAISE NOTICE 'Done. Draft session for live test: a1000001-0000-4000-8000-000000000099';
  RAISE NOTICE 'Participant UUID: %', v_patient;
END $$;

-- Verify
SELECT
  p.full_name,
  s.id,
  s.session_date::date,
  s.status,
  s.compliance_score,
  s.progress_delta IS NOT NULL AS has_progress_delta,
  s.progress_delta
FROM public.sessions s
JOIN public.patients p ON p.id = s.patient_id
WHERE p.full_name ILIKE '%James%'
ORDER BY s.session_date;
