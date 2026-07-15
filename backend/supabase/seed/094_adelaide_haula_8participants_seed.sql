-- =============================================================================
-- CARECLIQ — Adelaide 8-participant seed (Haula Grixellou)
-- -----------------------------------------------------------------------------
-- Worker:      97c486f6-f189-4245-92a0-c22b37d94c36  (Haula Grixellou)
-- Coordinator: e704e016-689d-4d93-9577-691a5ba5879b
-- Org:         a1111111-1111-1111-1111-111111111111
--
-- SAFE cleanup (does NOT delete shared patients used by other workers):
--   1) deletes only THIS worker's shifts + sessions (any participant)
--   2) deletes only THIS seed's patients (fixed e814… UUIDs) on re-run
--   3) unassigns this worker from other patients (assigned_worker_id / allocation)
--      instead of deleting those patient rows
-- Then reseeds 8 Adelaide locals:
--
--   1. Harper Lin      — TODAY long in_progress + pending random check-in (~2 min)
--   2. Miles Nguyen    — TODAY new scheduled (not started)
--   3. Freya Gibson    — INCOMING (tomorrow)
--   4. Callum Wright   — INCOMING (+2 days)
--   5. Isla Moretti    — TODAY completed + compliance/tasks + incident report
--   6. Noah Patel      — PAST completed LONG (6h) + compliance/tasks/check-ins + incident
--   7. Ava Richter     — PAST completed LONG (6.5h) + compliance/tasks/check-ins + incident
--   8. Ethan Brooks    — TODAY new scheduled (afternoon slot)
--
-- Safe to re-run: fixed UUIDs (e814…) + cleanup + ON CONFLICT upserts.
-- =============================================================================

BEGIN;

DO $$
DECLARE
    v_org_id         uuid := 'a1111111-1111-1111-1111-111111111111';
    v_worker_id      uuid := '97c486f6-f189-4245-92a0-c22b37d94c36';
    v_coordinator_id uuid := 'e704e016-689d-4d93-9577-691a5ba5879b';

    -- Patients e8140001…0008
    p1 uuid := 'e8140001-0000-4000-8000-000000000001'; -- Harper Lin — long today
    p2 uuid := 'e8140002-0000-4000-8000-000000000002'; -- Miles Nguyen — new today
    p3 uuid := 'e8140003-0000-4000-8000-000000000003'; -- Freya Gibson — incoming
    p4 uuid := 'e8140004-0000-4000-8000-000000000004'; -- Callum Wright — incoming
    p5 uuid := 'e8140005-0000-4000-8000-000000000005'; -- Isla Moretti — today completed
    p6 uuid := 'e8140006-0000-4000-8000-000000000006'; -- Noah Patel — past completed
    p7 uuid := 'e8140007-0000-4000-8000-000000000007'; -- Ava Richter — past completed
    p8 uuid := 'e8140008-0000-4000-8000-000000000008'; -- Ethan Brooks — new today PM

    -- Plans / goals / tasks / sessions / shifts (per participant …xxNN)
    pl1 uuid; pl2 uuid; pl3 uuid; pl4 uuid; pl5 uuid; pl6 uuid; pl7 uuid; pl8 uuid;
    g1a uuid; g1b uuid; g2a uuid; g2b uuid; g3a uuid; g3b uuid; g4a uuid; g4b uuid;
    g5a uuid; g5b uuid; g6a uuid; g6b uuid; g7a uuid; g7b uuid; g8a uuid; g8b uuid;
    t1a uuid; t1b uuid; t2a uuid; t2b uuid; t3a uuid; t3b uuid; t4a uuid; t4b uuid;
    t5a uuid; t5b uuid; t6a uuid; t6b uuid; t7a uuid; t7b uuid; t8a uuid; t8b uuid;
    s1 uuid; s5 uuid; s6 uuid; s7 uuid;
    sh1 uuid; sh2 uuid; sh3 uuid; sh4 uuid; sh5 uuid; sh6 uuid; sh7 uuid; sh8 uuid;

    v_day_start      timestamptz;
    t_long_in        timestamptz;
    t_long_end       timestamptz;
    t_session_start  timestamptz;
    t_last_activity  timestamptz;
    t_break_start    timestamptz;
    t_break_end      timestamptz;
    t_checkin_soon   timestamptz;
    t_checkin_later  timestamptz;
    t_today_am_s     timestamptz;
    t_today_am_e     timestamptz;
    t_today_pm_s     timestamptz;
    t_today_pm_e     timestamptz;
    t_in1_s          timestamptz;
    t_in1_e          timestamptz;
    t_in2_s          timestamptz;
    t_in2_e          timestamptz;
    t_done_today_s   timestamptz;
    t_done_today_e   timestamptz;
    t_past1_s        timestamptz;
    t_past1_e        timestamptz;
    t_past2_s        timestamptz;
    t_past2_e        timestamptz;

    v_tasks_long     jsonb;
    v_tasks_done     jsonb;
    v_support_long   jsonb;
    v_end_validation jsonb;
    v_pid            uuid;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_worker_id AND organization_id = v_org_id) THEN
        RAISE EXCEPTION 'Worker % not found in org %', v_worker_id, v_org_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_coordinator_id AND organization_id = v_org_id) THEN
        RAISE EXCEPTION 'Coordinator % not found in org %', v_coordinator_id, v_org_id;
    END IF;

    pl1 := 'e8140201-0000-4000-8000-000000000001'; pl2 := 'e8140202-0000-4000-8000-000000000002';
    pl3 := 'e8140203-0000-4000-8000-000000000003'; pl4 := 'e8140204-0000-4000-8000-000000000004';
    pl5 := 'e8140205-0000-4000-8000-000000000005'; pl6 := 'e8140206-0000-4000-8000-000000000006';
    pl7 := 'e8140207-0000-4000-8000-000000000007'; pl8 := 'e8140208-0000-4000-8000-000000000008';

    g1a := 'e8140301-0000-4000-8000-000000000001'; g1b := 'e8140302-0000-4000-8000-000000000001';
    g2a := 'e8140301-0000-4000-8000-000000000002'; g2b := 'e8140302-0000-4000-8000-000000000002';
    g3a := 'e8140301-0000-4000-8000-000000000003'; g3b := 'e8140302-0000-4000-8000-000000000003';
    g4a := 'e8140301-0000-4000-8000-000000000004'; g4b := 'e8140302-0000-4000-8000-000000000004';
    g5a := 'e8140301-0000-4000-8000-000000000005'; g5b := 'e8140302-0000-4000-8000-000000000005';
    g6a := 'e8140301-0000-4000-8000-000000000006'; g6b := 'e8140302-0000-4000-8000-000000000006';
    g7a := 'e8140301-0000-4000-8000-000000000007'; g7b := 'e8140302-0000-4000-8000-000000000007';
    g8a := 'e8140301-0000-4000-8000-000000000008'; g8b := 'e8140302-0000-4000-8000-000000000008';

    t1a := 'e8140401-0000-4000-8000-000000000001'; t1b := 'e8140402-0000-4000-8000-000000000001';
    t2a := 'e8140401-0000-4000-8000-000000000002'; t2b := 'e8140402-0000-4000-8000-000000000002';
    t3a := 'e8140401-0000-4000-8000-000000000003'; t3b := 'e8140402-0000-4000-8000-000000000003';
    t4a := 'e8140401-0000-4000-8000-000000000004'; t4b := 'e8140402-0000-4000-8000-000000000004';
    t5a := 'e8140401-0000-4000-8000-000000000005'; t5b := 'e8140402-0000-4000-8000-000000000005';
    t6a := 'e8140401-0000-4000-8000-000000000006'; t6b := 'e8140402-0000-4000-8000-000000000006';
    t7a := 'e8140401-0000-4000-8000-000000000007'; t7b := 'e8140402-0000-4000-8000-000000000007';
    t8a := 'e8140401-0000-4000-8000-000000000008'; t8b := 'e8140402-0000-4000-8000-000000000008';

    s1 := 'e8140701-0000-4000-8000-000000000001';
    s5 := 'e8140705-0000-4000-8000-000000000005';
    s6 := 'e8140706-0000-4000-8000-000000000006';
    s7 := 'e8140707-0000-4000-8000-000000000007';

    sh1 := 'e8140801-0000-4000-8000-000000000001';
    sh2 := 'e8140802-0000-4000-8000-000000000002';
    sh3 := 'e8140803-0000-4000-8000-000000000003';
    sh4 := 'e8140804-0000-4000-8000-000000000004';
    sh5 := 'e8140805-0000-4000-8000-000000000005';
    sh6 := 'e8140806-0000-4000-8000-000000000006';
    sh7 := 'e8140807-0000-4000-8000-000000000007';
    sh8 := 'e8140808-0000-4000-8000-000000000008';

    v_day_start := date_trunc('day', now() AT TIME ZONE 'Australia/Adelaide') AT TIME ZONE 'Australia/Adelaide';
    -- Elapsed >= 6h so random-checkin pass picks this up; end still ~2.5h away.
    t_long_in       := now() - interval '6 hours 30 minutes';
    t_long_end      := now() + interval '2 hours 30 minutes';
    t_session_start := t_long_in + interval '15 minutes';
    t_last_activity := now() - interval '20 minutes';
    t_break_start   := now() - interval '40 minutes';
    t_break_end     := now() - interval '25 minutes';
    -- Pending random compliance prompts for push/in-app test after reseed.
    t_checkin_soon  := now() + interval '2 minutes';
    t_checkin_later := now() + interval '75 minutes';
    t_today_am_s    := v_day_start + interval '9 hours';
    t_today_am_e    := v_day_start + interval '12 hours';
    t_today_pm_s    := v_day_start + interval '14 hours';
    t_today_pm_e    := v_day_start + interval '17 hours';
    t_in1_s         := v_day_start + interval '1 day 9 hours';
    t_in1_e         := v_day_start + interval '1 day 12 hours';
    t_in2_s         := v_day_start + interval '2 days 10 hours';
    t_in2_e         := v_day_start + interval '2 days 14 hours';
    t_done_today_s  := v_day_start + interval '7 hours';
    t_done_today_e  := v_day_start + interval '9 hours 30 minutes';
    t_past1_s       := v_day_start - interval '3 days' + interval '9 hours';
    t_past1_e       := t_past1_s + interval '6 hours';          -- Noah long completed
    t_past2_s       := v_day_start - interval '7 days' + interval '10 hours';
    t_past2_e       := t_past2_s + interval '6 hours 30 minutes'; -- Ava long completed

    -- ══════════════════════════════════════════════════════════════════════════
    -- CLEANUP (safe) — worker-owned shifts/sessions + seed patients only
    -- Never delete patients just because assigned_worker_id = this worker:
    -- shifts can belong to any worker; patients may be shared.
    -- ══════════════════════════════════════════════════════════════════════════
    CREATE TEMP TABLE _worker_shifts ON COMMIT DROP AS
        SELECT id FROM public.shifts WHERE worker_id = v_worker_id;

    CREATE TEMP TABLE _worker_sessions ON COMMIT DROP AS
        SELECT id FROM public.sessions WHERE worker_id = v_worker_id;

    -- Only this seed's patient rows may be hard-deleted on re-run
    CREATE TEMP TABLE _seed_patients ON COMMIT DROP AS
        SELECT unnest(ARRAY[p1,p2,p3,p4,p5,p6,p7,p8]) AS id;

    -- Unlink circular FKs for THIS worker's rows only
    UPDATE public.sessions SET shift_id = NULL
     WHERE id IN (SELECT id FROM _worker_sessions)
        OR shift_id IN (SELECT id FROM _worker_shifts);
    UPDATE public.shifts SET session_id = NULL
     WHERE id IN (SELECT id FROM _worker_shifts);

    -- Shift children (this worker's shifts only)
    DELETE FROM public.budget_usage WHERE shift_verification_id IN (
        SELECT id FROM public.shift_verifications WHERE shift_id IN (SELECT id FROM _worker_shifts)
    );
    DELETE FROM public.shift_verifications WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_activity_events WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_checkins WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_breaks WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_visit_notes WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_tasks WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_briefing_acknowledgements WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_briefing_alert_acknowledgements WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_scheduled_checkins WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_signatures WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_feedback WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_travel_expenses WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_messages WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_office_messages WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_view_events WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_change_acknowledgements WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_reminder_settings WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_check_ins WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.shift_export_requests WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.task_completions WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.task_evidence_metadata WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.user_notifications WHERE shift_id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.worker_shift_swap_request_details WHERE shift_id IN (SELECT id FROM _worker_shifts);
    UPDATE public.conversations SET shift_id = NULL WHERE shift_id IN (SELECT id FROM _worker_shifts);
    UPDATE public.incidents SET shift_id = NULL WHERE shift_id IN (SELECT id FROM _worker_shifts);
    UPDATE public.participant_tasks SET shift_id = NULL WHERE shift_id IN (SELECT id FROM _worker_shifts);

    -- Session children (this worker's sessions only)
    DELETE FROM public.budget_usage WHERE session_id IN (SELECT id FROM _worker_sessions);
    DELETE FROM public.compliance_audit_logs WHERE session_id IN (SELECT id FROM _worker_sessions);
    DELETE FROM public.compliance_checks WHERE session_id IN (SELECT id FROM _worker_sessions);
    DELETE FROM public.compliance_rule_results WHERE session_id IN (SELECT id FROM _worker_sessions);
    DELETE FROM public.session_messages WHERE session_id IN (SELECT id FROM _worker_sessions);
    DELETE FROM public.session_embeddings WHERE session_id IN (SELECT id FROM _worker_sessions);
    DELETE FROM public.media_files WHERE session_id IN (SELECT id FROM _worker_sessions);
    DELETE FROM public.ai_insights WHERE session_id IN (SELECT id FROM _worker_sessions);
    DELETE FROM public.restrictive_practice_flags WHERE session_id IN (SELECT id FROM _worker_sessions);
    DELETE FROM public.alerts WHERE session_id IN (SELECT id FROM _worker_sessions);
    DELETE FROM public.shift_activity_events WHERE session_id IN (SELECT id FROM _worker_sessions);
    DELETE FROM public.shift_checkins WHERE session_id IN (SELECT id FROM _worker_sessions);
    DELETE FROM public.shift_breaks WHERE session_id IN (SELECT id FROM _worker_sessions);
    DELETE FROM public.shift_visit_notes WHERE session_id IN (SELECT id FROM _worker_sessions);
    DELETE FROM public.shift_scheduled_checkins WHERE session_id IN (SELECT id FROM _worker_sessions);
    DELETE FROM public.task_evidence_metadata WHERE session_id IN (SELECT id FROM _worker_sessions);
    UPDATE public.incidents SET session_id = NULL WHERE session_id IN (SELECT id FROM _worker_sessions);

    DELETE FROM public.shifts WHERE id IN (SELECT id FROM _worker_shifts);
    DELETE FROM public.sessions WHERE id IN (SELECT id FROM _worker_sessions);

    -- Detach this worker from OTHER patients (keep patient rows for everyone else)
    UPDATE public.patients
       SET assigned_worker_id = NULL, updated_at = now()
     WHERE assigned_worker_id = v_worker_id
       AND id NOT IN (SELECT id FROM _seed_patients);

    UPDATE public.practitioner_allocations
       SET is_active = false
     WHERE user_id = v_worker_id
       AND patient_id NOT IN (SELECT id FROM _seed_patients);

    -- Hard-delete only this seed's patients (e814…) and their related rows
    FOR v_pid IN SELECT id FROM _seed_patients LOOP
        DELETE FROM public.budget_usage WHERE plan_id IN (SELECT id FROM public.ndis_plans WHERE patient_id = v_pid);
        DELETE FROM public.plan_budgets WHERE plan_id IN (SELECT id FROM public.ndis_plans WHERE patient_id = v_pid);
        DELETE FROM public.task_completions WHERE participant_id = v_pid;
        DELETE FROM public.task_instances WHERE participant_id = v_pid;
        DELETE FROM public.participant_tasks WHERE participant_id = v_pid;
        DELETE FROM public.participant_task_templates WHERE participant_id = v_pid;
        DELETE FROM public.ndis_goals WHERE participant_id = v_pid;
        DELETE FROM public.participant_allergies WHERE participant_id = v_pid;
        DELETE FROM public.participant_briefing_alerts WHERE participant_id = v_pid;
        DELETE FROM public.participant_safety_protocols WHERE participant_id = v_pid;
        DELETE FROM public.participant_check_in_codes WHERE participant_id = v_pid;
        DELETE FROM public.worker_safety_acknowledgements WHERE participant_id = v_pid;
        DELETE FROM public.worker_preferred_shift_request_details WHERE participant_id = v_pid;
        DELETE FROM public.billing_periods WHERE participant_id = v_pid;
        DELETE FROM public.report_history WHERE participant_id = v_pid;
        DELETE FROM public.ai_detected_patterns WHERE participant_id = v_pid;
        DELETE FROM public.session_embeddings WHERE participant_id = v_pid;
        DELETE FROM public.plan_meeting_sessions WHERE participant_id = v_pid;
        DELETE FROM public.participant_plan_meetings WHERE participant_id = v_pid;
        DELETE FROM public.shift_verifications WHERE participant_id = v_pid;
        DELETE FROM public.alerts WHERE patient_id = v_pid;
        DELETE FROM public.incidents WHERE participant_id = v_pid;
        UPDATE public.conversations SET participant_id = NULL WHERE participant_id = v_pid;
        DELETE FROM public.shifts WHERE participant_id = v_pid;
        DELETE FROM public.sessions WHERE patient_id = v_pid;
        DELETE FROM public.ndis_plans WHERE patient_id = v_pid;
        DELETE FROM public.practitioner_allocations WHERE patient_id = v_pid;
        DELETE FROM public.patients WHERE id = v_pid;
    END LOOP;

    -- ══════════════════════════════════════════════════════════════════════════
    -- PATIENTS (8 Adelaide profiles)
    -- ══════════════════════════════════════════════════════════════════════════
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
    ) VALUES
    (p1, v_org_id, 'Harper Lin', 'Harps', '4308000001', '1997-05-12', 'female',
     'harper.lin@example.com', '0412 803 041',
     '28 The Parade, Norwood SA 5067',
     'Terrace house — park on Queen Street. Key lockbox code 1947 on front porch.',
     'active', '2026-01-01', '2026-12-31', 62000.00,
     'plan-managed',
     'Autism Spectrum Disorder',
     E'Mild ASD\nGeneralised anxiety\nRequires predictable long-day routines',
     E'Sertraline 50mg — morning with breakfast\nMelatonin 2mg — nightly at 9:00 pm',
     E'⚠️ Noise sensitivity in busy retail\nComplete 90-min check-ins on long shifts',
     'Tree nuts — moderate GI reaction',
     'low', ARRAY['Sudden schedule changes','Crowded shopping centres','Unfamiliar workers'],
     E'Provide 15-minute transition warnings.\nUse visual schedules on multi-step tasks.',
     jsonb_build_object('name','Mei Lin','phone','0418 220 114','relationship','Mother'),
     'Priya Nair', '08 8123 4500', 'priya.nair@ndisplanmanager.com.au',
     'Clear, direct language with visual supports',
     'Use short sentences and wait for processing time.',
     'Enjoys Norwood Parade cafés, baking, and quiet park walks. Dislikes strong perfume.',
     'Prefers natural light and low background noise.',
     'Chinese-Australian family — remove shoes at front door.',
     '["Baking simple recipes","Parade café visits","Victoria Park walks"]'::jsonb,
     '[{"title":"Transitions","body":"Give a 15-minute warning before leaving home."}]'::jsonb,
     'Harper is a 29-year-old Norwood resident building independence across long community access shifts.',
     now() - interval '2 days',
     'Last shift: completed morning hygiene and meal prep with one visual prompt.',
     now() - interval '1 day', '2026-11-20',
     v_worker_id, v_coordinator_id, v_coordinator_id, now()),

    (p2, v_org_id, 'Miles Nguyen', 'Miles', '4308000002', '1991-11-03', 'male',
     'miles.nguyen@example.com', '0427 118 602',
     '12 Alpha Road, Prospect SA 5082',
     'Unit 4 rear courtyard — intercom "Nguyen". Visitor bays off Vine Street.',
     'active', '2026-02-01', '2027-01-31', 54000.00,
     'self-managed',
     'Intellectual Disability',
     E'Mild intellectual disability\nType 2 diabetes — diet controlled',
     E'Metformin 500mg — twice daily with food',
     E'⚠️ Check BGL before community outing if fasting',
     'None known',
     'low', ARRAY['Missed meals','Rushed transitions'],
     E'Use pictorial shopping lists.\nConfirm understanding by asking Miles to repeat steps.',
     jsonb_build_object('name','Linh Nguyen','phone','0403 771 220','relationship','Sister'),
     'Helen Marsh', '08 8226 9100', 'h.marsh@leapplan.com.au',
     'Plain English; visual schedules',
     'Speak slowly and face Miles. Praise effort.',
     'Loves Prospect markets and Vietnamese cooking. Dislikes being rushed.',
     'Prefers quiet spaces; avoid strong cleaning scents.',
     'Vietnamese-Australian — remove shoes at door.',
     '["Prospect Market","Meal prep","Library visits"]'::jsonb,
     '[{"title":"Pacing","body":"Offer a short break if Miles becomes quiet or avoids eye contact."}]'::jsonb,
     'Miles is a 34-year-old Prospect resident focusing on morning routines and local shopping confidence.',
     now() - interval '5 days',
     'No shift delivered yet this week — first today.',
     now() - interval '1 day', '2026-10-15',
     v_worker_id, v_coordinator_id, v_coordinator_id, now()),

    (p3, v_org_id, 'Freya Gibson', 'Freya', '4308000003', '1988-08-21', 'female',
     'freya.gibson@example.com', '0438 550 733',
     '9 Moseley Street, Glenelg SA 5045',
     'Ground-floor flat. Beach wheelchair in garage. Street parking on Moseley St.',
     'active', '2026-03-01', '2027-02-28', 71000.00,
     'plan-managed',
     'Multiple Sclerosis',
     E'Relapsing-remitting MS\nFatigue after midday\nReduced lower-limb strength',
     E'Interferon beta-1a — weekly (Wed)\nBaclofen 10mg — twice daily',
     E'⛔ Falls risk — gait belt for outdoor transfers\n⚠️ Heat sensitivity',
     'Sulfonamide antibiotics — rash',
     'medium', ARRAY['Heat and humidity','Uneven footpaths','Fatigue after midday'],
     E'Schedule demanding tasks before 11:00 am.\nHydration every hour outdoors.',
     jsonb_build_object('name','Tom Gibson','phone','0417 882 301','relationship','Partner'),
     'James Whitford', '08 8234 7700', 'j.whitford@ndis.gov.au',
     'Verbal preferred; allow extra time when fatigued',
     'Offer seated rests when fatigue shows.',
     'Enjoys jetty walks and coffee on Jetty Road. Dislikes midday heat.',
     'Cool environments preferred; cooling vest on warm days.',
     'No specific cultural requirements.',
     '["Glenelg jetty walks","Café visits","Light patio gardening"]'::jsonb,
     '[{"title":"Fatigue","body":"Cease activity and support rest if heavy legs or slurred speech."}]'::jsonb,
     'Freya is a 37-year-old Glenelg resident managing MS with morning personal care and fatigue-aware community access.',
     now() - interval '4 days',
     'Last week: jetty outing shortened due to heat — rested with hydration.',
     now() - interval '3 days', '2026-12-01',
     v_worker_id, v_coordinator_id, v_coordinator_id, now()),

    (p4, v_org_id, 'Callum Wright', 'Cal', '4308000004', '2002-02-14', 'male',
     'callum.wright@example.com', '0421 409 864',
     '55 King William Road, Unley SA 5061',
     'Unit 3 — intercom Wright. Visitor parking on Mitchell Street.',
     'active', '2026-01-15', '2026-12-14', 48000.00,
     'plan-managed',
     'Acquired Brain Injury',
     E'Mild right hemiparesis\nFatigue and processing delays\nSwallowing precautions for thin fluids',
     E'Baclofen 10mg — morning\nVitamin D 1000 IU — daily',
     E'⚠️ Swallowing precautions — thicken fluids as charted\nForearm crutches by front door',
     'Dairy — mild GI upset',
     'medium', ARRAY['Rushed speech','Thin fluids','Overstimulation in cafés'],
     E'Allow extra time for mobility.\nCut food into small pieces; follow dysphagia chart.',
     jsonb_build_object('name','Sarah Wright','phone','0413 556 902','relationship','Mother'),
     'David O''Connor', '08 8344 5500', 'd.oconnor@ndis.gov.au',
     'Slow, clear speech; one instruction at a time',
     'Confirm Callum has processed each step before continuing.',
     'Enjoys Unley cafés and footy highlights. Dislikes being spoken over.',
     'Prefers quieter café corners near exits.',
     'Anglo-Australian — AFL supporter (Crows).',
     '["Unley café outings","Fine motor practice","Walking with crutches"]'::jsonb,
     '[{"title":"Processing","body":"Wait 10 seconds after instructions before repeating."}]'::jsonb,
     'Callum is a 24-year-old Unley resident rebuilding upper limb function and community confidence after ABI.',
     now() - interval '6 days',
     'Upcoming first supported café outing this week.',
     now() - interval '2 days', '2026-11-05',
     v_worker_id, v_coordinator_id, v_coordinator_id, now()),

    (p5, v_org_id, 'Isla Moretti', 'Isla', '4308000005', '1993-09-30', 'female',
     'isla.moretti@example.com', '0415 772 905',
     '7 Seaview Road, Henley Beach SA 5022',
     'Ramp at rear entrance. Key safe code 3381 on rear gate.',
     'active', '2026-01-01', '2026-12-31', 58000.00,
     'plan-managed',
     'Intellectual Disability',
     E'Mild intellectual disability\nGeneralised anxiety',
     E'Melatonin 2mg — nightly',
     E'⚠️ Latex sensitivity — nitrile gloves only',
     'Latex — contact dermatitis',
     'low', ARRAY['Unfamiliar workers','Sudden plan changes'],
     E'Use whiteboard checklist for morning routine.\nNitrile gloves for personal care.',
     jsonb_build_object('name','Angela Moretti','phone','0418 334 770','relationship','Sister'),
     'Helen Marsh', '08 8226 9100', 'h.marsh@leapplan.com.au',
     'Plain English with pictorial checklist',
     'Ask Isla to tick checklist items herself.',
     'Loves seaside walks and gospel playlists. Dislikes latex smell.',
     'Soft music okay; avoid fluorescent flicker if possible.',
     'Italian-Australian Catholic — Sunday family call mid-morning.',
     '["Henley jetty","Breakfast cooking","Gospel playlists"]'::jsonb,
     '[{"title":"Anxiety","body":"Offer garden break if Isla goes quiet."}]'::jsonb,
     'Isla is a 32-year-old Henley Beach resident building morning personal care and breakfast independence.',
     now() - interval '1 day',
     'Today shift completed: morning hygiene + breakfast with one verbal prompt.',
     now(), '2026-10-22',
     v_worker_id, v_coordinator_id, v_coordinator_id, now()),

    (p6, v_org_id, 'Noah Patel', 'Noah', '4308000006', '1999-01-18', 'male',
     'noah.patel@example.com', '0419 660 216',
     '14 Melbourne Street, North Adelaide SA 5006',
     'Ground-floor unit. Key safe 4821 on left fence post. Street parking OK.',
     'active', '2026-02-01', '2027-01-31', 52000.00,
     'plan-managed',
     'Autism Spectrum Disorder',
     E'Mild ASD\nSensory processing differences',
     E'Sertraline 25mg — morning',
     E'⚠️ Latex sensitivity — nitrile gloves\n15-minute transition warnings',
     'Latex — mild contact dermatitis',
     'low', ARRAY['Loud unexpected noises','Crowded Central Market peak times'],
     E'Visual recipe cards in kitchen drawer.\nHeadphones available for community outings.',
     jsonb_build_object('name','Margaret Patel','phone','0413 456 201','relationship','Mother'),
     'Priya Nair', '08 8123 4500', 'priya.nair@ndisplanmanager.com.au',
     'Clear direct language with visual supports',
     'Offer written or pictorial choices.',
     'Cooking shows, Torrens walks, quiet Central Market mornings.',
     'Natural light preferred; avoid strong perfume.',
     'Indian-Australian household — vegetarian Mondays.',
     '["Meal prep","Torrens Linear Park","Central Market"]'::jsonb,
     '[{"title":"Transitions","body":"Give 15-minute warning before leaving."}]'::jsonb,
     'Noah is a 27-year-old North Adelaide local focused on cooking independence and quiet community outings.',
     now() - interval '4 days',
     'Past shift: scrambled eggs + toast with two verbal prompts; cleaned independently.',
     now() - interval '3 days', '2026-09-15',
     v_worker_id, v_coordinator_id, v_coordinator_id, now()),

    (p7, v_org_id, 'Ava Richter', 'Ava', '4308000007', '1986-12-07', 'female',
     'ava.richter@example.com', '0432 918 447',
     '22 Magill Road, Magill SA 5072',
     'Cottage with small step — handrail fitted. Park in driveway if free.',
     'active', '2026-04-01', '2027-03-31', 65000.00,
     'self-managed',
     'Psychosocial disability',
     E'Major depressive disorder (stable)\nHistory of seizures (controlled)',
     E'Sertraline 100mg — morning\nLamotrigine 100mg — twice daily',
     E'⚠️ Seizure precautions — time episodes; call coordinator if >5 min\nDo not leave cooking unattended',
     'Penicillin — hives',
     'medium', ARRAY['Missed medication','Overstimulating shopping centres','Cooking left unattended'],
     E'Use whiteboard daily routine.\nConfirm medication taken before community outing.',
     jsonb_build_object('name','Ben Richter','phone','0411 772 088','relationship','Brother'),
     'James Whitford', '08 8234 7700', 'j.whitford@ndis.gov.au',
     'Calm tone; avoid pressuring decisions',
     'Offer choices; validate feelings before redirecting to tasks.',
     'Community garden volunteering and audiobooks. Dislikes crowded malls.',
     'Quiet rooms preferred; soft lighting.',
     'German-Australian heritage — no alcohol in household.',
     '["Community garden","Whiteboard routines","Library visits"]'::jsonb,
     '[{"title":"Seizure","body":"If seizure: time it, protect head, call coordinator if >5 minutes."}]'::jsonb,
     'Ava is a 39-year-old Magill resident rebuilding structured daily routines and community volunteering.',
     now() - interval '8 days',
     'Past shift: completed personal care checklist and community garden prep.',
     now() - interval '7 days', '2027-02-28',
     v_worker_id, v_coordinator_id, v_coordinator_id, now()),

    (p8, v_org_id, 'Ethan Brooks', 'Eth', '4308000008', '1995-06-25', 'male',
     'ethan.brooks@example.com', '0408 331 598',
     '42 Hutt Street, Adelaide SA 5000',
     'Townhouse — visitor parking on Hutt St. Lockbox 2847 on meter box.',
     'active', '2026-01-01', '2026-12-31', 50000.00,
     'plan-managed',
     'Autism Spectrum Disorder',
     E'Mild ASD\nRequires visual schedules for multi-step domestic tasks',
     E'Melatonin 2mg — nightly',
     E'⚠️ Noise sensitivity — headphones for busy CBD streets',
     'None known',
     'low', ARRAY['Crowded Rundle Mall peak','Unfamiliar routes'],
     E'Use visual schedule on fridge.\nPlan quieter walking routes along Frome Rd.',
     jsonb_build_object('name','Laura Brooks','phone','0412 881 455','relationship','Mother'),
     'Priya Nair', '08 8123 4500', 'priya.nair@ndisplanmanager.com.au',
     'Clear, direct language',
     'Offer pictorial choices for afternoon activity.',
     'Enjoys Hutt St cafés on quiet afternoons and AFL podcasts.',
     'Prefers predictable routes; avoid Rundle Mall lunch rush.',
     'Anglo-Australian — Adelaide Crows supporter.',
     '["Domestic checklist","Quiet café visits","Parkland walks"]'::jsonb,
     '[{"title":"Overwhelm","body":"If pacing starts, offer a short sit-down before continuing."}]'::jsonb,
     'Ethan is a 30-year-old Adelaide CBD resident practising domestic sequencing and quiet community access.',
     now() - interval '3 days',
     'Afternoon shift scheduled today — briefing not yet acknowledged.',
     now() - interval '1 day', '2026-11-30',
     v_worker_id, v_coordinator_id, v_coordinator_id, now())
    ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        assigned_worker_id = EXCLUDED.assigned_worker_id,
        updated_at = now();

    -- Allocations
    INSERT INTO public.practitioner_allocations (
        id, patient_id, user_id, allocated_role, organization_id, assigned_by, is_active
    ) VALUES
        ('e8140101-0000-4000-8000-000000000001', p1, v_worker_id, 'support_worker', v_org_id, v_coordinator_id, true),
        ('e8140102-0000-4000-8000-000000000002', p2, v_worker_id, 'support_worker', v_org_id, v_coordinator_id, true),
        ('e8140103-0000-4000-8000-000000000003', p3, v_worker_id, 'support_worker', v_org_id, v_coordinator_id, true),
        ('e8140104-0000-4000-8000-000000000004', p4, v_worker_id, 'support_worker', v_org_id, v_coordinator_id, true),
        ('e8140105-0000-4000-8000-000000000005', p5, v_worker_id, 'support_worker', v_org_id, v_coordinator_id, true),
        ('e8140106-0000-4000-8000-000000000006', p6, v_worker_id, 'support_worker', v_org_id, v_coordinator_id, true),
        ('e8140107-0000-4000-8000-000000000007', p7, v_worker_id, 'support_worker', v_org_id, v_coordinator_id, true),
        ('e8140108-0000-4000-8000-000000000008', p8, v_worker_id, 'support_worker', v_org_id, v_coordinator_id, true)
    ON CONFLICT (patient_id, user_id) DO UPDATE SET is_active = true, assigned_by = EXCLUDED.assigned_by;

    -- Plans
    INSERT INTO public.ndis_plans (id, organization_id, patient_id, plan_number, plan_start, plan_end, total_funding, status) VALUES
        (pl1, v_org_id, p1, '2026-NDIS-HL-801', '2026-01-01', '2026-12-31', 62000.00, 'active'),
        (pl2, v_org_id, p2, '2026-NDIS-MN-802', '2026-02-01', '2027-01-31', 54000.00, 'active'),
        (pl3, v_org_id, p3, '2026-NDIS-FG-803', '2026-03-01', '2027-02-28', 71000.00, 'active'),
        (pl4, v_org_id, p4, '2026-NDIS-CW-804', '2026-01-15', '2026-12-14', 48000.00, 'active'),
        (pl5, v_org_id, p5, '2026-NDIS-IM-805', '2026-01-01', '2026-12-31', 58000.00, 'active'),
        (pl6, v_org_id, p6, '2026-NDIS-NP-806', '2026-02-01', '2027-01-31', 52000.00, 'active'),
        (pl7, v_org_id, p7, '2026-NDIS-AR-807', '2026-04-01', '2027-03-31', 65000.00, 'active'),
        (pl8, v_org_id, p8, '2026-NDIS-EB-808', '2026-01-01', '2026-12-31', 50000.00, 'active')
    ON CONFLICT (id) DO UPDATE SET status = 'active', total_funding = EXCLUDED.total_funding, updated_at = now();

    INSERT INTO public.plan_budgets (id, plan_id, category, allocated_amount, used_amount) VALUES
        ('e8140211-0000-4000-8000-000000000001', pl1, 'core', 38000, 7200),
        ('e8140212-0000-4000-8000-000000000001', pl1, 'capacity_building', 18000, 2100),
        ('e8140213-0000-4000-8000-000000000001', pl1, 'capital', 6000, 500),
        ('e8140211-0000-4000-8000-000000000002', pl2, 'core', 34000, 3000),
        ('e8140212-0000-4000-8000-000000000002', pl2, 'capacity_building', 14000, 900),
        ('e8140213-0000-4000-8000-000000000002', pl2, 'capital', 6000, 300),
        ('e8140211-0000-4000-8000-000000000003', pl3, 'core', 44000, 8200),
        ('e8140212-0000-4000-8000-000000000003', pl3, 'capacity_building', 21000, 2500),
        ('e8140213-0000-4000-8000-000000000003', pl3, 'capital', 6000, 500),
        ('e8140211-0000-4000-8000-000000000004', pl4, 'core', 30000, 2400),
        ('e8140212-0000-4000-8000-000000000004', pl4, 'capacity_building', 12000, 800),
        ('e8140213-0000-4000-8000-000000000004', pl4, 'capital', 6000, 400),
        ('e8140211-0000-4000-8000-000000000005', pl5, 'core', 36000, 6100),
        ('e8140212-0000-4000-8000-000000000005', pl5, 'capacity_building', 16000, 2100),
        ('e8140213-0000-4000-8000-000000000005', pl5, 'capital', 6000, 500),
        ('e8140211-0000-4000-8000-000000000006', pl6, 'core', 32000, 5400),
        ('e8140212-0000-4000-8000-000000000006', pl6, 'capacity_building', 14000, 1500),
        ('e8140213-0000-4000-8000-000000000006', pl6, 'capital', 6000, 500),
        ('e8140211-0000-4000-8000-000000000007', pl7, 'core', 40000, 9800),
        ('e8140212-0000-4000-8000-000000000007', pl7, 'capacity_building', 19000, 2800),
        ('e8140213-0000-4000-8000-000000000007', pl7, 'capital', 6000, 600),
        ('e8140211-0000-4000-8000-000000000008', pl8, 'core', 31000, 3800),
        ('e8140212-0000-4000-8000-000000000008', pl8, 'capacity_building', 13000, 1000),
        ('e8140213-0000-4000-8000-000000000008', pl8, 'capital', 6000, 300)
    ON CONFLICT (plan_id, category) DO UPDATE SET
        allocated_amount = EXCLUDED.allocated_amount, used_amount = EXCLUDED.used_amount;

    -- Goals
    INSERT INTO public.ndis_goals (
        id, participant_id, organization_id, plan_id, created_by,
        name, goal_area, description, target_date, why_it_matters, support_category, priority, status
    ) VALUES
        (g1a, p1, v_org_id, pl1, v_coordinator_id, 'Independent daily living on long shifts', 'daily_living',
         'Complete personal care and meal prep on 4–6 hour community access days.', '2026-12-15',
         'Foundation for shared accommodation independence.', 'core_daily_activities', 1, 'active'),
        (g1b, p1, v_org_id, pl1, v_coordinator_id, 'Community access confidence', 'community',
         'Attend structured community activities during long supported shifts.', '2027-01-31',
         'Reduces social isolation.', 'core_social_community', 2, 'active'),
        (g2a, p2, v_org_id, pl2, v_coordinator_id, 'Morning personal care independence', 'daily_living',
         'Complete morning hygiene with pictorial checklist.', '2026-11-30',
         'Supports routine reliability.', 'core_daily_activities', 1, 'active'),
        (g2b, p2, v_org_id, pl2, v_coordinator_id, 'Community shopping skills', 'community',
         'Complete a 5-item shopping list at Prospect Market.', '2027-01-15',
         'Builds community confidence.', 'core_social_community', 2, 'active'),
        (g3a, p3, v_org_id, pl3, v_coordinator_id, 'Maintain home independence', 'daily_living',
         'Morning personal care with stand-by assist and fatigue monitoring.', '2027-01-31',
         'Primary quality-of-life goal.', 'core_daily_activities', 1, 'active'),
        (g3b, p3, v_org_id, pl3, v_coordinator_id, 'Safe beachside mobility', 'community',
         'Safe footpath mobility and jetty walks before midday.', '2026-12-31',
         'Reduces isolation.', 'core_social_community', 2, 'active'),
        (g4a, p4, v_org_id, pl4, v_coordinator_id, 'Upper limb fine motor practice', 'health',
         'Buttoning, utensil use and grip exercises during morning routine.', '2026-11-15',
         'Supports dressing independence.', 'cb_health_wellbeing', 1, 'active'),
        (g4b, p4, v_org_id, pl4, v_coordinator_id, 'Build social confidence', 'social',
         'Order independently at familiar Unley café.', '2027-01-31',
         'Builds peer connection.', 'core_social_community', 2, 'active'),
        (g5a, p5, v_org_id, pl5, v_coordinator_id, 'Morning hygiene independence', 'daily_living',
         'Complete morning hygiene routine with checklist.', '2026-11-30',
         'Foundation for community access.', 'core_daily_activities', 1, 'active'),
        (g5b, p5, v_org_id, pl5, v_coordinator_id, 'Breakfast meal prep skills', 'daily_living',
         'Prepare breakfast using visual recipe card.', '2026-12-15',
         'Supports nutritional independence.', 'core_daily_activities', 2, 'active'),
        (g6a, p6, v_org_id, pl6, v_coordinator_id, 'Independent meal preparation', 'daily_living',
         'Prepare a simple hot meal with minimal verbal prompting.', '2026-10-31',
         'Supports independence in North Adelaide unit.', 'core_daily_activities', 1, 'active'),
        (g6b, p6, v_org_id, pl6, v_coordinator_id, 'Increase community participation', 'community',
         'Attend community activities twice per week with support.', '2026-12-15',
         'Builds social connection.', 'core_social_community', 2, 'active'),
        (g7a, p7, v_org_id, pl7, v_coordinator_id, 'Rebuild daily living routines', 'daily_living',
         'Follow written routines for personal care, meals and domestic tasks.', '2027-02-28',
         'Foundation for independent living.', 'core_daily_activities', 1, 'active'),
        (g7b, p7, v_org_id, pl7, v_coordinator_id, 'Return to part-time volunteering', 'employment',
         'Build stamina for community garden volunteering.', '2027-03-31',
         'Meaningful community role.', 'cb_employment', 2, 'active'),
        (g8a, p8, v_org_id, pl8, v_coordinator_id, 'Domestic task sequencing', 'daily_living',
         'Follow visual schedule for multi-step domestic tasks.', '2026-12-15',
         'Supports independent living.', 'core_daily_activities', 1, 'active'),
        (g8b, p8, v_org_id, pl8, v_coordinator_id, 'Quiet community access', 'community',
         'Complete quiet café outing using preferred CBD routes.', '2027-01-31',
         'Reduces isolation without overwhelm.', 'core_social_community', 2, 'active')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = 'active', updated_at = now();

    -- Participant tasks (real NDIS-style shift tasks)
    INSERT INTO public.participant_tasks (
        id, participant_id, goal_id, organization_id, created_by,
        name, description, frequency, shift_type, category, priority,
        support_category, evidence_required, is_mandatory, status
    ) VALUES
        (t1a, p1, g1a, v_org_id, v_coordinator_id, 'Morning personal care and meal prep',
         'Use visual recipe card. Document prompting level.', 'each_shift', 'morning', 'personal_care', 'high',
         'core_daily_activities', 'notes', true, 'pending'),
        (t1b, p1, g1b, v_org_id, v_coordinator_id, 'Torrens / Victoria Park community walk',
         'Quiet park walk. Note engagement and anxiety signs.', 'weekly', 'morning', 'community_access', 'medium',
         'core_social_community', 'photo', false, 'pending'),
        (t2a, p2, g2a, v_org_id, v_coordinator_id, 'Morning hygiene checklist',
         'Follow pictorial checklist in bathroom.', 'each_shift', 'morning', 'personal_care', 'high',
         'core_daily_activities', 'notes', true, 'pending'),
        (t2b, p2, g2b, v_org_id, v_coordinator_id, 'Prospect Market shopping list',
         'Support 5-item shopping with pictorial list.', 'weekly', 'morning', 'community_access', 'medium',
         'core_social_community', 'none', false, 'pending'),
        (t3a, p3, g3a, v_org_id, v_coordinator_id, 'Morning personal care and domestic tasks',
         'Stand-by assist with showering and dressing. Rest breaks as needed.', 'each_shift', 'morning', 'personal_care', 'high',
         'core_daily_activities', 'notes', true, 'pending'),
        (t3b, p3, g3b, v_org_id, v_coordinator_id, 'Glenelg jetty mobility outing',
         'Jetty or café outing before 11:00 am. Gait belt on uneven surfaces.', 'weekly', 'morning', 'community_access', 'medium',
         'core_social_community', 'photo', false, 'pending'),
        (t4a, p4, g4a, v_org_id, v_coordinator_id, 'Upper limb fine motor practice',
         'Buttoning, utensil use and grip exercises during morning routine.', 'each_shift', 'morning', 'personal_care', 'high',
         'cb_health_wellbeing', 'notes', true, 'pending'),
        (t4b, p4, g4b, v_org_id, v_coordinator_id, 'Supported Unley café social outing',
         'Encourage Callum to order independently.', 'weekly', 'morning', 'community_access', 'medium',
         'core_social_community', 'none', false, 'pending'),
        (t5a, p5, g5a, v_org_id, v_coordinator_id, 'Morning hygiene checklist',
         'Follow pictorial checklist in bathroom. Nitrile gloves only.', 'each_shift', 'morning', 'personal_care', 'high',
         'core_daily_activities', 'notes', true, 'pending'),
        (t5b, p5, g5b, v_org_id, v_coordinator_id, 'Breakfast meal prep',
         'Prepare breakfast using visual recipe card.', 'each_shift', 'morning', 'domestic_assistance', 'high',
         'core_daily_activities', 'notes', true, 'pending'),
        (t6a, p6, g6a, v_org_id, v_coordinator_id, 'Support meal preparation with visual recipe',
         'Use pictorial recipe card. Document prompting level.', 'each_shift', 'afternoon', 'domestic_assistance', 'high',
         'core_daily_activities', 'notes', true, 'pending'),
        (t6b, p6, g6b, v_org_id, v_coordinator_id, 'Accompany community outing',
         'Support planned community activity. Note engagement.', 'weekly', 'anytime', 'community_access', 'medium',
         'core_social_community', 'none', false, 'pending'),
        (t7a, p7, g7a, v_org_id, v_coordinator_id, 'Follow written daily routine',
         'Use whiteboard checklist for personal care and meal steps.', 'each_shift', 'afternoon', 'domestic_assistance', 'high',
         'core_daily_activities', 'notes', true, 'pending'),
        (t7b, p7, g7b, v_org_id, v_coordinator_id, 'Community garden visit prep',
         'Review volunteer role expectations and transport plan.', 'weekly', 'afternoon', 'community_access', 'low',
         'cb_employment', 'none', false, 'pending'),
        (t8a, p8, g8a, v_org_id, v_coordinator_id, 'Domestic task visual schedule',
         'Complete fridge visual schedule steps in order.', 'each_shift', 'afternoon', 'domestic_assistance', 'high',
         'core_daily_activities', 'notes', true, 'pending'),
        (t8b, p8, g8b, v_org_id, v_coordinator_id, 'Quiet Hutt Street café outing',
         'Avoid Rundle Mall rush; note engagement.', 'weekly', 'afternoon', 'community_access', 'medium',
         'core_social_community', 'none', false, 'pending')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = now();

    -- Allergies + briefing alerts
    INSERT INTO public.participant_allergies (id, participant_id, organization_id, allergen, severity, notes) VALUES
        ('e8140501-0000-4000-8000-000000000001', p1, v_org_id, 'Tree nuts', 'moderate', 'Avoid shared nut products in meal prep.'),
        ('e8140502-0000-4000-8000-000000000001', p1, v_org_id, 'Latex', 'mild', 'Use nitrile gloves for personal care.'),
        ('e8140501-0000-4000-8000-000000000002', p2, v_org_id, 'None documented', 'mild', 'Confirm annually.'),
        ('e8140501-0000-4000-8000-000000000003', p3, v_org_id, 'Sulfonamide antibiotics', 'moderate', 'Documented rash.'),
        ('e8140501-0000-4000-8000-000000000004', p4, v_org_id, 'Dairy', 'mild', 'Use lactose-free milk.'),
        ('e8140501-0000-4000-8000-000000000005', p5, v_org_id, 'Latex', 'moderate', 'Nitrile gloves only.'),
        ('e8140501-0000-4000-8000-000000000006', p6, v_org_id, 'Latex', 'mild', 'Nitrile gloves for personal care.'),
        ('e8140501-0000-4000-8000-000000000007', p7, v_org_id, 'Penicillin', 'moderate', 'Hives reaction documented.'),
        ('e8140501-0000-4000-8000-000000000008', p8, v_org_id, 'None documented', 'mild', 'Confirm annually.')
    ON CONFLICT (id) DO UPDATE SET allergen = EXCLUDED.allergen, severity = EXCLUDED.severity, notes = EXCLUDED.notes, updated_at = now();

    INSERT INTO public.participant_briefing_alerts (id, participant_id, organization_id, alert_text, sort_order, is_active) VALUES
        ('e8140601-0000-4000-8000-000000000001', p1, v_org_id, '⚠️ Tree nut allergy — check all meal ingredients.', 0, true),
        ('e8140602-0000-4000-8000-000000000001', p1, v_org_id, 'Long shifts (4h+): complete check-ins every 90 minutes.', 1, true),
        ('e8140601-0000-4000-8000-000000000002', p2, v_org_id, 'Use pictorial shopping list for Prospect Market.', 0, true),
        ('e8140601-0000-4000-8000-000000000003', p3, v_org_id, '⛔ Falls risk — gait belt in hallway cupboard.', 0, true),
        ('e8140602-0000-4000-8000-000000000003', p3, v_org_id, '⚠️ Heat sensitivity — outings before 11:00 am.', 1, true),
        ('e8140601-0000-4000-8000-000000000004', p4, v_org_id, '⚠️ Swallowing precautions — cut food into small pieces.', 0, true),
        ('e8140601-0000-4000-8000-000000000005', p5, v_org_id, '⚠️ Latex sensitivity — use non-latex gloves.', 0, true),
        ('e8140601-0000-4000-8000-000000000006', p6, v_org_id, '⚠️ Latex sensitivity — nitrile gloves only.', 0, true),
        ('e8140602-0000-4000-8000-000000000006', p6, v_org_id, 'Give 15-minute transition warnings before leaving home.', 1, true),
        ('e8140601-0000-4000-8000-000000000007', p7, v_org_id, '⚠️ Seizure precautions — time episodes; call coordinator if >5 min.', 0, true),
        ('e8140601-0000-4000-8000-000000000008', p8, v_org_id, 'Avoid Rundle Mall lunch rush — use Frome Rd route.', 0, true)
    ON CONFLICT (id) DO UPDATE SET alert_text = EXCLUDED.alert_text, is_active = true, updated_at = now();

    -- Task / compliance JSON helpers
    v_tasks_long := jsonb_build_array(
        jsonb_build_object('task_id','default_personal_hygiene','type','default','label','Personal Hygiene / Showering',
            'description','Assist with bathing, grooming, oral care.','completed',true,
            'completed_at', (t_session_start - interval '15 minutes')::text,
            'checked_at', (t_session_start - interval '15 minutes')::text,
            'note','Completed with verbal prompts.','order',1,'mandatory',true,
            'goal_id', g1a::text, 'goal_title','Independent daily living on long shifts'),
        jsonb_build_object('task_id','default_meal_prep','type','default','label','Meal Preparation',
            'description','Prepare breakfast and lunch using visual recipe.','completed',true,
            'completed_at', (t_session_start + interval '30 minutes')::text,
            'checked_at', (t_session_start + interval '30 minutes')::text,
            'note','Visual recipe followed. No nut exposure.','order',2,'mandatory',true,
            'goal_id', g1a::text, 'goal_title','Independent daily living on long shifts'),
        jsonb_build_object('task_id','default_community_access','type','default','label','Community Access',
            'description','Victoria Park walk and quiet café visit.','completed',false,
            'order',3,'mandatory',false,
            'goal_id', g1b::text, 'goal_title','Community access confidence'),
        jsonb_build_object('task_id','default_documentation','type','default','label','Documentation / Notes',
            'description','Record progress notes and check-ins.','completed',false,
            'order',4,'mandatory',true,
            'goal_id', g1a::text, 'goal_title','Independent daily living on long shifts')
    );

    v_support_long := jsonb_build_array(
        jsonb_build_object('category','Entry','body','Key lockbox code 1947 on front porch.','critical',true),
        jsonb_build_object('category','Meal support','body','Visual recipe cards in kitchen drawer — top shelf.','critical',false),
        jsonb_build_object('category','Community','body','Noise-cancelling headphones in living room cupboard if needed.','critical',false)
    );

    v_end_validation := jsonb_build_object(
        'compliance_score', 92,
        'low_compliance', false,
        'tasks_completed', 3,
        'tasks_total', 3,
        'mandatory_total', 3,
        'mandatory_with_evidence', 3,
        'mandatory_without_evidence', 0,
        'force_ended', false,
        'flagged_tasks', '[]'::jsonb
    );

    -- ── SESSION + SHIFT: Harper long in_progress ─────────────────────────────
    INSERT INTO public.sessions (
        id, patient_id, organization_id, worker_id, created_by, owner_user_id,
        session_date, start_time, session_type, duration_minutes, status,
        notes, compliance_input_text, translation_status,
        goals_addressed, support_category,
        tasks, is_long_shift, last_activity_at, max_gap_secs, checkin_count,
        break_duration_secs, billable_duration_secs, engagement_score,
        random_checkins_scheduled
    ) VALUES (
        s1, p1, v_org_id, v_worker_id, v_worker_id, v_worker_id,
        (t_session_start AT TIME ZONE 'Australia/Adelaide')::date, t_session_start, 'daily_living', 540, 'draft',
        'Harper engaged well during morning personal care and meal preparation. Community outing planned after break.',
        'Harper engaged well during morning personal care and meal preparation. Community outing planned after break.',
        'not_required',
        jsonb_build_array(g1a::text, g1b::text), 'core_daily_activities',
        v_tasks_long, true, t_last_activity, 2700, 2,
        900, 21600, 84,
        true
    ) ON CONFLICT (id) DO UPDATE SET
        start_time = EXCLUDED.start_time, session_date = EXCLUDED.session_date,
        status = EXCLUDED.status, tasks = EXCLUDED.tasks,
        is_long_shift = true, last_activity_at = EXCLUDED.last_activity_at,
        checkin_count = EXCLUDED.checkin_count, engagement_score = EXCLUDED.engagement_score,
        duration_minutes = EXCLUDED.duration_minutes,
        break_duration_secs = EXCLUDED.break_duration_secs,
        billable_duration_secs = EXCLUDED.billable_duration_secs,
        random_checkins_scheduled = true, updated_at = now();

    INSERT INTO public.shifts (
        id, organization_id, worker_id, participant_id, session_id,
        scheduled_start, scheduled_end, clocked_in_at, clocked_out_at, duration_minutes,
        participant_name, participant_dob, participant_gender,
        participant_address, participant_phone,
        allergies, health_flags, health_alerts, visit_notes,
        access_instructions, coordinator_notes, entry_instructions,
        active_goals, special_instructions, status, tasks, support_instructions,
        risks_acknowledged_at, risks_acknowledged_by
    ) VALUES (
        sh1, v_org_id, v_worker_id, p1, s1,
        t_long_in, t_long_end, t_long_in, NULL, 540,
        'Harper Lin', '1997-05-12', 'female',
        '28 The Parade, Norwood SA 5067', '0412 803 041',
        'Tree nuts, Latex',
        'Noise sensitivity; requires visual schedules',
        E'⚠️ Tree nut allergy\nGive 15-minute transition warnings\nComplete 90-min check-ins on long shifts',
        'Morning routine complete. Community outing after break.',
        'Key lockbox 1947 on front porch.',
        'Long shift demo — monitor engagement on live dashboard.',
        'Enter via front door. Lockbox on porch.',
        ARRAY['Independent daily living on long shifts (Daily Living)', 'Community access confidence (Community)'],
        'Use visual recipe for meal prep. Complete check-ins every 90 minutes.',
        'in_progress', v_tasks_long, v_support_long,
        t_long_in - interval '10 minutes', v_worker_id
    ) ON CONFLICT (id) DO UPDATE SET
        session_id = EXCLUDED.session_id, scheduled_start = EXCLUDED.scheduled_start,
        scheduled_end = EXCLUDED.scheduled_end, clocked_in_at = EXCLUDED.clocked_in_at,
        duration_minutes = EXCLUDED.duration_minutes,
        status = 'in_progress', tasks = EXCLUDED.tasks, updated_at = now();

    UPDATE public.sessions SET shift_id = sh1 WHERE id = s1;

    INSERT INTO public.shift_visit_notes (
        id, organization_id, shift_id, worker_id, session_id, content, category, created_at, updated_at
    ) VALUES (
        'e8140901-0000-4000-8000-000000000001', v_org_id, sh1, v_worker_id, s1,
        'Harper completed morning hygiene with two verbal prompts. Mood calm and cooperative.',
        'session_progress', t_session_start + interval '20 minutes', now()
    ) ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = now();

    DELETE FROM public.shift_activity_events WHERE shift_id = sh1;
    DELETE FROM public.shift_checkins WHERE shift_id = sh1;
    DELETE FROM public.shift_breaks WHERE shift_id = sh1;
    DELETE FROM public.shift_scheduled_checkins WHERE shift_id = sh1;

    INSERT INTO public.shift_activity_events (
        id, session_id, shift_id, event_type, occurred_at, worker_id, patient_id, metadata, is_billable, gap_before_secs
    ) VALUES
        ('e8140a01-0000-4000-8000-000000000001', NULL, sh1, 'CLOCK_IN', t_long_in, v_worker_id, p1, '{}'::jsonb, true, 0),
        ('e8140a02-0000-4000-8000-000000000002', s1, sh1, 'NOTE_SAVED', t_session_start, v_worker_id, p1, '{"note_type":"session_start"}'::jsonb, true, 900),
        ('e8140a03-0000-4000-8000-000000000003', s1, sh1, 'TASK_TICKED', t_session_start + interval '15 minutes', v_worker_id, p1, '{"task_id":"default_personal_hygiene"}'::jsonb, true, 900),
        ('e8140a04-0000-4000-8000-000000000004', s1, sh1, 'CHECK_IN', t_session_start + interval '90 minutes', v_worker_id, p1, '{"status":"GOING_WELL"}'::jsonb, true, 4500),
        ('e8140a05-0000-4000-8000-000000000005', s1, sh1, 'NOTE_SAVED', t_session_start + interval '2 hours', v_worker_id, p1, '{"note_type":"meal_prep"}'::jsonb, true, 1800),
        ('e8140a06-0000-4000-8000-000000000006', s1, sh1, 'CHECK_IN', t_session_start + interval '3 hours', v_worker_id, p1, '{"status":"GOING_WELL"}'::jsonb, true, 600),
        ('e8140a07-0000-4000-8000-000000000007', s1, sh1, 'TASK_TICKED', t_session_start + interval '3 hours 30 minutes', v_worker_id, p1, '{"task_id":"default_meal_prep"}'::jsonb, true, 1800),
        ('e8140a08-0000-4000-8000-000000000008', s1, sh1, 'BREAK_START', t_break_start, v_worker_id, p1, '{"active":true}'::jsonb, false, 900),
        ('e8140a09-0000-4000-8000-000000000009', s1, sh1, 'BREAK_END', t_break_end, v_worker_id, p1, '{"active":false}'::jsonb, false, 900),
        ('e8140a0a-0000-4000-8000-00000000000a', s1, sh1, 'NOTE_SAVED', t_last_activity, v_worker_id, p1, '{"note_type":"progress"}'::jsonb, true, 1500);

    INSERT INTO public.shift_checkins (
        id, session_id, shift_id, worker_id, patient_id, status, note,
        prompt_triggered_at, submitted_at, response_time_secs, gap_at_prompt_secs, coordinator_notified
    ) VALUES
        ('e8140b01-0000-4000-8000-000000000001', s1, sh1, v_worker_id, p1,
         'GOING_WELL', 'Harper calm and engaged after morning routine.',
         t_session_start + interval '85 minutes', t_session_start + interval '90 minutes', 300, 5100, false),
        ('e8140b02-0000-4000-8000-000000000002', s1, sh1, v_worker_id, p1,
         'GOING_WELL', 'Post-meal check-in — ready for community outing after break.',
         t_session_start + interval '175 minutes', t_session_start + interval '3 hours', 300, 600, false);

    INSERT INTO public.shift_breaks (
        id, session_id, shift_id, worker_id, break_start_at, break_end_at, duration_secs, is_compliant, break_number
    ) VALUES (
        'e8140c01-0000-4000-8000-000000000001', s1, sh1, v_worker_id, t_break_start, t_break_end, 900, true, 1
    );

    -- Pending random compliance check-ins (push test: first fires ~2 min after reseed)
    INSERT INTO public.shift_scheduled_checkins (
        id, session_id, shift_id, worker_id, organization_id,
        sequence_number, scheduled_at, status, created_at, updated_at
    ) VALUES
        ('e8140d01-0000-4000-8000-000000000001', s1, sh1, v_worker_id, v_org_id,
         1, t_checkin_soon, 'pending', now(), now()),
        ('e8140d02-0000-4000-8000-000000000002', s1, sh1, v_worker_id, v_org_id,
         2, t_checkin_later, 'pending', now(), now())
    ON CONFLICT (id) DO UPDATE SET
        scheduled_at = EXCLUDED.scheduled_at,
        status = 'pending',
        prompted_at = NULL,
        response_deadline_at = NULL,
        shift_checkin_id = NULL,
        notification_reference_key = NULL,
        updated_at = now();

    -- ── SCHEDULED: Miles today AM (new) ──────────────────────────────────────
    INSERT INTO public.shifts (
        id, organization_id, worker_id, participant_id, session_id,
        scheduled_start, scheduled_end, clocked_in_at, clocked_out_at, duration_minutes,
        participant_name, participant_dob, participant_gender,
        participant_address, participant_phone,
        allergies, health_flags, health_alerts, visit_notes,
        access_instructions, coordinator_notes, entry_instructions,
        active_goals, special_instructions, status, tasks, support_instructions,
        risks_acknowledged_at, risks_acknowledged_by
    ) VALUES (
        sh2, v_org_id, v_worker_id, p2, NULL,
        t_today_am_s, t_today_am_e, NULL, NULL, NULL,
        'Miles Nguyen', '1991-11-03', 'male',
        '12 Alpha Road, Prospect SA 5082', '0427 118 602',
        'None known', 'Type 2 diabetes — diet controlled',
        E'Use pictorial shopping list\nConfirm understanding by asking Miles to repeat steps',
        'New today shift — acknowledge briefing before clock-in.',
        'Unit 4 rear — intercom Nguyen.',
        'First shift of the day for Miles.',
        'Intercom access via Vine Street laneway.',
        ARRAY['Morning personal care independence', 'Community shopping skills'],
        'Morning hygiene then optional Prospect Market if regulated.',
        'scheduled', '[]'::jsonb,
        jsonb_build_array(jsonb_build_object('category','Entry','body','Intercom label Nguyen — Unit 4 rear.','critical',true)),
        NULL, NULL
    ) ON CONFLICT (id) DO UPDATE SET
        scheduled_start = EXCLUDED.scheduled_start, scheduled_end = EXCLUDED.scheduled_end,
        status = 'scheduled', updated_at = now();

    -- ── SCHEDULED: Freya incoming tomorrow ───────────────────────────────────
    INSERT INTO public.shifts (
        id, organization_id, worker_id, participant_id, session_id,
        scheduled_start, scheduled_end,
        participant_name, participant_dob, participant_gender,
        participant_address, participant_phone,
        allergies, health_flags, health_alerts, visit_notes,
        access_instructions, coordinator_notes, entry_instructions,
        active_goals, special_instructions, status, tasks,
        risks_acknowledged_at, risks_acknowledged_by
    ) VALUES (
        sh3, v_org_id, v_worker_id, p3, NULL,
        t_in1_s, t_in1_e,
        'Freya Gibson', '1988-08-21', 'female',
        '9 Moseley Street, Glenelg SA 5045', '0438 550 733',
        'Sulfonamide antibiotics',
        E'Heat sensitivity\nReduced balance — gait belt required',
        E'⛔ Falls risk — gait belt for transfers\n⚠️ Heat sensitivity — outings before 11:00 am',
        'Incoming shift — morning personal care then jetty if cool.',
        'Ramp at rear. Tom (partner) may be home.',
        'Finish community outing by 10:45 am latest.',
        'Rear ramp access preferred.',
        ARRAY['Maintain home independence', 'Safe beachside mobility'],
        'Gait belt in hallway cupboard.',
        'scheduled', '[]'::jsonb, NULL, NULL
    ) ON CONFLICT (id) DO UPDATE SET
        scheduled_start = EXCLUDED.scheduled_start, scheduled_end = EXCLUDED.scheduled_end,
        status = 'scheduled', updated_at = now();

    -- ── SCHEDULED: Callum incoming +2 days ───────────────────────────────────
    INSERT INTO public.shifts (
        id, organization_id, worker_id, participant_id, session_id,
        scheduled_start, scheduled_end,
        participant_name, participant_dob, participant_gender,
        participant_address, participant_phone,
        allergies, health_flags, health_alerts, visit_notes,
        access_instructions, coordinator_notes, entry_instructions,
        active_goals, special_instructions, status, tasks,
        risks_acknowledged_at, risks_acknowledged_by
    ) VALUES (
        sh4, v_org_id, v_worker_id, p4, NULL,
        t_in2_s, t_in2_e,
        'Callum Wright', '2002-02-14', 'male',
        '55 King William Road, Unley SA 5061', '0421 409 864',
        'Dairy intolerance',
        E'Mobility — forearm crutches\nSwallowing precautions',
        E'⚠️ Swallowing precautions — cut food into small pieces\nForearm crutches by front door',
        'Incoming: upper limb practice then Unley café if regulated.',
        'Unit 3 — intercom Wright. Visitor parking on Mitchell Street.',
        'Allow processing time; one instruction at a time.',
        'Enter via intercom; wait for Callum to open.',
        ARRAY['Upper limb fine motor practice', 'Build social confidence'],
        'Encourage independent ordering at café.',
        'scheduled', '[]'::jsonb, NULL, NULL
    ) ON CONFLICT (id) DO UPDATE SET
        scheduled_start = EXCLUDED.scheduled_start, scheduled_end = EXCLUDED.scheduled_end,
        status = 'scheduled', updated_at = now();

    -- ── COMPLETED TODAY: Isla + full compliance ──────────────────────────────
    v_tasks_done := jsonb_build_array(
        jsonb_build_object('task_id','default_personal_hygiene','type','default','label','Personal Hygiene / Showering',
            'description','Morning hygiene routine with pictorial checklist.','completed',true,
            'completed_at', (t_done_today_s + interval '35 minutes')::text,
            'checked_at', (t_done_today_s + interval '35 minutes')::text,
            'note','One verbal prompt on toothbrushing. Nitrile gloves used.','order',1,'mandatory',true,
            'goal_id', g5a::text, 'goal_title','Morning hygiene independence'),
        jsonb_build_object('task_id','default_meal_prep','type','default','label','Meal Preparation',
            'description','Breakfast with visual recipe card.','completed',true,
            'completed_at', (t_done_today_s + interval '75 minutes')::text,
            'checked_at', (t_done_today_s + interval '75 minutes')::text,
            'note','Toast and scrambled eggs completed. Workspace cleaned.','order',2,'mandatory',true,
            'goal_id', g5b::text, 'goal_title','Breakfast meal prep skills'),
        jsonb_build_object('task_id','default_documentation','type','default','label','Documentation / Notes',
            'description','Shift summary and goal progress notes.','completed',true,
            'completed_at', (t_done_today_e - interval '5 minutes')::text,
            'checked_at', (t_done_today_e - interval '5 minutes')::text,
            'note','Compliance pack complete.','order',3,'mandatory',true,
            'goal_id', g5a::text, 'goal_title','Morning hygiene independence')
    );

    INSERT INTO public.sessions (
        id, patient_id, organization_id, worker_id, created_by, owner_user_id,
        session_date, start_time, session_type, duration_minutes, status,
        notes, compliance_input_text, translated_english_note, translation_status,
        compliance_score, compliance_status, compliance_notes, end_validation,
        goals_addressed, support_category, tasks,
        activities_performed, outcomes, participant_response, progress_toward_goals
    ) VALUES (
        s5, p5, v_org_id, v_worker_id, v_worker_id, v_worker_id,
        (t_done_today_s AT TIME ZONE 'Australia/Adelaide')::date, t_done_today_s, 'daily_living', 150, 'completed',
        'Isla completed morning hygiene and breakfast meal prep with one verbal prompt. Mood positive. Nitrile gloves used throughout personal care. No incidents.',
        'Isla completed morning hygiene and breakfast meal prep with one verbal prompt. Mood positive. Nitrile gloves used throughout personal care. No incidents.',
        'Isla completed morning hygiene and breakfast meal prep with one verbal prompt. Mood positive. Nitrile gloves used throughout personal care. No incidents.',
        'not_required', 92, 'compliant',
        'Goal linkage documented. Prompting level recorded. Mandatory tasks complete with evidence. NDIS practice standards met.',
        v_end_validation,
        jsonb_build_array(g5a::text, g5b::text), 'core_daily_activities', v_tasks_done,
        'Morning hygiene checklist; breakfast meal prep with visual recipe',
        'Both mandatory tasks completed with verbal prompting only',
        'Engaged and proud of independent checklist ticking',
        'Measurable progress toward morning hygiene independence'
    ) ON CONFLICT (id) DO UPDATE SET
        status = 'completed', compliance_score = 92, compliance_status = 'compliant',
        session_date = EXCLUDED.session_date, start_time = EXCLUDED.start_time,
        tasks = EXCLUDED.tasks, end_validation = EXCLUDED.end_validation, updated_at = now();

    INSERT INTO public.shifts (
        id, organization_id, worker_id, participant_id, session_id,
        scheduled_start, scheduled_end, clocked_in_at, clocked_out_at, duration_minutes,
        participant_name, participant_dob, participant_gender,
        participant_address, participant_phone,
        allergies, health_flags, health_alerts, visit_notes,
        access_instructions, coordinator_notes, entry_instructions,
        active_goals, special_instructions, status, tasks, support_instructions,
        risks_acknowledged_at, risks_acknowledged_by
    ) VALUES (
        sh5, v_org_id, v_worker_id, p5, s5,
        t_done_today_s, t_done_today_e,
        t_done_today_s + interval '3 minutes', t_done_today_e - interval '2 minutes', 145,
        'Isla Moretti', '1993-09-30', 'female',
        '7 Seaview Road, Henley Beach SA 5022', '0415 772 905',
        'Latex — contact dermatitis',
        'Anxiety with unfamiliar workers',
        E'⚠️ Latex sensitivity — nitrile gloves only',
        'Today completed — full compliance and tasks.',
        'Rear ramp. Key safe 3381.',
        'Document prompting levels on hygiene and meal prep.',
        'Rear ramp access preferred.',
        ARRAY['Morning hygiene independence', 'Breakfast meal prep skills'],
        'Use pictorial checklist and visual recipe.',
        'completed', v_tasks_done,
        jsonb_build_array(jsonb_build_object('category','PPE','body','Nitrile gloves in bathroom drawer.','critical',true)),
        t_done_today_s - interval '8 minutes', v_worker_id
    ) ON CONFLICT (id) DO UPDATE SET
        session_id = EXCLUDED.session_id, status = 'completed', tasks = EXCLUDED.tasks,
        clocked_in_at = EXCLUDED.clocked_in_at, clocked_out_at = EXCLUDED.clocked_out_at, updated_at = now();

    UPDATE public.sessions SET shift_id = sh5 WHERE id = s5;

    INSERT INTO public.shift_tasks (id, shift_id, task_id, organization_id) VALUES
        ('e8140501-0000-4000-a000-000000000005', sh5, t5a, v_org_id),
        ('e8140502-0000-4000-a000-000000000005', sh5, t5b, v_org_id)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.budget_usage (
        id, plan_id, session_id, category, amount, hourly_rate, duration_minutes, description
    ) VALUES (
        'e8141005-0000-4000-8000-000000000005', pl5, s5, 'core',
        168.90, 67.56, 150, 'Daily living — Isla Moretti (today completed)'
    ) ON CONFLICT (id) DO UPDATE SET amount = EXCLUDED.amount, duration_minutes = EXCLUDED.duration_minutes;

    -- ── PAST COMPLETED LONG: Noah (6h) ───────────────────────────────────────
    v_tasks_done := jsonb_build_array(
        jsonb_build_object('task_id','default_meal_prep','type','default','label','Meal Preparation',
            'description','Visual recipe meal prep.','completed',true,
            'completed_at', (t_past1_s + interval '50 minutes')::text,
            'note','Scrambled eggs and toast; two verbal prompts for stove timing.','order',1,'mandatory',true,
            'goal_id', g6a::text, 'goal_title','Independent meal preparation'),
        jsonb_build_object('task_id','default_community_access','type','default','label','Community Access',
            'description','Quiet Torrens walk + café.','completed',true,
            'completed_at', (t_past1_s + interval '4 hours')::text,
            'note','Tolerated Linear Park walk well with headphones available.','order',2,'mandatory',false,
            'goal_id', g6b::text, 'goal_title','Increase community participation'),
        jsonb_build_object('task_id','default_documentation','type','default','label','Documentation / Notes',
            'description','Progress notes and long-shift check-ins.','completed',true,
            'completed_at', (t_past1_e - interval '5 minutes')::text,
            'note','Prompting levels, check-ins and goals documented.','order',3,'mandatory',true,
            'goal_id', g6a::text, 'goal_title','Independent meal preparation')
    );

    INSERT INTO public.sessions (
        id, patient_id, organization_id, worker_id, created_by, owner_user_id,
        session_date, start_time, session_type, duration_minutes, status,
        notes, compliance_input_text, translated_english_note, translation_status,
        compliance_score, compliance_status, compliance_notes, end_validation,
        goals_addressed, support_category, tasks,
        activities_performed, outcomes, participant_response, progress_toward_goals,
        is_long_shift, last_activity_at, max_gap_secs, checkin_count,
        break_duration_secs, billable_duration_secs, engagement_score
    ) VALUES (
        s6, p6, v_org_id, v_worker_id, v_worker_id, v_worker_id,
        (t_past1_s AT TIME ZONE 'Australia/Adelaide')::date, t_past1_s, 'community_access', 360, 'completed',
        'Noah completed a 6-hour community access shift with structured check-ins and one compliant break. Meal prep first, then Torrens walk. Incident-free.',
        'Noah completed a 6-hour community access shift with structured check-ins and one compliant break. Meal prep first, then Torrens walk. Incident-free.',
        'Noah completed a 6-hour community access shift with structured check-ins and one compliant break. Meal prep first, then Torrens walk. Incident-free.',
        'not_required', 91, 'compliant',
        'Long-shift check-ins completed. Goal linkage documented. Prompting level recorded. No restrictive practices.',
        jsonb_build_object('compliance_score',91,'low_compliance',false,'tasks_completed',3,'tasks_total',3,
            'mandatory_total',2,'mandatory_with_evidence',2,'mandatory_without_evidence',0,'force_ended',false,'flagged_tasks','[]'::jsonb),
        jsonb_build_array(g6a::text, g6b::text), 'core_social_community', v_tasks_done,
        'Meal preparation with visual recipe; Torrens Linear Park walk; scheduled check-ins',
        '6-hour long shift completed with verbal prompting only; community walk completed',
        'Engaged throughout; requested to repeat cook session next week',
        'Measurable progress toward independent meal preparation',
        true, t_past1_e - interval '10 minutes', 5400, 3,
        1200, 20400, 86
    ) ON CONFLICT (id) DO UPDATE SET
        status = 'completed', compliance_score = 91, compliance_status = 'compliant',
        session_date = EXCLUDED.session_date, start_time = EXCLUDED.start_time,
        tasks = EXCLUDED.tasks, is_long_shift = true,
        checkin_count = EXCLUDED.checkin_count, engagement_score = EXCLUDED.engagement_score,
        duration_minutes = EXCLUDED.duration_minutes, updated_at = now();

    INSERT INTO public.shifts (
        id, organization_id, worker_id, participant_id, session_id,
        scheduled_start, scheduled_end, clocked_in_at, clocked_out_at, duration_minutes,
        participant_name, participant_dob, participant_gender,
        participant_address, participant_phone,
        allergies, health_flags, health_alerts, visit_notes,
        access_instructions, coordinator_notes, entry_instructions,
        active_goals, special_instructions, status, tasks,
        risks_acknowledged_at, risks_acknowledged_by
    ) VALUES (
        sh6, v_org_id, v_worker_id, p6, s6,
        t_past1_s, t_past1_e, t_past1_s + interval '2 minutes', t_past1_e, 360,
        'Noah Patel', '1999-01-18', 'male',
        '14 Melbourne Street, North Adelaide SA 5006', '0419 660 216',
        'Latex — mild contact dermatitis',
        'Sensory sensitivity in noisy environments',
        E'⚠️ Latex sensitivity — nitrile gloves\nGive 15-minute transition warnings\nLong shift: check-ins every 90 minutes',
        'Past completed LONG shift (6h) with full compliance.',
        'Key safe 4821 on left fence post.',
        '6-hour community access — review engagement / check-ins.',
        'Enter via front door.',
        ARRAY['Independent meal preparation', 'Increase community participation'],
        'Use pictorial recipe card. Complete 90-min check-ins.',
        'completed', v_tasks_done,
        t_past1_s - interval '10 minutes', v_worker_id
    ) ON CONFLICT (id) DO UPDATE SET
        session_id = EXCLUDED.session_id, status = 'completed', tasks = EXCLUDED.tasks,
        scheduled_start = EXCLUDED.scheduled_start, scheduled_end = EXCLUDED.scheduled_end,
        clocked_in_at = EXCLUDED.clocked_in_at, clocked_out_at = EXCLUDED.clocked_out_at,
        duration_minutes = EXCLUDED.duration_minutes, updated_at = now();

    UPDATE public.sessions SET shift_id = sh6 WHERE id = s6;

    INSERT INTO public.shift_tasks (id, shift_id, task_id, organization_id) VALUES
        ('e8140501-0000-4000-a000-000000000006', sh6, t6a, v_org_id),
        ('e8140502-0000-4000-a000-000000000006', sh6, t6b, v_org_id)
    ON CONFLICT (id) DO NOTHING;

    DELETE FROM public.shift_activity_events WHERE shift_id = sh6;
    DELETE FROM public.shift_checkins WHERE shift_id = sh6;
    DELETE FROM public.shift_breaks WHERE shift_id = sh6;

    INSERT INTO public.shift_activity_events (
        id, session_id, shift_id, event_type, occurred_at, worker_id, patient_id, metadata, is_billable, gap_before_secs
    ) VALUES
        ('e8140d01-0000-4000-8000-000000000006', s6, sh6, 'CLOCK_IN',    t_past1_s, v_worker_id, p6, '{}'::jsonb, true, 0),
        ('e8140d02-0000-4000-8000-000000000006', s6, sh6, 'TASK_TICKED', t_past1_s + interval '50 minutes', v_worker_id, p6, '{"task_id":"default_meal_prep"}'::jsonb, true, 3000),
        ('e8140d03-0000-4000-8000-000000000006', s6, sh6, 'CHECK_IN',    t_past1_s + interval '90 minutes', v_worker_id, p6, '{"status":"GOING_WELL"}'::jsonb, true, 2400),
        ('e8140d04-0000-4000-8000-000000000006', s6, sh6, 'BREAK_START', t_past1_s + interval '3 hours', v_worker_id, p6, '{}'::jsonb, false, 5400),
        ('e8140d05-0000-4000-8000-000000000006', s6, sh6, 'BREAK_END',   t_past1_s + interval '3 hours 20 minutes', v_worker_id, p6, '{"duration_secs":1200}'::jsonb, false, 1200),
        ('e8140d06-0000-4000-8000-000000000006', s6, sh6, 'CHECK_IN',    t_past1_s + interval '4 hours 30 minutes', v_worker_id, p6, '{"status":"GOING_WELL"}'::jsonb, true, 4200),
        ('e8140d07-0000-4000-8000-000000000006', s6, sh6, 'CHECK_IN',    t_past1_s + interval '5 hours 30 minutes', v_worker_id, p6, '{"status":"GOING_WELL"}'::jsonb, true, 3600),
        ('e8140d08-0000-4000-8000-000000000006', s6, sh6, 'CLOCK_OUT',   t_past1_e, v_worker_id, p6, '{}'::jsonb, true, 1800);

    INSERT INTO public.shift_checkins (
        id, session_id, shift_id, worker_id, patient_id, status, note,
        prompt_triggered_at, submitted_at, response_time_secs, coordinator_notified
    ) VALUES
        ('e8140e01-0000-4000-8000-000000000006', s6, sh6, v_worker_id, p6,
         'GOING_WELL', 'Post meal-prep — calm and ready for outing.',
         t_past1_s + interval '85 minutes', t_past1_s + interval '90 minutes', 300, false),
        ('e8140e02-0000-4000-8000-000000000006', s6, sh6, v_worker_id, p6,
         'GOING_WELL', 'Mid-afternoon park walk going well.',
         t_past1_s + interval '4 hours 25 minutes', t_past1_s + interval '4 hours 30 minutes', 300, false),
        ('e8140e03-0000-4000-8000-000000000006', s6, sh6, v_worker_id, p6,
         'GOING_WELL', 'Final check-in before clock-out.',
         t_past1_s + interval '5 hours 25 minutes', t_past1_s + interval '5 hours 30 minutes', 300, false);

    INSERT INTO public.shift_breaks (
        id, session_id, shift_id, worker_id, break_start_at, break_end_at, duration_secs, is_compliant, break_number
    ) VALUES (
        'e8140f01-0000-4000-8000-000000000006', s6, sh6, v_worker_id,
        t_past1_s + interval '3 hours', t_past1_s + interval '3 hours 20 minutes', 1200, true, 1
    );

    INSERT INTO public.budget_usage (
        id, plan_id, session_id, category, amount, hourly_rate, duration_minutes, description
    ) VALUES (
        'e8141006-0000-4000-8000-000000000006', pl6, s6, 'core',
        405.36, 67.56, 360, 'Community access long shift — Noah Patel (past completed 6h)'
    ) ON CONFLICT (id) DO UPDATE SET amount = EXCLUDED.amount, duration_minutes = EXCLUDED.duration_minutes;

    -- ── PAST COMPLETED LONG: Ava (6.5h) ──────────────────────────────────────
    v_tasks_done := jsonb_build_array(
        jsonb_build_object('task_id','default_personal_hygiene','type','default','label','Personal Hygiene / Showering',
            'description','Whiteboard daily routine — personal care.','completed',true,
            'completed_at', (t_past2_s + interval '40 minutes')::text,
            'note','Completed with written prompts; medication confirmed taken.','order',1,'mandatory',true,
            'goal_id', g7a::text, 'goal_title','Rebuild daily living routines'),
        jsonb_build_object('task_id','default_domestic','type','default','label','Domestic Assistance',
            'description','Light domestic tasks and garden prep checklist.','completed',true,
            'completed_at', (t_past2_s + interval '2 hours')::text,
            'note','Domestic checklist complete; cooking not left unattended.','order',2,'mandatory',true,
            'goal_id', g7a::text, 'goal_title','Rebuild daily living routines'),
        jsonb_build_object('task_id','default_community_access','type','default','label','Community Access',
            'description','Community garden volunteering support.','completed',true,
            'completed_at', (t_past2_s + interval '5 hours')::text,
            'note','Attended garden session; reviewed volunteer role.','order',3,'mandatory',false,
            'goal_id', g7b::text, 'goal_title','Return to part-time volunteering'),
        jsonb_build_object('task_id','default_documentation','type','default','label','Documentation / Notes',
            'description','Progress notes and long-shift check-ins.','completed',true,
            'completed_at', (t_past2_e - interval '5 minutes')::text,
            'note','Seizure precautions observed; check-ins complete; incident-free.','order',4,'mandatory',true,
            'goal_id', g7a::text, 'goal_title','Rebuild daily living routines')
    );

    INSERT INTO public.sessions (
        id, patient_id, organization_id, worker_id, created_by, owner_user_id,
        session_date, start_time, session_type, duration_minutes, status,
        notes, compliance_input_text, translated_english_note, translation_status,
        compliance_score, compliance_status, compliance_notes, end_validation,
        goals_addressed, support_category, tasks,
        activities_performed, outcomes, participant_response, progress_toward_goals,
        is_long_shift, last_activity_at, max_gap_secs, checkin_count,
        break_duration_secs, billable_duration_secs, engagement_score
    ) VALUES (
        s7, p7, v_org_id, v_worker_id, v_worker_id, v_worker_id,
        (t_past2_s AT TIME ZONE 'Australia/Adelaide')::date, t_past2_s, 'daily_living', 390, 'completed',
        'Ava completed a 6.5-hour long shift: whiteboard personal care, domestic checklist, then community garden volunteering. Medication confirmed. One compliant break. No seizure activity. Incident-free.',
        'Ava completed a 6.5-hour long shift: whiteboard personal care, domestic checklist, then community garden volunteering. Medication confirmed. One compliant break. No seizure activity. Incident-free.',
        'Ava completed a 6.5-hour long shift: whiteboard personal care, domestic checklist, then community garden volunteering. Medication confirmed. One compliant break. No seizure activity. Incident-free.',
        'not_required', 90, 'compliant',
        'Long-shift engagement pack complete. Seizure precautions followed. Mandatory tasks evidenced.',
        jsonb_build_object('compliance_score',90,'low_compliance',false,'tasks_completed',4,'tasks_total',4,
            'mandatory_total',3,'mandatory_with_evidence',3,'mandatory_without_evidence',0,'force_ended',false,'flagged_tasks','[]'::jsonb),
        jsonb_build_array(g7a::text, g7b::text), 'core_daily_activities', v_tasks_done,
        'Whiteboard routine; domestic tasks; community garden; scheduled check-ins',
        '6.5-hour long shift completed with written prompts; volunteer session attended',
        'Calm and cooperative; looking forward to next garden session',
        'Progress rebuilding daily living routines',
        true, t_past2_e - interval '15 minutes', 5400, 3,
        1200, 22200, 82
    ) ON CONFLICT (id) DO UPDATE SET
        status = 'completed', compliance_score = 90, compliance_status = 'compliant',
        session_date = EXCLUDED.session_date, start_time = EXCLUDED.start_time,
        tasks = EXCLUDED.tasks, is_long_shift = true,
        checkin_count = EXCLUDED.checkin_count, engagement_score = EXCLUDED.engagement_score,
        duration_minutes = EXCLUDED.duration_minutes, updated_at = now();

    INSERT INTO public.shifts (
        id, organization_id, worker_id, participant_id, session_id,
        scheduled_start, scheduled_end, clocked_in_at, clocked_out_at, duration_minutes,
        participant_name, participant_dob, participant_gender,
        participant_address, participant_phone,
        allergies, health_flags, health_alerts, visit_notes,
        access_instructions, coordinator_notes, entry_instructions,
        active_goals, special_instructions, status, tasks,
        risks_acknowledged_at, risks_acknowledged_by
    ) VALUES (
        sh7, v_org_id, v_worker_id, p7, s7,
        t_past2_s, t_past2_e, t_past2_s + interval '4 minutes', t_past2_e, 390,
        'Ava Richter', '1986-12-07', 'female',
        '22 Magill Road, Magill SA 5072', '0432 918 447',
        'Penicillin — hives',
        E'Seizure history (controlled)\nDo not leave cooking unattended',
        E'⚠️ Seizure precautions — time episodes; call coordinator if >5 min\nLong shift: check-ins every 90 minutes',
        'Past completed LONG shift (6.5h) with full compliance.',
        'Handrail at front step. Park in driveway if free.',
        'Review engagement score and check-in trail in audit pack.',
        'Small step — use handrail.',
        ARRAY['Rebuild daily living routines', 'Return to part-time volunteering'],
        'Whiteboard checklist. Complete 90-min check-ins on long shift.',
        'completed', v_tasks_done,
        t_past2_s - interval '12 minutes', v_worker_id
    ) ON CONFLICT (id) DO UPDATE SET
        session_id = EXCLUDED.session_id, status = 'completed', tasks = EXCLUDED.tasks,
        scheduled_start = EXCLUDED.scheduled_start, scheduled_end = EXCLUDED.scheduled_end,
        clocked_in_at = EXCLUDED.clocked_in_at, clocked_out_at = EXCLUDED.clocked_out_at,
        duration_minutes = EXCLUDED.duration_minutes, updated_at = now();

    UPDATE public.sessions SET shift_id = sh7 WHERE id = s7;

    INSERT INTO public.shift_tasks (id, shift_id, task_id, organization_id) VALUES
        ('e8140501-0000-4000-a000-000000000007', sh7, t7a, v_org_id),
        ('e8140502-0000-4000-a000-000000000007', sh7, t7b, v_org_id)
    ON CONFLICT (id) DO NOTHING;

    DELETE FROM public.shift_activity_events WHERE shift_id = sh7;
    DELETE FROM public.shift_checkins WHERE shift_id = sh7;
    DELETE FROM public.shift_breaks WHERE shift_id = sh7;

    INSERT INTO public.shift_activity_events (
        id, session_id, shift_id, event_type, occurred_at, worker_id, patient_id, metadata, is_billable, gap_before_secs
    ) VALUES
        ('e8140d01-0000-4000-8000-000000000007', s7, sh7, 'CLOCK_IN',    t_past2_s, v_worker_id, p7, '{}'::jsonb, true, 0),
        ('e8140d02-0000-4000-8000-000000000007', s7, sh7, 'CHECK_IN',    t_past2_s + interval '90 minutes', v_worker_id, p7, '{"status":"GOING_WELL"}'::jsonb, true, 5400),
        ('e8140d03-0000-4000-8000-000000000007', s7, sh7, 'BREAK_START', t_past2_s + interval '3 hours', v_worker_id, p7, '{}'::jsonb, false, 5400),
        ('e8140d04-0000-4000-8000-000000000007', s7, sh7, 'BREAK_END',   t_past2_s + interval '3 hours 20 minutes', v_worker_id, p7, '{"duration_secs":1200}'::jsonb, false, 1200),
        ('e8140d05-0000-4000-8000-000000000007', s7, sh7, 'CHECK_IN',    t_past2_s + interval '4 hours 30 minutes', v_worker_id, p7, '{"status":"GOING_WELL"}'::jsonb, true, 4200),
        ('e8140d06-0000-4000-8000-000000000007', s7, sh7, 'CHECK_IN',    t_past2_s + interval '6 hours', v_worker_id, p7, '{"status":"GOING_WELL"}'::jsonb, true, 5400),
        ('e8140d07-0000-4000-8000-000000000007', s7, sh7, 'CLOCK_OUT',   t_past2_e, v_worker_id, p7, '{}'::jsonb, true, 1800);

    INSERT INTO public.shift_checkins (
        id, session_id, shift_id, worker_id, patient_id, status, note,
        prompt_triggered_at, submitted_at, response_time_secs, coordinator_notified
    ) VALUES
        ('e8140e01-0000-4000-8000-000000000007', s7, sh7, v_worker_id, p7,
         'GOING_WELL', 'Personal care complete; medication confirmed.',
         t_past2_s + interval '85 minutes', t_past2_s + interval '90 minutes', 300, false),
        ('e8140e02-0000-4000-8000-000000000007', s7, sh7, v_worker_id, p7,
         'GOING_WELL', 'At community garden — Ava engaged.',
         t_past2_s + interval '4 hours 25 minutes', t_past2_s + interval '4 hours 30 minutes', 300, false),
        ('e8140e03-0000-4000-8000-000000000007', s7, sh7, v_worker_id, p7,
         'GOING_WELL', 'Final check-in before return home.',
         t_past2_s + interval '5 hours 55 minutes', t_past2_s + interval '6 hours', 300, false);

    INSERT INTO public.shift_breaks (
        id, session_id, shift_id, worker_id, break_start_at, break_end_at, duration_secs, is_compliant, break_number
    ) VALUES (
        'e8140f01-0000-4000-8000-000000000007', s7, sh7, v_worker_id,
        t_past2_s + interval '3 hours', t_past2_s + interval '3 hours 20 minutes', 1200, true, 1
    );

    INSERT INTO public.budget_usage (
        id, plan_id, session_id, category, amount, hourly_rate, duration_minutes, description
    ) VALUES (
        'e8141007-0000-4000-8000-000000000007', pl7, s7, 'core',
        439.14, 67.56, 390, 'Daily living long shift — Ava Richter (past completed 6.5h)'
    ) ON CONFLICT (id) DO UPDATE SET amount = EXCLUDED.amount, duration_minutes = EXCLUDED.duration_minutes;

    -- ── SCHEDULED: Ethan today PM (8th / new today) ──────────────────────────
    INSERT INTO public.shifts (
        id, organization_id, worker_id, participant_id, session_id,
        scheduled_start, scheduled_end,
        participant_name, participant_dob, participant_gender,
        participant_address, participant_phone,
        allergies, health_flags, health_alerts, visit_notes,
        access_instructions, coordinator_notes, entry_instructions,
        active_goals, special_instructions, status, tasks,
        risks_acknowledged_at, risks_acknowledged_by
    ) VALUES (
        sh8, v_org_id, v_worker_id, p8, NULL,
        t_today_pm_s, t_today_pm_e,
        'Ethan Brooks', '1995-06-25', 'male',
        '42 Hutt Street, Adelaide SA 5000', '0408 331 598',
        'None known',
        'Noise sensitivity in busy CBD',
        E'Avoid Rundle Mall lunch rush — use Frome Rd route',
        'New today afternoon shift — acknowledge briefing before clock-in.',
        'Lockbox 2847 on meter box.',
        'Quiet café outing if domestic checklist complete.',
        'Front door — lockbox on left of meter box.',
        ARRAY['Domestic task sequencing', 'Quiet community access'],
        'Follow fridge visual schedule before outing.',
        'scheduled', '[]'::jsonb, NULL, NULL
    ) ON CONFLICT (id) DO UPDATE SET
        scheduled_start = EXCLUDED.scheduled_start, scheduled_end = EXCLUDED.scheduled_end,
        status = 'scheduled', updated_at = now();

    -- ══════════════════════════════════════════════════════════════════════════
    -- INCIDENT REPORTS — completed shifts only (Isla, Noah, Ava)
    -- ══════════════════════════════════════════════════════════════════════════
    INSERT INTO public.incidents (
        id, organization_id, participant_id, session_id, shift_id,
        title, description, incident_type, severity, status,
        incident_date, reported_date, resolved_date,
        location, witnesses,
        ndis_reportable, practice_standard,
        participant_impact, worker_actions, investigation_notes, corrective_actions,
        follow_up_required, follow_up_date,
        created_by, user_id,
        worker_report_type, behaviour_subtype,
        participant_present, participant_harmed,
        escalate, photo_urls, photo_metadata
    ) VALUES
        -- Isla — today completed: near-miss latex PPE
        (
            'e8141101-0000-4000-8000-000000000005', v_org_id, p5, s5, sh5,
            'Near miss — latex gloves found in bathroom drawer',
            E'During morning personal care, Isla reached for gloves in the bathroom drawer. A box of latex gloves (left by previous agency) was found beside the nitrile supply. Worker intercepted before contact. No skin reaction occurred.\n'
            || E'Latex sensitivity is documented on file. Nitrile gloves used for the remainder of the shift.',
            'near_miss', 'low', 'resolved',
            t_done_today_s + interval '25 minutes',
            t_done_today_s + interval '40 minutes',
            t_done_today_e + interval '1 hour',
            '7 Seaview Road, Henley Beach SA 5022 — bathroom',
            'Support worker (Haula Grixellou)',
            false, 'Standard 2.1 — Risk management',
            'No harm. Brief anxiety when gloves were removed from drawer; settled after explanation.',
            E'1. Removed latex gloves from bathroom immediately.\n2. Used nitrile gloves for personal care.\n3. Notified coordinator via incident report before clock-out.',
            'Coordinator confirmed latex PPE purged from site after shift. Key safe note updated.',
            E'1. Remove all latex PPE from premises.\n2. Label bathroom drawer "NITRILE ONLY".\n3. Briefing alert already flags latex — remind relieving workers.',
            true, (t_done_today_s::date + 7),
            v_worker_id, v_worker_id,
            'safety_hazard', NULL,
            true, 'no',
            false, '{}'::text[], '[]'::jsonb
        ),
        -- Noah — past long completed: behaviour / sensory escalation during outing
        (
            'e8141101-0000-4000-8000-000000000006', v_org_id, p6, s6, sh6,
            'Participant behaviour — sensory overwhelm at Central Market edge',
            E'During the community portion of a 6-hour shift, Noah became distressed near a busy market entrance (covering ears, pacing, reduced eye contact). No aggression toward others.\n'
            || E'Worker offered noise-cancelling headphones and redirected to Torrens Linear Park quieter path. Noah regulated within ~10 minutes and continued the outing.',
            'behaviour_of_concern', 'medium', 'resolved',
            t_past1_s + interval '4 hours 10 minutes',
            t_past1_s + interval '4 hours 25 minutes',
            t_past1_e + interval '2 hours',
            'Adelaide Central Market precinct → Torrens Linear Park, Adelaide SA',
            'Support worker (Haula Grixellou); no members of public involved',
            false, 'Standard 4.2 — Behaviour support',
            'Temporary sensory distress; no injury. Able to continue supported outing after de-escalation.',
            E'1. Reduced environmental stimuli (moved away from entrance).\n2. Offered headphones and processing time.\n3. Documented prompting and check-in status GOING_WELL after recovery.\n4. Logged incident before clock-out.',
            'BSP strategies followed. No escalation to restrictive practice. Coordinator reviewed engagement trail.',
            E'1. Prefer quieter Torrens routes on long community days.\n2. Carry headphones as standard on Noah community shifts.\n3. Avoid peak market times where possible.',
            true, (t_past1_s::date + 14),
            v_worker_id, v_worker_id,
            'participant_behaviour', 'verbal',
            true, 'no',
            false, '{}'::text[], '[]'::jsonb
        ),
        -- Ava — past long completed: near-miss fall / environmental
        (
            'e8141101-0000-4000-8000-000000000007', v_org_id, p7, s7, sh7,
            'Near miss — trip hazard on Magill Road driveway step',
            E'During return from community garden on a 6.5-hour shift, Ava mis-stepped on the front driveway step. Worker provided standby assist via handrail; Ava regained balance. No fall, no injury, no seizure activity.\n'
            || E'Seizure precautions remained in place throughout. Medication confirmed earlier in shift.',
            'near_miss', 'low', 'closed',
            t_past2_s + interval '5 hours 45 minutes',
            t_past2_s + interval '6 hours',
            t_past2_e + interval '1 day',
            '22 Magill Road, Magill SA 5072 — front driveway step',
            'Support worker (Haula Grixellou)',
            false, 'Standard 3.1 — Safe environment',
            'No injury. Ava reported feeling startled but okay after a short sit-down.',
            E'1. Immediate standby assist and verbal cue to use handrail.\n2. Seated rest and observation for 10 minutes (no seizure signs).\n3. Documented near miss and notified via incident report.',
            'Site hazard noted. Coordinator closed after confirming handrail intact and step edge visibility adequate in daylight.',
            E'1. Add high-visibility strip to step edge if night returns occur.\n2. Remind workers: standby at front step on arrival/departure.\n3. Keep seizure timing card accessible.',
            false, NULL,
            v_worker_id, v_worker_id,
            'safety_hazard', NULL,
            true, 'no',
            false, '{}'::text[], '[]'::jsonb
        )
    ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        incident_type = EXCLUDED.incident_type,
        severity = EXCLUDED.severity,
        status = EXCLUDED.status,
        incident_date = EXCLUDED.incident_date,
        session_id = EXCLUDED.session_id,
        shift_id = EXCLUDED.shift_id,
        worker_actions = EXCLUDED.worker_actions,
        corrective_actions = EXCLUDED.corrective_actions,
        updated_at = now();

    -- Link Noah mid-shift check-in to the behaviour incident (if column allows)
    UPDATE public.shift_checkins
       SET linked_incident_id = 'e8141101-0000-4000-8000-000000000006',
           status = 'NEEDS_ATTENTION',
           note = 'Brief sensory overwhelm near market — de-escalated with headphones; incident logged.',
           coordinator_notified = true
     WHERE id = 'e8140e02-0000-4000-8000-000000000006';

    RAISE NOTICE 'Seed complete for worker % — 8 Adelaide participants', v_worker_id;
END $$;

COMMIT;

-- Verification
SELECT p.full_name, p.phone, s.status AS shift_status,
       sess.compliance_score, sess.is_long_shift,
       i.title AS incident_title, i.incident_type, i.severity, i.status AS incident_status
FROM public.patients p
JOIN public.shifts s ON s.participant_id = p.id AND s.worker_id = '97c486f6-f189-4245-92a0-c22b37d94c36'
LEFT JOIN public.sessions sess ON sess.id = s.session_id
LEFT JOIN public.incidents i ON i.shift_id = s.id
WHERE p.assigned_worker_id = '97c486f6-f189-4245-92a0-c22b37d94c36'
ORDER BY s.scheduled_start;
