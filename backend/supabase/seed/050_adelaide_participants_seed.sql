-- =============================================================================
-- CARECLIQ — Adelaide participants seed (Sunshine Disability Services)
-- -----------------------------------------------------------------------------
-- Four production-like participants with complete profiles and shift coverage:
--   2 × completed shifts  (sessions with compliance_score / compliance_status)
--   2 × scheduled shifts  (pre-shift briefing + risk alerts for compliance ack)
--
-- Target org:  a1111111-1111-1111-1111-111111111111
-- Coordinator: e704e016-689d-4d93-9577-691a5ba5879b
-- Worker:      d3c3d4a4-55e1-4f43-af66-5ef0a46f3a11
--
-- Participants:
--   Lachlan Fraser   — b1000001… — COMPLETED shift
--   Amelia Kovac     — b1000002… — COMPLETED shift
--   Ethan Walsh      — b1000003… — SCHEDULED shift
--   Charlotte O'Brien — b1000004… — SCHEDULED shift
--
-- Safe to re-run: fixed UUIDs + ON CONFLICT upserts.
-- =============================================================================

BEGIN;

-- ── 1. Patients ───────────────────────────────────────────────────────────────
INSERT INTO public.patients (
    id, organization_id, full_name, preferred_name, ndis_number, date_of_birth,
    biological_sex, email, phone, address, address_notes, plan_status,
    plan_start_date, plan_end_date, total_budget, used_budget,
    plan_management_type, plan_management, primary_disability,
    current_conditions, medications, medical_alerts, allergies,
    risk_level, risk_triggers, risk_management_plan, goals,
    emergency_contact, case_manager_name, case_manager_phone, case_manager_email,
    communication_preferences, communication_guidance, likes_dislikes,
    sensory_preferences, cultural_preferences, preferred_activities,
    behavioural_notes, background_summary, background_summary_updated_at,
    previous_visit_notes, previous_visit_notes_updated_at, upcoming_review_date,
    assigned_worker_id, created_by, owner_user_id, updated_at
) VALUES
    -- ── COMPLETED: Lachlan Fraser ─────────────────────────────────────────────
    (
        'b1000001-0000-4000-8000-000000000001'::uuid,
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'Lachlan Fraser', 'Lachie', '4301000011', '1998-02-14', 'male',
        'lachlan.fraser@example.com', '0412 678 901',
        '14 Melbourne Street, North Adelaide SA 5006',
        'Ground-floor unit. Street parking on Melbourne St or Wilson St.',
        'active', '2026-01-01', '2026-12-31', 52000.00, 8400.00,
        'plan_managed', 'Plan-managed via My Plan Manager (Adelaide)',
        'Autism Spectrum Disorder',
        E'Mild anxiety\nSensory processing differences\nRequires routine predictability',
        E'Melatonin 2mg — nightly at 9:00 pm\nSertraline 50mg — morning with breakfast',
        E'⚠️ Latex sensitivity — use non-latex gloves\nMonitor for increased anxiety in noisy environments',
        'Latex — contact dermatitis', 'low',
        ARRAY['Sudden schedule changes', 'Crowded shopping centres', 'Loud unexpected noises'],
        E'Provide 15-minute transition warnings.\nOffer noise-cancelling headphones in community settings.',
        '[{"id":"goal_lachlan_1","title":"Independent meal preparation","status":"active"},{"id":"goal_lachlan_2","title":"Increase community participation","status":"active"}]'::jsonb,
        jsonb_build_object('name','Margaret Fraser','phone','0413 456 789','relationship','Mother'),
        'Priya Nair', '08 8123 4500', 'priya.nair@ndisplanmanager.com.au',
        'Clear, direct language with visual supports',
        'Use short sentences and wait for processing time. Offer written or pictorial choices.',
        'Enjoys cooking shows and walking along the Torrens. Dislikes strong perfumes and fluorescent lighting.',
        'Prefers natural light, quiet background music, and predictable routines.',
        'No specific cultural requirements.',
        '["Cooking simple meals","Walking the River Torrens","Central Market on quiet mornings"]'::jsonb,
        '[{"title":"Transitions","body":"Give a 15-minute warning before leaving home."}]'::jsonb,
        'Lachlan is a 27-year-old North Adelaide local building cooking and community skills with visual schedules and calm support.',
        now() - interval '3 days',
        'Meal prep completed with two verbal prompts. Workspace cleaned independently.',
        now() - interval '2 days', '2026-09-15',
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        'e704e016-689d-4d93-9577-691a5ba5879b'::uuid,
        'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, now()
    ),
    -- ── COMPLETED: Amelia Kovac ───────────────────────────────────────────────
    (
        'b1000002-0000-4000-8000-000000000002'::uuid,
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'Amelia Kovac', 'Amy', '4301000012', '1987-09-22', 'female',
        'amelia.kovac@example.com', '0438 214 567',
        '7 Seaview Road, Henley Beach SA 5022',
        'Ramp access at rear entrance. Beach wheelchair stored in garage.',
        'active', '2026-03-01', '2027-02-28', 68000.00, 14200.00,
        'self_managed', 'Self-managed — Amelia coordinates invoices directly',
        'Multiple Sclerosis',
        E'Relapsing-remitting MS\nFatigue management required\nReduced balance and lower limb strength',
        E'Interferon beta-1a (Avonex) — weekly injection (Wednesdays)\nBaclofen 10mg — twice daily',
        E'⚠️ Heat sensitivity\n⛔ Falls risk — use gait belt for transfers',
        'Sulfonamide antibiotics — rash', 'medium',
        ARRAY['Heat and humidity', 'Fatigue after midday', 'Uneven footpaths'],
        E'Schedule demanding activities before 11:00 am.\nEnsure hydration every hour.',
        '[{"id":"goal_amelia_1","title":"Maintain independent living at home","status":"active"},{"id":"goal_amelia_2","title":"Improve community mobility","status":"active"}]'::jsonb,
        jsonb_build_object('name','Tom Kovac','phone','0417 882 334','relationship','Husband'),
        'James Whitford', '08 8234 7700', 'j.whitford@ndis.gov.au',
        'Verbal communication preferred; allow extra time when fatigued',
        'Speak at a normal pace. Offer seated tasks when fatigue is evident.',
        'Enjoys seaside walks, audiobooks, and coffee at Henley Square.',
        'Prefers cool environments. Uses cooling vest on warm days.',
        'Croatian heritage — enjoys traditional cooking on weekends.',
        '["Henley Beach jetty walks","Audiobooks","Light gardening on the patio"]'::jsonb,
        '[{"title":"Fatigue","body":"Cease activity and support rest if heavy legs or slurred speech."}]'::jsonb,
        'Amelia is a 38-year-old Henley Beach resident managing MS with morning personal care and fatigue-aware community access.',
        now() - interval '5 days',
        'Personal care with stand-by assist. Fatigue noted at 10:45 am — outing shortened per plan.',
        now() - interval '1 day', '2026-11-20',
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        'e704e016-689d-4d93-9577-691a5ba5879b'::uuid,
        'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, now()
    ),
    -- ── SCHEDULED: Ethan Walsh ──────────────────────────────────────────────────
    (
        'b1000003-0000-4000-8000-000000000003'::uuid,
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'Ethan Walsh', 'Eth', '4301000013', '2004-11-08', 'male',
        'ethan.walsh@example.com', '0421 309 876',
        '55 King William Road, Unley SA 5061',
        'Unit 3 — intercom "Walsh". Visitor parking on Mitchell Street.',
        'active', '2026-02-01', '2027-01-31', 48000.00, 5200.00,
        'ndia_managed', 'NDIA-managed plan',
        'Cerebral Palsy',
        E'Spastic diplegia\nUses forearm crutches for community mobility\nMild speech impairment',
        E'Botox injections — every 4 months (next due August 2026)\nParacetamol PRN for muscle soreness',
        E'⚠️ Swallowing precautions — cut food into small pieces\nMonitor for muscle cramping after physiotherapy',
        'Dairy intolerance — gastrointestinal upset', 'low',
        ARRAY['Cold weather', 'Rushed transitions', 'Unfamiliar environments'],
        E'Allow extra time for mobility transitions.\nUse step-by-step instructions for new tasks.',
        '[{"id":"goal_ethan_1","title":"Improve upper limb function","status":"active"},{"id":"goal_ethan_2","title":"Build social confidence","status":"active"}]'::jsonb,
        jsonb_build_object('name','Karen Walsh','phone','0418 220 145','relationship','Mother'),
        'Sandra Lim', '08 8271 3300', 's.lim@ndisplanmanager.com.au',
        'Patient, clear instructions; allow time to formulate responses',
        'Face Ethan when speaking. Repeat key information. Use gestures to support verbal instructions.',
        'Enjoys adaptive sports, PlayStation, and coffee at Unley Cafés. Dislikes being spoken about in third person.',
        'Prefers warm environments. Dislikes slippery floors — check footwear.',
        'Irish-Australian family. Enjoys AFL — supports Adelaide Crows.',
        '["Adaptive gym sessions","Local café outings","Online gaming with friends"]'::jsonb,
        '[{"title":"Mobility","body":"Forearm crutches by front door. Allow seated rest every 20 minutes on outings."}]'::jsonb,
        'Ethan is a 21-year-old Unley resident with cerebral palsy working on upper limb skills and social confidence through structured community access.',
        now() - interval '2 days',
        'No prior visit this week — first morning shift scheduled.',
        now() - interval '1 day', '2026-10-01',
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        'e704e016-689d-4d93-9577-691a5ba5879b'::uuid,
        'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, now()
    ),
    -- ── SCHEDULED: Charlotte O'Brien ────────────────────────────────────────────
    (
        'b1000004-0000-4000-8000-000000000004'::uuid,
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'Charlotte O''Brien', 'Charlie', '4301000014', '1993-05-17', 'female',
        'charlotte.obrien@example.com', '0433 781 204',
        '28 Port Road, Hindmarsh SA 5007',
        'Apartment 12 — lift access. Street parking on Port Road (metered until 6 pm).',
        'active', '2026-04-01', '2027-03-31', 61000.00, 7800.00,
        'plan_managed', 'Plan-managed via Plan Partners Adelaide',
        'Acquired Brain Injury',
        E'Traumatic brain injury (2019 MVA)\nMild memory impairment\nOccasional word-finding difficulty',
        E'Levetiracetam 500mg — twice daily\nSertraline 100mg — morning',
        E'⚠️ Seizure precautions — remove hazards if seizure suspected\n⛔ Do not leave unattended near open flame when cooking',
        'Penicillin — hives', 'medium',
        ARRAY['Overstimulation', 'Multi-step instructions without written prompts', 'Evening fatigue'],
        E'Use written task lists and check off completed steps.\nKeep environment calm; one instruction at a time.',
        '[{"id":"goal_charlotte_1","title":"Rebuild daily living routines","status":"active"},{"id":"goal_charlotte_2","title":"Return to part-time volunteering","status":"active"}]'::jsonb,
        jsonb_build_object('name','Patrick O''Brien','phone','0402 991 887','relationship','Brother'),
        'Michelle Tran', '08 8365 1200', 'm.tran@planpartners.com.au',
        'Written prompts helpful; repeat and confirm understanding',
        'Use whiteboard or notes app for multi-step tasks. Confirm comprehension before starting cooking.',
        'Enjoys art therapy, op-shops on Magill Road, and cooking simple meals. Dislikes loud TV or radio.',
        'Prefers soft lighting. Uses labelled cupboards for organisation.',
        'Anglo-Australian background. Volunteers at community garden when supported.',
        '["Art and craft","Op-shop browsing","Meal prep with visual recipes"]'::jsonb,
        '[{"title":"Memory support","body":"Leave written summary of shift activities on kitchen whiteboard."}]'::jsonb,
        'Charlotte is a 33-year-old Hindmarsh resident recovering from ABI, rebuilding routines and working toward part-time volunteering with structured memory supports.',
        now() - interval '4 days',
        'Afternoon shift not yet delivered — confirm whiteboard prompts before cooking task.',
        now() - interval '2 days', '2026-12-05',
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        'e704e016-689d-4d93-9577-691a5ba5879b'::uuid,
        'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, now()
    )
ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    full_name = EXCLUDED.full_name,
    preferred_name = EXCLUDED.preferred_name,
    ndis_number = EXCLUDED.ndis_number,
    date_of_birth = EXCLUDED.date_of_birth,
    biological_sex = EXCLUDED.biological_sex,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    address = EXCLUDED.address,
    address_notes = EXCLUDED.address_notes,
    plan_status = EXCLUDED.plan_status,
    plan_start_date = EXCLUDED.plan_start_date,
    plan_end_date = EXCLUDED.plan_end_date,
    total_budget = EXCLUDED.total_budget,
    used_budget = EXCLUDED.used_budget,
    plan_management_type = EXCLUDED.plan_management_type,
    plan_management = EXCLUDED.plan_management,
    primary_disability = EXCLUDED.primary_disability,
    current_conditions = EXCLUDED.current_conditions,
    medications = EXCLUDED.medications,
    medical_alerts = EXCLUDED.medical_alerts,
    allergies = EXCLUDED.allergies,
    risk_level = EXCLUDED.risk_level,
    risk_triggers = EXCLUDED.risk_triggers,
    risk_management_plan = EXCLUDED.risk_management_plan,
    goals = EXCLUDED.goals,
    emergency_contact = EXCLUDED.emergency_contact,
    assigned_worker_id = EXCLUDED.assigned_worker_id,
    created_by = EXCLUDED.created_by,
    owner_user_id = EXCLUDED.owner_user_id,
    background_summary = EXCLUDED.background_summary,
    updated_at = now();

-- ── 2. Practitioner allocations ───────────────────────────────────────────────
INSERT INTO public.practitioner_allocations (
    id, patient_id, user_id, allocated_role, organization_id, assigned_by, is_active
) VALUES
    ('b1000101-0000-4000-8000-000000000001'::uuid, 'b1000001-0000-4000-8000-000000000001'::uuid, 'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid, 'support_worker', 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, true),
    ('b1000102-0000-4000-8000-000000000002'::uuid, 'b1000002-0000-4000-8000-000000000002'::uuid, 'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid, 'support_worker', 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, true),
    ('b1000103-0000-4000-8000-000000000003'::uuid, 'b1000003-0000-4000-8000-000000000003'::uuid, 'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid, 'support_worker', 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, true),
    ('b1000104-0000-4000-8000-000000000004'::uuid, 'b1000004-0000-4000-8000-000000000004'::uuid, 'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid, 'support_worker', 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, true)
ON CONFLICT (patient_id, user_id) DO UPDATE SET
    allocated_role = EXCLUDED.allocated_role, organization_id = EXCLUDED.organization_id,
    assigned_by = EXCLUDED.assigned_by, is_active = true;

-- ── 3. NDIS plans + budgets ───────────────────────────────────────────────────
INSERT INTO public.ndis_plans (
    id, organization_id, patient_id, plan_number, plan_start, plan_end, total_funding, status
) VALUES
    ('b1000201-0000-4000-8000-000000000001'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b1000001-0000-4000-8000-000000000001'::uuid, '2026-NDIS-LF-001', '2026-01-01', '2026-12-31', 52000.00, 'active'),
    ('b1000202-0000-4000-8000-000000000002'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b1000002-0000-4000-8000-000000000002'::uuid, '2026-NDIS-AK-002', '2026-03-01', '2027-02-28', 68000.00, 'active'),
    ('b1000203-0000-4000-8000-000000000003'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b1000003-0000-4000-8000-000000000003'::uuid, '2026-NDIS-EW-003', '2026-02-01', '2027-01-31', 48000.00, 'active'),
    ('b1000204-0000-4000-8000-000000000004'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b1000004-0000-4000-8000-000000000004'::uuid, '2026-NDIS-CO-004', '2026-04-01', '2027-03-31', 61000.00, 'active')
ON CONFLICT (id) DO UPDATE SET
    patient_id = EXCLUDED.patient_id, plan_number = EXCLUDED.plan_number,
    plan_start = EXCLUDED.plan_start, plan_end = EXCLUDED.plan_end,
    total_funding = EXCLUDED.total_funding, status = EXCLUDED.status, updated_at = now();

UPDATE public.patients SET ndis_plan_id = v.plan_id
FROM (VALUES
    ('b1000001-0000-4000-8000-000000000001'::uuid, 'b1000201-0000-4000-8000-000000000001'::uuid),
    ('b1000002-0000-4000-8000-000000000002'::uuid, 'b1000202-0000-4000-8000-000000000002'::uuid),
    ('b1000003-0000-4000-8000-000000000003'::uuid, 'b1000203-0000-4000-8000-000000000003'::uuid),
    ('b1000004-0000-4000-8000-000000000004'::uuid, 'b1000204-0000-4000-8000-000000000004'::uuid)
) AS v(patient_id, plan_id)
WHERE patients.id = v.patient_id;

INSERT INTO public.plan_budgets (id, plan_id, category, allocated_amount, used_amount) VALUES
    ('b1000211-0000-4000-8000-000000000001'::uuid, 'b1000201-0000-4000-8000-000000000001'::uuid, 'core', 32000.00, 6100.00),
    ('b1000212-0000-4000-8000-000000000001'::uuid, 'b1000201-0000-4000-8000-000000000001'::uuid, 'capacity_building', 16000.00, 1800.00),
    ('b1000213-0000-4000-8000-000000000001'::uuid, 'b1000201-0000-4000-8000-000000000001'::uuid, 'capital', 4000.00, 500.00),
    ('b1000211-0000-4000-8000-000000000002'::uuid, 'b1000202-0000-4000-8000-000000000002'::uuid, 'core', 42000.00, 9800.00),
    ('b1000212-0000-4000-8000-000000000002'::uuid, 'b1000202-0000-4000-8000-000000000002'::uuid, 'capacity_building', 22000.00, 3900.00),
    ('b1000213-0000-4000-8000-000000000002'::uuid, 'b1000202-0000-4000-8000-000000000002'::uuid, 'capital', 4000.00, 500.00),
    ('b1000211-0000-4000-8000-000000000003'::uuid, 'b1000203-0000-4000-8000-000000000003'::uuid, 'core', 30000.00, 4200.00),
    ('b1000212-0000-4000-8000-000000000003'::uuid, 'b1000203-0000-4000-8000-000000000003'::uuid, 'capacity_building', 14000.00, 800.00),
    ('b1000213-0000-4000-8000-000000000003'::uuid, 'b1000203-0000-4000-8000-000000000003'::uuid, 'capital', 4000.00, 200.00),
    ('b1000211-0000-4000-8000-000000000004'::uuid, 'b1000204-0000-4000-8000-000000000004'::uuid, 'core', 38000.00, 6500.00),
    ('b1000212-0000-4000-8000-000000000004'::uuid, 'b1000204-0000-4000-8000-000000000004'::uuid, 'capacity_building', 18000.00, 1000.00),
    ('b1000213-0000-4000-8000-000000000004'::uuid, 'b1000204-0000-4000-8000-000000000004'::uuid, 'capital', 5000.00, 300.00)
ON CONFLICT (plan_id, category) DO UPDATE SET
    allocated_amount = EXCLUDED.allocated_amount, used_amount = EXCLUDED.used_amount;

-- ── 4. NDIS goals (2 per participant) ───────────────────────────────────────
INSERT INTO public.ndis_goals (
    id, participant_id, organization_id, plan_id, created_by,
    name, goal_area, description, target_date, success_criteria,
    why_it_matters, support_category, priority, status
) VALUES
    ('b1000301-0000-4000-8000-000000000001'::uuid, 'b1000001-0000-4000-8000-000000000001'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b1000201-0000-4000-8000-000000000001'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Independent meal preparation', 'daily_living', 'Prepare a simple hot meal with minimal verbal prompting using a visual recipe card.', '2026-10-31', 'Two-item meal on 4 of 5 sessions with verbal prompting only.', 'Supports independence in North Adelaide unit.', 'core_daily_activities', 1, 'active'),
    ('b1000302-0000-4000-8000-000000000001'::uuid, 'b1000001-0000-4000-8000-000000000001'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b1000201-0000-4000-8000-000000000001'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Increase community participation', 'community', 'Attend community activities twice per week with support.', '2026-12-15', '2+ outings per week for 4 consecutive weeks.', 'Builds social connection beyond home.', 'core_social_community', 2, 'active'),
    ('b1000301-0000-4000-8000-000000000002'::uuid, 'b1000002-0000-4000-8000-000000000002'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b1000202-0000-4000-8000-000000000002'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Maintain independent living at home', 'daily_living', 'Complete morning personal care and domestic tasks with stand-by assist.', '2027-01-31', 'Morning routine with stand-by assist on 4 of 5 sessions.', 'Primary quality-of-life goal.', 'core_daily_activities', 1, 'active'),
    ('b1000302-0000-4000-8000-000000000002'::uuid, 'b1000002-0000-4000-8000-000000000002'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b1000202-0000-4000-8000-000000000002'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Improve community mobility and confidence', 'community', 'Safe footpath mobility and café outings before midday.', '2026-11-30', '30-minute outing twice weekly without falls.', 'Reduces isolation.', 'core_social_community', 2, 'active'),
    ('b1000301-0000-4000-8000-000000000003'::uuid, 'b1000003-0000-4000-8000-000000000003'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b1000203-0000-4000-8000-000000000003'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Improve upper limb function', 'health', 'Practice fine motor tasks during daily living and community activities.', '2026-11-15', 'Completes buttoning and utensil tasks with partial prompting on 4 of 5 sessions.', 'Supports independence with dressing and eating.', 'cb_health_wellbeing', 1, 'active'),
    ('b1000302-0000-4000-8000-000000000003'::uuid, 'b1000003-0000-4000-8000-000000000003'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b1000203-0000-4000-8000-000000000003'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Build social confidence', 'social', 'Engage in structured social activities in familiar community venues.', '2027-01-31', 'Initiates one social interaction per supported outing for 4 weeks.', 'Builds peer connection.', 'core_social_community', 2, 'active'),
    ('b1000301-0000-4000-8000-000000000004'::uuid, 'b1000004-0000-4000-8000-000000000004'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b1000204-0000-4000-8000-000000000004'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Rebuild daily living routines', 'daily_living', 'Follow written routines for personal care, meals, and domestic tasks.', '2027-02-28', 'Completes 3-step routine with written prompts on 4 of 5 sessions.', 'Foundation for independent living.', 'core_daily_activities', 1, 'active'),
    ('b1000302-0000-4000-8000-000000000004'::uuid, 'b1000004-0000-4000-8000-000000000004'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'b1000204-0000-4000-8000-000000000004'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Return to part-time volunteering', 'employment', 'Build stamina and confidence for community garden volunteering.', '2027-03-31', 'Attends 2-hour supported volunteer session fortnightly for 8 weeks.', 'Meaningful community role.', 'cb_employment', 2, 'active')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status, updated_at = now();

-- ── 5. Participant tasks (2 per participant) ──────────────────────────────────
INSERT INTO public.participant_tasks (
    id, participant_id, goal_id, organization_id, created_by,
    name, description, frequency, shift_type, category, priority,
    support_category, evidence_required, is_mandatory, status
) VALUES
    ('b1000401-0000-4000-8000-000000000001'::uuid, 'b1000001-0000-4000-8000-000000000001'::uuid, 'b1000301-0000-4000-8000-000000000001'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Support meal preparation with visual recipe', 'Use pictorial recipe card. Document prompting level.', 'each_shift', 'afternoon', 'domestic_assistance', 'high', 'core_daily_activities', 'notes', true, 'pending'),
    ('b1000402-0000-4000-8000-000000000001'::uuid, 'b1000001-0000-4000-8000-000000000001'::uuid, 'b1000302-0000-4000-8000-000000000001'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Accompany community outing', 'Support planned community activity. Note engagement.', 'weekly', 'anytime', 'community_access', 'medium', 'core_social_community', 'none', false, 'pending'),
    ('b1000401-0000-4000-8000-000000000002'::uuid, 'b1000002-0000-4000-8000-000000000002'::uuid, 'b1000301-0000-4000-8000-000000000002'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Morning personal care and domestic tasks', 'Stand-by assist with showering and dressing. Rest breaks as needed.', 'each_shift', 'morning', 'personal_care', 'high', 'core_daily_activities', 'notes', true, 'pending'),
    ('b1000402-0000-4000-8000-000000000002'::uuid, 'b1000002-0000-4000-8000-000000000002'::uuid, 'b1000302-0000-4000-8000-000000000002'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Henley Beach mobility outing', 'Jetty or café outing before 11:00 am. Gait belt on uneven surfaces.', 'weekly', 'morning', 'community_access', 'medium', 'core_social_community', 'photo', false, 'pending'),
    ('b1000401-0000-4000-8000-000000000003'::uuid, 'b1000003-0000-4000-8000-000000000003'::uuid, 'b1000301-0000-4000-8000-000000000003'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Upper limb fine motor practice', 'Buttoning, utensil use, and grip exercises during morning routine.', 'each_shift', 'morning', 'personal_care', 'high', 'cb_health_wellbeing', 'notes', true, 'pending'),
    ('b1000402-0000-4000-8000-000000000003'::uuid, 'b1000003-0000-4000-8000-000000000003'::uuid, 'b1000302-0000-4000-8000-000000000003'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Supported café social outing', 'Unley café visit. Encourage Ethan to order independently.', 'weekly', 'morning', 'community_access', 'medium', 'core_social_community', 'none', false, 'pending'),
    ('b1000401-0000-4000-8000-000000000004'::uuid, 'b1000004-0000-4000-8000-000000000004'::uuid, 'b1000301-0000-4000-8000-000000000004'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Follow written daily routine', 'Use whiteboard checklist for personal care and meal steps.', 'each_shift', 'afternoon', 'domestic_assistance', 'high', 'core_daily_activities', 'notes', true, 'pending'),
    ('b1000402-0000-4000-8000-000000000004'::uuid, 'b1000004-0000-4000-8000-000000000004'::uuid, 'b1000302-0000-4000-8000-000000000004'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'e704e016-689d-4d93-9577-691a5ba5879b'::uuid, 'Community garden visit prep', 'Review volunteer role expectations and transport plan.', 'weekly', 'afternoon', 'community_access', 'low', 'cb_employment', 'none', false, 'pending')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, status = EXCLUDED.status, updated_at = now();

-- ── 6. Allergies + briefing alerts ────────────────────────────────────────────
INSERT INTO public.participant_allergies (id, participant_id, organization_id, allergen, severity, notes) VALUES
    ('b1000501-0000-4000-8000-000000000001'::uuid, 'b1000001-0000-4000-8000-000000000001'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'Latex', 'moderate', 'Use nitrile gloves for personal care.'),
    ('b1000502-0000-4000-8000-000000000002'::uuid, 'b1000002-0000-4000-8000-000000000002'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'Sulfonamide antibiotics', 'moderate', 'Documented rash — confirm with GP.'),
    ('b1000503-0000-4000-8000-000000000003'::uuid, 'b1000003-0000-4000-8000-000000000003'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'Dairy', 'mild', 'GI upset — use lactose-free milk.'),
    ('b1000504-0000-4000-8000-000000000004'::uuid, 'b1000004-0000-4000-8000-000000000004'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'Penicillin', 'moderate', 'Hives reaction documented.')
ON CONFLICT (id) DO UPDATE SET allergen = EXCLUDED.allergen, severity = EXCLUDED.severity, notes = EXCLUDED.notes, updated_at = now();

INSERT INTO public.participant_briefing_alerts (id, participant_id, organization_id, alert_text, sort_order, is_active) VALUES
    ('b1000601-0000-4000-8000-000000000001'::uuid, 'b1000001-0000-4000-8000-000000000001'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, '⚠️ Latex sensitivity — use non-latex gloves.', 0, true),
    ('b1000602-0000-4000-8000-000000000001'::uuid, 'b1000001-0000-4000-8000-000000000001'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'Give 15-minute transition warnings before leaving home.', 1, true),
    ('b1000601-0000-4000-8000-000000000002'::uuid, 'b1000002-0000-4000-8000-000000000002'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, '⛔ Falls risk — gait belt in hallway cupboard.', 0, true),
    ('b1000602-0000-4000-8000-000000000002'::uuid, 'b1000002-0000-4000-8000-000000000002'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, '⚠️ Heat sensitivity — outings before 11:00 am.', 1, true),
    ('b1000601-0000-4000-8000-000000000003'::uuid, 'b1000003-0000-4000-8000-000000000003'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, '⚠️ Swallowing precautions — cut food into small pieces.', 0, true),
    ('b1000602-0000-4000-8000-000000000003'::uuid, 'b1000003-0000-4000-8000-000000000003'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'Forearm crutches by front door — allow extra mobility time.', 1, true),
    ('b1000601-0000-4000-8000-000000000004'::uuid, 'b1000004-0000-4000-8000-000000000004'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, '⚠️ Seizure precautions — time episodes; call coordinator if >5 min.', 0, true),
    ('b1000602-0000-4000-8000-000000000004'::uuid, 'b1000004-0000-4000-8000-000000000004'::uuid, 'a1111111-1111-1111-1111-111111111111'::uuid, 'Use whiteboard checklist — do not leave cooking unattended.', 1, true)
ON CONFLICT (id) DO UPDATE SET alert_text = EXCLUDED.alert_text, sort_order = EXCLUDED.sort_order, is_active = EXCLUDED.is_active, updated_at = now();

-- ── 7. Completed sessions WITH compliance (Lachlan + Amelia only) ─────────────
INSERT INTO public.sessions (
    id, patient_id, organization_id, worker_id, created_by, owner_user_id,
    session_date, session_type, duration_minutes,
    notes, translated_english_note, compliance_input_text,
    detected_language, translation_status,
    status, compliance_score, compliance_status, compliance_notes,
    goals_addressed, support_category,
    activities_performed, outcomes, participant_response, progress_toward_goals
) VALUES
    (
        'b1000701-0000-4000-8000-000000000001'::uuid,
        'b1000001-0000-4000-8000-000000000001'::uuid,
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        now() - interval '4 days', 'daily_living', 120,
        'Lachlan prepared scrambled eggs and toast using his visual recipe card. Required two verbal prompts for stove timing. Tolerated session well and cleaned workspace independently.',
        'Lachlan prepared scrambled eggs and toast using his visual recipe card. Required two verbal prompts for stove timing. Tolerated session well and cleaned workspace independently.',
        'Lachlan prepared scrambled eggs and toast using his visual recipe card. Required two verbal prompts for stove timing. Tolerated session well and cleaned workspace independently.',
        'en', 'not_required',
        'completed', 91, 'compliant',
        'Goal linkage documented. Prompting level recorded. No restrictive practices. Incident-free shift.',
        '["goal_lachlan_1"]'::jsonb, 'core_daily_activities',
        'Meal preparation with visual recipe card; kitchen safety review',
        'Two-item hot meal completed with verbal prompting only',
        'Engaged throughout; requested to repeat session next week',
        'Measurable progress toward independent meal preparation goal'
    ),
    (
        'b1000702-0000-4000-8000-000000000002'::uuid,
        'b1000002-0000-4000-8000-000000000002'::uuid,
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        now() - interval '3 days', 'personal_care', 90,
        'Amelia completed morning shower and dressing with stand-by assist. Fatigue noted at 10:45 am. Shortened planned outing; rested on patio with hydration. No falls or incidents.',
        'Amelia completed morning shower and dressing with stand-by assist. Fatigue noted at 10:45 am. Shortened planned outing; rested on patio with hydration. No falls or incidents.',
        'Amelia completed morning shower and dressing with stand-by assist. Fatigue noted at 10:45 am. Shortened planned outing; rested on patio with hydration. No falls or incidents.',
        'en', 'not_required',
        'completed', 89, 'compliant',
        'Fatigue management plan followed. Gait belt used for transfers. Goals addressed. NDIS practice standards met.',
        '["goal_amelia_1"]'::jsonb, 'core_daily_activities',
        'Personal care, light domestic tasks, fatigue monitoring',
        'Morning routine completed safely; outing modified per fatigue plan',
        'Cooperative; reported feeling tired but okay after rest break',
        'Continued progress maintaining independence at home'
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

-- ── 8. Shifts: 2 completed + 2 scheduled ──────────────────────────────────────
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
    -- COMPLETED: Lachlan
    (
        'b1000801-0000-4000-8000-000000000001'::uuid,
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        'b1000001-0000-4000-8000-000000000001'::uuid,
        'b1000701-0000-4000-8000-000000000001'::uuid,
        now() - interval '4 days 2 hours', now() - interval '4 days',
        now() - interval '4 days 2 hours', now() - interval '4 days', 120,
        'Lachlan Fraser', '1998-02-14', 'male',
        '14 Melbourne Street, North Adelaide SA 5006', '0412 678 901',
        'Latex — contact dermatitis', 'Sensory sensitivity in noisy environments',
        E'⚠️ Latex sensitivity — use non-latex gloves\nGive 15-minute transition warnings',
        'Visual recipe card in kitchen drawer.',
        'Ground-floor unit — key safe code 4821 on front fence.',
        'Focus on meal preparation goal. Document prompting levels.',
        'Enter via front door. Key safe on left fence post.',
        ARRAY['Independent meal preparation (Daily Living)', 'Increase community participation (Community)'],
        'Use pictorial recipe card for cooking task.',
        'completed', '[]'::jsonb,
        now() - interval '4 days 2 hours', 'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid
    ),
    -- COMPLETED: Amelia
    (
        'b1000802-0000-4000-8000-000000000002'::uuid,
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        'b1000002-0000-4000-8000-000000000002'::uuid,
        'b1000702-0000-4000-8000-000000000002'::uuid,
        now() - interval '3 days 2 hours', now() - interval '3 days',
        now() - interval '3 days 2 hours', now() - interval '3 days', 90,
        'Amelia Kovac', '1987-09-22', 'female',
        '7 Seaview Road, Henley Beach SA 5022', '0438 214 567',
        'Sulfonamide antibiotics, shellfish',
        E'Heat sensitivity\nReduced balance — gait belt required',
        E'⛔ Falls risk — gait belt for transfers\n⚠️ Heat sensitivity — outings before 11:00 am',
        'Cooling vest in laundry. Gait belt in hallway cupboard.',
        'Ramp at rear entrance. Tom (husband) may be home.',
        'Monitor fatigue closely. Shorten outing if needed.',
        'Rear ramp access preferred.',
        ARRAY['Maintain independent living at home (Daily Living)', 'Improve community mobility (Community)'],
        'Finish community outing by 10:45 am latest.',
        'completed', '[]'::jsonb,
        now() - interval '3 days 2 hours', 'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid
    ),
    -- SCHEDULED: Ethan (compliance ack pending)
    (
        'b1000803-0000-4000-8000-000000000003'::uuid,
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        'b1000003-0000-4000-8000-000000000003'::uuid,
        NULL,
        date_trunc('day', now() AT TIME ZONE 'Australia/Adelaide') AT TIME ZONE 'Australia/Adelaide' + interval '9 hours',
        date_trunc('day', now() AT TIME ZONE 'Australia/Adelaide') AT TIME ZONE 'Australia/Adelaide' + interval '13 hours',
        NULL, NULL, NULL,
        'Ethan Walsh', '2004-11-08', 'male',
        '55 King William Road, Unley SA 5061', '0421 309 876',
        'Dairy intolerance',
        E'Mobility — forearm crutches\nSwallowing precautions',
        E'⚠️ Swallowing precautions — cut food into small pieces\nForearm crutches by front door — allow extra time',
        'Morning upper limb practice then Unley café outing if regulated.',
        'Unit 3 — intercom Walsh. Visitor parking on Mitchell Street.',
        'Acknowledge all briefing alerts before clock-in. Document fine motor prompting.',
        'Intercom unit 3. Crutches visible from entry.',
        ARRAY['Improve upper limb function (Health)', 'Build social confidence (Social)'],
        'Encourage Ethan to order at café independently.',
        'scheduled', '[]'::jsonb,
        NULL, NULL
    ),
    -- SCHEDULED: Charlotte (compliance ack pending)
    (
        'b1000804-0000-4000-8000-000000000004'::uuid,
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'd3c3d4a4-55e1-4f43-af66-5ef0a46f3a11'::uuid,
        'b1000004-0000-4000-8000-000000000004'::uuid,
        NULL,
        date_trunc('day', now() AT TIME ZONE 'Australia/Adelaide') AT TIME ZONE 'Australia/Adelaide' + interval '14 hours',
        date_trunc('day', now() AT TIME ZONE 'Australia/Adelaide') AT TIME ZONE 'Australia/Adelaide' + interval '18 hours',
        NULL, NULL, NULL,
        'Charlotte O''Brien', '1993-05-17', 'female',
        '28 Port Road, Hindmarsh SA 5007', '0433 781 204',
        'Penicillin — hives',
        E'Memory support required\nSeizure precautions',
        E'⚠️ Seizure precautions — time episodes; call coordinator if >5 min\nUse whiteboard checklist for all multi-step tasks',
        'Afternoon routine with written prompts. No unattended cooking.',
        'Apartment 12 — lift access. Metered parking on Port Road.',
        'Review whiteboard before starting. Leave written shift summary on departure.',
        'Lift to level 1, apartment 12 on left.',
        ARRAY['Rebuild daily living routines (Daily Living)', 'Return to part-time volunteering (Employment)'],
        'Do not leave Charlotte unattended near open flame when cooking.',
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

-- Sync shift snapshot fields from patients (ensures phone/address always present on re-run)
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
    'b1000801-0000-4000-8000-000000000001'::uuid,
    'b1000802-0000-4000-8000-000000000002'::uuid,
    'b1000803-0000-4000-8000-000000000003'::uuid,
    'b1000804-0000-4000-8000-000000000004'::uuid
  );

-- Remove legacy scheduled shifts that were on Lachlan/Amelia (replaced by Ethan/Charlotte)
DELETE FROM public.shifts
WHERE id IN (
    'b1000803-0000-4000-8000-000000000001'::uuid,
    'b1000804-0000-4000-8000-000000000002'::uuid
)
  AND participant_id IN (
    'b1000001-0000-4000-8000-000000000001'::uuid,
    'b1000002-0000-4000-8000-000000000002'::uuid
  );

UPDATE public.sessions SET shift_id = 'b1000801-0000-4000-8000-000000000001'::uuid WHERE id = 'b1000701-0000-4000-8000-000000000001'::uuid;
UPDATE public.sessions SET shift_id = 'b1000802-0000-4000-8000-000000000002'::uuid WHERE id = 'b1000702-0000-4000-8000-000000000002'::uuid;

-- ── 9. Budget usage (completed sessions) ──────────────────────────────────────
INSERT INTO public.budget_usage (
    id, plan_id, session_id, category, amount, hourly_rate, duration_minutes, description
) VALUES
    ('b1000901-0000-4000-8000-000000000001'::uuid, 'b1000201-0000-4000-8000-000000000001'::uuid, 'b1000701-0000-4000-8000-000000000001'::uuid, 'core', 135.12, 67.56, 120, 'Daily activities — meal preparation (Lachlan Fraser)'),
    ('b1000902-0000-4000-8000-000000000002'::uuid, 'b1000202-0000-4000-8000-000000000002'::uuid, 'b1000702-0000-4000-8000-000000000002'::uuid, 'core', 101.34, 67.56, 90, 'Personal care and domestic assistance (Amelia Kovac)')
ON CONFLICT (id) DO UPDATE SET
    amount = EXCLUDED.amount, duration_minutes = EXCLUDED.duration_minutes, description = EXCLUDED.description;

COMMIT;

-- ── Verification ──────────────────────────────────────────────────────────────
SELECT
    p.full_name,
    p.ndis_number,
    p.phone       AS patient_phone,
    p.address     AS patient_address,
    s.participant_phone,
    s.participant_address,
    s.status AS shift_status,
    s.scheduled_start,
    sess.compliance_score,
    sess.compliance_status,
    CASE
        WHEN s.status = 'scheduled' AND s.risks_acknowledged_at IS NULL THEN 'ACK PENDING'
        WHEN s.status = 'completed' AND sess.compliance_status = 'compliant' THEN 'COMPLIANT'
        ELSE s.status
    END AS compliance_state
FROM public.patients p
JOIN public.shifts s ON s.participant_id = p.id
LEFT JOIN public.sessions sess ON sess.id = s.session_id
WHERE p.id IN (
    'b1000001-0000-4000-8000-000000000001'::uuid,
    'b1000002-0000-4000-8000-000000000002'::uuid,
    'b1000003-0000-4000-8000-000000000003'::uuid,
    'b1000004-0000-4000-8000-000000000004'::uuid
)
ORDER BY s.status DESC, p.full_name;
