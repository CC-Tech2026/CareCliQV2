-- Meet & Greet Easy Capture: keep the recording, and keep it with the intake.
--
-- Until now the Meet & Greet step saved `meet_greet_recording_url` as a
-- browser `blob:` URL — it only ever played back in the tab that recorded
-- it — and the plan-meeting session it created had no link to the intake,
-- so once the person became a participant their Meet & Greet (and the
-- consent recorded for it) was orphaned.
--
-- Recordings go to a private bucket and are served through short-lived
-- signed URLs. The session is tied to the intake, and activation copies the
-- new participant id onto it (participant_intake_service).

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'meeting-recordings',
    'meeting-recordings',
    false,
    26214400,
    ARRAY['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/x-m4a']
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.plan_meeting_sessions
    ADD COLUMN IF NOT EXISTS intake_id UUID REFERENCES public.participant_intakes(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS recording_path TEXT;

CREATE INDEX IF NOT EXISTS idx_plan_meeting_sessions_intake
    ON public.plan_meeting_sessions (intake_id)
    WHERE intake_id IS NOT NULL;

ALTER TABLE public.participant_intakes
    ADD COLUMN IF NOT EXISTS meet_greet_session_id UUID REFERENCES public.plan_meeting_sessions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS meet_greet_recording_path TEXT;

-- blob: URLs were never playable outside the recording tab; clear them so
-- the UI doesn't offer a broken player.
UPDATE public.participant_intakes
SET meet_greet_recording_url = NULL
WHERE meet_greet_recording_url LIKE 'blob:%';

COMMIT;
