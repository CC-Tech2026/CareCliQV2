-- ============================================================
-- CCQ-106 / CCQ-107 — note_embeddings: org isolation
-- ============================================================
-- Promotes organization_id to a first-class column on
-- note_embeddings (was absent — CCQ-106 AC), backfills from the
-- parent session, adds NOT NULL + FK + index, and applies an
-- org-scoped RLS policy so Org A's embeddings never surface in
-- Org B's semantic searches (CCQ-106 AC integration test target).
-- ============================================================

BEGIN;

-- ── 1. Add organisation column ───────────────────────────────────────────────

ALTER TABLE public.note_embeddings
    ADD COLUMN IF NOT EXISTS organization_id uuid;

-- ── 2. Backfill from parent session ─────────────────────────────────────────

UPDATE public.note_embeddings ne
SET    organization_id = s.organization_id
FROM   public.sessions s
WHERE  ne.session_id        = s.id
  AND  ne.organization_id   IS NULL
  AND  s.organization_id    IS NOT NULL;

-- Any remaining NULLs (orphaned embeddings with no matching session):
-- delete rather than carry orphaned data forward.
DELETE FROM public.note_embeddings
WHERE  organization_id IS NULL;

-- ── 3. NOT NULL + FK + index ─────────────────────────────────────────────────

ALTER TABLE public.note_embeddings
    ALTER COLUMN organization_id SET NOT NULL;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_note_embeddings_org'
    ) THEN
        ALTER TABLE public.note_embeddings
        ADD CONSTRAINT fk_note_embeddings_org
        FOREIGN KEY (organization_id) REFERENCES public.organizations(organization_id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_note_embeddings_organization_id
    ON public.note_embeddings(organization_id);

-- ── 4. RLS — org-isolated SELECT; all writes via service role ────────────────

-- RLS already enabled by supabase_setup.sql; ensure FORCE so the owner
-- role (service_role used by the Python backend) is not affected.
ALTER TABLE public.note_embeddings ENABLE ROW LEVEL SECURITY;

-- Authenticated reads are always org-scoped
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'note_embeddings' AND policyname = 'note_embeddings_org_select'
    ) THEN
        CREATE POLICY note_embeddings_org_select ON public.note_embeddings
        FOR SELECT TO authenticated
        USING (organization_id = public.cs_user_org_id());
    END IF;
END $$;

-- The service role policy from supabase_setup.sql covers INSERT/UPDATE/DELETE.
-- Python backend always uses the admin/service-role client for writes.

COMMIT;
