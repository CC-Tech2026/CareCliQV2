-- =============================================================================
-- CARECLIQ — Adelaide participants full-package seed
-- -----------------------------------------------------------------------------
-- Two participants with every coordinator/worker context field populated:
--   case manager, sensory/cultural/communication prefs, visit notes,
--   behavioural notes, BSP, restricted notes, compliance audit history.
--
--   Ruby Santoro   — b2000001… — COMPLETED shift + compliant session + audit log
--   Marcus Nguyen  — b2000002… — SCHEDULED shift (ack pending)
--
-- Target org:  a1111111-1111-1111-1111-111111111111
-- Coordinator: e704e016-689d-4d93-9577-691a5ba5879b
-- Worker:      d3c3d4a4-55e1-4f43-af66-5ef0a46f3a11
--
-- Safe to re-run: fixed UUIDs + ON CONFLICT upserts.
-- =============================================================================

BEGIN;

-- ── 1. Patients (full profile) ────────────────────────────────────────────────
INSERT INTO public.patients (
    id, organization_id, full_name, preferred_name, ndis_number, date_of_birth,
    biological_sex, email, phone, address, address_notes,
    plan_status, plan_start_date, plan_end_date, total_budget, used_budget,
    plan_management_type, plan_management, primary_disability,
    current_conditions, medications, medical_alerts, allergies,
    risk_level, risk_triggers, risk_management_plan, goals,
    emergency_contact,
    case_manager_name, case_manager_phone, case_manager_email,
    communication_preferences, communication_guidance,
    likes_dislikes, sensory_preferences, cultural_preferences, preferred_activities,
    behavioural_notes, restricted_behavioural_notes, behaviour_support_plan,
    background_summary, background_summary_updated_at,
    previous_visit_notes, previous_visit_notes_updated_at,
    upcoming_review_date,
    assigned_worker_id, created_by, owner_user_id, updated_at
) VALUES
    -- ── Ruby Santoro — COMPLETED shift participant ────────────────────────────
    (
        'b2000001-0000-4000-8000-000000000001'::uuid,
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'Ruby Santoro', 'Rue', '4301000015', '1991-07-03', 'female',
        'ruby.santoro@example.com', '0415 882 340',
        '102 Gilles Street, Adelaide SA 5000',
        'Heritage cottage — narrow driveway; park on Gilles St. Key lockbox code 7392 on porch.',
        'active', '2026-01-15', '2026-12-14', 55000.00, 11200.00,
        'plan_managed', 'Plan-managed via LEAP Plan Management (Adelaide CBD)',
        'Intellectual Disability',
        E'Mild intellectual disability\nType 1 diabetes — insulin dependent\nGeneralised anxiety disorder',
        E'Insulin NovoRapid — sliding scale with meals (chart on fridge)\nInsulin Lantus — 18 units at 9:00 pm\nMetformin 500mg — twice daily with food',
        E'⚠️ Hypoglycaemia risk — carry glucose tabs and monitor before community outings\n⛔ Latex allergy — nitrile gloves only',
        'Latex — anaphylactic risk; tree nuts — moderate',
        'medium',
        ARRAY['Unfamiliar workers', 'Blood glucose checks', 'Changes to meal timing'],
        E'Check BGL before meals and document on MAR.\nUse calm, predictable routines.\nContact coordinator if BGL <4.0 or >15.0 mmol/L.',
        '[{"id":"goal_ruby_1","title":"Independent diabetes self-management","status":"active"},{"id":"goal_ruby_2","title":"Community shopping confidence","status":"active"}]'::jsonb,
        jsonb_build_object('name', 'Angela Santoro', 'phone', '0418 334 902', 'relationship', 'Sister'),
        'Helen Marsh', '08 8226 9100', 'h.marsh@leapplan.com.au',
        'Plain English; visual schedules; confirm understanding by asking Ruby to repeat instructions',
        'Speak slowly and face Ruby. Use pictorial shopping lists. Never rush insulin administration — follow MAR exactly. Praise effort, not just outcomes.',
        'Loves baking, gospel music, and Adelaide Central Market on Thursday mornings. Dislikes being spoken about in third person or sudden loud noises.',
        'Prefers soft instrumental music, natural lighting, and unscented cleaning products. Sensitive to strong food smells when fasting for BGL checks.',
        'Italian-Australian Catholic family. Sunday family calls are important — avoid scheduling over 10:30 am Sundays.',
        '["Baking simple recipes","Central Market shopping","Listening to gospel playlists","Garden watering on patio"]'::jsonb,
        '[
            {"title":"Anxiety escalation","body":"Ruby may become quiet and avoid eye contact when anxious. Offer a 5-minute break in the garden before continuing."},
            {"title":"Diabetes routine","body":"Never skip BGL check before lunch prep. Ruby can verbalise her own reading with prompting."}
        ]'::jsonb,
        E'RESTRICTED — Coordinator eyes only\n'
        || E'History of self-injurious behaviour when blood sugar drops below 3.5 mmol/L (head-banging, 2023 incident).\n'
        || E'If BGL <4.0: stop activity, administer fast-acting glucose per MAR, recheck in 15 minutes, call Angela if no improvement.\n'
        || E'Ruby may refuse finger prick when anxious — use distraction technique (counting gospel songs) before retry.',
        E'Behaviour Support Plan (BSP) — Version 3.1 (reviewed March 2026)\n'
        || E'1. Proactive: maintain predictable meal and insulin times; visual schedule visible in kitchen.\n'
        || E'2. Early signs: pacing, repeated questioning about time, covering ears.\n'
        || E'3. De-escalation: offer break, reduce stimuli, validate feelings, redirect to preferred activity.\n'
        || E'4. Restrictive practices: none authorised. Contact on-call coordinator before any physical guidance.\n'
        || E'5. Post-incident: document BGL, triggers, and participant response within 2 hours.',
        'Ruby is a 34-year-old Gilles Street resident building diabetes self-management and community shopping skills with visual supports and calm, predictable routines.',
        now() - interval '6 days',
        'Last shift: Ruby checked her own BGL before lunch (6.2 mmol/L) with verbal prompting. Completed Central Market shopping list with one staff prompt. Insulin administered per MAR with no issues.',
        now() - interval '5 days',
        '2026-10-22',
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        'e704e016-689d-4d93-9577-691a5ba5879b'::uuid,
        'e704e016-689d-4d93-9577-691a5ba5879b'::uuid,
        now()
    ),
    -- ── Marcus Nguyen — SCHEDULED shift participant ───────────────────────────
    (
        'b2000002-0000-4000-8000-000000000002'::uuid,
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'Marcus Nguyen', 'Marc', '4301000016', '1985-12-19', 'male',
        'marcus.nguyen@example.com', '0427 651 908',
        '6 Main North Road, Prospect SA 5082',
        'Unit 2 at rear — access via laneway off Vine Street. Intercom label "Nguyen".',
        'active', '2026-03-10', '2027-03-09', 72000.00, 6800.00,
        'self_managed', 'Self-managed — Marcus reviews invoices fortnightly',
        'Spinal Cord Injury (T6 paraplegia)',
        E'T6 complete paraplegia — wheelchair user\nNeuropathic pain — lower limbs\nRecurrent UTIs — prevention plan in place',
        E'Pregabalin 75mg — twice daily\nOxybutynin 5mg — twice daily\nParacetamol 1g — PRN (max 4g/day)',
        E'⚠️ Autonomic dysreflexia risk — know emergency protocol card on fridge\n⛔ Pressure injury prevention — 2-hourly repositioning in bed',
        'Iodine contrast dye — severe reaction (documented 2024)',
        'high',
        ARRAY['Full bladder', 'Tight clothing', 'Extreme temperatures', 'Missed catheter care'],
        E'Monitor for AD symptoms: pounding headache, sweating above injury, hypertension.\nFollow bowel program chart (Mon/Wed/Fri mornings).\nDocument skin checks each personal care shift.',
        '[{"id":"goal_marcus_1","title":"Maintain pressure injury prevention routine","status":"active"},{"id":"goal_marcus_2","title":"Increase community participation via adaptive sport","status":"active"}]'::jsonb,
        jsonb_build_object('name', 'Linh Nguyen', 'phone', '0403 778 221', 'relationship', 'Wife'),
        'David O''Connor', '08 8344 5500', 'd.oconnor@ndis.gov.au',
        'Direct, respectful adult-to-adult communication; no patronising tone',
        'Ask before assisting with transfers — Marcus prefers to verbalise when help is needed. Use person-first language. Explain each step of personal care before starting.',
        'Enjoys wheelchair basketball, Vietnamese cooking, and podcasts about science. Dislikes being rushed or having wheelchair handled without permission.',
        'Prefers firm mattress overlay already in place. Room temperature 20–22°C. Dislikes scented air fresheners.',
        'Vietnamese-Australian household — remove shoes at door. Wife Linh may be present — greet respectfully. Buddhist — no meat on 1st and 15th lunar month (check calendar on fridge).',
        '["Wheelchair basketball (Prospect courts)","Vietnamese meal prep","Science podcasts","Prospect Library accessible events"]'::jsonb,
        '[
            {"title":"Wheelchair handling","body":"Never push wheelchair without asking. Marcus controls speed and direction."},
            {"title":"Autonomic dysreflexia","body":"If headache + sweating: sit upright, loosen clothing, check catheter, call 000 if BP remains elevated."}
        ]'::jsonb,
        E'RESTRICTED — Coordinator eyes only\n'
        || E'Autonomic dysreflexia episode January 2026 — triggered by blocked catheter. Resolved after irrigation in ED.\n'
        || E'Marcus may minimise pain — always ask about headache and sweating during morning care.\n'
        || E'History of pressure injury Stage 2 (sacrum, 2025) — healed but area remains vulnerable.',
        E'Behaviour Support Plan (BSP) — Version 2.0 (reviewed February 2026)\n'
        || E'1. Marcus values autonomy — offer choices for timing of personal care.\n'
        || E'2. Frustration signs: sharp tone, wheel locks applied abruptly, withdrawal from conversation.\n'
        || E'3. De-escalation: acknowledge frustration, offer to pause task, revisit in 10 minutes.\n'
        || E'4. No restrictive practices authorised.\n'
        || E'5. Emergency: AD protocol card on fridge — follow before calling 000.',
        'Marcus is a 40-year-old Prospect resident with T6 paraplegia, focused on skin integrity, catheter care, and adaptive community participation.',
        now() - interval '3 days',
        'No shift delivered this week yet — first scheduled visit tomorrow. Confirm AD protocol card location and pressure cushion check on arrival.',
        now() - interval '1 day',
        '2026-11-08',
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        'e704e016-689d-4d93-9577-691a5ba5879b'::uuid,
        'e704e016-689d-4d93-9577-691a5ba5879b'::uuid,
        now()
    )
ON CONFLICT (id) DO UPDATE SET
    organization_id               = EXCLUDED.organization_id,
    full_name                     = EXCLUDED.full_name,
    preferred_name                = EXCLUDED.preferred_name,
    ndis_number                   = EXCLUDED.ndis_number,
    date_of_birth                 = EXCLUDED.date_of_birth,
    biological_sex                = EXCLUDED.biological_sex,
    email                         = EXCLUDED.email,
    phone                         = EXCLUDED.phone,
    address                       = EXCLUDED.address,
    address_notes                 = EXCLUDED.address_notes,
    plan_status                   = EXCLUDED.plan_status,
    plan_start_date               = EXCLUDED.plan_start_date,
    plan_end_date                 = EXCLUDED.plan_end_date,
    total_budget                  = EXCLUDED.total_budget,
    used_budget                   = EXCLUDED.used_budget,
    plan_management_type          = EXCLUDED.plan_management_type,
    plan_management               = EXCLUDED.plan_management,
    primary_disability            = EXCLUDED.primary_disability,
    current_conditions            = EXCLUDED.current_conditions,
    medications                   = EXCLUDED.medications,
    medical_alerts                = EXCLUDED.medical_alerts,
    allergies                     = EXCLUDED.allergies,
    risk_level                    = EXCLUDED.risk_level,
    risk_triggers                 = EXCLUDED.risk_triggers,
    risk_management_plan          = EXCLUDED.risk_management_plan,
    goals                         = EXCLUDED.goals,
    emergency_contact             = EXCLUDED.emergency_contact,
    case_manager_name             = EXCLUDED.case_manager_name,
    case_manager_phone            = EXCLUDED.case_manager_phone,
    case_manager_email            = EXCLUDED.case_manager_email,
    communication_preferences     = EXCLUDED.communication_preferences,
    communication_guidance      = EXCLUDED.communication_guidance,
    likes_dislikes                = EXCLUDED.likes_dislikes,
    sensory_preferences           = EXCLUDED.sensory_preferences,
    cultural_preferences          = EXCLUDED.cultural_preferences,
    preferred_activities          = EXCLUDED.preferred_activities,
    behavioural_notes             = EXCLUDED.behavioural_notes,
    restricted_behavioural_notes  = EXCLUDED.restricted_behavioural_notes,
    behaviour_support_plan        = EXCLUDED.behaviour_support_plan,
    background_summary            = EXCLUDED.background_summary,
    background_summary_updated_at = EXCLUDED.background_summary_updated_at,
    previous_visit_notes          = EXCLUDED.previous_visit_notes,
    previous_visit_notes_updated_at = EXCLUDED.previous_visit_notes_updated_at,
    upcoming_review_date          = EXCLUDED.upcoming_review_date,
    assigned_worker_id            = EXCLUDED.assigned_worker_id,
    created_by                    = EXCLUDED.created_by,
    owner_user_id                 = EXCLUDED.owner_user_id,
    updated_at                    = now();

-- ── 2. Practitioner allocations ───────────────────────────────────────────────
INSERT INTO public.practitioner_allocations (
    id, patient_id, user_id, allocated_role, organization_id, assigned_by, is_active
) VALUES
    ('b2000101-0000-4000-8000-000000000001'::uuid, 'b2000001-0000-4000-8000-000000000001'::uuid, 'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid, 'support_worker', 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, true),
    ('b2000102-0000-4000-8000-000000000002'::uuid, 'b2000002-0000-4000-8000-000000000002'::uuid, 'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid, 'support_worker', 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, true)
ON CONFLICT (patient_id, user_id) DO UPDATE SET
    allocated_role = EXCLUDED.allocated_role, is_active = true;

-- ── 3. NDIS plans + budgets ───────────────────────────────────────────────────
INSERT INTO public.ndis_plans (
    id, organization_id, patient_id, plan_number, plan_start, plan_end, total_funding, status
) VALUES
    ('b2000201-0000-4000-8000-000000000001'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b2000001-0000-4000-8000-000000000001'::uuid, '2026-NDIS-RS-015', '2026-01-15', '2026-12-14', 55000.00, 'active'),
    ('b2000202-0000-4000-8000-000000000002'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b2000002-0000-4000-8000-000000000002'::uuid, '2026-NDIS-MN-016', '2026-03-10', '2027-03-09', 72000.00, 'active')
ON CONFLICT (id) DO UPDATE SET
    plan_number = EXCLUDED.plan_number, total_funding = EXCLUDED.total_funding, status = EXCLUDED.status, updated_at = now();

UPDATE public.patients SET ndis_plan_id = 'b2000201-0000-4000-8000-000000000001'::uuid WHERE id = 'b2000001-0000-4000-8000-000000000001'::uuid;
UPDATE public.patients SET ndis_plan_id = 'b2000202-0000-4000-8000-000000000002'::uuid WHERE id = 'b2000002-0000-4000-8000-000000000002'::uuid;

INSERT INTO public.plan_budgets (id, plan_id, category, allocated_amount, used_amount) VALUES
    ('b2000211-0000-4000-8000-000000000001'::uuid, 'b2000201-0000-4000-8000-000000000001'::uuid, 'core', 34000.00, 8900.00),
    ('b2000212-0000-4000-8000-000000000001'::uuid, 'b2000201-0000-4000-8000-000000000001'::uuid, 'capacity_building', 17000.00, 1900.00),
    ('b2000213-0000-4000-8000-000000000001'::uuid, 'b2000201-0000-4000-8000-000000000001'::uuid, 'capital', 4000.00, 400.00),
    ('b2000211-0000-4000-8000-000000000002'::uuid, 'b2000202-0000-4000-8000-000000000002'::uuid, 'core', 48000.00, 5200.00),
    ('b2000212-0000-4000-8000-000000000002'::uuid, 'b2000202-0000-4000-8000-000000000002'::uuid, 'capacity_building', 20000.00, 1200.00),
    ('b2000213-0000-4000-8000-000000000002'::uuid, 'b2000202-0000-4000-8000-000000000002'::uuid, 'capital', 4000.00, 400.00)
ON CONFLICT (plan_id, category) DO UPDATE SET
    allocated_amount = EXCLUDED.allocated_amount, used_amount = EXCLUDED.used_amount;

-- ── 4. NDIS goals ─────────────────────────────────────────────────────────────
INSERT INTO public.ndis_goals (
    id, participant_id, organization_id, plan_id, created_by,
    name, goal_area, description, target_date, success_criteria,
    why_it_matters, support_category, priority, status
) VALUES
    ('b2000301-0000-4000-8000-000000000001'::uuid, 'b2000001-0000-4000-8000-000000000001'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b2000201-0000-4000-8000-000000000001'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Independent diabetes self-management', 'health', 'Ruby will check BGL and administer insulin with stand-by assist using MAR chart.', '2026-11-30', 'Independent BGL check on 4 of 5 sessions; insulin with stand-by assist only.', 'Critical for Ruby''s health and independence.', 'cb_health_wellbeing', 1, 'active'),
    ('b2000302-0000-4000-8000-000000000001'::uuid, 'b2000001-0000-4000-8000-000000000001'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b2000201-0000-4000-8000-000000000001'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Community shopping confidence', 'community', 'Complete pictorial shopping list at Central Market with minimal prompting.', '2026-12-20', 'Completes shopping list with ≤2 prompts on 4 of 5 outings.', 'Builds practical life skills.', 'core_social_community', 2, 'active'),
    ('b2000301-0000-4000-8000-000000000002'::uuid, 'b2000002-0000-4000-8000-000000000002'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b2000202-0000-4000-8000-000000000002'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Maintain pressure injury prevention routine', 'health', 'Complete skin checks and repositioning per care plan during personal care shifts.', '2027-02-28', 'Skin check documented each shift; no new pressure injuries.', 'Prevents hospitalisation.', 'core_daily_activities', 1, 'active'),
    ('b2000302-0000-4000-8000-000000000002'::uuid, 'b2000002-0000-4000-8000-000000000002'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b2000202-0000-4000-8000-000000000002'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Increase community participation via adaptive sport', 'community', 'Attend wheelchair basketball session fortnightly with transport support.', '2027-03-01', 'Attends 2 consecutive fortnightly sessions with positive engagement.', 'Supports physical and social wellbeing.', 'core_social_community', 2, 'active')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = now();

-- ── 5. Participant tasks ──────────────────────────────────────────────────────
INSERT INTO public.participant_tasks (
    id, participant_id, goal_id, organization_id, created_by,
    name, description, frequency, shift_type, category, priority,
    support_category, evidence_required, is_mandatory, status
) VALUES
    ('b2000401-0000-4000-8000-000000000001'::uuid, 'b2000001-0000-4000-8000-000000000001'::uuid, 'b2000301-0000-4000-8000-000000000001'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'BGL check and insulin per MAR', 'Follow MAR on fridge. Document reading and dose.', 'each_shift', 'morning', 'medication', 'high', 'cb_health_wellbeing', 'notes', true, 'pending'),
    ('b2000402-0000-4000-8000-000000000001'::uuid, 'b2000001-0000-4000-8000-000000000001'::uuid, 'b2000302-0000-4000-8000-000000000001'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Pictorial shopping list outing', 'Support Central Market trip with visual list.', 'weekly', 'morning', 'community_access', 'medium', 'core_social_community', 'photo', false, 'pending'),
    ('b2000401-0000-4000-8000-000000000002'::uuid, 'b2000002-0000-4000-8000-000000000002'::uuid, 'b2000301-0000-4000-8000-000000000002'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Skin check and pressure relief', 'Inspect sacrum and heels. Log on skin chart.', 'each_shift', 'morning', 'personal_care', 'high', 'core_daily_activities', 'notes', true, 'pending'),
    ('b2000402-0000-4000-8000-000000000002'::uuid, 'b2000002-0000-4000-8000-000000000002'::uuid, 'b2000302-0000-4000-8000-000000000002'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Transport to adaptive sport', 'Prospect courts — confirm wheelchair tie-downs.', 'weekly', 'afternoon', 'transport', 'medium', 'core_social_community', 'none', false, 'pending')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = now();

-- ── 6. Allergies + briefing alerts ────────────────────────────────────────────
INSERT INTO public.participant_allergies (id, participant_id, organization_id, allergen, severity, notes) VALUES
    ('b2000501-0000-4000-8000-000000000001'::uuid, 'b2000001-0000-4000-8000-000000000001'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'Latex', 'anaphylactic', 'EpiPen in kitchen drawer. Call 000 if reaction suspected.'),
    ('b2000502-0000-4000-8000-000000000001'::uuid, 'b2000001-0000-4000-8000-000000000001'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'Tree nuts', 'moderate', 'Avoid nut products in baking ingredients.'),
    ('b2000501-0000-4000-8000-000000000002'::uuid, 'b2000002-0000-4000-8000-000000000002'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'Iodine contrast dye', 'severe', 'Hospital allergy band on file — notify if medical appointment.'),
    ('b2000502-0000-4000-8000-000000000002'::uuid, 'b2000002-0000-4000-8000-000000000002'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'Penicillin', 'moderate', 'Rash — use alternative antibiotics per GP.')
ON CONFLICT (id) DO UPDATE SET allergen = EXCLUDED.allergen, severity = EXCLUDED.severity, notes = EXCLUDED.notes, updated_at = now();

INSERT INTO public.participant_briefing_alerts (id, participant_id, organization_id, alert_text, sort_order, is_active) VALUES
    ('b2000601-0000-4000-8000-000000000001'::uuid, 'b2000001-0000-4000-8000-000000000001'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, '⛔ Latex anaphylaxis — EpiPen in kitchen drawer; nitrile gloves only.', 0, true),
    ('b2000602-0000-4000-8000-000000000001'::uuid, 'b2000001-0000-4000-8000-000000000001'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, '⚠️ Check BGL before meals — follow MAR for insulin.', 1, true),
    ('b2000601-0000-4000-8000-000000000002'::uuid, 'b2000002-0000-4000-8000-000000000002'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, '⛔ Autonomic dysreflexia — protocol card on fridge; sit upright if symptoms.', 0, true),
    ('b2000602-0000-4000-8000-000000000002'::uuid, 'b2000002-0000-4000-8000-000000000002'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, '⚠️ Pressure injury prevention — skin check and cushion inspection each shift.', 1, true)
ON CONFLICT (id) DO UPDATE SET alert_text = EXCLUDED.alert_text, is_active = EXCLUDED.is_active, updated_at = now();

-- ── 7. Completed session + compliance (Ruby only) ─────────────────────────────
INSERT INTO public.sessions (
    id, patient_id, organization_id, worker_id, created_by, owner_user_id,
    session_date, session_type, duration_minutes,
    notes, translated_english_note, compliance_input_text,
    detected_language, translation_status,
    status, compliance_score, compliance_status, compliance_notes,
    goals_addressed, support_category,
    activities_performed, outcomes, participant_response, progress_toward_goals
) VALUES (
    'b2000701-0000-4000-8000-000000000001'::uuid,
    'b2000001-0000-4000-8000-000000000001'::uuid,
    'a1111111-1111-1111-1111-111111111111'::uuid,
    'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
    'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
    'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
    now() - interval '5 days',
    'daily_living',
    150,
    'Ruby independently checked her blood glucose level before lunch (reading 6.2 mmol/L) with one verbal prompt to wash hands first. Worker provided stand-by assist for NovoRapid insulin per MAR chart. Ruby then completed a pictorial shopping list at Adelaide Central Market, selecting all items with two staff prompts for aisle navigation. Participant remained regulated throughout, engaged positively with market staff, and requested gospel music on the drive home. No incidents or restrictive practices. BSP strategies not required.',
    'Ruby independently checked her blood glucose level before lunch (reading 6.2 mmol/L) with one verbal prompt to wash hands first. Worker provided stand-by assist for NovoRapid insulin per MAR chart. Ruby then completed a pictorial shopping list at Adelaide Central Market, selecting all items with two staff prompts for aisle navigation. Participant remained regulated throughout, engaged positively with market staff, and requested gospel music on the drive home. No incidents or restrictive practices. BSP strategies not required.',
    'Ruby independently checked her blood glucose level before lunch (reading 6.2 mmol/L) with one verbal prompt to wash hands first. Worker provided stand-by assist for NovoRapid insulin per MAR chart. Ruby then completed a pictorial shopping list at Adelaide Central Market, selecting all items with two staff prompts for aisle navigation. Participant remained regulated throughout, engaged positively with market staff, and requested gospel music on the drive home. No incidents or restrictive practices. BSP strategies not required.',
    'en', 'not_required',
    'completed', 94.5, 'compliant',
    'All 12 compliance rules passed. Goals linked. MAR followed. Objective person-first language. No restrictive practice flags.',
    '["goal_ruby_1","goal_ruby_2"]'::jsonb,
    'core_daily_activities',
    'BGL monitoring, insulin administration per MAR, community shopping with pictorial list',
    'Diabetes routine completed safely; shopping goal progressed with minimal prompting',
    'Ruby reported feeling "proud" of her shopping and asked to return next Thursday',
    'Measurable progress on diabetes self-management and community participation goals'
)
ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    compliance_score = EXCLUDED.compliance_score,
    compliance_status = EXCLUDED.compliance_status,
    compliance_notes = EXCLUDED.compliance_notes,
    notes = EXCLUDED.notes,
    translated_english_note = EXCLUDED.translated_english_note,
    compliance_input_text = EXCLUDED.compliance_input_text,
    detected_language = EXCLUDED.detected_language,
    translation_status = EXCLUDED.translation_status,
    updated_at = now();

-- Compliance audit history (2 entries — latest + prior session audit for history depth)
INSERT INTO public.compliance_audit_logs (
    id, session_id, organization_id,
    compliance_score, rules_checked, rules_passed, rules_warnings, rules_failed,
    failed_rules, all_rules, created_at
) VALUES
    (
        'b2000951-0000-4000-8000-000000000001'::uuid,
        'b2000701-0000-4000-8000-000000000001'::uuid,
        'a1111111-1111-1111-1111-111111111111'::uuid,
        94.5, 12, 12, 0, 0,
        '[]'::jsonb,
        '[
            {"rule":"R1","label":"Session time and duration","status":"pass","message":"R1: Session start, end, and duration documented (150 min)","severity":"high"},
            {"rule":"R2","label":"48-hour documentation","status":"pass","message":"R2: Note completed within 48 hours","severity":"low"},
            {"rule":"R3","label":"Note quality","status":"pass","message":"R3: Clinical documentation exceeds 80-word standard (112 words)","severity":"high"},
            {"rule":"R4","label":"Support type documented","status":"pass","message":"R4: Support type recorded: daily_living","severity":"medium"},
            {"rule":"R5","label":"Goals referenced in note","status":"pass","message":"R5: Linked to goal_ruby_1 and goal_ruby_2","severity":"high"},
            {"rule":"R6","label":"Objective language","status":"pass","message":"R6: Objective language throughout","severity":"medium"},
            {"rule":"R7","label":"Person-first language","status":"pass","message":"R7: Person-first language used","severity":"low"},
            {"rule":"R8","label":"Scope of practice","status":"pass","message":"R8: No scope-of-practice concerns","severity":"medium"},
            {"rule":"R9","label":"Incident triggers","status":"pass","message":"R9: No incident trigger language","severity":"low"},
            {"rule":"R10","label":"Restrictive practice reported","status":"pass","message":"R10: No restrictive practice detected","severity":"high"},
            {"rule":"R11","label":"Note uniqueness","status":"pass","message":"R11: Note uniqueness acceptable (similarity: 8%)","severity":"low"},
            {"rule":"R12","label":"Participant response","status":"pass","message":"R12: Participant response documented","severity":"medium"}
        ]'::jsonb,
        now() - interval '5 days'
    ),
    (
        'b2000952-0000-4000-8000-000000000001'::uuid,
        'b2000701-0000-4000-8000-000000000001'::uuid,
        'a1111111-1111-1111-1111-111111111111'::uuid,
        88.0, 12, 11, 1, 0,
        '[]'::jsonb,
        '[
            {"rule":"R1","label":"Session time and duration","status":"pass","message":"R1: Duration documented","severity":"high"},
            {"rule":"R2","label":"48-hour documentation","status":"pass","message":"R2: Within 48 hours","severity":"low"},
            {"rule":"R3","label":"Note quality","status":"warning","message":"R3: Note slightly below preferred length — revised in final submission","severity":"medium"},
            {"rule":"R5","label":"Goals referenced in note","status":"pass","message":"R5: Goals linked","severity":"high"},
            {"rule":"R10","label":"Restrictive practice reported","status":"pass","message":"R10: None detected","severity":"high"}
        ]'::jsonb,
        now() - interval '5 days 2 hours'
    )
ON CONFLICT (id) DO UPDATE SET
    compliance_score = EXCLUDED.compliance_score,
    rules_passed = EXCLUDED.rules_passed,
    all_rules = EXCLUDED.all_rules;

-- ── 8. Shifts: Ruby completed, Marcus scheduled ───────────────────────────────
INSERT INTO public.shifts (
    id, organization_id, worker_id, participant_id, session_id,
    scheduled_start, scheduled_end, clocked_in_at, clocked_out_at, duration_minutes,
    participant_name, participant_dob, participant_gender,
    participant_address, participant_phone,
    allergies, health_flags, health_alerts, visit_notes,
    access_instructions, coordinator_notes, entry_instructions,
    active_goals, special_instructions, status, tasks,
    risks_acknowledged_at, risks_acknowledged_by
) VALUES
    (
        'b2000801-0000-4000-8000-000000000001'::uuid,
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        'b2000001-0000-4000-8000-000000000001'::uuid,
        'b2000701-0000-4000-8000-000000000001'::uuid,
        now() - interval '5 days 2 hours 30 minutes',
        now() - interval '5 days',
        now() - interval '5 days 2 hours 30 minutes',
        now() - interval '5 days',
        150,
        'Ruby Santoro', '1991-07-03', 'female',
        '102 Gilles Street, Adelaide SA 5000', '0415 882 340',
        'Latex — anaphylactic; tree nuts — moderate',
        E'Diabetes — insulin dependent\nAnxiety in unfamiliar situations',
        E'⛔ Latex anaphylaxis — EpiPen in kitchen drawer\n⚠️ BGL check before meals — follow MAR',
        'MAR on fridge. Pictorial shopping list in folder by door. Gospel playlist on phone for transitions.',
        'Park on Gilles St. Lockbox 7392 on porch.',
        'Document BGL readings and insulin on MAR. Link goals in session note.',
        'Front door — lockbox left of door handle.',
        ARRAY['Independent diabetes self-management (Health)', 'Community shopping confidence (Community)'],
        'Use nitrile gloves only. Confirm Ruby repeats insulin instructions.',
        'completed', '[]'::jsonb,
        now() - interval '5 days 2 hours 30 minutes',
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid
    ),
    (
        'b2000802-0000-4000-8000-000000000002'::uuid,
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        'b2000002-0000-4000-8000-000000000002'::uuid,
        NULL,
        date_trunc('day', now() AT TIME ZONE 'Australia/Adelaide' + interval '1 day') AT TIME ZONE 'Australia/Adelaide' + interval '8 hours',
        date_trunc('day', now() AT TIME ZONE 'Australia/Adelaide' + interval '1 day') AT TIME ZONE 'Australia/Adelaide' + interval '12 hours',
        NULL, NULL, NULL,
        'Marcus Nguyen', '1985-12-19', 'male',
        '6 Main North Road, Prospect SA 5082', '0427 651 908',
        'Iodine contrast dye — severe; penicillin — moderate',
        E'T6 paraplegia — wheelchair user\nAutonomic dysreflexia risk\nPressure injury prevention',
        E'⛔ Autonomic dysreflexia — protocol card on fridge\n⚠️ Skin check and cushion inspection required',
        'First visit — review AD card, skin chart, and bowel program. Ask before wheelchair handling.',
        'Laneway off Vine Street to Unit 2. Remove shoes at door.',
        'Acknowledge all briefing alerts before clock-in. Document skin check on chart.',
        'Intercom "Nguyen". Wife Linh may be home.',
        ARRAY['Pressure injury prevention (Health)', 'Adaptive sport participation (Community)'],
        'Do not push wheelchair without permission. Check catheter patency if AD symptoms.',
        'scheduled', '[]'::jsonb,
        NULL, NULL
    )
ON CONFLICT (id) DO UPDATE SET
    organization_id       = EXCLUDED.organization_id,
    worker_id             = EXCLUDED.worker_id,
    participant_id        = EXCLUDED.participant_id,
    session_id            = EXCLUDED.session_id,
    scheduled_start       = EXCLUDED.scheduled_start,
    scheduled_end         = EXCLUDED.scheduled_end,
    clocked_in_at         = EXCLUDED.clocked_in_at,
    clocked_out_at        = EXCLUDED.clocked_out_at,
    duration_minutes      = EXCLUDED.duration_minutes,
    participant_name      = EXCLUDED.participant_name,
    participant_dob       = EXCLUDED.participant_dob,
    participant_gender    = EXCLUDED.participant_gender,
    participant_address   = EXCLUDED.participant_address,
    participant_phone     = EXCLUDED.participant_phone,
    allergies             = EXCLUDED.allergies,
    health_flags          = EXCLUDED.health_flags,
    health_alerts         = EXCLUDED.health_alerts,
    visit_notes           = EXCLUDED.visit_notes,
    access_instructions   = EXCLUDED.access_instructions,
    coordinator_notes     = EXCLUDED.coordinator_notes,
    entry_instructions    = EXCLUDED.entry_instructions,
    active_goals          = EXCLUDED.active_goals,
    special_instructions  = EXCLUDED.special_instructions,
    status                = EXCLUDED.status,
    risks_acknowledged_at = EXCLUDED.risks_acknowledged_at,
    risks_acknowledged_by = EXCLUDED.risks_acknowledged_by,
    updated_at            = now();

UPDATE public.shifts s
SET
    participant_name    = p.full_name,
    participant_dob     = p.date_of_birth,
    participant_gender  = p.biological_sex,
    participant_address = p.address,
    participant_phone   = p.phone,
    updated_at          = now()
FROM public.patients p
WHERE s.participant_id = p.id
  AND s.id IN (
    'b2000801-0000-4000-8000-000000000001'::uuid,
    'b2000802-0000-4000-8000-000000000002'::uuid
  );

UPDATE public.sessions
SET shift_id = 'b2000801-0000-4000-8000-000000000001'::uuid
WHERE id = 'b2000701-0000-4000-8000-000000000001'::uuid;

-- ── 9. Budget usage ───────────────────────────────────────────────────────────
INSERT INTO public.budget_usage (
    id, plan_id, session_id, category, amount, hourly_rate, duration_minutes, description
) VALUES (
    'b2000901-0000-4000-8000-000000000001'::uuid,
    'b2000201-0000-4000-8000-000000000001'::uuid,
    'b2000701-0000-4000-8000-000000000001'::uuid,
    'core', 168.90, 67.56, 150,
    'Daily activities — diabetes routine and community shopping (Ruby Santoro)'
)
ON CONFLICT (id) DO UPDATE SET
    amount = EXCLUDED.amount, description = EXCLUDED.description;

COMMIT;

-- ── Verification ──────────────────────────────────────────────────────────────
SELECT
    p.full_name,
    p.phone,
    p.address,
    p.case_manager_name,
    p.case_manager_phone,
    p.sensory_preferences IS NOT NULL AS has_sensory,
    p.cultural_preferences IS NOT NULL AS has_cultural,
    p.communication_preferences IS NOT NULL AS has_comm_style,
    p.communication_guidance IS NOT NULL AS has_comm_guidance,
    p.previous_visit_notes IS NOT NULL AS has_visit_notes,
    p.behavioural_notes IS NOT NULL AS has_behavioural,
    p.preferred_activities IS NOT NULL AS has_activities,
    p.restricted_behavioural_notes IS NOT NULL AS has_restricted,
    p.behaviour_support_plan IS NOT NULL AS has_bsp,
    s.status AS shift_status,
    (SELECT COUNT(*) FROM public.compliance_audit_logs cal
     JOIN public.sessions sess ON sess.id = cal.session_id
     WHERE sess.patient_id = p.id) AS audit_log_count
FROM public.patients p
LEFT JOIN public.shifts s ON s.participant_id = p.id
    AND s.id IN (
        'b2000801-0000-4000-8000-000000000001'::uuid,
        'b2000802-0000-4000-8000-000000000002'::uuid
    )
WHERE p.id IN (
    'b2000001-0000-4000-8000-000000000001'::uuid,
    'b2000002-0000-4000-8000-000000000002'::uuid
)
ORDER BY p.full_name;
