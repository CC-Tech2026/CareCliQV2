-- Participant complaints: complaints raised by, or on behalf of, a
-- participant (a family member, advocate or the participant themselves),
-- with how each was handled. NDIS Practice Standards expect a complaints
-- register; the managing director's Participant Complaints page records
-- them here, and the Documents & Audit Vault files each complaint and the
-- register under Feedback & Complaints Management.
--
-- Separate from operational_feedback (staff raising operational issues)
-- and from incidents (participant-safety events with their own immutable
-- workflow).
--
-- Service-role only: the API reads and writes it for coordinators and the
-- managing director. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.participant_complaints (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    -- Null when the complaint is about someone not (yet) a participant.
    participant_id    UUID        REFERENCES public.participants(id) ON DELETE SET NULL,
    participant_name  TEXT        NOT NULL CHECK (char_length(trim(participant_name)) >= 1),
    -- Who raised it, e.g. "Mother (Jane Rivera)" or "Participant".
    raised_by         TEXT,
    subject           TEXT        NOT NULL CHECK (char_length(trim(subject)) >= 1),
    description       TEXT        NOT NULL CHECK (char_length(trim(description)) >= 1),
    status            TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved')),
    resolution_notes  TEXT,
    responded_at      TIMESTAMPTZ,
    responded_by      UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    filed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A complaint can't be marked resolved without saying what was done.
    CONSTRAINT participant_complaints_resolution_notes
        CHECK (status <> 'resolved' OR char_length(trim(coalesce(resolution_notes, ''))) >= 1)
);

CREATE INDEX IF NOT EXISTS idx_participant_complaints_org
    ON public.participant_complaints (organization_id, filed_at DESC);

CREATE INDEX IF NOT EXISTS idx_participant_complaints_participant
    ON public.participant_complaints (participant_id)
    WHERE participant_id IS NOT NULL;

ALTER TABLE public.participant_complaints ENABLE ROW LEVEL SECURITY;

COMMIT;
