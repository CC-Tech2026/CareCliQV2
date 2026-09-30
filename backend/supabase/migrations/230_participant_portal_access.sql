-- Participants Portal access: who may log in to see which participant.
--
-- Replaces the single users.participant_id link from
-- 228_users_role_participant.sql as the portal's access source. One row =
-- one person's access to one participant, so a participant can have several
-- logins (themselves, a nominee, a parent) and one login can cover several
-- participants (a parent of two children). participant_portal.py checks for
-- an active row here on every request; users.participant_id is left in place
-- but no longer read.
--
-- Each row carries its own single-use invite: the raw token is only ever
-- emailed, never stored (invite_token_hash is its SHA-256), and accepting
-- requires first passing an identity check against something already on
-- file (the participant's date of birth or NDIS number, or a one-off code
-- the MD gives the invitee directly).
--
-- Rows are never deleted — revocation keeps the row (revoked_at/by/reason)
-- so "who could see this participant on date X, and why" stays answerable
-- for the 7-year NDIS record-retention period.

BEGIN;

CREATE TABLE IF NOT EXISTS public.participant_portal_access (
    id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id           UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    participant_id            UUID        NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
    -- NULL until the invite is accepted (or set at grant time when the email
    -- already belongs to a participant login in this org).
    user_id                   UUID        REFERENCES public.users(id) ON DELETE SET NULL,

    email                     TEXT        NOT NULL,
    full_name                 TEXT        NOT NULL,
    relationship              TEXT        NOT NULL
                              CHECK (relationship IN (
                                  'self', 'plan_nominee', 'correspondence_nominee', 'guardian',
                                  'power_of_attorney', 'registered_supporter', 'parent', 'consented_family'
                              )),
    authority_notes           TEXT,
    consent_method            TEXT        CHECK (consent_method IN ('written', 'verbal')),

    status                    TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'active', 'revoked')),

    invite_token_hash         TEXT        UNIQUE,
    invite_expires_at         TIMESTAMPTZ,
    invite_sent_at            TIMESTAMPTZ,
    identity_method           TEXT        CHECK (identity_method IN ('participant_dob', 'ndis_number', 'code')),
    identity_code_hash        TEXT,
    identity_failed_attempts  INTEGER     NOT NULL DEFAULT 0,
    identity_locked_at        TIMESTAMPTZ,
    identity_verified_at      TIMESTAMPTZ,

    granted_by                UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    granted_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at               TIMESTAMPTZ,
    revoked_by                UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    revoked_at                TIMESTAMPTZ,
    revoked_reason            TEXT,

    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one live (pending or active) grant per person per participant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_participant_portal_access_live
    ON public.participant_portal_access (participant_id, lower(email))
    WHERE status <> 'revoked';

CREATE INDEX IF NOT EXISTS idx_participant_portal_access_user_active
    ON public.participant_portal_access (user_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_participant_portal_access_org_participant
    ON public.participant_portal_access (organization_id, participant_id);

-- "Not using portal" is a recorded decision, not just an absence of logins —
-- an auditor must be able to tell a deliberate choice from an oversight.
-- Pending/active portal status is derived from the rows above, so only the
-- opt-out itself is stored here.
ALTER TABLE public.participants
    ADD COLUMN IF NOT EXISTS portal_not_using_reason      TEXT,
    ADD COLUMN IF NOT EXISTS portal_not_using_note        TEXT,
    ADD COLUMN IF NOT EXISTS portal_review_date           DATE,
    ADD COLUMN IF NOT EXISTS portal_not_using_recorded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS portal_not_using_recorded_at TIMESTAMPTZ;

ALTER TABLE public.participants
    DROP CONSTRAINT IF EXISTS participants_portal_not_using_reason_check;
ALTER TABLE public.participants
    ADD CONSTRAINT participants_portal_not_using_reason_check
    CHECK (portal_not_using_reason IS NULL OR portal_not_using_reason IN (
        'declined', 'unable_no_representative', 'no_email_or_device', 'other'
    ));

ALTER TABLE public.participant_portal_access ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'participant_portal_access'
        AND policyname = 'participant_portal_access_service_role'
    ) THEN
        CREATE POLICY participant_portal_access_service_role
        ON public.participant_portal_access
        FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

COMMIT;
