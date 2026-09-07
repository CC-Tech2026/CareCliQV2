-- 163_launch_waitlist.sql
-- Email capture on the pre-launch countdown page (/get-started, shown until
-- the 7 October 2026 launch instant) - "Notify Me" signups, distinct from
-- any org/invitations flow since no account exists at this point.

BEGIN;

CREATE TABLE IF NOT EXISTS public.launch_waitlist_signups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.launch_waitlist_signups IS
    'Emails captured on the pre-launch countdown page, for a one-time "we have launched" notification.';

ALTER TABLE public.launch_waitlist_signups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'launch_waitlist_signups'
          AND policyname = 'launch_waitlist_signups_service_all'
    ) THEN
        CREATE POLICY launch_waitlist_signups_service_all
            ON public.launch_waitlist_signups FOR ALL TO service_role
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
