-- ============================================================
-- Harbor View Supports — Org 2 Demo Seed
-- Second isolated organisation for multi-tenant testing.
--
-- Logins:
--   Support Coordinator:
--     lisa@harborview-demo.com  /  Lisaharbor#2026
--   Support Worker:
--     james@harborview-demo.com  /  Jamesharbor#2026
--   Allied Health:
--     priya@harborview-demo.com  /  Priyaharbor#2026
--
-- IDs are deterministic so this script is fully idempotent.
-- Run in the Supabase SQL editor (requires service_role access
-- to auth.users / auth.identities).
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Auth users ─────────────────────────────────────────────────────────

DO $$
DECLARE
    identities_id_type      text;
    provider_id_exists      boolean;
    provider_id_generated   text;
    identity_payload        jsonb;
    demo                    record;
BEGIN
    SELECT data_type
    INTO identities_id_type
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name   = 'identities'
      AND column_name  = 'id';

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'auth'
          AND table_name   = 'identities'
          AND column_name  = 'provider_id'
    ) INTO provider_id_exists;

    SELECT COALESCE(MAX(is_generated), 'NEVER')
    INTO provider_id_generated
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name   = 'identities'
      AND column_name  = 'provider_id';

    -- Clean up identities so re-runs don't hit unique violations
    DELETE FROM auth.identities
    WHERE user_id IN (
        '10000000-0000-4000-8000-000000000201'::uuid,
        '10000000-0000-4000-8000-000000000202'::uuid,
        '10000000-0000-4000-8000-000000000203'::uuid
    );

    -- Remove any stale auth rows that don't match the deterministic IDs
    DELETE FROM auth.users
    WHERE lower(email) IN (
        'lisa@harborview-demo.com',
        'james@harborview-demo.com',
        'priya@harborview-demo.com'
    )
      AND id NOT IN (
        '10000000-0000-4000-8000-000000000201'::uuid,
        '10000000-0000-4000-8000-000000000202'::uuid,
        '10000000-0000-4000-8000-000000000203'::uuid
    );

    FOR demo IN
        SELECT *
        FROM (VALUES
            ('10000000-0000-4000-8000-000000000201'::uuid, 'lisa@harborview-demo.com',  'Lisaharbor#2026',  'Lisa Nguyen'),
            ('10000000-0000-4000-8000-000000000202'::uuid, 'james@harborview-demo.com', 'Jamesharbor#2026', 'James Obi'),
            ('10000000-0000-4000-8000-000000000203'::uuid, 'priya@harborview-demo.com', 'Priyaharbor#2026', 'Priya Sharma')
        ) AS t(id, email, password, full_name)
    LOOP
        INSERT INTO auth.users (
            instance_id,
            id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            raw_app_meta_data,
            raw_user_meta_data,
            created_at,
            updated_at,
            confirmation_token,
            email_change,
            email_change_token_new,
            recovery_token
        ) VALUES (
            '00000000-0000-0000-0000-000000000000'::uuid,
            demo.id,
            'authenticated',
            'authenticated',
            demo.email,
            crypt(demo.password, gen_salt('bf')),
            now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('full_name', demo.full_name),
            now(),
            now(),
            '', '', '', ''
        )
        ON CONFLICT (id) DO UPDATE
        SET
            email              = EXCLUDED.email,
            encrypted_password = EXCLUDED.encrypted_password,
            email_confirmed_at = COALESCE(auth.users.email_confirmed_at, now()),
            raw_app_meta_data  = EXCLUDED.raw_app_meta_data,
            raw_user_meta_data = EXCLUDED.raw_user_meta_data,
            updated_at         = now();

        identity_payload := jsonb_build_object(
            'sub',            demo.id::text,
            'email',          demo.email,
            'email_verified', true,
            'phone_verified', false,
            'full_name',      demo.full_name
        );

        IF provider_id_exists AND provider_id_generated <> 'ALWAYS' THEN
            IF identities_id_type = 'uuid' THEN
                INSERT INTO auth.identities (
                    id, user_id, provider_id, identity_data, provider,
                    last_sign_in_at, created_at, updated_at
                ) VALUES (
                    gen_random_uuid(), demo.id, demo.id::text, identity_payload, 'email',
                    now(), now(), now()
                ) ON CONFLICT DO NOTHING;
            ELSE
                INSERT INTO auth.identities (
                    id, user_id, provider_id, identity_data, provider,
                    last_sign_in_at, created_at, updated_at
                ) VALUES (
                    demo.id::text, demo.id, demo.id::text, identity_payload, 'email',
                    now(), now(), now()
                ) ON CONFLICT DO NOTHING;
            END IF;
        ELSE
            IF identities_id_type = 'uuid' THEN
                INSERT INTO auth.identities (
                    id, user_id, identity_data, provider,
                    last_sign_in_at, created_at, updated_at
                ) VALUES (
                    gen_random_uuid(), demo.id, identity_payload, 'email',
                    now(), now(), now()
                ) ON CONFLICT DO NOTHING;
            ELSE
                INSERT INTO auth.identities (
                    id, user_id, identity_data, provider,
                    last_sign_in_at, created_at, updated_at
                ) VALUES (
                    demo.id::text, demo.id, identity_payload, 'email',
                    now(), now(), now()
                ) ON CONFLICT DO NOTHING;
            END IF;
        END IF;
    END LOOP;
END $$;

-- ── 2. Organisation ────────────────────────────────────────────────────────

INSERT INTO public.organizations (
    organization_id,
    name,
    owner_user_id,
    provider_type,
    registration_status,
    team_size,
    participant_volume,
    contact_number,
    plan_tier
) VALUES (
    '20000000-0000-4000-8000-000000000002'::uuid,
    'Harbor View Supports',
    '10000000-0000-4000-8000-000000000201'::uuid,
    'support_coord',
    'registered_ndis',
    '2-10',
    '1-25',
    '02 5550 2027',
    'starter'
)
ON CONFLICT (organization_id) DO UPDATE
SET
    name               = EXCLUDED.name,
    owner_user_id      = EXCLUDED.owner_user_id,
    provider_type      = EXCLUDED.provider_type,
    registration_status= EXCLUDED.registration_status,
    team_size          = EXCLUDED.team_size,
    participant_volume = EXCLUDED.participant_volume,
    contact_number     = EXCLUDED.contact_number,
    plan_tier          = EXCLUDED.plan_tier;

-- ── 3. public.users profiles ───────────────────────────────────────────────

WITH org2_profiles(id, email, full_name, role_name, account_type) AS (
    VALUES
        ('10000000-0000-4000-8000-000000000201'::uuid, 'lisa@harborview-demo.com',  'Lisa Nguyen',  'support_coordinator', 'small_provider'),
        ('10000000-0000-4000-8000-000000000202'::uuid, 'james@harborview-demo.com', 'James Obi',    'support_worker',      'independent_worker'),
        ('10000000-0000-4000-8000-000000000203'::uuid, 'priya@harborview-demo.com', 'Priya Sharma', 'allied_health',       'allied_health')
)
INSERT INTO public.users (
    id,
    email,
    full_name,
    role,
    account_type,
    onboarding_complete,
    email_verified,
    profile_completed,
    onboarding_completed,
    role_specific_profile_completed,
    organization_id,
    is_active
)
SELECT
    id,
    email,
    full_name,
    role_name,
    account_type,
    true, true, true, true, true,
    '20000000-0000-4000-8000-000000000002'::uuid,
    true
FROM org2_profiles
ON CONFLICT (id) DO UPDATE
SET
    email                           = EXCLUDED.email,
    full_name                       = EXCLUDED.full_name,
    role                            = EXCLUDED.role,
    account_type                    = EXCLUDED.account_type,
    onboarding_complete             = true,
    email_verified                  = true,
    profile_completed               = true,
    onboarding_completed            = true,
    role_specific_profile_completed = true,
    organization_id                 = EXCLUDED.organization_id,
    is_active                       = true;

-- ── 4. organization_members ────────────────────────────────────────────────

WITH org2_members(user_id, role_name) AS (
    VALUES
        ('10000000-0000-4000-8000-000000000201'::uuid, 'support_coordinator'),
        ('10000000-0000-4000-8000-000000000202'::uuid, 'support_worker'),
        ('10000000-0000-4000-8000-000000000203'::uuid, 'allied_health')
)
INSERT INTO public.organization_members (
    user_id,
    organization_id,
    role,
    is_active,
    invited_by
)
SELECT
    user_id,
    '20000000-0000-4000-8000-000000000002'::uuid,
    role_name,
    true,
    '10000000-0000-4000-8000-000000000201'::uuid
FROM org2_members
ON CONFLICT (user_id, organization_id) DO UPDATE
SET
    role       = EXCLUDED.role,
    is_active  = true,
    invited_by = EXCLUDED.invited_by;

-- ── 5. Patients ────────────────────────────────────────────────────────────

INSERT INTO public.patients (
    id,
    organization_id,
    full_name,
    ndis_number,
    date_of_birth,
    email,
    phone,
    plan_status,
    plan_start_date,
    plan_end_date,
    total_budget,
    used_budget,
    primary_disability,
    goals,
    assigned_worker_id,
    allied_health_id,
    created_by,
    owner_user_id
) VALUES
    (
        '30000000-0000-4000-8000-000000000201'::uuid,
        '20000000-0000-4000-8000-000000000002'::uuid,
        'Liam Torres',
        'NDIS-HBR-001',
        '2009-03-14',
        'liam.torres@example.com',
        '0411 100 200',
        'active',
        '2026-01-01',
        '2026-12-31',
        48000.00,
        9200.00,
        'Down Syndrome',
        '[{"id":"goal_liam_1","title":"Build numeracy skills","status":"active"},{"id":"goal_liam_2","title":"Increase social confidence","status":"active"}]'::jsonb,
        '10000000-0000-4000-8000-000000000202'::uuid,
        null,
        '10000000-0000-4000-8000-000000000201'::uuid,
        '10000000-0000-4000-8000-000000000201'::uuid
    ),
    (
        '30000000-0000-4000-8000-000000000202'::uuid,
        '20000000-0000-4000-8000-000000000002'::uuid,
        'Amelia Park',
        'NDIS-HBR-002',
        '1992-07-29',
        'amelia.park@example.com',
        '0422 300 400',
        'active',
        '2026-03-01',
        '2027-02-28',
        62000.00,
        15800.00,
        'Multiple Sclerosis',
        '[{"id":"goal_amelia_1","title":"Maintain independent living skills","status":"active"},{"id":"goal_amelia_2","title":"Improve fatigue management","status":"active"}]'::jsonb,
        null,
        '10000000-0000-4000-8000-000000000203'::uuid,
        '10000000-0000-4000-8000-000000000201'::uuid,
        '10000000-0000-4000-8000-000000000201'::uuid
    )
ON CONFLICT (id) DO UPDATE
SET
    organization_id    = EXCLUDED.organization_id,
    full_name          = EXCLUDED.full_name,
    ndis_number        = EXCLUDED.ndis_number,
    date_of_birth      = EXCLUDED.date_of_birth,
    email              = EXCLUDED.email,
    phone              = EXCLUDED.phone,
    plan_status        = EXCLUDED.plan_status,
    plan_start_date    = EXCLUDED.plan_start_date,
    plan_end_date      = EXCLUDED.plan_end_date,
    total_budget       = EXCLUDED.total_budget,
    used_budget        = EXCLUDED.used_budget,
    primary_disability = EXCLUDED.primary_disability,
    goals              = EXCLUDED.goals,
    assigned_worker_id = EXCLUDED.assigned_worker_id,
    allied_health_id   = EXCLUDED.allied_health_id,
    created_by         = EXCLUDED.created_by,
    owner_user_id      = EXCLUDED.owner_user_id;

-- ── 5b. Practitioner allocations ───────────────────────────────────────────

INSERT INTO public.practitioner_allocations (
    patient_id,
    user_id,
    allocated_role,
    organization_id,
    assigned_by,
    is_active
) VALUES
    (
        '30000000-0000-4000-8000-000000000201'::uuid,
        '10000000-0000-4000-8000-000000000202'::uuid,
        'support_worker',
        '20000000-0000-4000-8000-000000000002'::uuid,
        '10000000-0000-4000-8000-000000000201'::uuid,
        true
    ),
    (
        '30000000-0000-4000-8000-000000000202'::uuid,
        '10000000-0000-4000-8000-000000000203'::uuid,
        'allied_health',
        '20000000-0000-4000-8000-000000000002'::uuid,
        '10000000-0000-4000-8000-000000000201'::uuid,
        true
    )
ON CONFLICT (patient_id, user_id) DO UPDATE
SET
    allocated_role   = EXCLUDED.allocated_role,
    organization_id  = EXCLUDED.organization_id,
    assigned_by      = EXCLUDED.assigned_by,
    is_active        = true;

-- ── 6. Sessions ────────────────────────────────────────────────────────────

INSERT INTO public.sessions (
    id,
    patient_id,
    organization_id,
    worker_id,
    practitioner_id,
    session_date,
    session_type,
    duration_minutes,
    notes,
    translated_english_note,
    compliance_input_text,
    original_language_input,
    detected_language,
    translation_status,
    translation_provider,
    translation_confidence,
    translation_metadata,
    translation_completed_at,
    status,
    compliance_score,
    goals_addressed,
    created_by,
    owner_user_id
) VALUES
    (
        '40000000-0000-4000-8000-000000000201'::uuid,
        '30000000-0000-4000-8000-000000000201'::uuid,
        '20000000-0000-4000-8000-000000000002'::uuid,
        '10000000-0000-4000-8000-000000000202'::uuid,
        null,
        now() - interval '2 days',
        'community_access',
        90,
        'Liam practised counting change at the local shops and interacted with two unfamiliar adults. He used his communication card once and completed the task independently.',
        'Liam practised counting change at the local shops and interacted with two unfamiliar adults. He used his communication card once and completed the task independently.',
        'Liam practised counting change at the local shops and interacted with two unfamiliar adults. He used his communication card once and completed the task independently.',
        'Liam practised counting change at the local shops and interacted with two unfamiliar adults. He used his communication card once and completed the task independently.',
        'en',
        'not_required',
        'none',
        1.0000,
        '{"source":"demo_seed"}'::jsonb,
        now(),
        'completed',
        90,
        '["goal_liam_2"]'::jsonb,
        '10000000-0000-4000-8000-000000000202'::uuid,
        '10000000-0000-4000-8000-000000000202'::uuid
    ),
    (
        '40000000-0000-4000-8000-000000000202'::uuid,
        '30000000-0000-4000-8000-000000000202'::uuid,
        '20000000-0000-4000-8000-000000000002'::uuid,
        null,
        '10000000-0000-4000-8000-000000000203'::uuid,
        now() - interval '1 day',
        'occupational_therapy',
        60,
        'Amelia completed energy conservation strategies review and practised task pacing in the kitchen. She reported reduced fatigue after implementing rest breaks.',
        'Amelia completed energy conservation strategies review and practised task pacing in the kitchen. She reported reduced fatigue after implementing rest breaks.',
        'Amelia completed energy conservation strategies review and practised task pacing in the kitchen. She reported reduced fatigue after implementing rest breaks.',
        'Amelia completed energy conservation strategies review and practised task pacing in the kitchen. She reported reduced fatigue after implementing rest breaks.',
        'en',
        'not_required',
        'none',
        1.0000,
        '{"source":"demo_seed"}'::jsonb,
        now(),
        'completed',
        87,
        '["goal_amelia_2"]'::jsonb,
        '10000000-0000-4000-8000-000000000203'::uuid,
        '10000000-0000-4000-8000-000000000203'::uuid
    )
ON CONFLICT (id) DO UPDATE
SET
    patient_id               = EXCLUDED.patient_id,
    organization_id          = EXCLUDED.organization_id,
    worker_id                = EXCLUDED.worker_id,
    practitioner_id          = EXCLUDED.practitioner_id,
    session_date             = EXCLUDED.session_date,
    session_type             = EXCLUDED.session_type,
    duration_minutes         = EXCLUDED.duration_minutes,
    notes                    = EXCLUDED.notes,
    translated_english_note  = EXCLUDED.translated_english_note,
    compliance_input_text    = EXCLUDED.compliance_input_text,
    original_language_input  = EXCLUDED.original_language_input,
    detected_language        = EXCLUDED.detected_language,
    translation_status       = EXCLUDED.translation_status,
    translation_provider     = EXCLUDED.translation_provider,
    translation_confidence   = EXCLUDED.translation_confidence,
    translation_metadata     = EXCLUDED.translation_metadata,
    translation_completed_at = EXCLUDED.translation_completed_at,
    status                   = EXCLUDED.status,
    compliance_score         = EXCLUDED.compliance_score,
    goals_addressed          = EXCLUDED.goals_addressed,
    created_by               = EXCLUDED.created_by,
    owner_user_id            = EXCLUDED.owner_user_id;

COMMIT;
