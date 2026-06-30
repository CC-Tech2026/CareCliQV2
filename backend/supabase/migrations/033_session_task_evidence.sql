-- CARECLIQV2-228: task-specific evidence linked to sessions
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS task_evidence jsonb DEFAULT '[]'::jsonb;
