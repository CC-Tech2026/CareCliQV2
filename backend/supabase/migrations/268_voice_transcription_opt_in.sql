-- Voice recording (voice notes, plan meeting and meet-and-greet recordings)
-- sends audio overseas to be turned into text. An organisation's managing
-- director can switch it on for their organisation after agreeing to that;
-- who agreed, when, and to which wording is kept. Off by default.

BEGIN;

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS voice_transcription_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS voice_transcription_agreed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS voice_transcription_agreed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS voice_transcription_terms_version TEXT,
    ADD COLUMN IF NOT EXISTS voice_transcription_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.organizations.voice_transcription_enabled IS
    'The managing director switched voice recording and transcription on (services/voice_access.py).';
COMMENT ON COLUMN public.organizations.voice_transcription_agreed_by IS
    'Who agreed to audio being sent overseas for transcription when it was switched on.';
COMMENT ON COLUMN public.organizations.voice_transcription_terms_version IS
    'Which wording they agreed to (voice_access.TERMS_VERSION).';

COMMIT;
