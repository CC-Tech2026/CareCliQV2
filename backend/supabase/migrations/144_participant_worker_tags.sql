-- Worker-Participant Matching Enhancement, Phase 1 (Foundation).
--
-- Structured, curated tag taxonomy for participant/worker matching -
-- shared interests, consented lived-experience, communication style, etc.
-- Distinct from the existing free-text narrative fields on patients
-- (interests, favourite_activities, preferred_activities, likes_dislikes,
-- worker_notes) - those are prose for a worker reading a briefing; tags
-- here are curated so overlap can be computed programmatically for the
-- ranking service (Phase 2). "preferred_worker_notes" from the design spec
-- is intentionally NOT a new column - patients.worker_notes already exists,
-- is unused anywhere in the app today, and serves exactly that purpose.
--
-- Org-scoped taxonomy (not global) so each provider curates their own list
-- rather than sharing one fixed set across unrelated organisations.

CREATE TABLE IF NOT EXISTS public.tag_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    name text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS public.tags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    category_id uuid NOT NULL REFERENCES public.tag_categories(id) ON DELETE CASCADE,
    label text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, category_id, label)
);

CREATE TABLE IF NOT EXISTS public.participant_tags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    added_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    added_at timestamptz NOT NULL DEFAULT now(),
    notes text,
    UNIQUE (participant_id, tag_id)
);

-- visible_to_coordinator_only: per org decision (Aug 2026), "coordinator" here
-- means every support_coordinator/managing_director in the organisation, not
-- just a worker's assigned coordinator (coordinator_id) - matches how every
-- other coordinator-facing worker record in this app is already org-wide
-- readable, and coordinator_id is a nullable rollout-only scoping field on
-- team-list queries, not a privacy boundary.
CREATE TABLE IF NOT EXISTS public.worker_tags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    added_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    added_at timestamptz NOT NULL DEFAULT now(),
    notes text,
    visible_to_coordinator_only boolean NOT NULL DEFAULT false,
    UNIQUE (worker_id, tag_id)
);

-- Lets a worker opt out of interest/lived-experience-based ranking entirely
-- (Phase 2) while keeping their tags on file for their own reference.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS matching_opt_in boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_tags_org_category ON public.tags(organization_id, category_id);
CREATE INDEX IF NOT EXISTS idx_participant_tags_participant ON public.participant_tags(participant_id);
CREATE INDEX IF NOT EXISTS idx_participant_tags_tag ON public.participant_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_worker_tags_worker ON public.worker_tags(worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_tags_tag ON public.worker_tags(tag_id);
