-- CARECLIQV2-116 — Demo scheduled + upcoming shifts for worker QA
-- Run after 029_shifts.sql and 031_shift_tasks.sql. Safe to re-run.

DO $$
DECLARE
  v_worker_id   uuid;
  v_org_id      uuid;
  v_patient_id  uuid;
  v_name        text;
  v_shift_today uuid := 'b2000003-0000-4000-8000-000000000001';
  v_shift_up    uuid := 'b2000004-0000-4000-8000-000000000002';
BEGIN
  SELECT u.id, u.organization_id
  INTO v_worker_id, v_org_id
  FROM public.users u
  WHERE u.role = 'support_worker'
  ORDER BY u.created_at
  LIMIT 1;

  IF v_worker_id IS NULL THEN
    RAISE NOTICE 'No support worker found — skip shift demo seed';
    RETURN;
  END IF;

  SELECT p.id, p.full_name
  INTO v_patient_id, v_name
  FROM public.patients p
  WHERE p.organization_id = v_org_id
  ORDER BY p.created_at
  LIMIT 1;

  IF v_patient_id IS NULL THEN
    RAISE NOTICE 'No patient found for org % — skip shift demo seed', v_org_id;
    RETURN;
  END IF;

  -- Ensure worker can access participant via My Clients / session APIs
  UPDATE public.patients
  SET assigned_worker_id = v_worker_id
  WHERE id = v_patient_id;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'practitioner_allocations'
  ) THEN
    INSERT INTO public.practitioner_allocations (
      patient_id, user_id, allocated_role, organization_id, assigned_by, is_active
    ) VALUES (
      v_patient_id, v_worker_id, 'support_worker', v_org_id, v_worker_id, true
    )
    ON CONFLICT (patient_id, user_id) DO UPDATE SET is_active = true;
  END IF;

  INSERT INTO public.shifts (
    id, organization_id, worker_id, participant_id,
    scheduled_start, scheduled_end,
    participant_name, participant_address, participant_phone,
    coordinator_notes, entry_instructions, health_alerts, active_goals,
    status, tasks, visit_notes, allergies, health_flags, access_instructions
  ) VALUES (
    v_shift_today,
    v_org_id,
    v_worker_id,
    v_patient_id,
    date_trunc('day', now()) + interval '2 hours',
    date_trunc('day', now()) + interval '4 hours',
    COALESCE(v_name, 'Demo Participant'),
    '42 Example Street, Adelaide SA 5000',
    '0400 000 000',
    'Please focus on morning routine and hydration today.',
    'Gate code: 1234. Park in driveway. Ring doorbell twice.',
    E'⚠️ Peanut allergy — avoid all nut products\n⛔ Risk of falls — supervise transfers',
    ARRAY['Increase independence in daily living (Daily Living)', 'Community participation (Social)'],
    'scheduled',
    '[]'::jsonb,
    'Use gait belt for transfers. Prompt morning medications with MAR chart.',
    'Peanuts, tree nuts — EpiPen in kitchen drawer',
    'Falls risk — use non-slip mat in bathroom',
    'Wheelchair ramp on left side; knock loudly — hearing aid in use'
  )
  ON CONFLICT (id) DO UPDATE SET
    worker_id = EXCLUDED.worker_id,
    scheduled_start = EXCLUDED.scheduled_start,
    scheduled_end = EXCLUDED.scheduled_end,
    coordinator_notes = EXCLUDED.coordinator_notes,
    entry_instructions = EXCLUDED.entry_instructions,
    health_alerts = EXCLUDED.health_alerts,
    visit_notes = EXCLUDED.visit_notes,
    allergies = EXCLUDED.allergies,
    health_flags = EXCLUDED.health_flags,
    access_instructions = EXCLUDED.access_instructions,
    active_goals = EXCLUDED.active_goals,
    status = 'scheduled',
    updated_at = now();

  INSERT INTO public.shifts (
    id, organization_id, worker_id, participant_id,
    scheduled_start, scheduled_end,
    participant_name, participant_address,
    coordinator_notes, status, tasks
  ) VALUES (
    v_shift_up,
    v_org_id,
    v_worker_id,
    v_patient_id,
    date_trunc('day', now()) + interval '2 days' + interval '9 hours',
    date_trunc('day', now()) + interval '2 days' + interval '11 hours',
    COALESCE(v_name, 'Demo Participant'),
    '42 Example Street, Adelaide SA 5000',
    'Afternoon community access shift.',
    'scheduled',
    '[]'::jsonb
  )
  ON CONFLICT (id) DO UPDATE SET
    worker_id = EXCLUDED.worker_id,
    scheduled_start = EXCLUDED.scheduled_start,
    scheduled_end = EXCLUDED.scheduled_end,
    status = 'scheduled',
    updated_at = now();

  RAISE NOTICE 'Demo shifts seeded for worker %', v_worker_id;
END $$;
