-- 260: Book the Meet & Greet from participant onboarding.
-- Someone in onboarding isn't a participant yet (that record is made when
-- they're activated), so a meeting booked for them points at their intake.
-- When they're activated the meeting is filed on their participant record
-- too (participant_intake_service._attach_meeting_sessions).
-- Nullable, so existing events keep working unchanged.

ALTER TABLE public.org_events
  ADD COLUMN IF NOT EXISTS intake_id uuid REFERENCES public.participant_intakes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_org_events_intake
  ON public.org_events (intake_id, event_date)
  WHERE intake_id IS NOT NULL;
