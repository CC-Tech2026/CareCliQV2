-- Induction as its own entity, distinct from training_modules — a worker's
-- one-time first-day checklist (org intro, policies, orientation) rather
-- than an ongoing/renewable training module. Every active mandatory item
-- applies to every worker in the org; there's no per-item auto-assign
-- toggle like training_modules has, since induction is inherently
-- org-wide, not opt-in per module.

BEGIN;

CREATE TABLE IF NOT EXISTS public.induction_items (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    title             TEXT        NOT NULL,
    description       TEXT,
    content_url       TEXT,
    is_mandatory      BOOLEAN     NOT NULL DEFAULT true,
    sort_order        INTEGER     NOT NULL DEFAULT 0,
    is_active         BOOLEAN     NOT NULL DEFAULT true,
    created_by        UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_induction_items_org
    ON public.induction_items (organization_id, sort_order)
    WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.worker_induction_completions (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    item_id           UUID        NOT NULL REFERENCES public.induction_items(id) ON DELETE CASCADE,
    organization_id   UUID        NOT NULL,
    completed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (worker_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_worker_induction_completions_worker
    ON public.worker_induction_completions (worker_id);

ALTER TABLE public.induction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_induction_completions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'induction_items'
        AND policyname = 'induction_items_service_role'
    ) THEN
        CREATE POLICY induction_items_service_role
        ON public.induction_items
        FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'worker_induction_completions'
        AND policyname = 'worker_induction_completions_service_role'
    ) THEN
        CREATE POLICY worker_induction_completions_service_role
        ON public.worker_induction_completions
        FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

-- First-login welcome screen, shown once before induction — a simple stamp,
-- not a checklist item (it's not mandatory/gating, just a one-time greeting).
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS welcome_seen_at TIMESTAMPTZ;

COMMIT;
