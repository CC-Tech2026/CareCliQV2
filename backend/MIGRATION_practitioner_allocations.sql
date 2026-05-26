-- ============================================================
-- CRITICAL MIGRATION: Practitioner Allocations Table
-- Run this in Supabase SQL Editor if practitioner_allocations table doesn't exist
-- https://supabase.com/dashboard/project/_/sql/new
-- ============================================================

-- PRACTITIONER ALLOCATIONS — Links support workers and allied health to participants
CREATE TABLE IF NOT EXISTS public.practitioner_allocations (
    id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    patient_id          UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    user_id             UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    allocated_role      TEXT        NOT NULL DEFAULT 'support_worker'
                                    CHECK (allocated_role IN (
                                        'support_worker', 'allied_health',
                                        'primary_ot', 'supervisor'
                                    )),
    organization_id     UUID        REFERENCES public.organizations(id) ON DELETE SET NULL,
    assigned_by         UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    assigned_at         TIMESTAMPTZ DEFAULT NOW(),
    deactivated_at      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_allocation UNIQUE (patient_id, user_id)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_patient_id ON public.practitioner_allocations(patient_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_user_id ON public.practitioner_allocations(user_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_is_active ON public.practitioner_allocations(is_active);
CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_organization_id ON public.practitioner_allocations(organization_id);

-- Enable Row Level Security
ALTER TABLE public.practitioner_allocations ENABLE ROW LEVEL SECURITY;

-- Service role policy (backend can access all)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='practitioner_allocations' AND policyname='pa_service_role_all') THEN
        CREATE POLICY pa_service_role_all ON public.practitioner_allocations
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Verify the table was created
SELECT COUNT(*) as row_count FROM information_schema.tables 
WHERE table_name = 'practitioner_allocations' AND table_schema = 'public';
-- Expected output: 1
