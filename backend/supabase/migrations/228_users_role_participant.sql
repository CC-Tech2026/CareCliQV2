-- Adds 'participant' to users.role — the new participant-facing role for
-- the Participants Portal (see access.py's PARTICIPANT_ROLES). Unlike every
-- staff role, a participant isn't org-wide within their organization_id —
-- they're scoped to exactly one row in public.participants, so this
-- migration also adds users.participant_id to carry that link.
--
-- Drops whatever the current CHECK constraint on users.role is actually
-- named, same dynamic-lookup approach 154_users_role_super_admin.sql used,
-- since that migration already documented this constraint's name drifting
-- from the migration history over time.

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
    'managing_director', 'super_admin', 'participant'
));

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS participant_id uuid REFERENCES public.participants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_participant_id ON public.users(participant_id);

-- organization_members.role carries its own, separately-drifted CHECK
-- constraint (see markdown/replit.md and 006_multilingual_legal_record_alignment.sql).
-- Login upserts a row here for every authenticated user with an
-- organization_id (auth.py's _resolve_org_member_role) — without this, every
-- participant login would hit a swallowed CHECK-violation exception on that
-- upsert. Same dynamic-lookup approach as above rather than assuming the
-- constraint's current definition.
DO $$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.organization_members'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%role%'
    LOOP
        EXECUTE format('ALTER TABLE public.organization_members DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;

ALTER TABLE public.organization_members
ADD CONSTRAINT organization_members_role_check
CHECK (role IN (
    'support_worker', 'support_coordinator', 'allied_health',
    'managing_director', 'admin', 'participant'
));
