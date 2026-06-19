-- CARECLIQV2-258: per-account login lockout after repeated failed attempts
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS locked_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_locked_until ON public.users(locked_until)
WHERE locked_until IS NOT NULL;
