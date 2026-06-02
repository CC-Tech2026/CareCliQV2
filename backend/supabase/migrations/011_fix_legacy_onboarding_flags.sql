-- ============================================================
-- CareScribe legacy onboarding/profile flag backfill.
--
-- Run after 010_sprint_completion_security_wallet_toolkit.sql if
-- users were migrated while the new flags still had their default false
-- values. Safe to run repeatedly.
-- ============================================================

BEGIN;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS email_verified boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS profile_completed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS role_specific_profile_completed boolean DEFAULT false;

ALTER TABLE public.access_logs
ADD COLUMN IF NOT EXISTS participant_id uuid,
ADD COLUMN IF NOT EXISTS session_id uuid,
ADD COLUMN IF NOT EXISTS purpose text,
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_access_logs_participant_id ON public.access_logs(participant_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_session_id ON public.access_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON public.access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON public.access_logs(created_at DESC);

UPDATE public.users
SET
    profile_completed = true,
    onboarding_completed = true,
    role_specific_profile_completed = true,
    email_verified = CASE
        WHEN id IN (
            '10000000-0000-4000-8000-000000000101'::uuid,
            '10000000-0000-4000-8000-000000000102'::uuid,
            '10000000-0000-4000-8000-000000000103'::uuid
        )
        OR lower(email) IN (
            'sarah@sunshine-demo.com',
            'amara@sunshine-demo.com',
            'daniel@sunshine-demo.com'
        )
        THEN true
        ELSE email_verified
    END
WHERE onboarding_complete IS TRUE
   OR id IN (
        '10000000-0000-4000-8000-000000000101'::uuid,
        '10000000-0000-4000-8000-000000000102'::uuid,
        '10000000-0000-4000-8000-000000000103'::uuid
   )
   OR lower(email) IN (
        'sarah@sunshine-demo.com',
        'amara@sunshine-demo.com',
        'daniel@sunshine-demo.com'
   );

COMMIT;
