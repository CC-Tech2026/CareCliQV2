-- Tenant isolation audit (2026-08-21): 054_notifications_realtime_rls.sql ran
-- `FORCE ROW LEVEL SECURITY` on these three tables without ever running `ENABLE`
-- first. FORCE only changes whether the table owner is subject to RLS — it has no
-- effect on the `authenticated`/`anon` roles unless ENABLE already ran, so the
-- carefully-written policies in 054 were never actually being evaluated.
--
-- This matters because these are exactly the tables the frontend subscribes to
-- directly over Supabase Realtime with the public anon key + a real user JWT
-- (see artifacts/frontend/src/hooks/useNotificationRealtime.ts and
-- useWorkerNotificationPresenter.ts) — with RLS off, any authenticated user of any
-- organisation could read every other org's coordinator<->worker messages and every
-- user's in-app notifications. No policy changes are needed; the existing policies
-- from 054_notifications_realtime_rls.sql just start being enforced.

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
