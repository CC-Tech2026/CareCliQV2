-- CARECLIQV2-72 — Structured participant progress signals per session (JSONB array per goal).

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS progress_delta JSONB;

COMMENT ON COLUMN public.sessions.progress_delta IS
  'Per-goal progress snapshot: [{goal_id, prompt_level, independence_rating, skill_step, delta_summary}]';
