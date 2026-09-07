-- approve_session() (backend/app/api/coordinator.py) has always tried to
-- write approved_by/approved_at, but neither column has ever existed in the
-- live schema - confirmed directly against the database. The write silently
-- fell back to embedding that identity/timestamp as plain text inside the
-- free-text review_note field instead of a queryable column. This adds the
-- real columns so that fallback can be removed entirely.

BEGIN;

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

COMMIT;
