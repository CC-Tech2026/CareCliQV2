-- =============================================================================
-- CARECLIQV2-97: Dashboard landing page demo seed (Action Items + Compliance Alerts)
-- -----------------------------------------------------------------------------
-- Curated data for amara@sunshine-demo.com:
--   • Critical  — Acknowledge participant risks (today's shift)
--   • Medium    — Incomplete session documentation (distinct clients / types)
--   • High      — Sessions needing compliance fixes
--   • Alerts    — Expiring + expired credentials
--
-- Prerequisites: 041_demo_data.sql, 047_my_shifts_component_seed.sql (recommended)
-- Safe to re-run: fixed UUIDs + upserts; closes other open sessions for Amara.
-- =============================================================================

BEGIN;

ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS assigned_worker_id UUID;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS support_worker_id UUID;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS owner_user_id UUID;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS primary_disability TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS plan_status TEXT;

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS worker_id UUID;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS support_worker_id UUID;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS owner_user_id UUID;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS compliance_input_text TEXT;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS translation_status TEXT;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS compliance_score INTEGER;

DO $$
DECLARE
    v_org_id uuid := '20000000-0000-4000-8000-000000000001';
    v_worker_id uuid := '10000000-0000-4000-8000-000000000102';
    v_coordinator_id uuid := '10000000-0000-4000-8000-000000000101';

    v_patient_isabella uuid := 'c0480000-0000-4000-8000-000000000011';
    v_patient_jacob uuid := 'c0480000-0000-4000-8000-000000000012';
    v_patient_mia uuid := '30000000-0000-4000-8000-000000000001';
    v_patient_grace uuid := '30000000-0000-4000-8000-000000000003';

    v_shift_risk_ack uuid := 'b2770001-0000-4000-8000-000000000001';

    v_sess_isabella uuid := 'c0480001-0000-4000-8000-000000000001';
    v_sess_jacob uuid := 'c0480002-0000-4000-8000-000000000002';
    v_sess_grace uuid := 'c0480003-0000-4000-8000-000000000003';
    v_sess_mia uuid := 'c0480004-0000-4000-8000-000000000004';
    v_sess_james_live uuid := 'a2770001-0000-4000-8000-000000000001';
BEGIN
    SELECT u.id INTO v_worker_id
    FROM public.users u
    WHERE lower(u.email) = 'amara@sunshine-demo.com'
    LIMIT 1;

    IF v_worker_id IS NULL THEN
        RAISE NOTICE '048 dashboard landing seed: amara@sunshine-demo.com not found — run 041_demo_data.sql first.';
        RETURN;
    END IF;

    SELECT u.organization_id INTO v_org_id FROM public.users u WHERE u.id = v_worker_id;

    SELECT u.id INTO v_coordinator_id
    FROM public.users u
    WHERE u.organization_id = v_org_id AND u.role = 'support_coordinator'
    ORDER BY CASE WHEN lower(u.email) = 'sarah@sunshine-demo.com' THEN 0 ELSE 1 END
    LIMIT 1;

    INSERT INTO public.patients (
        id, organization_id, full_name, ndis_number, date_of_birth, email, phone,
        plan_status, primary_disability, assigned_worker_id, support_worker_id,
        created_by, owner_user_id
    ) VALUES
        (
            v_patient_isabella, v_org_id, 'Isabella Martin', 'NDIS-SUN-011', '2008-03-14',
            'isabella.martin@example.com', '0400 201 011', 'active', 'Autism Spectrum Disorder',
            v_worker_id, v_worker_id, COALESCE(v_coordinator_id, v_worker_id), COALESCE(v_coordinator_id, v_worker_id)
        ),
        (
            v_patient_jacob, v_org_id, 'Jacob Anderson', 'NDIS-SUN-012', '2005-07-22',
            'jacob.anderson@example.com', '0400 201 012', 'review', 'Intellectual Disability',
            v_worker_id, v_worker_id, COALESCE(v_coordinator_id, v_worker_id), COALESCE(v_coordinator_id, v_worker_id)
        )
    ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        assigned_worker_id = EXCLUDED.assigned_worker_id,
        support_worker_id = EXCLUDED.support_worker_id,
        plan_status = EXCLUDED.plan_status,
        updated_at = now();

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'practitioner_allocations'
    ) THEN
        INSERT INTO public.practitioner_allocations (
            patient_id, user_id, allocated_role, organization_id, assigned_by, is_active
        ) VALUES
            (v_patient_isabella, v_worker_id, 'support_worker', v_org_id, COALESCE(v_coordinator_id, v_worker_id), true),
            (v_patient_jacob, v_worker_id, 'support_worker', v_org_id, COALESCE(v_coordinator_id, v_worker_id), true)
        ON CONFLICT (patient_id, user_id) DO UPDATE SET is_active = true;
    END IF;

    UPDATE public.sessions
    SET status = 'completed', updated_at = now()
    WHERE organization_id = v_org_id
      AND (worker_id = v_worker_id OR support_worker_id = v_worker_id)
      AND status NOT IN ('completed', 'cancelled')
      AND id NOT IN (v_sess_isabella, v_sess_jacob, v_sess_grace, v_sess_mia, v_sess_james_live);

    INSERT INTO public.sessions (
        id, patient_id, organization_id, worker_id, support_worker_id, owner_user_id,
        session_date, session_type, duration_minutes, status,
        notes, compliance_input_text, translation_status, compliance_score, created_by
    ) VALUES
        (
            v_sess_isabella, v_patient_isabella, v_org_id, v_worker_id, v_worker_id, v_worker_id,
            (current_date - interval '1 day')::timestamptz + time '14:30',
            'community_access', 90, 'draft', '', '', 'not_required', NULL, v_worker_id
        ),
        (
            v_sess_jacob, v_patient_jacob, v_org_id, v_worker_id, v_worker_id, v_worker_id,
            current_date::timestamptz + time '09:00',
            'personal_care', 120, 'in_progress',
            'Morning routine started.', 'Morning routine started.', 'not_required', NULL, v_worker_id
        ),
        (
            v_sess_grace, v_patient_grace, v_org_id, v_worker_id, v_worker_id, v_worker_id,
            (current_date - interval '2 days')::timestamptz + time '11:00',
            'skill_development', 60, 'draft', 'Short draft only.', 'Needs goals linked.', 'not_required', 68, v_worker_id
        ),
        (
            v_sess_mia, v_patient_mia, v_org_id, v_worker_id, v_worker_id, v_worker_id,
            (current_date - interval '3 days')::timestamptz + time '16:00',
            'domestic_assistance', 75, 'draft', 'Brief note.', 'Brief.', 'failed', 55, v_worker_id
        )
    ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        session_type = EXCLUDED.session_type,
        compliance_score = EXCLUDED.compliance_score,
        translation_status = EXCLUDED.translation_status,
        updated_at = now();

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'shifts'
    ) THEN
        ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS risks_acknowledged_at TIMESTAMPTZ;
        ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS risks_acknowledged_by UUID;
        ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS health_alerts TEXT;
        ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS allergies TEXT;
        ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS health_flags TEXT;
        ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ;
        ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMPTZ;

        UPDATE public.shifts
        SET
            risks_acknowledged_at = NULL,
            risks_acknowledged_by = NULL,
            health_alerts = E'⚠️ Peanut allergy — avoid nut products\n⛔ Falls risk — supervise all transfers',
            allergies = 'Peanuts, tree nuts — EpiPen in kitchen drawer',
            health_flags = 'Falls risk in bathroom',
            scheduled_start = date_trunc('day', now()) + interval '8 hours',
            scheduled_end = date_trunc('day', now()) + interval '10 hours',
            status = 'scheduled',
            updated_at = now()
        WHERE id = v_shift_risk_ack AND worker_id = v_worker_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'credentials'
    ) THEN
        INSERT INTO public.credentials (
            id, user_id, organization_id, credential_type, title, credential_number,
            issuer, issue_date, expiry_date, status, notes
        ) VALUES
            (
                'c048000c-0000-4000-8000-000000000001',
                v_worker_id, v_org_id, 'ndis_worker_screening', 'NDIS Worker Screening Check',
                'NWS-2024-88421', 'NDIS Quality and Safeguards Commission',
                (current_date - interval '2 years')::date,
                (current_date + interval '14 days')::date,
                'valid', 'Demo: expiring within 30 days.'
            ),
            (
                'c048000c-0000-4000-8000-000000000002',
                v_worker_id, v_org_id, 'first_aid', 'Provide First Aid (HLTAID011)',
                'FA-2019-55210', 'St John Ambulance',
                (current_date - interval '3 years')::date,
                (current_date - interval '12 days')::date,
                'expired', 'Demo: expired credential.'
            ),
            (
                'c048000c-0000-4000-8000-000000000003',
                v_worker_id, v_org_id, 'manual_handling', 'Manual Handling Training',
                'MH-2025-11002', 'Lanex Training',
                (current_date - interval '6 months')::date,
                (current_date + interval '18 months')::date,
                'pending_review', 'Demo: awaiting coordinator review.'
            )
        ON CONFLICT (id) DO UPDATE SET
            expiry_date = EXCLUDED.expiry_date,
            status = EXCLUDED.status,
            updated_at = now();
    END IF;

    RAISE NOTICE '048 dashboard landing seed ready for amara@sunshine-demo.com';
END $$;

COMMIT;
