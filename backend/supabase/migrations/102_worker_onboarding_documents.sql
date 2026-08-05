-- Worker onboarding documents (offer letter, service agreement, other) — coordinator worker profile

BEGIN;

CREATE TABLE IF NOT EXISTS public.worker_onboarding_documents (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id        UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id  UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    document_type    TEXT        NOT NULL DEFAULT 'other'
                     CHECK (document_type IN ('offer_letter', 'service_agreement', 'other')),
    title            TEXT        NOT NULL,
    notes            TEXT,
    file_path        TEXT,
    file_url         TEXT,
    uploaded_by      UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_onboarding_documents_worker
    ON public.worker_onboarding_documents (worker_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_worker_onboarding_documents_org
    ON public.worker_onboarding_documents (organization_id);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'worker-onboarding-files',
    'worker-onboarding-files',
    false,
    20971520,
    ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.worker_onboarding_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'worker_onboarding_documents'
        AND policyname = 'worker_onboarding_documents_service_role'
    ) THEN
        CREATE POLICY worker_onboarding_documents_service_role
        ON public.worker_onboarding_documents
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

COMMIT;