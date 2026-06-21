-- CARECLIQV2-158 — Participant risks & acknowledgement demo seed
-- Covers all ticket alert types: allergies, legal blindness, falls risk,
-- seizures, BSP, swallowing risk.
--
-- Run after:
--   029_shifts.sql, 032_shift_risks_ack.sql, 036_participant_context.sql
--   046_scheduled_shifts_demo.sql (recommended — reuses today's demo shift)
--
-- Safe to re-run: resets risks_acknowledged_* so the ack workflow can be tested again.

DO $$
DECLARE
  v_worker_id   uuid;
  v_org_id      uuid;
  v_patient_id  uuid;
  v_shift_today uuid := 'b2000003-0000-4000-8000-000000000001';
  v_shift_up    uuid := 'b2000004-0000-4000-8000-000000000002';
  v_health_alerts text;
BEGIN
  -- Patient columns used by build_participant_risks()
  ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS behaviour_support_plan text;
  ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS medical_alerts text;
  ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS current_conditions text;

  SELECT u.id, u.organization_id
  INTO v_worker_id, v_org_id
  FROM public.users u
  WHERE u.role = 'support_worker'
  ORDER BY u.created_at
  LIMIT 1;

  IF v_worker_id IS NULL THEN
    RAISE NOTICE 'CARECLIQV2-158 seed: no support worker — skip';
    RETURN;
  END IF;

  SELECT p.id
  INTO v_patient_id
  FROM public.patients p
  WHERE p.organization_id = v_org_id
  ORDER BY p.created_at
  LIMIT 1;

  IF v_patient_id IS NULL THEN
    RAISE NOTICE 'CARECLIQV2-158 seed: no patient for org % — skip', v_org_id;
    RETURN;
  END IF;

  v_health_alerts := E'⛔ Peanut allergy — avoid all nut products. EpiPen in kitchen drawer.\n'
    || E'⚠️ Legal blindness — announce yourself when entering; do not move furniture or belongings.\n'
    || E'⛔ Falls risk — supervise all transfers; use gait belt and non-slip mat in bathroom.\n'
    || E'⚠️ Seizure disorder — follow emergency protocol; time episodes and call coordinator if >5 minutes.\n'
    || E'⚠️ Behaviour Support Plan (BSP) — use calm voice and offer breaks before redirecting.\n'
    || E'⛔ Swallowing risk — thickened fluids only; no thin liquids or unmodified food textures.';

  UPDATE public.patients
  SET
    allergies = 'Peanuts, tree nuts, sesame — anaphylactic risk',
    medical_alerts = E'⛔ Falls risk in wet areas\n⚠️ Seizure precautions — remove sharp objects from reach',
    current_conditions = E'Legal blindness\nEpilepsy — controlled with medication\nDysphagia — modified diet',
    behaviour_support_plan = E'Behaviour Support Plan (BSP)\n'
      || E'1. Offer a five-minute break when participant shows early signs of distress.\n'
      || E'2. Use short, calm sentences — avoid raised voice or sudden movements.\n'
      || E'3. Redirect to preferred activity (puzzles, music) before escalating support.\n'
      || E'4. Contact on-call coordinator if behaviour continues after two redirection attempts.',
    primary_disability = COALESCE(NULLIF(primary_disability, ''), 'Vision impairment; mobility support needs'),
    updated_at = now()
  WHERE id = v_patient_id;

  -- Structured allergies (participant_allergies — migration 036)
  DELETE FROM public.participant_allergies
  WHERE participant_id = v_patient_id
    AND organization_id = v_org_id;

  INSERT INTO public.participant_allergies (
    id, participant_id, organization_id, allergen, severity, notes
  ) VALUES
    (
      'c1580001-0000-4000-8000-000000000001',
      v_patient_id,
      v_org_id,
      'Peanuts',
      'anaphylactic',
      'EpiPen in kitchen drawer. Call 000 if reaction suspected.'
    ),
    (
      'c1580002-0000-4000-8000-000000000002',
      v_patient_id,
      v_org_id,
      'Tree nuts',
      'severe',
      'Includes almond milk and nut-based spreads.'
    ),
    (
      'c1580003-0000-4000-8000-000000000003',
      v_patient_id,
      v_org_id,
      'Sesame',
      'moderate',
      'Check bread and hummus labels.'
    )
  ON CONFLICT (id) DO UPDATE SET
    allergen = EXCLUDED.allergen,
    severity = EXCLUDED.severity,
    notes = EXCLUDED.notes,
    updated_at = now();

  -- Today's shift: full risk set, acknowledgement cleared for QA
  UPDATE public.shifts
  SET
    health_alerts = v_health_alerts,
    allergies = 'Peanuts, tree nuts, sesame — EpiPen in kitchen drawer',
    health_flags = E'Legal blindness — low vision; guide verbally not physically unless asked.\n'
      || E'Swallowing risk — IDDSI Level 3 minced & moist diet only.',
    visit_notes = 'Use gait belt for transfers. Prompt morning medications with MAR chart.',
    risks_acknowledged_at = NULL,
    risks_acknowledged_by = NULL,
    status = CASE WHEN status = 'completed' THEN status ELSE 'scheduled' END,
    clocked_in_at = CASE WHEN status = 'completed' THEN clocked_in_at ELSE NULL END,
    clocked_out_at = CASE WHEN status = 'completed' THEN clocked_out_at ELSE NULL END,
    updated_at = now()
  WHERE id = v_shift_today
    AND organization_id = v_org_id;

  IF NOT FOUND THEN
  INSERT INTO public.shifts (
    id, organization_id, worker_id, participant_id,
    scheduled_start, scheduled_end,
    participant_name, participant_address, participant_phone,
    coordinator_notes, entry_instructions, health_alerts,
    allergies, health_flags, visit_notes, active_goals, status, tasks
  )
  SELECT
    v_shift_today,
    v_org_id,
    v_worker_id,
    v_patient_id,
    date_trunc('day', now()) + interval '2 hours',
    date_trunc('day', now()) + interval '4 hours',
    p.full_name,
    '42 Example Street, Adelaide SA 5000',
    COALESCE(p.phone, '0400 000 000'),
    'Review all safety alerts before clock-in. Focus on morning routine and hydration.',
    'Gate code: 1234. Park in driveway. Ring doorbell twice.',
    v_health_alerts,
    'Peanuts, tree nuts, sesame — EpiPen in kitchen drawer',
  E'Legal blindness — low vision; guide verbally not physically unless asked.\n'
    || E'Swallowing risk — IDDSI Level 3 minced & moist diet only.',
    'Use gait belt for transfers. Prompt morning medications with MAR chart.',
    ARRAY['Increase independence in daily living (Daily Living)'],
    'scheduled',
    '[]'::jsonb
  FROM public.patients p
  WHERE p.id = v_patient_id
  ON CONFLICT (id) DO UPDATE SET
    health_alerts = EXCLUDED.health_alerts,
    allergies = EXCLUDED.allergies,
    health_flags = EXCLUDED.health_flags,
    risks_acknowledged_at = NULL,
    risks_acknowledged_by = NULL,
    updated_at = now();
  END IF;

  -- Upcoming shift: lighter alert set (still requires acknowledgement)
  UPDATE public.shifts
  SET
    health_alerts = E'⚠️ Peanut allergy — no nut products in home\n⛔ Falls risk — stand-by assist on stairs',
    allergies = 'Peanuts',
    health_flags = NULL,
    risks_acknowledged_at = NULL,
    risks_acknowledged_by = NULL,
    updated_at = now()
  WHERE id = v_shift_up
    AND organization_id = v_org_id;

  RAISE NOTICE 'CARECLIQV2-158 risks demo seeded for patient % (shift %)', v_patient_id, v_shift_today;
END $$;
