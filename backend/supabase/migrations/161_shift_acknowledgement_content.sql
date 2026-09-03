-- 161_shift_acknowledgement_content.sql
-- Standing, org-wide per-shift acknowledgement content - shown and required
-- at every clock-in alongside (not instead of) the existing per-participant
-- safety card (migrations 056, 157), so the acknowledgement is never empty
-- just because a participant has no special safety notes on file. Separate
-- from the one-time `code_of_conduct` credential verified at onboarding -
-- this is a per-shift re-affirmation, not a replacement for it.
--
-- Seeded per-org with a starting draft grounded in the NDIS Code of
-- Conduct's actual obligations under s.73V of the NDIS Act 2013 (respect &
-- dignity of risk, privacy, safe & competent practice, integrity, raising
-- concerns, preventing violence/abuse/neglect/exploitation, preventing
-- sexual misconduct) plus the unsupervised-contact rule - a draft for the
-- organisation's own review/compliance sign-off, not final legal text.

BEGIN;

CREATE TABLE IF NOT EXISTS public.organization_acknowledgement_content (
    organization_id UUID PRIMARY KEY,
    body TEXT NOT NULL DEFAULT '',
    content_version INTEGER NOT NULL DEFAULT 1 CHECK (content_version >= 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.organization_acknowledgement_content IS
    'Org-wide standing worker acknowledgement shown at every clock-in, alongside the per-participant safety card. Draft content, reviewed/edited by the organisation.';

ALTER TABLE public.organization_acknowledgement_content ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'organization_acknowledgement_content'
          AND policyname = 'organization_acknowledgement_content_service_all'
    ) THEN
        CREATE POLICY organization_acknowledgement_content_service_all
            ON public.organization_acknowledgement_content
            FOR ALL TO service_role
            USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Deliberately NOT seeded per-org here: this repo's `organizations` table
-- has a confirmed live/schema-file mismatch on its primary key column name
-- (worker_financial_details' own FK, migration 123, targets
-- organizations(organization_id), not organizations(id) as migration 001
-- declares) - a bulk INSERT ... SELECT keyed off the wrong column name
-- would fail unpredictably depending on environment. Instead,
-- get_org_acknowledgement_content() in safety_protocol_service.py returns
-- the same starting-draft text in-memory whenever no row exists yet for an
-- org, materializing a real row only the first time someone reads or edits
-- it - identical lazy-default pattern already used by get_protocol() /
-- _empty_protocol() for participant safety cards.

-- Per-shift acknowledgement now records which version of BOTH the
-- participant-specific and org-wide standing content the worker actually
-- saw, so a later edit to either never retroactively changes what a past
-- acknowledgement attested to.
ALTER TABLE public.worker_safety_acknowledgements
    ADD COLUMN IF NOT EXISTS org_content_version INTEGER;

COMMIT;
