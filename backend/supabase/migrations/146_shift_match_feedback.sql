-- Worker-Participant Matching Enhancement, Phase 3 (Feedback loop).
--
-- One row per shift, recording how a worker-participant pairing actually
-- went. This is what lets the Phase 2 "prior positive history" score
-- component (previously a fixed neutral placeholder) become real: once a
-- pair has feedback, worker_match_scoring_service can average outcome_rating
-- for that pair instead of assuming neutral.
--
-- coordinator side (participant_response, outcome_rating, would_repeat) and
-- worker side (worker_feedback) are recorded independently, per the Aug 2026
-- product decision that this prompt is worker-facing too, not
-- coordinator-only - hence two separate "recorded" timestamps rather than
-- one, since either side can arrive first.

CREATE TABLE IF NOT EXISTS public.shift_match_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    shift_id uuid NOT NULL UNIQUE REFERENCES public.shifts(id) ON DELETE CASCADE,
    participant_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    worker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    recorded_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    recorded_at timestamptz,
    participant_response text,
    outcome_rating smallint CHECK (outcome_rating BETWEEN 1 AND 5),
    would_repeat boolean,

    worker_feedback text,
    worker_feedback_recorded_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_match_feedback_pair ON public.shift_match_feedback(worker_id, participant_id);
CREATE INDEX IF NOT EXISTS idx_shift_match_feedback_org ON public.shift_match_feedback(organization_id);
