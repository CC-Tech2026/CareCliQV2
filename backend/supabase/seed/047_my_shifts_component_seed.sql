-- =============================================================================
-- CARECLIQV2-277: My Shifts component test seed
-- -----------------------------------------------------------------------------
-- Purpose:
--   Seed deterministic, re-runnable data to exercise My Shifts UI components:
--   - Scheduled (risk acknowledgement)
--   - Clocked-in (ready to start session)
--   - Session active (live note + task feed + evidence)
--   - Completed (completion summary)
--   - Upcoming and cancelled list states
--   - Participant profile/preferences/context fallbacks and structured context
--
-- Safe to re-run: fixed UUIDs + upserts.
-- Recommended prerequisite: backend/supabase/seed/041_demo_data.sql
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS shift_id UUID;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS tasks JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS task_evidence JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS compliance_input_text TEXT;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS owner_user_id UUID;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS support_worker_id UUID;

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
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS tasks JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS support_instructions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS risks_acknowledged_at TIMESTAMPTZ;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS risks_acknowledged_by UUID;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled';

ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS preferred_name TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS case_manager_name TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS case_manager_phone TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS owner_user_id UUID;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS support_worker_id UUID;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS emergency_contact JSONB;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS likes_dislikes TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS sensory_preferences TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS cultural_preferences TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS preferred_activities JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS communication_guidance TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS previous_visit_notes TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS previous_visit_notes_updated_at TIMESTAMPTZ;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS current_conditions TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS behavioural_notes JSONB DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.participant_allergies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL,
    allergen TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'mild'
        CHECK (severity IN ('mild', 'moderate', 'severe', 'anaphylactic')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE
    v_org_id uuid;
    v_worker_id uuid;
    v_coordinator_id uuid;
    v_patient_id uuid;
    v_patient_name text;

    v_shift_scheduled uuid := 'b2770001-0000-4000-8000-000000000001';
    v_shift_clocked_in uuid := 'b2770001-0000-4000-8000-000000000002';
    v_shift_session_active uuid := 'b2770001-0000-4000-8000-000000000003';
    v_shift_completed uuid := 'b2770001-0000-4000-8000-000000000004';
    v_shift_upcoming uuid := 'b2770001-0000-4000-8000-000000000005';
    v_shift_cancelled uuid := 'b2770001-0000-4000-8000-000000000006';

    v_session_active uuid := 'a2770001-0000-4000-8000-000000000001';
    v_session_completed uuid := 'a2770001-0000-4000-8000-000000000002';

    v_tasks_scheduled jsonb;
    v_tasks_clocked jsonb;
    v_tasks_active jsonb;
    v_tasks_completed jsonb;
BEGIN
    INSERT INTO public.organizations (
        id, owner_user_id, organization_name, provider_type, registration_status,
        team_size, participant_volume, contact_number
    ) VALUES (
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000101',
        'Sunshine Supports Demo',
        'support_coord',
        'registered_ndis',
        '2-10',
        '1-25',
        '02 5550 2026'
    )
    ON CONFLICT (id) DO UPDATE SET
        owner_user_id = EXCLUDED.owner_user_id,
        organization_name = EXCLUDED.organization_name,
        provider_type = EXCLUDED.provider_type,
        registration_status = EXCLUDED.registration_status,
        team_size = EXCLUDED.team_size,
        participant_volume = EXCLUDED.participant_volume,
        contact_number = EXCLUDED.contact_number;

    INSERT INTO public.users (
        id, email, full_name, role, account_type, onboarding_complete,
        organization_id, is_active
    ) VALUES
      (
        '10000000-0000-4000-8000-000000000101',
        'sarah@sunshine-demo.com',
        'Sarah Mitchell',
        'support_coordinator',
        'small_provider',
        true,
        '20000000-0000-4000-8000-000000000001',
        true
      ),
      (
        '10000000-0000-4000-8000-000000000102',
        'amara@sunshine-demo.com',
        'Amara Okafor',
        'support_worker',
        'independent_worker',
        true,
        '20000000-0000-4000-8000-000000000001',
        true
      )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      account_type = EXCLUDED.account_type,
      onboarding_complete = EXCLUDED.onboarding_complete,
      organization_id = EXCLUDED.organization_id,
      is_active = EXCLUDED.is_active;

    INSERT INTO public.patients (
      id, full_name, ndis_number, date_of_birth, phone, address,
      primary_disability, organization_id, assigned_worker_id, support_worker_id,
      owner_user_id, created_by, updated_at
    ) VALUES (
      '30000000-0000-4000-8000-000000000001',
      'James Chen',
      '430123456',
      '1990-01-15',
      '0400 000 000',
      '42 Example Street, Adelaide SA 5000',
      'Intellectual disability',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000102',
      '10000000-0000-4000-8000-000000000102',
      '10000000-0000-4000-8000-000000000101',
      '10000000-0000-4000-8000-000000000101',
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      ndis_number = EXCLUDED.ndis_number,
      date_of_birth = EXCLUDED.date_of_birth,
      phone = EXCLUDED.phone,
      address = EXCLUDED.address,
      primary_disability = EXCLUDED.primary_disability,
      organization_id = EXCLUDED.organization_id,
      assigned_worker_id = EXCLUDED.assigned_worker_id,
      support_worker_id = EXCLUDED.support_worker_id,
      owner_user_id = EXCLUDED.owner_user_id,
      created_by = EXCLUDED.created_by,
      updated_at = now();

    SELECT u.id, u.organization_id
      INTO v_worker_id, v_org_id
      FROM public.users u
     WHERE u.role = 'support_worker'
     ORDER BY CASE WHEN lower(u.email) = 'amara@sunshine-demo.com' THEN 0 ELSE 1 END, u.created_at
     LIMIT 1;

    IF v_worker_id IS NULL OR v_org_id IS NULL THEN
        RAISE NOTICE 'No support worker with organization found. Run 041_demo_data.sql first.';
        RETURN;
    END IF;

    SELECT u.id
      INTO v_coordinator_id
      FROM public.users u
     WHERE u.organization_id = v_org_id
       AND u.role = 'support_coordinator'
     ORDER BY CASE WHEN lower(u.email) = 'sarah@sunshine-demo.com' THEN 0 ELSE 1 END, u.created_at
     LIMIT 1;

    SELECT p.id, p.full_name
      INTO v_patient_id, v_patient_name
      FROM public.patients p
     WHERE p.organization_id = v_org_id
     ORDER BY CASE WHEN lower(p.full_name) = 'james chen' THEN 0 ELSE 1 END, p.created_at
     LIMIT 1;

    IF v_patient_id IS NULL THEN
        RAISE NOTICE 'No patient found for org %. Seed skipped.', v_org_id;
        RETURN;
    END IF;

    UPDATE public.patients
       SET assigned_worker_id = v_worker_id,
           support_worker_id = v_worker_id,
           owner_user_id = COALESCE(owner_user_id, v_coordinator_id),
           updated_at = now()
     WHERE id = v_patient_id;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'practitioner_allocations'
    ) THEN
        INSERT INTO public.practitioner_allocations (
            patient_id, user_id, allocated_role, organization_id, assigned_by, is_active
        ) VALUES (
            v_patient_id, v_worker_id, 'support_worker', v_org_id, COALESCE(v_coordinator_id, v_worker_id), true
        )
        ON CONFLICT (patient_id, user_id)
        DO UPDATE SET
            allocated_role = EXCLUDED.allocated_role,
            organization_id = EXCLUDED.organization_id,
            is_active = true;
    END IF;

    UPDATE public.patients
       SET preferred_name = 'Jamie',
           case_manager_name = 'Alex Rivera',
           case_manager_phone = '0400 777 666',
           emergency_contact = jsonb_build_object(
               'name', 'Sam Chen',
               'phone', '0400 999 888',
               'relationship', 'Mother'
           ),
           likes_dislikes = 'Enjoys puzzles and gardening. Dislikes loud crowded spaces.',
           sensory_preferences = 'Prefers quiet spaces, dim lighting, and gradual transitions.',
           cultural_preferences = 'Prefers morning visits and tea before routines.',
           preferred_activities = '["Gardening", "Music", "Short community walks"]'::jsonb,
           communication_guidance = 'Use short prompts, one instruction at a time, and offer clear choices.',
           previous_visit_notes = 'Hydration prompts worked well. Required standby assist for bathroom transfers.',
           previous_visit_notes_updated_at = now() - interval '1 day',
           current_conditions = 'Type 2 diabetes and mild anxiety.',
           behavioural_notes = '[{"title":"Transitions","body":"Give a 10-minute warning before transitions."},{"title":"Escalation signs","body":"Pacing and reduced eye contact can indicate overwhelm."}]'::jsonb,
           updated_at = now()
     WHERE id = v_patient_id;

    INSERT INTO public.participant_allergies (id, participant_id, organization_id, allergen, severity, notes)
    VALUES
      ('c2770001-0000-4000-8000-000000000001', v_patient_id, v_org_id, 'Peanuts', 'anaphylactic', 'EpiPen in kitchen drawer.'),
      ('c2770001-0000-4000-8000-000000000002', v_patient_id, v_org_id, 'Penicillin', 'moderate', 'Rash reaction recorded.')
    ON CONFLICT (id)
    DO UPDATE SET
      participant_id = EXCLUDED.participant_id,
      organization_id = EXCLUDED.organization_id,
      allergen = EXCLUDED.allergen,
      severity = EXCLUDED.severity,
      notes = EXCLUDED.notes,
      updated_at = now();

    v_tasks_scheduled := $json$
    [
      {"task_id":"default_personal_hygiene","type":"default","label":"Personal Hygiene / Showering","description":"Assist with bathing, grooming, oral care, or personal hygiene routine.","completed":false,"completed_at":null,"checked_at":null,"note":"","context_note":"","order":1,"mandatory":true,"goal_id":"daily_living_skills","goal_title":"Develop Daily Living Skills","outcome_tip":"Participant completed hygiene routine with appropriate support."},
      {"task_id":"default_meal_prep","type":"default","label":"Meal Preparation","description":"Prepare meals, snacks, and support hydration throughout the shift.","completed":false,"completed_at":null,"checked_at":null,"note":"","context_note":"","order":2,"mandatory":true,"goal_id":"daily_living_skills","goal_title":"Develop Daily Living Skills","outcome_tip":"Meals prepared safely with participant involvement where possible."},
      {"task_id":"default_medication","type":"default","label":"Medication Administration","description":"Assist with medication as per the Medication Administration Record.","completed":false,"completed_at":null,"checked_at":null,"note":"","context_note":"","order":3,"mandatory":true,"goal_id":"health_wellbeing","goal_title":"Health & Wellbeing","outcome_tip":"Medications taken as prescribed with no adverse reactions noted."},
      {"task_id":"default_health_wellness","type":"default","label":"Health & Wellness Check","description":"Check vitals, mood, and general wellbeing.","completed":false,"completed_at":null,"checked_at":null,"note":"","context_note":"","order":4,"mandatory":false,"goal_id":"health_wellbeing","goal_title":"Health & Wellbeing","outcome_tip":"Participant wellbeing observed and any concerns documented."},
      {"task_id":"default_community_access","type":"default","label":"Community Access","description":"Outings, social, activities","completed":false,"completed_at":null,"checked_at":null,"note":"","context_note":"","order":5,"mandatory":false,"goal_id":"community_participation","goal_title":"Community Participation","outcome_tip":"Participant engaged in community activity with support as needed."},
      {"task_id":"default_documentation","type":"default","label":"Documentation / Notes","description":"Record progress notes, incidents, and participant communication.","completed":false,"completed_at":null,"checked_at":null,"note":"","context_note":"","order":6,"mandatory":true,"goal_id":"documentation_reporting","goal_title":"Documentation & Reporting","outcome_tip":"Progress notes capture what was done and participant response."}
    ]
    $json$::jsonb;

    v_tasks_clocked := jsonb_set(
        jsonb_set(v_tasks_scheduled, '{0,completed}', 'true'::jsonb),
        '{0,completed_at}', to_jsonb((now() - interval '35 minutes')::text)
    );

    v_tasks_active := $json$
    [
      {"task_id":"default_personal_hygiene","type":"default","label":"Personal Hygiene / Showering","description":"Assist with bathing, grooming, oral care, or personal hygiene routine.","completed":true,"completed_at":"NOW_MINUS_80","checked_at":"NOW_MINUS_80","evidence_status":"with_evidence","evidence_added_at":"NOW_MINUS_75","evidence_ids":["ev-277-1"],"has_photo":true,"has_voice":false,"has_text_notes":true,"note":"Completed morning hygiene with prompts.","context_note":"Participant requested extra time.","order":1,"mandatory":true,"goal_id":"daily_living_skills","goal_title":"Develop Daily Living Skills","outcome_tip":"Participant completed hygiene routine with appropriate support.","photo_thumbnails":["https://images.unsplash.com/photo-1581579438747-1dc8dcccbb50?auto=format&fit=crop&w=320&q=80"]},
      {"task_id":"default_meal_prep","type":"default","label":"Meal Preparation","description":"Prepare meals, snacks, and support hydration throughout the shift.","completed":true,"completed_at":"NOW_MINUS_60","checked_at":"NOW_MINUS_60","evidence_status":"with_evidence","evidence_added_at":"NOW_MINUS_55","evidence_ids":["ev-277-2"],"has_photo":false,"has_voice":true,"has_text_notes":true,"note":"Prepared breakfast and hydration plan.","context_note":"No allergy exposure.","order":2,"mandatory":true,"goal_id":"daily_living_skills","goal_title":"Develop Daily Living Skills","outcome_tip":"Meals prepared safely with participant involvement where possible.","voice_duration_seconds":42},
      {"task_id":"default_medication","type":"default","label":"Medication Administration","description":"Assist with medication as per the Medication Administration Record.","completed":false,"completed_at":null,"checked_at":null,"evidence_status":"without_evidence","evidence_added_at":null,"evidence_ids":[],"has_photo":false,"has_voice":false,"has_text_notes":true,"note":"Pending MAR chart prompt.","context_note":"Due at 10:30.","order":3,"mandatory":true,"goal_id":"health_wellbeing","goal_title":"Health & Wellbeing","outcome_tip":"Medications taken as prescribed with no adverse reactions noted."},
      {"task_id":"default_documentation","type":"default","label":"Documentation / Notes","description":"Record progress notes, incidents, and participant communication.","completed":false,"completed_at":null,"checked_at":null,"evidence_status":"without_evidence","evidence_added_at":null,"evidence_ids":[],"has_photo":false,"has_voice":false,"has_text_notes":false,"note":"","context_note":"Capture participant response before end shift.","order":6,"mandatory":true,"goal_id":"documentation_reporting","goal_title":"Documentation & Reporting","outcome_tip":"Progress notes capture what was done and participant response."}
    ]
    $json$::jsonb;

    v_tasks_active := replace(v_tasks_active::text, 'NOW_MINUS_80', to_char(now() - interval '80 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'))::jsonb;
    v_tasks_active := replace(v_tasks_active::text, 'NOW_MINUS_75', to_char(now() - interval '75 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'))::jsonb;
    v_tasks_active := replace(v_tasks_active::text, 'NOW_MINUS_60', to_char(now() - interval '60 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'))::jsonb;
    v_tasks_active := replace(v_tasks_active::text, 'NOW_MINUS_55', to_char(now() - interval '55 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'))::jsonb;

    v_tasks_completed := $json$
    [
      {"task_id":"default_personal_hygiene","type":"default","label":"Personal Hygiene / Showering","completed":true,"completed_at":"DONE_1","order":1,"mandatory":true},
      {"task_id":"default_meal_prep","type":"default","label":"Meal Preparation","completed":true,"completed_at":"DONE_2","order":2,"mandatory":true},
      {"task_id":"default_medication","type":"default","label":"Medication Administration","completed":true,"completed_at":"DONE_3","order":3,"mandatory":true},
      {"task_id":"default_health_wellness","type":"default","label":"Health & Wellness Check","completed":true,"completed_at":"DONE_4","order":4,"mandatory":false},
      {"task_id":"default_community_access","type":"default","label":"Community Access","completed":true,"completed_at":"DONE_5","order":5,"mandatory":false},
      {"task_id":"default_documentation","type":"default","label":"Documentation / Notes","completed":true,"completed_at":"DONE_6","order":6,"mandatory":true}
    ]
    $json$::jsonb;
    v_tasks_completed := replace(v_tasks_completed::text, 'DONE_1', to_char(now() - interval '5 hours', 'YYYY-MM-DD"T"HH24:MI:SSOF'))::jsonb;
    v_tasks_completed := replace(v_tasks_completed::text, 'DONE_2', to_char(now() - interval '4 hours 40 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'))::jsonb;
    v_tasks_completed := replace(v_tasks_completed::text, 'DONE_3', to_char(now() - interval '4 hours 10 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'))::jsonb;
    v_tasks_completed := replace(v_tasks_completed::text, 'DONE_4', to_char(now() - interval '3 hours 45 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'))::jsonb;
    v_tasks_completed := replace(v_tasks_completed::text, 'DONE_5', to_char(now() - interval '3 hours 20 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'))::jsonb;
    v_tasks_completed := replace(v_tasks_completed::text, 'DONE_6', to_char(now() - interval '2 hours 55 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'))::jsonb;

    INSERT INTO public.sessions (
        id, patient_id, organization_id, worker_id, support_worker_id, owner_user_id,
        session_date, start_time, duration_minutes, session_type, status,
        notes, compliance_input_text, task_evidence, created_at, updated_at, tasks
    ) VALUES
      (
        v_session_active, v_patient_id, v_org_id, v_worker_id, v_worker_id, COALESCE(v_coordinator_id, v_worker_id),
        now(), now() - interval '95 minutes', 110, 'support_work', 'draft',
        'Live session in progress.',
        'Worker documenting supports in real time.',
        jsonb_build_array(
            jsonb_build_object(
                'evidence_id', 'ev-277-1',
                'task_id', 'default_personal_hygiene',
                'session_id', 'a2770001-0000-4000-8000-000000000001',
                'type', 'photo',
                'content', '',
                'file_url', 'https://images.unsplash.com/photo-1581579438747-1dc8dcccbb50?auto=format&fit=crop&w=640&q=80',
                'goal_id', 'daily_living_skills',
                'created_at', to_char(now() - interval '75 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'),
                'synced', true
            ),
            jsonb_build_object(
                'evidence_id', 'ev-277-2',
                'task_id', 'default_meal_prep',
                'session_id', 'a2770001-0000-4000-8000-000000000001',
                'type', 'voice',
                'content', 'Voice summary captured.',
                'goal_id', 'daily_living_skills',
                'duration_seconds', 42,
                'created_at', to_char(now() - interval '55 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'),
                'synced', true
            )
        ),
        now() - interval '100 minutes', now() - interval '10 minutes',
        v_tasks_active
      ),
      (
        v_session_completed, v_patient_id, v_org_id, v_worker_id, v_worker_id, COALESCE(v_coordinator_id, v_worker_id),
        now() - interval '1 day', now() - interval '1 day 3 hours', 135, 'support_work', 'completed',
        'Completed shift note with outcomes documented.',
        'Participant completed planned tasks and tolerated transitions well.',
        '[]'::jsonb,
        now() - interval '1 day 4 hours', now() - interval '1 day 2 hours',
        v_tasks_completed
      )
    ON CONFLICT (id)
    DO UPDATE SET
        patient_id = EXCLUDED.patient_id,
        organization_id = EXCLUDED.organization_id,
        worker_id = EXCLUDED.worker_id,
        support_worker_id = EXCLUDED.support_worker_id,
        owner_user_id = EXCLUDED.owner_user_id,
        session_date = EXCLUDED.session_date,
        start_time = EXCLUDED.start_time,
        duration_minutes = EXCLUDED.duration_minutes,
        session_type = EXCLUDED.session_type,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        compliance_input_text = EXCLUDED.compliance_input_text,
        task_evidence = EXCLUDED.task_evidence,
        tasks = EXCLUDED.tasks,
        updated_at = now();

    INSERT INTO public.shifts (
        id, organization_id, worker_id, participant_id, session_id,
        scheduled_start, scheduled_end, clocked_in_at, clocked_out_at,
        duration_minutes, participant_name, participant_dob, participant_gender,
        participant_address, participant_phone,
        allergies, health_flags, health_alerts, visit_notes,
        access_instructions, coordinator_notes, entry_instructions,
        active_goals, status, tasks, support_instructions,
        risks_acknowledged_at, risks_acknowledged_by, created_at, updated_at
    ) VALUES
      (
        v_shift_scheduled, v_org_id, v_worker_id, v_patient_id, NULL,
        date_trunc('day', now()) + interval '8 hours',
        date_trunc('day', now()) + interval '10 hours',
        NULL, NULL,
        120, COALESCE(v_patient_name, 'Demo Participant'), '1990-01-15', 'female',
        '42 Example Street, Adelaide SA 5000', '0400 000 000',
        'Peanuts, tree nuts — EpiPen in kitchen drawer',
        'Falls risk in bathroom',
        E'⚠️ Peanut allergy — avoid nut products\n⛔ Falls risk — supervise all transfers',
        'Use gait belt for transfers and prompt hydration hourly.',
        'Wheelchair ramp on left side.',
        'Use short prompts and offer clear choices.',
        'Gate code 1234. Ring bell twice.',
        ARRAY['Daily living routine support', 'Community participation'],
        'scheduled',
        v_tasks_scheduled,
        '[{"category":"Mobility","body":"Use wheelchair ramp on left side of house.","critical":false},{"category":"Transfers","body":"⛔ Use gait belt for all transfers.","critical":true},{"category":"Medication Prompts","body":"Prompt meds using MAR chart in kitchen.","critical":false},{"category":"Personal Care","body":"⛔ Verify non-slip mat before shower.","critical":true}]'::jsonb,
        NULL, NULL,
        now() - interval '2 hours', now()
      ),
      (
        v_shift_clocked_in, v_org_id, v_worker_id, v_patient_id, NULL,
        date_trunc('day', now()) + interval '11 hours',
        date_trunc('day', now()) + interval '13 hours',
        now() - interval '40 minutes', NULL,
        120, COALESCE(v_patient_name, 'Demo Participant'), '1990-01-15', 'female',
        '42 Example Street, Adelaide SA 5000', '0400 000 000',
        'Peanuts, tree nuts',
        'Falls risk in bathroom',
        E'⚠️ Falls risk — monitor bathroom transfers',
        'Prompt routines and hydration.',
        'Use driveway and side entry.',
        'Keep tone calm and concise.',
        'Knock loudly.',
        ARRAY['Daily living routine support'],
        'in_progress',
        v_tasks_clocked,
        '[]'::jsonb,
        now() - interval '45 minutes', v_worker_id,
        now() - interval '1 hour', now()
      ),
      (
        v_shift_session_active, v_org_id, v_worker_id, v_patient_id, v_session_active,
        date_trunc('day', now()) + interval '6 hours',
        date_trunc('day', now()) + interval '9 hours',
        now() - interval '95 minutes', NULL,
        180, COALESCE(v_patient_name, 'Demo Participant'), '1990-01-15', 'female',
        '42 Example Street, Adelaide SA 5000', '0400 000 000',
        'Peanuts, tree nuts — EpiPen in kitchen drawer',
        'Anxiety spikes during fast transitions',
        E'⚠️ Anxiety escalation possible during transitions',
        'Use countdown before transitions and monitor hydration.',
        'Ramp entry only.',
        'One instruction at a time and confirm understanding.',
        'Gate code 1234.',
        ARRAY['Daily living routine support', 'Health and wellbeing'],
        'in_progress',
        v_tasks_active,
        '[{"category":"Behaviour Support","body":"Use calm redirection and offer 5-minute breaks.","critical":false},{"category":"Meals","body":"Avoid all nuts and document hydration prompts.","critical":false}]'::jsonb,
        now() - interval '96 minutes', v_worker_id,
        now() - interval '2 hours', now()
      ),
      (
        v_shift_completed, v_org_id, v_worker_id, v_patient_id, v_session_completed,
        date_trunc('day', now()) - interval '1 day' + interval '8 hours',
        date_trunc('day', now()) - interval '1 day' + interval '11 hours',
        now() - interval '1 day 3 hours', now() - interval '1 day 45 minutes',
        135, COALESCE(v_patient_name, 'Demo Participant'), '1990-01-15', 'female',
        '42 Example Street, Adelaide SA 5000', '0400 000 000',
        'Peanuts',
        'Falls risk in bathroom',
        E'⚠️ Falls risk',
        'Completed previous support plan successfully.',
        'Front door access.',
        'Document outcomes and participant response.',
        'Doorbell once.',
        ARRAY['Daily living routine support', 'Documentation and reporting'],
        'completed',
        v_tasks_completed,
        '[]'::jsonb,
        now() - interval '1 day 3 hours', v_worker_id,
        now() - interval '1 day 4 hours', now() - interval '1 day 30 minutes'
      ),
      (
        v_shift_upcoming, v_org_id, v_worker_id, v_patient_id, NULL,
        date_trunc('day', now()) + interval '2 days' + interval '9 hours',
        date_trunc('day', now()) + interval '2 days' + interval '11 hours',
        NULL, NULL,
        120, COALESCE(v_patient_name, 'Demo Participant'), '1990-01-15', 'female',
        '42 Example Street, Adelaide SA 5000', '0400 000 000',
        NULL, NULL, NULL,
        NULL, NULL,
        'Community access outing planned.',
        NULL,
        ARRAY['Community participation'],
        'scheduled',
        '[]'::jsonb,
        '[]'::jsonb,
        NULL, NULL,
        now(), now()
      ),
      (
        v_shift_cancelled, v_org_id, v_worker_id, v_patient_id, NULL,
        date_trunc('day', now()) - interval '2 days' + interval '14 hours',
        date_trunc('day', now()) - interval '2 days' + interval '16 hours',
        NULL, NULL,
        120, COALESCE(v_patient_name, 'Demo Participant'), '1990-01-15', 'female',
        '42 Example Street, Adelaide SA 5000', '0400 000 000',
        NULL, NULL, NULL,
        NULL, NULL,
        'Cancelled due to participant unwell.',
        NULL,
        ARRAY[]::text[],
        'cancelled',
        '[]'::jsonb,
        '[]'::jsonb,
        NULL, NULL,
        now(), now()
      )
    ON CONFLICT (id)
    DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        worker_id = EXCLUDED.worker_id,
        participant_id = EXCLUDED.participant_id,
        session_id = EXCLUDED.session_id,
        scheduled_start = EXCLUDED.scheduled_start,
        scheduled_end = EXCLUDED.scheduled_end,
        clocked_in_at = EXCLUDED.clocked_in_at,
        clocked_out_at = EXCLUDED.clocked_out_at,
        duration_minutes = EXCLUDED.duration_minutes,
        participant_name = EXCLUDED.participant_name,
        participant_dob = EXCLUDED.participant_dob,
        participant_gender = EXCLUDED.participant_gender,
        participant_address = EXCLUDED.participant_address,
        participant_phone = EXCLUDED.participant_phone,
        allergies = EXCLUDED.allergies,
        health_flags = EXCLUDED.health_flags,
        health_alerts = EXCLUDED.health_alerts,
        visit_notes = EXCLUDED.visit_notes,
        access_instructions = EXCLUDED.access_instructions,
        coordinator_notes = EXCLUDED.coordinator_notes,
        entry_instructions = EXCLUDED.entry_instructions,
        active_goals = EXCLUDED.active_goals,
        status = EXCLUDED.status,
        tasks = EXCLUDED.tasks,
        support_instructions = EXCLUDED.support_instructions,
        risks_acknowledged_at = EXCLUDED.risks_acknowledged_at,
        risks_acknowledged_by = EXCLUDED.risks_acknowledged_by,
        updated_at = now();

    UPDATE public.sessions
       SET shift_id = CASE id
           WHEN v_session_active THEN v_shift_session_active
           WHEN v_session_completed THEN v_shift_completed
           ELSE shift_id
       END
     WHERE id IN (v_session_active, v_session_completed);

    RAISE NOTICE 'My Shifts component seed applied for worker % in org % (patient %).', v_worker_id, v_org_id, v_patient_id;
END $$;

COMMIT;
