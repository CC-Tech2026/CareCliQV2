-- ============================================================
-- CareScribe Sunshine Demo Seed
-- Creates the three pitch users and scoped demo data.
--
-- Logins:
--   Support Coordinator / CareScribe Parent
--     sarah@sunshine-demo.com / Sarahsunshine#2026
--   Support Worker / CareScribe Child
--     amara@sunshine-demo.com / Amarasunshine#2026
--   Allied Health Professional / CareScribe Pro
--     daniel@sunshine-demo.com / Danielsunshine#2026
--
-- Run after schema migrations in the Supabase SQL editor.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Product roles are intentionally limited to:
-- support_coordinator, support_worker, allied_health.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS account_type text DEFAULT 'independent_worker';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS onboarding_complete boolean DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS organization_id uuid;

DO $$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.users'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%role%'
    LOOP
        EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', constraint_name);
    END LOOP;

    ALTER TABLE public.users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('support_coordinator', 'support_worker', 'allied_health'));
END $$;

CREATE TABLE IF NOT EXISTS public.organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL,
    organization_name text NOT NULL,
    provider_type text,
    registration_status text,
    team_size text,
    participant_volume text,
    contact_number text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'support_worker',
    is_active boolean NOT NULL DEFAULT true,
    invited_by uuid REFERENCES public.users(id),
    joined_at timestamptz DEFAULT now(),
    CONSTRAINT uq_org_member UNIQUE (user_id, organization_id)
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.organization_members'::regclass
          AND conname = 'organization_members_role_check'
    ) THEN
        ALTER TABLE public.organization_members DROP CONSTRAINT organization_members_role_check;
    END IF;

    ALTER TABLE public.organization_members
    ADD CONSTRAINT organization_members_role_check
    CHECK (role IN ('support_coordinator', 'support_worker', 'allied_health'));
END $$;

CREATE TABLE IF NOT EXISTS public.practitioner_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    allocated_role text NOT NULL DEFAULT 'support_worker',
    organization_id uuid,
    assigned_by uuid REFERENCES public.users(id),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT uq_practitioner_allocations_patient_user UNIQUE (patient_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_patient_id ON public.practitioner_allocations(patient_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_user_id ON public.practitioner_allocations(user_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_org_id ON public.practitioner_allocations(organization_id);

DO $$
DECLARE
    demo record;
    identities_id_type text;
    provider_id_exists boolean;
    provider_id_generated text;
    identity_payload jsonb;
BEGIN
    SELECT data_type
    INTO identities_id_type
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'identities'
      AND column_name = 'id';

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'auth'
          AND table_name = 'identities'
          AND column_name = 'provider_id'
    )
    INTO provider_id_exists;

    SELECT COALESCE(MAX(is_generated), 'NEVER')
    INTO provider_id_generated
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'identities'
      AND column_name = 'provider_id';

    -- Reset only these deterministic demo identities if the seed is rerun.
    DELETE FROM auth.identities
    WHERE user_id IN (
        '10000000-0000-4000-8000-000000000101'::uuid,
        '10000000-0000-4000-8000-000000000102'::uuid,
        '10000000-0000-4000-8000-000000000103'::uuid
    );

    DELETE FROM auth.users
    WHERE lower(email) IN (
        'sarah@sunshine-demo.com',
        'amara@sunshine-demo.com',
        'daniel@sunshine-demo.com'
    )
      AND id NOT IN (
        '10000000-0000-4000-8000-000000000101'::uuid,
        '10000000-0000-4000-8000-000000000102'::uuid,
        '10000000-0000-4000-8000-000000000103'::uuid
    );

    FOR demo IN
        SELECT *
        FROM (VALUES
            ('10000000-0000-4000-8000-000000000101'::uuid, 'sarah@sunshine-demo.com',  'Sarahsunshine#2026',  'Sarah Mitchell', 'support_coordinator', 'small_provider'),
            ('10000000-0000-4000-8000-000000000102'::uuid, 'amara@sunshine-demo.com',  'Amarasunshine#2026',  'Amara Okafor',   'support_worker',      'independent_worker'),
            ('10000000-0000-4000-8000-000000000103'::uuid, 'daniel@sunshine-demo.com', 'Danielsunshine#2026', 'Daniel Hart',   'allied_health',       'allied_health')
        ) AS demo_users(id, email, password, full_name, role_name, account_type)
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
        )
        VALUES (
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
            '',
            '',
            '',
            ''
        )
        ON CONFLICT (id) DO UPDATE
        SET
            email = EXCLUDED.email,
            encrypted_password = EXCLUDED.encrypted_password,
            email_confirmed_at = COALESCE(auth.users.email_confirmed_at, now()),
            raw_app_meta_data = EXCLUDED.raw_app_meta_data,
            raw_user_meta_data = EXCLUDED.raw_user_meta_data,
            updated_at = now();

        identity_payload := jsonb_build_object(
            'sub', demo.id::text,
            'email', demo.email,
            'email_verified', true,
            'phone_verified', false,
            'full_name', demo.full_name
        );

        IF provider_id_exists AND provider_id_generated <> 'ALWAYS' THEN
            IF identities_id_type = 'uuid' THEN
                INSERT INTO auth.identities (
                    id, user_id, provider_id, identity_data, provider,
                    last_sign_in_at, created_at, updated_at
                )
                VALUES (
                    gen_random_uuid(), demo.id, demo.id::text, identity_payload, 'email',
                    now(), now(), now()
                )
                ON CONFLICT DO NOTHING;
            ELSE
                INSERT INTO auth.identities (
                    id, user_id, provider_id, identity_data, provider,
                    last_sign_in_at, created_at, updated_at
                )
                VALUES (
                    demo.id::text, demo.id, demo.id::text, identity_payload, 'email',
                    now(), now(), now()
                )
                ON CONFLICT DO NOTHING;
            END IF;
        ELSE
            IF identities_id_type = 'uuid' THEN
                INSERT INTO auth.identities (
                    id, user_id, identity_data, provider,
                    last_sign_in_at, created_at, updated_at
                )
                VALUES (
                    gen_random_uuid(), demo.id, identity_payload, 'email',
                    now(), now(), now()
                )
                ON CONFLICT DO NOTHING;
            ELSE
                INSERT INTO auth.identities (
                    id, user_id, identity_data, provider,
                    last_sign_in_at, created_at, updated_at
                )
                VALUES (
                    demo.id::text, demo.id, identity_payload, 'email',
                    now(), now(), now()
                )
                ON CONFLICT DO NOTHING;
            END IF;
        END IF;
    END LOOP;
END $$;

INSERT INTO public.organizations (
    id,
    owner_user_id,
    organization_name,
    provider_type,
    registration_status,
    team_size,
    participant_volume,
    contact_number
) VALUES (
    '20000000-0000-4000-8000-000000000001'::uuid,
    '10000000-0000-4000-8000-000000000101'::uuid,
    'Sunshine Supports Demo',
    'support_coord',
    'registered_ndis',
    '2-10',
    '1-25',
    '02 5550 2026'
)
ON CONFLICT (id) DO UPDATE
SET
    owner_user_id = EXCLUDED.owner_user_id,
    organization_name = EXCLUDED.organization_name,
    provider_type = EXCLUDED.provider_type,
    registration_status = EXCLUDED.registration_status,
    team_size = EXCLUDED.team_size,
    participant_volume = EXCLUDED.participant_volume,
    contact_number = EXCLUDED.contact_number;

WITH demo_profiles(id, email, full_name, role_name, account_type) AS (
    VALUES
        ('10000000-0000-4000-8000-000000000101'::uuid, 'sarah@sunshine-demo.com',  'Sarah Mitchell', 'support_coordinator', 'small_provider'),
        ('10000000-0000-4000-8000-000000000102'::uuid, 'amara@sunshine-demo.com',  'Amara Okafor',   'support_worker',      'independent_worker'),
        ('10000000-0000-4000-8000-000000000103'::uuid, 'daniel@sunshine-demo.com', 'Daniel Hart',   'allied_health',       'allied_health')
)
INSERT INTO public.users (
    id,
    email,
    full_name,
    role,
    account_type,
    onboarding_complete,
    organization_id,
    is_active
)
SELECT
    id,
    email,
    full_name,
    role_name,
    account_type,
    true,
    '20000000-0000-4000-8000-000000000001'::uuid,
    true
FROM demo_profiles
ON CONFLICT (id) DO UPDATE
SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    account_type = EXCLUDED.account_type,
    onboarding_complete = true,
    organization_id = EXCLUDED.organization_id,
    is_active = true;

WITH memberships(user_id, role_name) AS (
    VALUES
        ('10000000-0000-4000-8000-000000000101'::uuid, 'support_coordinator'),
        ('10000000-0000-4000-8000-000000000102'::uuid, 'support_worker'),
        ('10000000-0000-4000-8000-000000000103'::uuid, 'allied_health')
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
    '20000000-0000-4000-8000-000000000001'::uuid,
    role_name,
    true,
    '10000000-0000-4000-8000-000000000101'::uuid
FROM memberships
ON CONFLICT (user_id, organization_id) DO UPDATE
SET
    role = EXCLUDED.role,
    is_active = true,
    invited_by = EXCLUDED.invited_by;

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
        '30000000-0000-4000-8000-000000000001'::uuid,
        '20000000-0000-4000-8000-000000000001'::uuid,
        'Mia Roberts',
        'NDIS-SUN-001',
        '2012-04-18',
        'mia.roberts@example.com',
        '0400 111 222',
        'active',
        '2026-01-01',
        '2026-12-31',
        42000.00,
        8600.00,
        'Autism Spectrum Disorder',
        '[{"id":"goal_mia_1","title":"Build morning routine independence","status":"active"},{"id":"goal_mia_2","title":"Increase community participation","status":"active"}]'::jsonb,
        '10000000-0000-4000-8000-000000000102'::uuid,
        null,
        '10000000-0000-4000-8000-000000000101'::uuid,
        '10000000-0000-4000-8000-000000000101'::uuid
    ),
    (
        '30000000-0000-4000-8000-000000000002'::uuid,
        '20000000-0000-4000-8000-000000000001'::uuid,
        'Noah Singh',
        'NDIS-SUN-002',
        '2010-09-05',
        'noah.singh@example.com',
        '0400 333 444',
        'active',
        '2026-02-01',
        '2027-01-31',
        56000.00,
        12150.00,
        'Cerebral Palsy',
        '[{"id":"goal_noah_1","title":"Improve upper limb function","status":"active"},{"id":"goal_noah_2","title":"Increase safe mobility at school","status":"active"}]'::jsonb,
        null,
        '10000000-0000-4000-8000-000000000103'::uuid,
        '10000000-0000-4000-8000-000000000101'::uuid,
        '10000000-0000-4000-8000-000000000101'::uuid
    ),
    (
        '30000000-0000-4000-8000-000000000003'::uuid,
        '20000000-0000-4000-8000-000000000001'::uuid,
        'Grace Nguyen',
        'NDIS-SUN-003',
        '1988-11-23',
        'grace.nguyen@example.com',
        '0400 555 666',
        'review',
        '2025-07-01',
        '2026-06-30',
        38000.00,
        31400.00,
        'Acquired Brain Injury',
        '[{"id":"goal_grace_1","title":"Maintain household routines","status":"active"},{"id":"goal_grace_2","title":"Improve memory strategies","status":"active"}]'::jsonb,
        null,
        null,
        '10000000-0000-4000-8000-000000000101'::uuid,
        '10000000-0000-4000-8000-000000000101'::uuid
    )
ON CONFLICT (id) DO UPDATE
SET
    organization_id = EXCLUDED.organization_id,
    full_name = EXCLUDED.full_name,
    ndis_number = EXCLUDED.ndis_number,
    date_of_birth = EXCLUDED.date_of_birth,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    plan_status = EXCLUDED.plan_status,
    plan_start_date = EXCLUDED.plan_start_date,
    plan_end_date = EXCLUDED.plan_end_date,
    total_budget = EXCLUDED.total_budget,
    used_budget = EXCLUDED.used_budget,
    primary_disability = EXCLUDED.primary_disability,
    goals = EXCLUDED.goals,
    assigned_worker_id = EXCLUDED.assigned_worker_id,
    allied_health_id = EXCLUDED.allied_health_id,
    created_by = EXCLUDED.created_by,
    owner_user_id = EXCLUDED.owner_user_id;

INSERT INTO public.practitioner_allocations (
    patient_id,
    user_id,
    allocated_role,
    organization_id,
    assigned_by,
    is_active
) VALUES
    (
        '30000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000102'::uuid,
        'support_worker',
        '20000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000101'::uuid,
        true
    ),
    (
        '30000000-0000-4000-8000-000000000002'::uuid,
        '10000000-0000-4000-8000-000000000103'::uuid,
        'allied_health',
        '20000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000101'::uuid,
        true
    )
ON CONFLICT (patient_id, user_id) DO UPDATE
SET
    allocated_role = EXCLUDED.allocated_role,
    organization_id = EXCLUDED.organization_id,
    assigned_by = EXCLUDED.assigned_by,
    is_active = true;

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
        '40000000-0000-4000-8000-000000000001'::uuid,
        '30000000-0000-4000-8000-000000000001'::uuid,
        '20000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000102'::uuid,
        null,
        now() - interval '2 days',
        'community_access',
        90,
        'Mia practised ordering lunch and using visual supports. She independently requested help twice and completed the outing safely.',
        'Mia practised ordering lunch and using visual supports. She independently requested help twice and completed the outing safely.',
        'Mia practised ordering lunch and using visual supports. She independently requested help twice and completed the outing safely.',
        'Mia practised ordering lunch and using visual supports. She independently requested help twice and completed the outing safely.',
        'en',
        'not_required',
        'none',
        1.0000,
        '{"source":"demo_seed"}'::jsonb,
        now(),
        'completed',
        92,
        '["goal_mia_2"]'::jsonb,
        '10000000-0000-4000-8000-000000000102'::uuid,
        '10000000-0000-4000-8000-000000000102'::uuid
    ),
    (
        '40000000-0000-4000-8000-000000000002'::uuid,
        '30000000-0000-4000-8000-000000000002'::uuid,
        '20000000-0000-4000-8000-000000000001'::uuid,
        null,
        '10000000-0000-4000-8000-000000000103'::uuid,
        now() - interval '1 day',
        'occupational_therapy',
        60,
        'Noah completed upper limb range-of-motion activities and trialled adaptive pencil grips. He tolerated the session well and demonstrated improved grasp control.',
        'Noah completed upper limb range-of-motion activities and trialled adaptive pencil grips. He tolerated the session well and demonstrated improved grasp control.',
        'Noah completed upper limb range-of-motion activities and trialled adaptive pencil grips. He tolerated the session well and demonstrated improved grasp control.',
        'Noah completed upper limb range-of-motion activities and trialled adaptive pencil grips. He tolerated the session well and demonstrated improved grasp control.',
        'en',
        'not_required',
        'none',
        1.0000,
        '{"source":"demo_seed"}'::jsonb,
        now(),
        'completed',
        88,
        '["goal_noah_1"]'::jsonb,
        '10000000-0000-4000-8000-000000000103'::uuid,
        '10000000-0000-4000-8000-000000000103'::uuid
    )
ON CONFLICT (id) DO UPDATE
SET
    patient_id = EXCLUDED.patient_id,
    organization_id = EXCLUDED.organization_id,
    worker_id = EXCLUDED.worker_id,
    practitioner_id = EXCLUDED.practitioner_id,
    session_date = EXCLUDED.session_date,
    session_type = EXCLUDED.session_type,
    duration_minutes = EXCLUDED.duration_minutes,
    notes = EXCLUDED.notes,
    translated_english_note = EXCLUDED.translated_english_note,
    compliance_input_text = EXCLUDED.compliance_input_text,
    original_language_input = EXCLUDED.original_language_input,
    detected_language = EXCLUDED.detected_language,
    translation_status = EXCLUDED.translation_status,
    translation_provider = EXCLUDED.translation_provider,
    translation_confidence = EXCLUDED.translation_confidence,
    translation_metadata = EXCLUDED.translation_metadata,
    translation_completed_at = EXCLUDED.translation_completed_at,
    status = EXCLUDED.status,
    compliance_score = EXCLUDED.compliance_score,
    goals_addressed = EXCLUDED.goals_addressed,
    created_by = EXCLUDED.created_by,
    owner_user_id = EXCLUDED.owner_user_id;

COMMIT;
