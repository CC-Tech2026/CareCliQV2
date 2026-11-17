-- 259: Employment Hero Payroll (formerly KeyPay): approved timesheets out.
--
-- A managing director clicks Connect to Employment Hero and signs in there;
-- nothing is typed in. When a coordinator approves a timesheet (verifies a
-- shift), the time worked goes to Employment Hero as a timesheet for that
-- worker, and Employment Hero's award settings (SCHADS) work out the pay.
-- Reversing the approval removes the timesheet there, unless it has already
-- been paid in a pay run.
--
-- Only the API (service role) reads or writes these tables: RLS is on with no
-- policies. Everything is new; nothing existing changes. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.employment_hero_connections (
  organization_id uuid PRIMARY KEY,
  -- Employment Hero's business (the payroll company) chosen on connect.
  business_id bigint,
  business_name text,
  -- Every business the person who connected can see, when there's more than
  -- one to choose from: [{"id": 123, "name": "..."}].
  businesses jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Encrypted when PII_ENCRYPTION_KEY is set.
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  access_token_expires_at timestamptz,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  connected_by uuid,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.employment_hero_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employment_hero_connections FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.employment_hero_oauth_states (
  state text PRIMARY KEY,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.employment_hero_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employment_hero_oauth_states FROM anon, authenticated;

-- Which Employment Hero employee each CareCliQ worker is. Found by email or
-- name automatically; a director picks the person from a list only when
-- that can't be told apart.
CREATE TABLE IF NOT EXISTS public.employment_hero_employees (
  organization_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  employee_id bigint NOT NULL,
  employee_name text,
  matched_by text NOT NULL DEFAULT 'email' CHECK (matched_by IN ('email', 'name', 'employee_id', 'chosen')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, worker_id)
);
ALTER TABLE public.employment_hero_employees ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employment_hero_employees FROM anon, authenticated;

-- One row per approved shift sent (or waiting to be sent) to Employment Hero.
CREATE TABLE IF NOT EXISTS public.employment_hero_timesheets (
  organization_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  worker_id uuid,
  -- Employment Hero's timesheet line id, once it's there.
  timesheet_id bigint,
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'sent', 'failed', 'removed', 'paid')),
  start_time timestamptz,
  end_time timestamptz,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, shift_id)
);
CREATE INDEX IF NOT EXISTS employment_hero_timesheets_status_idx
  ON public.employment_hero_timesheets (organization_id, status);
ALTER TABLE public.employment_hero_timesheets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employment_hero_timesheets FROM anon, authenticated;
