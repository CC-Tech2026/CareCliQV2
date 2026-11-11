-- 252: Bookable meetings on the MD Calendar.
-- org_events already holds the calendar's audits, training, meetings and
-- reviews. These columns let a meeting be booked with a participant (plan
-- review, intake, care team...), say how it happens (in person, phone or a
-- video call), list who's invited, and flag an in-person meeting for
-- recording with Easy Capture.
--
-- Invites go out as calendar invites (.ics) by email, so they land in
-- Google, Outlook or Apple calendars without anyone connecting an account.
-- invite_sequence counts the versions sent (an update must carry a higher
-- number than the one before), invites_sent_at says whether any went out.
-- A video call's invite is sent from the organiser's own calendar, which
-- adds the Meet or Teams link; meeting_link is kept for a link added later.
-- All nullable or defaulted, so existing events keep working unchanged.

ALTER TABLE public.org_events
  ADD COLUMN IF NOT EXISTS participant_id uuid REFERENCES public.participants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS meeting_kind text,
  ADD COLUMN IF NOT EXISTS meeting_mode text,
  ADD COLUMN IF NOT EXISTS meeting_link text,
  ADD COLUMN IF NOT EXISTS easy_capture boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attendees jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS invite_sequence integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invites_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE public.org_events
  DROP CONSTRAINT IF EXISTS org_events_meeting_kind_check;
ALTER TABLE public.org_events
  ADD CONSTRAINT org_events_meeting_kind_check
  CHECK (meeting_kind IS NULL OR meeting_kind IN (
    'intake', 'service_agreement', 'plan_review', 'goal_review',
    'check_in', 'care_team', 'incident_followup'
  ));

-- Earlier drafts named the video platform; they're all "video" now.
ALTER TABLE public.org_events
  DROP CONSTRAINT IF EXISTS org_events_meeting_mode_check;
UPDATE public.org_events
  SET meeting_mode = 'video'
  WHERE meeting_mode IN ('google_meet', 'zoom', 'teams');
ALTER TABLE public.org_events
  ADD CONSTRAINT org_events_meeting_mode_check
  CHECK (meeting_mode IS NULL OR meeting_mode IN ('in_person', 'phone', 'video'));

ALTER TABLE public.org_events
  DROP CONSTRAINT IF EXISTS org_events_meeting_link_check;
ALTER TABLE public.org_events
  ADD CONSTRAINT org_events_meeting_link_check
  CHECK (meeting_link IS NULL OR meeting_link ~ '^https://');

ALTER TABLE public.org_events
  DROP CONSTRAINT IF EXISTS org_events_attendees_check;
ALTER TABLE public.org_events
  ADD CONSTRAINT org_events_attendees_check
  CHECK (jsonb_typeof(attendees) = 'array');

-- The calendar now loads a date range (month/week/day) instead of "next 20".
CREATE INDEX IF NOT EXISTS idx_org_events_org_date
  ON public.org_events (organization_id, event_date);

CREATE INDEX IF NOT EXISTS idx_org_events_participant
  ON public.org_events (participant_id, event_date)
  WHERE participant_id IS NOT NULL;
