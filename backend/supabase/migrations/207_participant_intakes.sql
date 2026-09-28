-- Participant Onboarding pipeline (MD-only): Enquiry -> Screening ->
-- Meet & Greet -> Service Agreement -> Active/Inactive. Mirrors the
-- Applicants Board (128_applicants_board.sql) — a single board/detail
-- record per pipeline card, with the "active" transition creating a real
-- row in the existing `patients` table (see participant_intake_service.py)
-- rather than duplicating participant fields here.
--
-- Date of birth lives inside web_intake (jsonb), same as the frontend's own
-- Intake type — it's never been a top-level field there, including on the
-- profile-edit form that updates it post-activation. Requiring it (and the
-- Aged Care 65+ eligibility check) is enforced in participant_intake_service
-- rather than as a DB column, so there's one source of truth for it.

BEGIN;

CREATE TABLE IF NOT EXISTS public.participant_intakes (
    id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id           UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,

    full_name                 TEXT        NOT NULL,
    service_category          TEXT        CHECK (service_category IN ('aged_care', 'disability')),
    service_hours_required    NUMERIC(6, 2),
    ndis_number               TEXT        NOT NULL DEFAULT '',
    email                     TEXT        NOT NULL DEFAULT '',
    phone                     TEXT        NOT NULL DEFAULT '',
    source                    TEXT        NOT NULL DEFAULT 'coordinator_referral'
                              CHECK (source IN ('online_form', 'email', 'phone_call', 'coordinator_referral')),

    status                    TEXT        NOT NULL DEFAULT 'enquiry'
                              CHECK (status IN (
                                  'enquiry', 'screening', 'declined', 'withdrawn', 'meet_greet',
                                  'awaiting_signatures', 'signed', 'active', 'inactive'
                              )),
    decline_reason            TEXT,
    withdrawn_reason          TEXT,
    board_subtitle            TEXT,

    screening_checks          JSONB       NOT NULL DEFAULT '{}'::jsonb,

    meet_greet_recording_url  TEXT,
    meet_greet_notes          TEXT,

    signed_document_path      TEXT,
    signed_document_url       TEXT,
    signed_document_name      TEXT,
    plan_start_date           DATE,
    plan_end_date             DATE,
    total_budget              TEXT,
    provider_signed_name      TEXT,
    provider_signed_at        TIMESTAMPTZ,
    family_signed_name        TEXT,
    family_signed_at          TIMESTAMPTZ,

    activated_at              TIMESTAMPTZ,
    suspended_reason          TEXT,
    suspended_at              TIMESTAMPTZ,
    reactivated_at            TIMESTAMPTZ,

    -- Catch-all for the rest of the public referral form's fields
    -- (preferred name, pronouns, address, plan manager, next of kin,
    -- presenting needs, etc.) — not queried against, display-only.
    web_intake                JSONB,

    participant_id            UUID        REFERENCES public.patients(id) ON DELETE SET NULL,
    created_by                UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_participant_intakes_org_status
    ON public.participant_intakes (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_participant_intakes_participant
    ON public.participant_intakes (participant_id)
    WHERE participant_id IS NOT NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'participant-intake-files',
    'participant-intake-files',
    false,
    20971520,
    ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.participant_intakes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'participant_intakes'
        AND policyname = 'participant_intakes_service_role'
    ) THEN
        CREATE POLICY participant_intakes_service_role
        ON public.participant_intakes
        FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

COMMIT;
