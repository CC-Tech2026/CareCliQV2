-- Worker Onboarding Journey, Phase 1: a "reached Active" completion moment.
--
-- Deliberately a separate column from users.welcome_seen_at (which already gates a
-- different, first-login moment - see WelcomeScreenGate.tsx / get_my_welcome_status -
-- shown before induction starts, "quick induction before your first shift"). This one
-- gates the opposite end of onboarding: the point a worker has actually cleared
-- Credentials and Training and become Active. Two independent moments, two independent
-- columns, same naming convention.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS onboarding_completed_seen_at timestamptz;
