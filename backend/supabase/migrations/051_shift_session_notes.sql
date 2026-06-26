-- CARECLIQV2-231 — Task-linked session notes (task_id, goal_id, client sync id)

BEGIN;

ALTER TABLE public.shift_visit_notes
    ADD COLUMN IF NOT EXISTS task_id TEXT,
    ADD COLUMN IF NOT EXISTS goal_id TEXT,
    ADD COLUMN IF NOT EXISTS client_note_id UUID,
    ADD COLUMN IF NOT EXISTS auto_saved_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_visit_notes_client_note
    ON public.shift_visit_notes (session_id, client_note_id)
    WHERE client_note_id IS NOT NULL AND session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shift_visit_notes_session
    ON public.shift_visit_notes (session_id, created_at DESC)
    WHERE session_id IS NOT NULL;

COMMENT ON COLUMN public.shift_visit_notes.task_id IS
    'Optional shift task id when note is task-specific (CARECLIQV2-231).';
COMMENT ON COLUMN public.shift_visit_notes.goal_id IS
    'NDIS goal id auto-linked from task or supplied by client (CARECLIQV2-231).';
COMMENT ON COLUMN public.shift_visit_notes.client_note_id IS
    'Client-generated UUID for idempotent offline sync (CARECLIQV2-231).';

COMMIT;
