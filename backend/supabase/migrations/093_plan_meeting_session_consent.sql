-- Migration 093: Record consent for plan meeting recordings
-- Purpose: Recording a conversation with an NDIS participant requires explicit,
-- auditable consent — and the person giving consent may not be the participant
-- themselves (a nominee or guardian may consent on their behalf). This adds
-- nullable columns so existing rows are unaffected; new sessions are required
-- (at the API layer) to supply consent before a session can be created.

BEGIN;

ALTER TABLE public.plan_meeting_sessions
  ADD COLUMN IF NOT EXISTS consent_given_by VARCHAR(20),
  ADD COLUMN IF NOT EXISTS consent_method VARCHAR(20),
  ADD COLUMN IF NOT EXISTS consent_confirmed_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.plan_meeting_sessions
  DROP CONSTRAINT IF EXISTS valid_consent_given_by;
ALTER TABLE public.plan_meeting_sessions
  ADD CONSTRAINT valid_consent_given_by
    CHECK (consent_given_by IS NULL OR consent_given_by IN ('participant', 'nominee', 'guardian'));

ALTER TABLE public.plan_meeting_sessions
  DROP CONSTRAINT IF EXISTS valid_consent_method;
ALTER TABLE public.plan_meeting_sessions
  ADD CONSTRAINT valid_consent_method
    CHECK (consent_method IS NULL OR consent_method IN ('verbal', 'written'));

COMMENT ON COLUMN public.plan_meeting_sessions.consent_given_by IS
  'Who gave consent to record: the participant themselves, a nominee, or a guardian.';
COMMENT ON COLUMN public.plan_meeting_sessions.consent_method IS
  'How consent was given: verbal (confirmed on this screen) or written (obtained separately).';
COMMENT ON COLUMN public.plan_meeting_sessions.consent_confirmed_at IS
  'Server timestamp when the coordinator confirmed consent, immediately before recording started.';

COMMIT;
