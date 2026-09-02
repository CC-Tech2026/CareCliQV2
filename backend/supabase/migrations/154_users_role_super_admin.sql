-- Widens users.role's CHECK constraint to allow 'super_admin' — the new
-- vendor-side role for the Super Admin Portal (see access.py's
-- SUPER_ADMIN_ROLES). Confirmed live: attempting to insert a super_admin
-- row today fails with "violates check constraint users_role_check".
--
-- Also re-adds 'managing_director', which is live in production data today
-- despite no migration in this history ever having added it to the
-- constraint (006_multilingual_legal_record_alignment.sql's version only
-- listed support_worker/support_coordinator/allied_health) — it must have
-- been widened directly in the SQL editor outside the migration history at
-- some point. This migration makes that drift explicit and codified.
--
-- Drops whatever the current CHECK constraint on users.role is actually
-- named (same dynamic-lookup approach 006 used) rather than assuming a name,
-- since it clearly hasn't matched "users_role_check" 1:1 with this repo's
-- migration history for a while.

DO $$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.users'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%role%'
    LOOP
        EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;

ALTER TABLE public.users
ADD CONSTRAINT users_role_check
CHECK (role IN (
    'support_worker', 'support_coordinator', 'allied_health',
    'managing_director', 'super_admin'
));
