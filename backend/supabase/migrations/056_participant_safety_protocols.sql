-- Participant safety protocols for worker shift view (mandatory read, scenarios, escalation)

BEGIN;

CREATE TABLE IF NOT EXISTS public.participant_safety_protocols (
    participant_id UUID PRIMARY KEY REFERENCES public.patients(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL,
    safety_card_body TEXT NOT NULL DEFAULT '',
    scenarios JSONB NOT NULL DEFAULT '[]'::jsonb,
    deescalation_techniques JSONB NOT NULL DEFAULT '[]'::jsonb,
    physical_safety_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
    escalation_contacts JSONB NOT NULL DEFAULT '[]'::jsonb,
    content_version INTEGER NOT NULL DEFAULT 1 CHECK (content_version >= 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_participant_safety_protocols_org
    ON public.participant_safety_protocols (organization_id);

COMMENT ON TABLE public.participant_safety_protocols IS
    'Coordinator-authored safety card, scenarios, de-escalation, and escalation contacts per participant.';

CREATE TABLE IF NOT EXISTS public.worker_safety_acknowledgements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL,
    content_version INTEGER NOT NULL CHECK (content_version >= 1),
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT worker_safety_ack_unique UNIQUE (worker_id, participant_id, content_version)
);

CREATE INDEX IF NOT EXISTS idx_worker_safety_ack_worker_participant
    ON public.worker_safety_acknowledgements (worker_id, participant_id, content_version DESC);

COMMENT ON TABLE public.worker_safety_acknowledgements IS
    'Timestamped worker acknowledgement of participant safety card at a specific content version.';

ALTER TABLE public.participant_safety_protocols ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_safety_acknowledgements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'participant_safety_protocols'
          AND policyname = 'participant_safety_protocols_service_all'
    ) THEN
        CREATE POLICY participant_safety_protocols_service_all
            ON public.participant_safety_protocols
            FOR ALL TO service_role
            USING (true) WITH CHECK (true);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'worker_safety_acknowledgements'
          AND policyname = 'worker_safety_acknowledgements_service_all'
    ) THEN
        CREATE POLICY worker_safety_acknowledgements_service_all
            ON public.worker_safety_acknowledgements
            FOR ALL TO service_role
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
