-- CARECLIQV2-269 / 270 / 271 — Privacy, shift signatures, evidence compliance
--
-- Self-contained: creates evidence tables from 049 if missing, then adds 058 extensions.
-- Safe to run on fresh DB or after 049 was already applied.
BEGIN;

-- Organisation data retention policy (admin-configurable)
CREATE TABLE IF NOT EXISTS public.organization_data_policies (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    evidence_retention_days INTEGER NOT NULL DEFAULT 2555 CHECK (evidence_retention_days >= 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.organization_data_policies IS
    'Per-organisation retention settings for evidence and worker data (CARECLIQV2-271).';

-- ── 049 bootstrap: evidence chain-of-custody (skip if already exists) ─────────
CREATE TABLE IF NOT EXISTS public.task_evidence_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evidence_id TEXT NOT NULL UNIQUE,
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    uploaded_by UUID NOT NULL REFERENCES public.users(id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    file_hash TEXT NOT NULL,
    file_hash_algorithm TEXT DEFAULT 'sha256',
    file_size_bytes BIGINT NOT NULL,
    mime_type TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    storage_provider TEXT NOT NULL,
    file_url TEXT,
    ip_address INET,
    user_agent TEXT,
    evidence_type TEXT NOT NULL CHECK (evidence_type IN ('photo', 'voice', 'text', 'document')),
    task_id TEXT,
    goal_id UUID,
    duration_seconds INT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    integrity_verified_at TIMESTAMPTZ,
    is_finalized BOOLEAN DEFAULT true,
    -- 058 columns (included for fresh installs)
    device_type TEXT,
    retention_until DATE,
    shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    deletion_reason TEXT,
    quarantined_at TIMESTAMPTZ,
    quarantine_reason TEXT
);

CREATE TABLE IF NOT EXISTS public.evidence_access_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evidence_id TEXT NOT NULL,
    session_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    accessed_by UUID NOT NULL REFERENCES public.users(id),
    action TEXT NOT NULL CHECK (action IN (
        'upload', 'view', 'download', 'hash_verified', 'hash_failed',
        'exported', 'compliance_review_used', 'permission_denied', 'quarantined'
    )),
    ip_address INET,
    user_agent TEXT,
    file_hash_match BOOLEAN,
    file_hash_stored TEXT,
    file_hash_computed TEXT,
    purpose TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    -- 058 columns
    shift_id UUID,
    notes TEXT
);

-- 058 extensions when 049 was applied earlier (columns not in original CREATE)
ALTER TABLE public.task_evidence_metadata
    ADD COLUMN IF NOT EXISTS device_type TEXT,
    ADD COLUMN IF NOT EXISTS retention_until DATE,
    ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS deletion_reason TEXT,
    ADD COLUMN IF NOT EXISTS quarantined_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS quarantine_reason TEXT;

ALTER TABLE public.evidence_access_audit_log
    ADD COLUMN IF NOT EXISTS shift_id UUID,
    ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_task_evidence_metadata_session_id
    ON public.task_evidence_metadata(session_id);
CREATE INDEX IF NOT EXISTS idx_task_evidence_metadata_organization_id
    ON public.task_evidence_metadata(organization_id);
CREATE INDEX IF NOT EXISTS idx_task_evidence_metadata_uploaded_by
    ON public.task_evidence_metadata(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_task_evidence_metadata_evidence_id
    ON public.task_evidence_metadata(evidence_id);
CREATE INDEX IF NOT EXISTS idx_task_evidence_metadata_shift_id
    ON public.task_evidence_metadata(shift_id)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_evidence_access_audit_log_evidence_id
    ON public.evidence_access_audit_log(evidence_id);
CREATE INDEX IF NOT EXISTS idx_evidence_access_audit_log_session_id
    ON public.evidence_access_audit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_evidence_access_audit_log_shift_id
    ON public.evidence_access_audit_log(shift_id, created_at DESC);

ALTER TABLE public.task_evidence_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_access_audit_log ENABLE ROW LEVEL SECURITY;

-- Append-only deletion log (survives metadata soft-delete)
CREATE TABLE IF NOT EXISTS public.evidence_deletion_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evidence_id TEXT NOT NULL,
    session_id UUID NOT NULL,
    shift_id UUID,
    organization_id UUID NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    deleted_by UUID NOT NULL REFERENCES public.users(id),
    deletion_reason TEXT NOT NULL,
    file_hash TEXT,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_deletion_log_evidence
    ON public.evidence_deletion_log(evidence_id, deleted_at DESC);

ALTER TABLE public.evidence_deletion_log ENABLE ROW LEVEL SECURITY;

-- Immutable per-shift worker signature (CARECLIQV2-270)
CREATE TABLE IF NOT EXISTS public.shift_signatures (
    shift_id UUID PRIMARY KEY REFERENCES public.shifts(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.users(id),
    organization_id UUID NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    confirm_tasks_accurate BOOLEAN NOT NULL,
    confirm_safety_followed BOOLEAN NOT NULL,
    confirm_no_unreported_incidents BOOLEAN NOT NULL,
    signature_svg TEXT NOT NULL,
    signature_png_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    device_id TEXT,
    ip_address INET,
    user_agent TEXT,
    signed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_signatures_worker
    ON public.shift_signatures(worker_id, signed_at DESC);

ALTER TABLE public.shift_signatures ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'shift_signatures' AND policyname = 'prevent_updates'
    ) THEN
        CREATE POLICY prevent_updates ON public.shift_signatures FOR UPDATE USING (false);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'shift_signatures' AND policyname = 'prevent_deletes'
    ) THEN
        CREATE POLICY prevent_deletes ON public.shift_signatures FOR DELETE USING (false);
    END IF;
END $$;

-- Worker privacy preferences (CARECLIQV2-269)
CREATE TABLE IF NOT EXISTS public.worker_privacy_preferences (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    analytics_opt_out BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.data_export_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(organization_id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'ready', 'expired', 'failed')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    download_token_hash TEXT,
    expires_at TIMESTAMPTZ,
    file_path TEXT,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_data_export_requests_user
    ON public.data_export_requests(user_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(organization_id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
    confirmation_text TEXT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    coordinator_notified_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_user
    ON public.account_deletion_requests(user_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS public.privacy_policy_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version TEXT NOT NULL UNIQUE,
    summary_text TEXT NOT NULL,
    full_pdf_path TEXT,
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_current BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_privacy_policy_current
    ON public.privacy_policy_versions(is_current)
    WHERE is_current = true;

INSERT INTO public.privacy_policy_versions (version, summary_text, is_current)
SELECT '1.0',
    'CareCliQ collects your account details, shift records, GPS check-in data, messages, incident reports, and evidence uploads to deliver NDIS support services. We store this data securely in Australia and retain it according to your organisation''s policy and legal requirements. You can request a copy of your data or ask us to delete your account at any time.',
    true
WHERE NOT EXISTS (SELECT 1 FROM public.privacy_policy_versions WHERE is_current = true);

ALTER TABLE public.worker_privacy_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_export_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_data_policies ENABLE ROW LEVEL SECURITY;

COMMIT;
