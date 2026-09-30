-- Audit Readiness, stage 1 (foundation).
--
-- The requirement catalogue itself lives in code
-- (backend/app/services/audit_readiness_service.py), the same way the
-- compliance rule catalogue does: it's reference data that ships with
-- releases. What an organisation owns is stored here:
--
--   organization_audit_profiles   audit type, registration groups and the
--                                 services it delivers. Drives which
--                                 requirements apply.
--   audit_requirement_settings    per-org switch-off and review interval for
--                                 a catalogue requirement (e.g. the org's own
--                                 police check recheck period — deliberately
--                                 not a hard-coded rule).
--   audit_evidence_links          points a requirement (for the organisation,
--                                 a worker or a participant) at a record that
--                                 already exists elsewhere in CareCliQ —
--                                 nothing is uploaded twice — plus its review
--                                 by an authorised person.
--   audit_na_decisions            "Not applicable", with the recorded reason
--                                 and who approved it.
--
-- Links and N/A decisions are never deleted: removal/revocation is stamped so
-- the history stays reviewable. The backend uses the service role, so RLS
-- here only admits that role (same approach as 127_induction_items).

BEGIN;

CREATE TABLE IF NOT EXISTS public.organization_audit_profiles (
    organization_id     UUID        PRIMARY KEY REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    audit_type          TEXT        CHECK (audit_type IN ('verification', 'certification')),
    registration_groups TEXT[]      NOT NULL DEFAULT '{}',
    service_flags       TEXT[]      NOT NULL DEFAULT '{}',
    updated_by          UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_requirement_settings (
    organization_id      UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    requirement_code     TEXT        NOT NULL,
    is_enabled           BOOLEAN     NOT NULL DEFAULT true,
    review_interval_days INTEGER     CHECK (review_interval_days BETWEEN 1 AND 3650),
    updated_by           UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, requirement_code)
);

CREATE TABLE IF NOT EXISTS public.audit_evidence_links (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    requirement_code TEXT        NOT NULL,
    subject_type     TEXT        NOT NULL CHECK (subject_type IN ('organisation', 'worker', 'participant')),
    subject_id       UUID,
    source_table     TEXT        NOT NULL,
    source_id        TEXT        NOT NULL,
    vault_category   TEXT,
    source_title     TEXT,
    review_status    TEXT        NOT NULL DEFAULT 'awaiting_review'
                                 CHECK (review_status IN ('awaiting_review', 'approved', 'rejected')),
    review_note      TEXT,
    reviewed_by      UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_at      TIMESTAMPTZ,
    expiry_date      DATE,
    linked_by        UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    linked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    removed_by       UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    removed_at       TIMESTAMPTZ,
    CONSTRAINT audit_evidence_links_subject CHECK (
        (subject_type = 'organisation') = (subject_id IS NULL)
    )
);

-- One live link per requirement + subject + source record.
CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_evidence_links_live
    ON public.audit_evidence_links (
        organization_id, requirement_code, subject_type,
        COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid),
        source_table, source_id
    )
    WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_audit_evidence_links_org
    ON public.audit_evidence_links (organization_id)
    WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.audit_na_decisions (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    requirement_code TEXT        NOT NULL,
    subject_type     TEXT        NOT NULL CHECK (subject_type IN ('organisation', 'worker', 'participant')),
    subject_id       UUID,
    reason           TEXT        NOT NULL CHECK (length(btrim(reason)) >= 10),
    approved_by      UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    approved_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_by       UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    revoked_at       TIMESTAMPTZ,
    revoke_reason    TEXT,
    CONSTRAINT audit_na_decisions_subject CHECK (
        (subject_type = 'organisation') = (subject_id IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_na_decisions_live
    ON public.audit_na_decisions (
        organization_id, requirement_code, subject_type,
        COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
    WHERE revoked_at IS NULL;

ALTER TABLE public.organization_audit_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_requirement_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_na_decisions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'organization_audit_profiles',
        'audit_requirement_settings',
        'audit_evidence_links',
        'audit_na_decisions'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_service_role'
        ) THEN
            EXECUTE format(
                'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
                t || '_service_role', t
            );
        END IF;
    END LOOP;
END $$;

COMMIT;
