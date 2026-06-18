-- CARECLIQV2-195 / 196 / 295: structured participant context for worker shift view

ALTER TABLE public.patients
    ADD COLUMN IF NOT EXISTS preferred_name TEXT,
    ADD COLUMN IF NOT EXISTS case_manager_name TEXT,
    ADD COLUMN IF NOT EXISTS case_manager_phone TEXT,
    ADD COLUMN IF NOT EXISTS emergency_contact JSONB,
    ADD COLUMN IF NOT EXISTS likes_dislikes TEXT,
    ADD COLUMN IF NOT EXISTS sensory_preferences TEXT,
    ADD COLUMN IF NOT EXISTS cultural_preferences TEXT,
    ADD COLUMN IF NOT EXISTS preferred_activities JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS communication_guidance TEXT,
    ADD COLUMN IF NOT EXISTS previous_visit_notes TEXT,
    ADD COLUMN IF NOT EXISTS previous_visit_notes_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS current_conditions TEXT,
    ADD COLUMN IF NOT EXISTS behavioural_notes JSONB DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.participant_allergies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL,
    allergen TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'mild'
        CHECK (severity IN ('mild', 'moderate', 'severe', 'anaphylactic')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_participant_allergies_participant
    ON public.participant_allergies(participant_id);

ALTER TABLE public.participant_allergies ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'participant_allergies'
          AND policyname = 'participant_allergies_service_all'
    ) THEN
        CREATE POLICY participant_allergies_service_all
            ON public.participant_allergies
            FOR ALL TO service_role
            USING (true) WITH CHECK (true);
    END IF;
END $$;
