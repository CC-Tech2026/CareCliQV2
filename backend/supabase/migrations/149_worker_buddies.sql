-- Support Worker Onboarding Journey, Phase 2: buddy pairing.
--
-- Pairs a new worker with an experienced, currently-active worker before
-- their first shift. Suggestion starts simple (most-recently-active + same
-- suburb, filtered to matching_opt_in and onboarding_completed - see
-- worker_buddy_service.suggest_buddies) rather than the tag-based scoring
-- service, per the design spec's own Build Order: it doesn't need to wait
-- for that engine, and buddy fit is worker-to-worker, not the
-- worker-to-participant shape that scoring service already computes.
--
-- status distinguishes a suggestion the coordinator hasn't acted on yet
-- (suggested) from a real, current pairing (assigned) from history
-- (declined/completed) - a worker can accumulate multiple rows over time,
-- but only one should ever be 'assigned' per new_worker_id at once; enforced
-- in worker_buddy_service, not a DB constraint, since "assigned" is a
-- point-in-time state a coordinator can change, not an immutable fact.

CREATE TABLE IF NOT EXISTS public.worker_buddies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    new_worker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    buddy_worker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'assigned', 'declined', 'completed')),
    assigned_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    assigned_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (new_worker_id, buddy_worker_id)
);

CREATE INDEX IF NOT EXISTS idx_worker_buddies_new_worker ON public.worker_buddies(new_worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_buddies_org ON public.worker_buddies(organization_id);

ALTER TABLE public.worker_buddies ENABLE ROW LEVEL SECURITY;
CREATE POLICY worker_buddies_service_role_all ON public.worker_buddies
    FOR ALL TO service_role USING (true) WITH CHECK (true);
