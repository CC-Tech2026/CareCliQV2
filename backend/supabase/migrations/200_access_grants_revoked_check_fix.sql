-- Fixes a latent bug in 199's access_grants_revoked_consistency_check: it
-- required revoked_at and revoked_by_user_id to be both-null-or-both-set,
-- but revoked_by_user_id's FK is ON DELETE SET NULL — so the day an MD who
-- revoked a grant has their account deleted, the FK cascade would try to
-- null out revoked_by_user_id while revoked_at stays set, and this CHECK
-- would reject that update, failing the user-deletion transaction outright.
--
-- Relaxed to one-directional: revoked_by_user_id set implies revoked_at set
-- (the only write path, revoke_grant(), always sets both together), but not
-- the reverse — revoked_at alone remains the historical record that a grant
-- *was* revoked even after who-revoked-it is later nulled out.
BEGIN;

ALTER TABLE public.access_grants
    DROP CONSTRAINT IF EXISTS access_grants_revoked_consistency_check;

ALTER TABLE public.access_grants
    ADD CONSTRAINT access_grants_revoked_consistency_check
    CHECK (revoked_by_user_id IS NULL OR revoked_at IS NOT NULL);

COMMIT;
