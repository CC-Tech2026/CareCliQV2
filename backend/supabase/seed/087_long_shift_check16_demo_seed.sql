-- =============================================================================
-- CARECLIQ — Check 16 Long Shift Engagement demo seed
-- -----------------------------------------------------------------------------
-- New participant with full related data for UI testing Check 16:
--   • Benjamin Scott — active 5-hour in-progress shift + live session
--   • Scheduled 6-hour shift (tomorrow)
--   • Completed 6.5-hour shift with engagement audit trail
--
-- Target org:       a1111111-1111-1111-1111-111111111111
-- Worker:           97c486f6-f189-4245-92a0-c22b37d94c36
-- Coordinator:      e704e016-689d-4d93-9577-691a5ba5879b
--
-- Prerequisites:
--   • Migrations through 086_long_shift_engagement.sql applied
--     (shift_id/start_time/tasks on sessions come from earlier migrations, not 086)
--   • Worker + coordinator users exist in public.users for the org above
--
-- Safe to re-run: fixed UUIDs + ON CONFLICT upserts.
-- =============================================================================

BEGIN;

DO $$
DECLARE
    v_org_id         uuid := 'a1111111-1111-1111-1111-111111111111';
    v_worker_id      uuid := '97c486f6-f189-4245-92a0-c22b37d94c36';
    v_coordinator_id uuid := 'e704e016-689d-4d93-9577-691a5ba5879b';

    v_patient_id     uuid := 'c3000001-0000-4000-8000-000000000001';
    v_plan_id        uuid := 'c3000201-0000-4000-8000-000000000001';
    v_shift_active   uuid := 'c3000701-0000-4000-8000-000000000001';
    v_shift_sched    uuid := 'c3000702-0000-4000-8000-000000000002';
    v_shift_done     uuid := 'c3000703-0000-4000-8000-000000000003';
    v_session_active uuid := 'c3000801-0000-4000-8000-000000000001';
    v_session_done   uuid := 'c3000802-0000-4000-8000-000000000002';

    v_tasks_active   jsonb;
    v_tasks_done     jsonb;
    v_support_instr  jsonb;

    t_clock_in       timestamptz := now() - interval '5 hours';
    t_session_start  timestamptz := now() - interval '4 hours 45 minutes';
    t_last_activity  timestamptz := now() - interval '25 minutes';
    t_break_start    timestamptz := now() - interval '18 minutes';
    t_done_clock_in  timestamptz := now() - interval '8 days 6 hours';
    t_done_clock_out timestamptz := now() - interval '8 days';
BEGIN
    -- ── 1. Patient (full profile) ─────────────────────────────────────────────
    INSERT INTO public.patients (
        id, organization_id, full_name, preferred_name, ndis_number, date_of_birth,
        biological_sex, email, phone, address, address_notes,
        plan_status, plan_start_date, plan_end_date, total_budget,
        plan_management_type, primary_disability,
        current_conditions, medications, medical_alerts, allergies,
        risk_level, risk_triggers, risk_management_plan,
        emergency_contact,
        case_manager_name, case_manager_phone, case_manager_email,
        communication_preferences, communication_guidance,
        likes_dislikes, sensory_preferences, cultural_preferences, preferred_activities,
        behavioural_notes, background_summary, background_summary_updated_at,
        previous_visit_notes, previous_visit_notes_updated_at, upcoming_review_date,
        assigned_worker_id, created_by, owner_user_id, updated_at
    ) VALUES (
        v_patient_id, v_org_id,
        'Benjamin Scott', 'Ben', '4301000020', '1996-03-18', 'male',
        'benjamin.scott@example.com', '0419 552 318',
        '42 Hutt Street, Adelaide SA 5000',
        'Townhouse — visitor parking on Hutt St. Key lockbox code 2847 on meter box.',
        'active', '2026-01-01', '2026-12-31', 64000.00,
        'plan-managed',
        'Autism Spectrum Disorder',
        E'Mild ASD\nGeneralised anxiety\nRequires predictable routines and visual schedules',
        E'Sertraline 50mg — morning with breakfast\nMelatonin 2mg — nightly at 9:00 pm',
        E'⚠️ Noise sensitivity in crowded environments\nMonitor for anxiety escalation in unfamiliar settings',
        'Tree nuts — moderate GI reaction',
        'low',
        ARRAY['Sudden schedule changes', 'Crowded shopping centres', 'Unfamiliar workers'],
        E'Provide 15-minute transition warnings.\nUse visual schedules for multi-step tasks.\nOffer noise-cancelling headphones for community outings.',
        jsonb_build_object('name', 'Margaret Scott', 'phone', '0412 881 204', 'relationship', 'Mother'),
        'Priya Nair', '08 8123 4500', 'priya.nair@ndisplanmanager.com.au',
        'Clear, direct language with visual supports',
        'Use short sentences and wait for processing time. Offer written or pictorial choices.',
        'Enjoys cooking, walking along the Torrens, and quiet café visits. Dislikes strong perfumes and fluorescent lighting.',
        'Prefers natural light, quiet background music, and predictable routines.',
        'Anglo-Australian background. Enjoys AFL — supports Adelaide Crows.',
        '["Cooking with visual recipes","Torrens Linear Park walks","Central Market on quiet mornings"]'::jsonb,
        '[{"title":"Transitions","body":"Give a 15-minute warning before leaving home or changing activities."},{"title":"Anxiety","body":"Reduced eye contact and pacing may indicate overwhelm — offer a short break."}]'::jsonb,
        'Benjamin is a 30-year-old Adelaide resident building daily living independence and community confidence through structured long-shift community access supports.',
        now() - interval '4 days',
        'Previous shift: completed meal prep with visual recipe. Tolerated 5-hour community access outing well with two scheduled check-ins.',
        now() - interval '2 days',
        '2026-11-30',
        v_worker_id, v_coordinator_id, v_coordinator_id, now()
    )
    ON CONFLICT (id) DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        full_name = EXCLUDED.full_name,
        preferred_name = EXCLUDED.preferred_name,
        assigned_worker_id = EXCLUDED.assigned_worker_id,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        updated_at = now();

    -- ── 2. Practitioner allocation ──────────────────────────────────────────
    INSERT INTO public.practitioner_allocations (
        id, patient_id, user_id, allocated_role, organization_id, assigned_by, is_active
    ) VALUES (
        'c3000101-0000-4000-8000-000000000001', v_patient_id, v_worker_id,
        'support_worker', v_org_id, v_coordinator_id, true
    )
    ON CONFLICT (patient_id, user_id) DO UPDATE SET
        allocated_role = EXCLUDED.allocated_role,
        organization_id = EXCLUDED.organization_id,
        assigned_by = EXCLUDED.assigned_by,
        is_active = true;

    -- ── 3. NDIS plan + budgets ────────────────────────────────────────────────
    INSERT INTO public.ndis_plans (
        id, organization_id, patient_id, plan_number, plan_start, plan_end, total_funding, status
    ) VALUES (
        v_plan_id, v_org_id, v_patient_id, '2026-NDIS-BS-020', '2026-01-01', '2026-12-31', 64000.00, 'active'
    )
    ON CONFLICT (id) DO UPDATE SET
        patient_id = EXCLUDED.patient_id,
        plan_number = EXCLUDED.plan_number,
        total_funding = EXCLUDED.total_funding,
        status = EXCLUDED.status,
        updated_at = now();

    INSERT INTO public.plan_budgets (id, plan_id, category, allocated_amount, used_amount) VALUES
        ('c3000211-0000-4000-8000-000000000001', v_plan_id, 'core', 40000.00, 9200.00),
        ('c3000212-0000-4000-8000-000000000001', v_plan_id, 'capacity_building', 18000.00, 2100.00),
        ('c3000213-0000-4000-8000-000000000001', v_plan_id, 'capital', 6000.00, 500.00)
    ON CONFLICT (plan_id, category) DO UPDATE SET
        allocated_amount = EXCLUDED.allocated_amount,
        used_amount = EXCLUDED.used_amount;

    -- ── 4. NDIS goals ─────────────────────────────────────────────────────────
    INSERT INTO public.ndis_goals (
        id, participant_id, organization_id, plan_id, created_by,
        name, goal_area, description, target_date,
        why_it_matters, support_category, priority, status
    ) VALUES
        ('c3000301-0000-4000-8000-000000000001', v_patient_id, v_org_id, v_plan_id, v_coordinator_id,
         'Independent daily living routines', 'daily_living',
         'Follow visual schedules for personal care, meals, and domestic tasks on long community access days.',
         '2026-12-15',
         'Completes 3-step routine with visual prompts on 4 of 5 long shifts. Foundation for independent living in shared accommodation.',
         'core_daily_activities', 1, 'active'),
        ('c3000302-0000-4000-8000-000000000002', v_patient_id, v_org_id, v_plan_id, v_coordinator_id,
         'Community participation confidence', 'community',
         'Attend structured community activities during 4–6 hour supported shifts.',
         '2027-01-31',
         'Completes 2+ hour community outing without escalation on 3 consecutive long shifts. Reduces social isolation.',
         'core_social_community', 2, 'active')
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status, updated_at = now();

    -- ── 5. Participant tasks ──────────────────────────────────────────────────
    INSERT INTO public.participant_tasks (
        id, participant_id, goal_id, organization_id, created_by,
        name, description, frequency, shift_type, category, priority,
        support_category, evidence_required, is_mandatory, status
    ) VALUES
        ('c3000401-0000-4000-8000-000000000001', v_patient_id, 'c3000301-0000-4000-8000-000000000001', v_org_id, v_coordinator_id,
         'Morning personal care and meal prep', 'Use visual recipe card. Document prompting level.', 'each_shift', 'morning', 'personal_care', 'high', 'core_daily_activities', 'notes', true, 'pending'),
        ('c3000402-0000-4000-8000-000000000002', v_patient_id, 'c3000302-0000-4000-8000-000000000002', v_org_id, v_coordinator_id,
         'Torrens Linear Park community walk', 'Quiet morning walk. Note engagement and anxiety signs.', 'weekly', 'morning', 'community_access', 'medium', 'core_social_community', 'photo', false, 'pending')
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status, updated_at = now();

    -- ── 6. Allergies + briefing alerts ────────────────────────────────────────
    INSERT INTO public.participant_allergies (id, participant_id, organization_id, allergen, severity, notes) VALUES
        ('c3000501-0000-4000-8000-000000000001', v_patient_id, v_org_id, 'Tree nuts', 'moderate', 'Avoid shared nut products in meal prep.'),
        ('c3000502-0000-4000-8000-000000000002', v_patient_id, v_org_id, 'Latex', 'mild', 'Use nitrile gloves for personal care.')
    ON CONFLICT (id) DO UPDATE SET allergen = EXCLUDED.allergen, severity = EXCLUDED.severity, notes = EXCLUDED.notes, updated_at = now();

    INSERT INTO public.participant_briefing_alerts (id, participant_id, organization_id, alert_text, sort_order, is_active) VALUES
        ('c3000601-0000-4000-8000-000000000001', v_patient_id, v_org_id, '⚠️ Tree nut allergy — check all meal ingredients.', 0, true),
        ('c3000602-0000-4000-8000-000000000002', v_patient_id, v_org_id, 'Give 15-minute transition warnings before leaving home.', 1, true),
        ('c3000603-0000-4000-8000-000000000003', v_patient_id, v_org_id, 'Long shifts (4h+): complete check-ins every 90 minutes per org policy.', 2, true)
    ON CONFLICT (id) DO UPDATE SET alert_text = EXCLUDED.alert_text, sort_order = EXCLUDED.sort_order, is_active = EXCLUDED.is_active, updated_at = now();

    -- ── 7. Shift task JSON ────────────────────────────────────────────────────
    v_tasks_active := jsonb_build_array(
        jsonb_build_object('task_id','default_personal_hygiene','type','default','label','Personal Hygiene / Showering',
            'description','Assist with bathing, grooming, oral care.','completed',true,
            'completed_at', (t_session_start - interval '15 minutes')::text,
            'checked_at', (t_session_start - interval '15 minutes')::text,
            'note','Completed with verbal prompts.','order',1,'mandatory',true,
            'goal_id','c3000301-0000-4000-8000-000000000001','goal_title','Independent daily living routines'),
        jsonb_build_object('task_id','default_meal_prep','type','default','label','Meal Preparation',
            'description','Prepare breakfast and lunch using visual recipe.','completed',true,
            'completed_at', (t_session_start + interval '30 minutes')::text,
            'checked_at', (t_session_start + interval '30 minutes')::text,
            'note','Visual recipe followed. No nut exposure.','order',2,'mandatory',true,
            'goal_id','c3000301-0000-4000-8000-000000000001','goal_title','Independent daily living routines'),
        jsonb_build_object('task_id','default_community_access','type','default','label','Community Access',
            'description','Torrens walk and quiet café visit.','completed',false,
            'order',3,'mandatory',false,
            'goal_id','c3000302-0000-4000-8000-000000000002','goal_title','Community participation confidence'),
        jsonb_build_object('task_id','default_documentation','type','default','label','Documentation / Notes',
            'description','Record progress notes and check-ins.','completed',false,
            'order',4,'mandatory',true,
            'goal_id','c3000301-0000-4000-8000-000000000001','goal_title','Independent daily living routines')
    );

    v_tasks_done := jsonb_build_array(
        jsonb_build_object('task_id','default_personal_hygiene','type','default','label','Personal Hygiene','completed',true,'order',1,'mandatory',true),
        jsonb_build_object('task_id','default_meal_prep','type','default','label','Meal Preparation','completed',true,'order',2,'mandatory',true),
        jsonb_build_object('task_id','default_community_access','type','default','label','Community Access','completed',true,'order',3,'mandatory',false),
        jsonb_build_object('task_id','default_documentation','type','default','label','Documentation','completed',true,'order',4,'mandatory',true)
    );

    v_support_instr := jsonb_build_array(
        jsonb_build_object('category','Entry','body','Key lockbox code 2847 on meter box at front fence.','critical',true),
        jsonb_build_object('category','Meal support','body','Visual recipe cards in kitchen drawer — top shelf.','critical',false),
        jsonb_build_object('category','Community','body','Noise-cancelling headphones in living room cupboard if needed.','critical',false)
    );

    -- ── 8. Sessions (insert before shifts — shift_id linked after shifts exist) ─
    INSERT INTO public.sessions (
        id, patient_id, organization_id, worker_id, created_by, owner_user_id,
        session_date, start_time, session_type, duration_minutes, status,
        notes, compliance_input_text, translation_status,
        goals_addressed, support_category,
        tasks, is_long_shift, last_activity_at, max_gap_secs, checkin_count,
        break_duration_secs, billable_duration_secs, engagement_score
    ) VALUES (
        v_session_active, v_patient_id, v_org_id, v_worker_id, v_worker_id, v_worker_id,
        t_session_start, t_session_start, 'daily_living', 300, 'draft',
        'Benjamin engaged well during morning personal care and meal preparation. Community outing planned after break.',
        'Benjamin engaged well during morning personal care and meal preparation. Community outing planned after break.',
        'not_required',
        '["c3000301-0000-4000-8000-000000000001","c3000302-0000-4000-8000-000000000002"]'::jsonb, 'core_daily_activities',
        v_tasks_active, true, t_last_activity, 2700, 2,
        0, 16800, 83
    )
    ON CONFLICT (id) DO UPDATE SET
        start_time = EXCLUDED.start_time,
        status = EXCLUDED.status,
        tasks = EXCLUDED.tasks,
        is_long_shift = EXCLUDED.is_long_shift,
        last_activity_at = EXCLUDED.last_activity_at,
        max_gap_secs = EXCLUDED.max_gap_secs,
        checkin_count = EXCLUDED.checkin_count,
        break_duration_secs = EXCLUDED.break_duration_secs,
        billable_duration_secs = EXCLUDED.billable_duration_secs,
        engagement_score = EXCLUDED.engagement_score,
        updated_at = now();

    -- ── 9. Completed session (audit / compliance reference) ───────────────────
    INSERT INTO public.sessions (
        id, patient_id, organization_id, worker_id, created_by, owner_user_id,
        session_date, start_time, session_type, duration_minutes, status,
        notes, compliance_input_text, translated_english_note, translation_status,
        compliance_score, compliance_status,
        goals_addressed, support_category,
        is_long_shift, last_activity_at, max_gap_secs, checkin_count,
        break_duration_secs, billable_duration_secs, engagement_score
    ) VALUES (
        v_session_done, v_patient_id, v_org_id, v_worker_id, v_worker_id, v_worker_id,
        t_done_clock_in, t_done_clock_in, 'community_access', 390, 'completed',
        'Benjamin completed a 6.5-hour community access shift with structured check-ins and one compliant break. Minor anxiety noted during crowded market section — de-escalated with headphones.',
        'Benjamin completed a 6.5-hour community access shift with structured check-ins and one compliant break. Minor anxiety noted during crowded market section — de-escalated with headphones.',
        'Benjamin completed a 6.5-hour community access shift with structured check-ins and one compliant break. Minor anxiety noted during crowded market section — de-escalated with headphones.',
        'not_required', 78, 'at_risk',
        '["c3000301-0000-4000-8000-000000000001","c3000302-0000-4000-8000-000000000002"]'::jsonb, 'core_social_community',
        true, t_done_clock_out - interval '20 minutes', 5400, 3,
        1200, 22200, 72
    )
    ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        compliance_score = EXCLUDED.compliance_score,
        compliance_status = EXCLUDED.compliance_status,
        is_long_shift = EXCLUDED.is_long_shift,
        engagement_score = EXCLUDED.engagement_score,
        updated_at = now();

    -- ── 10. Shifts ────────────────────────────────────────────────────────────
    INSERT INTO public.shifts (
        id, organization_id, worker_id, participant_id, session_id,
        scheduled_start, scheduled_end, clocked_in_at, clocked_out_at, duration_minutes,
        participant_name, participant_dob, participant_gender,
        participant_address, participant_phone,
        allergies, health_flags, health_alerts, visit_notes,
        access_instructions, coordinator_notes, entry_instructions,
        active_goals, special_instructions, status, tasks, support_instructions,
        risks_acknowledged_at, risks_acknowledged_by
    ) VALUES
        -- ACTIVE: 5 hours in, session live (primary UI test)
        (
            v_shift_active, v_org_id, v_worker_id, v_patient_id, v_session_active,
            t_clock_in, t_clock_in + interval '6 hours',
            t_clock_in, NULL, NULL,
            'Benjamin Scott', '1996-03-18', 'male',
            '42 Hutt Street, Adelaide SA 5000', '0419 552 318',
            'Tree nuts, Latex',
            'Noise sensitivity; requires visual schedules',
            E'⚠️ Tree nut allergy\nGive 15-minute transition warnings\nComplete 90-min check-ins on long shifts',
            'Morning routine complete. Community outing after break.',
            'Key lockbox 2847 on front fence meter box.',
            'Check 16 long shift — monitor engagement on coordinator live dashboard.',
            'Enter via front door. Lockbox on left side of meter box.',
            ARRAY['Independent daily living routines (Daily Living)', 'Community participation confidence (Community)'],
            'Use visual recipe for meal prep. Complete check-ins every 90 minutes.',
            'in_progress', v_tasks_active, v_support_instr,
            t_clock_in - interval '10 minutes', v_worker_id
        ),
        -- SCHEDULED: tomorrow 6-hour shift
        (
            v_shift_sched, v_org_id, v_worker_id, v_patient_id, NULL,
            date_trunc('day', now() AT TIME ZONE 'Australia/Adelaide') AT TIME ZONE 'Australia/Adelaide' + interval '1 day 8 hours',
            date_trunc('day', now() AT TIME ZONE 'Australia/Adelaide') AT TIME ZONE 'Australia/Adelaide' + interval '1 day 14 hours',
            NULL, NULL, NULL,
            'Benjamin Scott', '1996-03-18', 'male',
            '42 Hutt Street, Adelaide SA 5000', '0419 552 318',
            'Tree nuts, Latex', 'Noise sensitivity', E'⚠️ Tree nut allergy\n15-minute transition warnings',
            'Planned: Central Market quiet morning + meal prep.',
            'Key lockbox 2847.', 'Acknowledge briefing alerts before clock-in.',
            'Standard front entry.', ARRAY['Independent daily living routines', 'Community participation confidence'],
            '6-hour community access — check-ins required.', 'scheduled', '[]'::jsonb, v_support_instr,
            NULL, NULL
        ),
        -- COMPLETED: 6.5-hour shift with engagement history
        (
            v_shift_done, v_org_id, v_worker_id, v_patient_id, v_session_done,
            t_done_clock_in, t_done_clock_out,
            t_done_clock_in, t_done_clock_out, 390,
            'Benjamin Scott', '1996-03-18', 'male',
            '42 Hutt Street, Adelaide SA 5000', '0419 552 318',
            'Tree nuts', 'Anxiety in crowds', E'⚠️ Tree nut allergy',
            'Completed long community access shift.',
            'Key lockbox 2847.', 'Review engagement score in audit pack.',
            'Front door.', ARRAY['Independent daily living routines', 'Community participation confidence'],
            '6.5-hour shift completed.', 'completed', v_tasks_done, v_support_instr,
            t_done_clock_in - interval '15 minutes', v_worker_id
        )
    ON CONFLICT (id) DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        worker_id = EXCLUDED.worker_id,
        participant_id = EXCLUDED.participant_id,
        session_id = EXCLUDED.session_id,
        scheduled_start = EXCLUDED.scheduled_start,
        scheduled_end = EXCLUDED.scheduled_end,
        clocked_in_at = EXCLUDED.clocked_in_at,
        clocked_out_at = EXCLUDED.clocked_out_at,
        duration_minutes = EXCLUDED.duration_minutes,
        status = EXCLUDED.status,
        tasks = EXCLUDED.tasks,
        support_instructions = EXCLUDED.support_instructions,
        risks_acknowledged_at = EXCLUDED.risks_acknowledged_at,
        risks_acknowledged_by = EXCLUDED.risks_acknowledged_by,
        updated_at = now();

    -- Link sessions ↔ shifts (sessions.shift_id FK requires shifts to exist first)
    UPDATE public.sessions SET shift_id = v_shift_active, updated_at = now()
     WHERE id = v_session_active;
    UPDATE public.sessions SET shift_id = v_shift_done, updated_at = now()
     WHERE id = v_session_done;

    -- ── 11. Visit notes (active session) ──────────────────────────────────────
    INSERT INTO public.shift_visit_notes (
        id, organization_id, shift_id, worker_id, session_id,
        content, category, created_at, updated_at
    ) VALUES (
        'c3000901-0000-4000-8000-000000000001', v_org_id, v_shift_active, v_worker_id, v_session_active,
        'Benjamin completed morning hygiene with two verbal prompts. Mood calm and cooperative.',
        'session_progress', t_session_start + interval '20 minutes', now()
    )
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = now();

    -- ── 12. Long shift engagement — activity events (active session) ──────────
    DELETE FROM public.shift_activity_events WHERE shift_id IN (v_shift_active, v_shift_done);
    DELETE FROM public.shift_checkins WHERE shift_id IN (v_shift_active, v_shift_done);
    DELETE FROM public.shift_breaks WHERE shift_id IN (v_shift_active, v_shift_done);

    INSERT INTO public.shift_activity_events (
        id, session_id, shift_id, event_type, occurred_at, worker_id, patient_id,
        metadata, is_billable, gap_before_secs
    ) VALUES
        ('c3000a01-0000-4000-8000-000000000001', NULL,              v_shift_active, 'CLOCK_IN',     t_clock_in,                              v_worker_id, v_patient_id, '{}'::jsonb, true, 0),
        ('c3000a02-0000-4000-8000-000000000002', v_session_active, v_shift_active, 'NOTE_SAVED',   t_session_start,                         v_worker_id, v_patient_id, '{"note_type":"session_start"}'::jsonb, true, 900),
        ('c3000a03-0000-4000-8000-000000000003', v_session_active, v_shift_active, 'TASK_TICKED',  t_session_start + interval '15 minutes', v_worker_id, v_patient_id, '{"task_id":"default_personal_hygiene"}'::jsonb, true, 900),
        ('c3000a04-0000-4000-8000-000000000004', v_session_active, v_shift_active, 'CHECK_IN',     t_session_start + interval '90 minutes', v_worker_id, v_patient_id, '{"status":"GOING_WELL"}'::jsonb, true, 4500),
        ('c3000a05-0000-4000-8000-000000000005', v_session_active, v_shift_active, 'NOTE_SAVED',   t_session_start + interval '2 hours',    v_worker_id, v_patient_id, '{"note_type":"meal_prep"}'::jsonb, true, 1800),
        ('c3000a08-0000-4000-8000-000000000008', v_session_active, v_shift_active, 'CHECK_IN',     t_session_start + interval '3 hours',    v_worker_id, v_patient_id, '{"status":"GOING_WELL"}'::jsonb, true, 600),
        ('c3000a09-0000-4000-8000-000000000009', v_session_active, v_shift_active, 'TASK_TICKED',  t_session_start + interval '3 hours 30 minutes', v_worker_id, v_patient_id, '{"task_id":"default_meal_prep"}'::jsonb, true, 1800),
        ('c3000a0a-0000-4000-8000-000000000010', v_session_active, v_shift_active, 'NOTE_SAVED',   t_last_activity,                         v_worker_id, v_patient_id, '{"note_type":"progress"}'::jsonb, true, 1500),
        ('c3000a0b-0000-4000-8000-000000000011', v_session_active, v_shift_active, 'BREAK_START',  t_break_start,                           v_worker_id, v_patient_id, '{"active":true}'::jsonb, false, 900);

    -- ── 13. Check-ins (active) ────────────────────────────────────────────────
    INSERT INTO public.shift_checkins (
        id, session_id, shift_id, worker_id, patient_id, status, note,
        prompt_triggered_at, submitted_at, response_time_secs, gap_at_prompt_secs, coordinator_notified
    ) VALUES
        ('c3000b01-0000-4000-8000-000000000001', v_session_active, v_shift_active, v_worker_id, v_patient_id,
         'GOING_WELL', 'Benjamin calm and engaged after morning routine.',
         t_session_start + interval '85 minutes', t_session_start + interval '90 minutes', 300, 5100, false),
        ('c3000b02-0000-4000-8000-000000000002', v_session_active, v_shift_active, v_worker_id, v_patient_id,
         'GOING_WELL', 'Post-break check-in — ready for community outing.',
         t_session_start + interval '175 minutes', t_session_start + interval '3 hours', 300, 600, false);

    -- ── 14. Break (active — in progress ~18 min for UI demo) ─────────────────
    INSERT INTO public.shift_breaks (
        id, session_id, shift_id, worker_id,
        break_start_at, break_end_at, duration_secs, is_compliant, break_number
    ) VALUES (
        'c3000c01-0000-4000-8000-000000000001', v_session_active, v_shift_active, v_worker_id,
        t_break_start,
        NULL, NULL, NULL, 1
    );

    -- ── 15. Completed shift engagement snapshot ───────────────────────────────
    INSERT INTO public.shift_activity_events (
        id, session_id, shift_id, event_type, occurred_at, worker_id, patient_id,
        metadata, is_billable, gap_before_secs
    ) VALUES
        ('c3000d01-0000-4000-8000-000000000001', v_session_done, v_shift_done, 'CLOCK_IN',    t_done_clock_in, v_worker_id, v_patient_id, '{}'::jsonb, true, 0),
        ('c3000d02-0000-4000-8000-000000000002', v_session_done, v_shift_done, 'CHECK_IN',    t_done_clock_in + interval '90 minutes', v_worker_id, v_patient_id, '{"status":"GOING_WELL"}'::jsonb, true, 5400),
        ('c3000d03-0000-4000-8000-000000000003', v_session_done, v_shift_done, 'BREAK_START', t_done_clock_in + interval '3 hours', v_worker_id, v_patient_id, '{}'::jsonb, false, 5400),
        ('c3000d04-0000-4000-8000-000000000004', v_session_done, v_shift_done, 'BREAK_END',   t_done_clock_in + interval '3 hours 20 minutes', v_worker_id, v_patient_id, '{"duration_secs":1200}'::jsonb, false, 1200),
        ('c3000d05-0000-4000-8000-000000000005', v_session_done, v_shift_done, 'CLOCK_OUT',   t_done_clock_out, v_worker_id, v_patient_id, '{}'::jsonb, true, 6000);

    INSERT INTO public.shift_checkins (
        id, session_id, shift_id, worker_id, patient_id, status, note,
        prompt_triggered_at, submitted_at, response_time_secs, coordinator_notified
    ) VALUES
        ('c3000e01-0000-4000-8000-000000000001', v_session_done, v_shift_done, v_worker_id, v_patient_id,
         'GOING_WELL', NULL, t_done_clock_in + interval '85 minutes', t_done_clock_in + interval '90 minutes', 300, false),
        ('c3000e02-0000-4000-8000-000000000002', v_session_done, v_shift_done, v_worker_id, v_patient_id,
         'GOING_WELL', NULL, t_done_clock_in + interval '175 minutes', t_done_clock_in + interval '3 hours', 300, false),
        ('c3000e03-0000-4000-8000-000000000003', v_session_done, v_shift_done, v_worker_id, v_patient_id,
         'NEEDS_ATTENTION', 'Brief anxiety in crowded market — resolved with headphones.',
         t_done_clock_in + interval '4 hours', t_done_clock_in + interval '4 hours 5 minutes', 300, true);

    INSERT INTO public.shift_breaks (
        id, session_id, shift_id, worker_id,
        break_start_at, break_end_at, duration_secs, is_compliant, break_number
    ) VALUES (
        'c3000f01-0000-4000-8000-000000000001', v_session_done, v_shift_done, v_worker_id,
        t_done_clock_in + interval '3 hours', t_done_clock_in + interval '3 hours 20 minutes', 1200, true, 1
    );

    -- ── 16. Budget usage (completed session) ──────────────────────────────────
    INSERT INTO public.budget_usage (
        id, plan_id, session_id, category, amount, hourly_rate, duration_minutes, description
    ) VALUES (
        'c3001001-0000-4000-8000-000000000001', v_plan_id, v_session_done, 'core',
        439.14, 67.56, 390, 'Community access — long shift (Benjamin Scott, Check 16 demo)'
    )
    ON CONFLICT (id) DO UPDATE SET
        amount = EXCLUDED.amount, duration_minutes = EXCLUDED.duration_minutes, description = EXCLUDED.description;

END $$;

COMMIT;

-- ── Verification ──────────────────────────────────────────────────────────────
SELECT
    p.full_name AS participant,
    s.id AS shift_id,
    s.status AS shift_status,
    s.clocked_in_at,
    round(EXTRACT(EPOCH FROM (now() - s.clocked_in_at)) / 3600.0, 1) AS hours_elapsed,
    sess.id AS session_id,
    sess.is_long_shift,
    sess.checkin_count,
    sess.engagement_score,
    sess.last_activity_at,
    round(EXTRACT(EPOCH FROM (now() - sess.last_activity_at)) / 60.0, 0) AS mins_since_activity
FROM public.patients p
JOIN public.shifts s ON s.participant_id = p.id
LEFT JOIN public.sessions sess ON sess.id = s.session_id
WHERE p.id = 'c3000001-0000-4000-8000-000000000001'
ORDER BY s.status, s.scheduled_start;

SELECT event_type, occurred_at, gap_before_secs, is_billable
FROM public.shift_activity_events
WHERE shift_id = 'c3000701-0000-4000-8000-000000000001'
ORDER BY occurred_at;
