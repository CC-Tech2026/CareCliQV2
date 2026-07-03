-- =============================================================================
-- CARECLIQV2-327 / 328 / 329 — UI test seed (complete data)
-- -----------------------------------------------------------------------------
-- Coordinator : e704e016-689d-4d93-9577-691a5ba5879b
-- Worker      : 97c486f6-f189-4245-92a0-c22b37d94c36
-- Org         : a1111111-1111-1111-1111-111111111111
--
-- Participants created:
--   Tessa PlanReady  (d3270001…) — active NDIS plan, goals, tasks, COMPLETED
--                                  shift awaiting verification (327)
--   Oliver NoPlan    (d3270002…) — NO ndis_plans row (328 plan-gate negative)
--
-- UI quick links (after seed):
--   Tessa goals tab : /patients?id=d3270001-0000-4000-8000-000000000001&tab=goals_tasks
--   Oliver goals tab: /patients?id=d3270002-0000-4000-8000-000000000002&tab=goals_tasks
--   Shift verify    : /coordinator/shift-verification
--
-- Prerequisites:
--   • Migrations through 092 applied
--   • Coordinator + worker users exist in public.users for the org above
--
-- Safe to re-run: fixed UUIDs + ON CONFLICT upserts; clears verification on test shift.
-- =============================================================================

BEGIN;

DO $$
DECLARE
    v_org_id         uuid := 'a1111111-1111-1111-1111-111111111111';
    v_coordinator_id uuid := 'e704e016-689d-4d93-9577-691a5ba5879b';
    v_worker_id      uuid := '97c486f6-f189-4245-92a0-c22b37d94c36';

    -- Tessa PlanReady (with plan)
    v_patient_ok     uuid := 'd3270001-0000-4000-8000-000000000001';
    v_plan_ok        uuid := 'd3270201-0000-4000-8000-000000000001';
    v_goal_ok        uuid := 'd3270301-0000-4000-8000-000000000001';
    v_goal_review    uuid := 'd3270302-0000-4000-8000-000000000002';
    v_task_1         uuid := 'd3270401-0000-4000-8000-000000000001';
    v_task_2         uuid := 'd3270402-0000-4000-8000-000000000002';
    v_shift_verify   uuid := 'd3270701-0000-4000-8000-000000000001';
    v_session_verify uuid := 'd3270801-0000-4000-8000-000000000001';
    v_alloc_ok       uuid := 'd3270101-0000-4000-8000-000000000001';

    -- Oliver NoPlan (no plan)
    v_patient_noplan uuid := 'd3270002-0000-4000-8000-000000000002';
    v_alloc_noplan   uuid := 'd3270102-0000-4000-8000-000000000002';

    v_price_item_id  uuid := 'd3270901-0000-4000-8000-000000000001';

    v_tasks_done     jsonb;
    v_end_validation jsonb;

    t_sched_start    timestamptz := date_trunc('day', now() AT TIME ZONE 'Australia/Adelaide') AT TIME ZONE 'Australia/Adelaide' - interval '1 day' + interval '9 hours';
    t_sched_end      timestamptz := t_sched_start + interval '2 hours';
    t_clock_in       timestamptz := t_sched_start + interval '5 minutes';
    t_clock_out      timestamptz := t_sched_start + interval '2 hours 5 minutes';
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = v_coordinator_id AND organization_id = v_org_id
    ) THEN
        RAISE EXCEPTION 'Coordinator % not found in org %. Create users first.', v_coordinator_id, v_org_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = v_worker_id AND organization_id = v_org_id
    ) THEN
        RAISE EXCEPTION 'Worker % not found in org %. Create users first.', v_worker_id, v_org_id;
    END IF;

    -- ── NDIS price item for shift verification dropdown (327) ─────────────────
  IF NOT EXISTS (
        SELECT 1 FROM public.ndis_price_items
        WHERE organization_id = v_org_id AND item_code = '01_011_0107_1_1' AND valid_to IS NULL
    ) THEN
        INSERT INTO public.ndis_price_items (
            id, organization_id, item_code,
            support_category_number, support_category_name, support_purpose, registration_group,
            name, description, unit,
            price_national, price_remote, price_very_remote,
            day_type, time_type, support_intensity,
            valid_from, valid_to, edited_by, edited_at
        ) VALUES (
            v_price_item_id, v_org_id, '01_011_0107_1_1',
            '01', 'Assistance with Daily Life', 'Core Supports', '0107',
            'Assistance With Self-Care Activities - Standard - Weekday Daytime',
            'UI test seed — weekday personal care rate for shift verification.',
            'H',
            6756.00, 7432.00, 8108.00,
            'Weekday', 'Daytime', 'Standard',
            '2025-07-01'::timestamptz, NULL, v_coordinator_id, now()
        )
        ON CONFLICT (id) DO NOTHING;
    END IF;

    -- ══════════════════════════════════════════════════════════════════════════
    -- TESSA PLANREADY — happy path (327 + 329 partial)
    -- ══════════════════════════════════════════════════════════════════════════
    INSERT INTO public.patients (
        id, organization_id, full_name, preferred_name, ndis_number, date_of_birth,
        biological_sex, email, phone, address,
        plan_status, plan_start_date, plan_end_date, total_budget,
        plan_management_type, primary_disability,
        emergency_contact,
        assigned_worker_id, created_by, owner_user_id, updated_at
    ) VALUES (
        v_patient_ok, v_org_id,
        'Tessa PlanReady', 'Tess', '4399000327', '1994-08-12', 'female',
        'tessa.planready@example.com', '0411 327 001',
        '18 King William Street, Adelaide SA 5000',
        'active', '2026-01-01', '2026-12-31', 48000.00,
        'plan-managed', 'Intellectual Disability',
        jsonb_build_object('name', 'Karen PlanReady', 'phone', '0412 327 001', 'relationship', 'Mother'),
        v_worker_id, v_coordinator_id, v_coordinator_id, now()
    )
    ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        plan_status = EXCLUDED.plan_status,
        assigned_worker_id = EXCLUDED.assigned_worker_id,
        updated_at = now();

    INSERT INTO public.practitioner_allocations (
        id, patient_id, user_id, allocated_role, organization_id, assigned_by, is_active
    ) VALUES (
        v_alloc_ok, v_patient_ok, v_worker_id, 'support_worker', v_org_id, v_coordinator_id, true
    )
    ON CONFLICT (patient_id, user_id) DO UPDATE SET
        is_active = true,
        assigned_by = EXCLUDED.assigned_by,
        organization_id = EXCLUDED.organization_id;

    INSERT INTO public.ndis_plans (
        id, organization_id, patient_id, plan_number, plan_start, plan_end, total_funding, status
    ) VALUES (
        v_plan_ok, v_org_id, v_patient_ok, '2026-NDIS-TPR-327', '2026-01-01', '2026-12-31', 48000.00, 'active'
    )
    ON CONFLICT (id) DO UPDATE SET
        status = 'active',
        plan_start = EXCLUDED.plan_start,
        plan_end = EXCLUDED.plan_end,
        total_funding = EXCLUDED.total_funding,
        updated_at = now();

    INSERT INTO public.plan_budgets (id, plan_id, category, allocated_amount, used_amount) VALUES
        ('d3270211-0000-4000-8000-000000000001', v_plan_ok, 'core', 30000.00, 1250.00),
        ('d3270212-0000-4000-8000-000000000001', v_plan_ok, 'capacity_building', 12000.00, 400.00),
        ('d3270213-0000-4000-8000-000000000001', v_plan_ok, 'capital', 6000.00, 0.00)
    ON CONFLICT (plan_id, category) DO UPDATE SET
        allocated_amount = EXCLUDED.allocated_amount,
        used_amount = EXCLUDED.used_amount;

    -- Goal WITH support_category (329 — good row)
    INSERT INTO public.ndis_goals (
        id, participant_id, organization_id, plan_id, created_by,
        name, goal_area, description, target_date, why_it_matters,
        support_category, priority, status
    ) VALUES (
        v_goal_ok, v_patient_ok, v_org_id, v_plan_ok, v_coordinator_id,
        'Morning personal care independence', 'daily_living',
        'Tessa will complete morning hygiene routine with minimal verbal prompting.',
        '2026-11-30',
        'Foundation for community access and employment readiness.',
        'core_daily_activities', 1, 'active'
    )
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        support_category = EXCLUDED.support_category,
        status = EXCLUDED.status,
        updated_at = now();

    -- Goal WITHOUT support_category (329 — review queue; goal_area other skips auto-backfill)
    INSERT INTO public.ndis_goals (
        id, participant_id, organization_id, plan_id, created_by,
        name, goal_area, description, target_date, why_it_matters,
        support_category, priority, status
    ) VALUES (
        v_goal_review, v_patient_ok, v_org_id, v_plan_ok, v_coordinator_id,
        'Explore supported employment pathway', 'other',
        'Investigate open-employment options with DES provider — category TBD by coordinator.',
        '2027-03-01',
        'Requires coordinator to assign correct funding line before billing.',
        NULL, 2, 'active'
    )
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        goal_area = EXCLUDED.goal_area,
        support_category = NULL,
        status = EXCLUDED.status,
        updated_at = now();

    INSERT INTO public.participant_tasks (
        id, participant_id, goal_id, organization_id, created_by,
        name, description, frequency, is_mandatory, status
    ) VALUES
        (v_task_1, v_patient_ok, v_goal_ok, v_org_id, v_coordinator_id,
         'Morning hygiene checklist', 'Follow pictorial checklist in bathroom.', 'each_shift', true, 'pending'),
        (v_task_2, v_patient_ok, v_goal_ok, v_org_id, v_coordinator_id,
         'Breakfast meal prep', 'Prepare breakfast using visual recipe card.', 'each_shift', false, 'pending')
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        updated_at = now();

    v_tasks_done := jsonb_build_array(
        jsonb_build_object('task_id','default_personal_hygiene','type','default','label','Personal Hygiene',
            'description','Morning hygiene routine.','completed',true,'order',1,'mandatory',true,
            'goal_id', v_goal_ok::text, 'goal_title','Morning personal care independence'),
        jsonb_build_object('task_id','default_meal_prep','type','default','label','Meal Preparation',
            'description','Breakfast prep.','completed',true,'order',2,'mandatory',true,
            'goal_id', v_goal_ok::text, 'goal_title','Morning personal care independence'),
        jsonb_build_object('task_id','default_documentation','type','default','label','Documentation / Notes',
            'description','Shift summary notes.','completed',true,'order',3,'mandatory',true,
            'goal_id', v_goal_ok::text, 'goal_title','Morning personal care independence')
    );

    v_end_validation := jsonb_build_object(
        'compliance_score', 88,
        'low_compliance', false,
        'tasks_completed', 3,
        'tasks_total', 3,
        'mandatory_total', 3,
        'mandatory_with_evidence', 3,
        'mandatory_without_evidence', 0,
        'force_ended', false,
        'flagged_tasks', '[]'::jsonb
    );

    -- Reset verification state so shift reappears in queue on re-run
    DELETE FROM public.budget_usage WHERE shift_verification_id IN (
        SELECT id FROM public.shift_verifications WHERE shift_id = v_shift_verify
    );
    DELETE FROM public.shift_verifications WHERE shift_id = v_shift_verify;

    INSERT INTO public.sessions (
        id, patient_id, organization_id, worker_id, created_by, owner_user_id,
        session_date, start_time, session_type, duration_minutes, status,
        notes, compliance_input_text, translation_status,
        compliance_score, compliance_status, end_validation,
        goals_addressed, support_category, tasks
    ) VALUES (
        v_session_verify, v_patient_ok, v_org_id, v_worker_id, v_worker_id, v_worker_id,
        t_clock_in, t_clock_in, 'daily_living', 125, 'completed',
        'Tessa completed morning hygiene and breakfast with one verbal prompt. Mood positive.',
        'Tessa completed morning hygiene and breakfast with one verbal prompt. Mood positive.',
        'not_required',
        88, 'compliant', v_end_validation,
        jsonb_build_array(v_goal_ok::text), 'core_daily_activities', v_tasks_done
    )
    ON CONFLICT (id) DO UPDATE SET
        status = 'completed',
        duration_minutes = EXCLUDED.duration_minutes,
        end_validation = EXCLUDED.end_validation,
        compliance_score = EXCLUDED.compliance_score,
        compliance_status = EXCLUDED.compliance_status,
        tasks = EXCLUDED.tasks,
        updated_at = now();

    INSERT INTO public.shifts (
        id, organization_id, worker_id, participant_id, session_id,
        scheduled_start, scheduled_end, clocked_in_at, clocked_out_at, duration_minutes,
        participant_name, participant_dob, participant_gender,
        participant_address, participant_phone,
        status, tasks,
        risks_acknowledged_at, risks_acknowledged_by
    ) VALUES (
        v_shift_verify, v_org_id, v_worker_id, v_patient_ok, v_session_verify,
        t_sched_start, t_sched_end, t_clock_in, t_clock_out, 125,
        'Tessa PlanReady', '1994-08-12', 'female',
        '18 King William Street, Adelaide SA 5000', '0411 327 001',
        'completed', v_tasks_done,
        t_clock_in - interval '10 minutes', v_worker_id
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
        status = 'completed',
        tasks = EXCLUDED.tasks,
        updated_at = now();

    INSERT INTO public.shift_tasks (id, shift_id, task_id, organization_id) VALUES
        ('d3270501-0000-4000-8000-000000000001', v_shift_verify, v_task_1, v_org_id),
        ('d3270502-0000-4000-8000-000000000002', v_shift_verify, v_task_2, v_org_id)
    ON CONFLICT (id) DO NOTHING;

    UPDATE public.sessions
       SET shift_id = v_shift_verify, updated_at = now()
     WHERE id = v_session_verify;

    -- ══════════════════════════════════════════════════════════════════════════
    -- OLIVER NOPLAN — plan-gate negative tests (328)
    -- ══════════════════════════════════════════════════════════════════════════
    INSERT INTO public.patients (
        id, organization_id, full_name, preferred_name, ndis_number, date_of_birth,
        biological_sex, email, phone, address,
        plan_status, plan_management_type, primary_disability,
        emergency_contact,
        assigned_worker_id, created_by, owner_user_id, updated_at
    ) VALUES (
        v_patient_noplan, v_org_id,
        'Oliver NoPlan', 'Ollie', '4399000328', '1990-02-20', 'male',
        'oliver.noplan@example.com', '0411 328 002',
        '55 Melbourne Street, North Adelaide SA 5006',
        'pending', NULL, 'Autism Spectrum Disorder',
        jsonb_build_object('name', 'James NoPlan', 'phone', '0412 328 002', 'relationship', 'Father'),
        v_worker_id, v_coordinator_id, v_coordinator_id, now()
    )
    ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        plan_status = 'pending',
        assigned_worker_id = EXCLUDED.assigned_worker_id,
        updated_at = now();

    INSERT INTO public.practitioner_allocations (
        id, patient_id, user_id, allocated_role, organization_id, assigned_by, is_active
    ) VALUES (
        v_alloc_noplan, v_patient_noplan, v_worker_id, 'support_worker', v_org_id, v_coordinator_id, true
    )
    ON CONFLICT (patient_id, user_id) DO UPDATE SET
        is_active = true,
        assigned_by = EXCLUDED.assigned_by;

    -- Ensure no active plan exists for Oliver
    DELETE FROM public.plan_budgets
     WHERE plan_id IN (
         SELECT id FROM public.ndis_plans WHERE patient_id = v_patient_noplan
     );
    DELETE FROM public.ndis_plans WHERE patient_id = v_patient_noplan;

    RAISE NOTICE '══════════════════════════════════════════════════════════════';
    RAISE NOTICE 'CARECLIQV2 327/328/329 UI test seed complete';
    RAISE NOTICE 'Tessa PlanReady  : %', v_patient_ok;
    RAISE NOTICE 'Oliver NoPlan    : %', v_patient_noplan;
    RAISE NOTICE 'Shift to verify  : % (worker %)', v_shift_verify, v_worker_id;
    RAISE NOTICE 'Core budget used : $1,250.00 (note before verifying shift)';
    RAISE NOTICE 'Goals review queue: 1 goal missing support_category on Tessa';
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
END $$;

COMMIT;
