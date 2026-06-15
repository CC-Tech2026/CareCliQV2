-- CARECLIQV2-34 — Cross-session AI detected risk patterns (coordinator alerts)

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_detected_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    pattern_type TEXT NOT NULL
        CHECK (pattern_type IN (
            'low_compliance_pair',
            'incident_escalation',
            'refused_activity_no_deescalation'
        )),
    severity TEXT NOT NULL DEFAULT 'medium'
        CHECK (severity IN ('low', 'medium', 'high')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    worker_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    participant_id UUID REFERENCES public.patients(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    dismissed_at TIMESTAMPTZ,
    dismissed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_detected_patterns IS
    'Weekly cross-session risk patterns for coordinator review (CARECLIQV2-34).';

CREATE INDEX IF NOT EXISTS idx_ai_patterns_org_active
    ON public.ai_detected_patterns (organization_id, detected_at DESC)
    WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_patterns_org_type
    ON public.ai_detected_patterns (organization_id, pattern_type);

ALTER TABLE public.ai_detected_patterns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'ai_detected_patterns' AND policyname = 'ai_detected_patterns_org_select'
    ) THEN
        CREATE POLICY ai_detected_patterns_org_select ON public.ai_detected_patterns
        FOR SELECT TO authenticated
        USING (organization_id = public.cs_user_org_id());
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'ai_detected_patterns' AND policyname = 'ai_detected_patterns_service_role'
    ) THEN
        CREATE POLICY ai_detected_patterns_service_role ON public.ai_detected_patterns
        FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    END IF;
END $$;

COMMIT;
