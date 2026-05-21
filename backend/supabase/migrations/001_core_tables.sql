-- Core schema bootstrap.
-- Non-destructive: creates the base tables required by later RBAC/RLS
-- migrations if they do not already exist.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'support_worker',
  full_name text,
  display_name text,
  account_type text,
  onboarding_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  onboarding_complete boolean NOT NULL DEFAULT false,
  organization_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active',
  last_login timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_name text,
  name text,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  owner_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  provider_type text,
  registration_status text,
  team_size text,
  participant_volume text,
  contact_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_organization_id_fkey'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_organization_id_fkey
      FOREIGN KEY (organization_id)
      REFERENCES public.organizations(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'support_worker',
  token text,
  token_hash text,
  invited_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  accepted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  ndis_number text NOT NULL DEFAULT '',
  date_of_birth date,
  email text,
  phone text,
  address text,
  plan_status text NOT NULL DEFAULT 'active',
  plan_start_date date,
  plan_end_date date,
  total_budget numeric(12, 2) DEFAULT 0,
  used_budget numeric(12, 2) DEFAULT 0,
  primary_disability text,
  biological_sex text DEFAULT 'unspecified',
  allergies text,
  communication_preferences text,
  goals jsonb NOT NULL DEFAULT '[]'::jsonb,
  ndis_plan_id uuid,
  external_pseudonym text,
  disposal_date date,
  is_purged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  session_date timestamptz NOT NULL DEFAULT now(),
  duration_minutes integer NOT NULL DEFAULT 0,
  session_type text NOT NULL DEFAULT 'support',
  notes text,
  transcription text,
  ai_summary text,
  ai_insights jsonb,
  compliance_score numeric(5, 2),
  compliance_status text DEFAULT 'draft',
  compliance_notes text,
  compliance_flags jsonb,
  compliance_checked_at timestamptz,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  goals_addressed jsonb NOT NULL DEFAULT '[]'::jsonb,
  photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  audio_url text,
  status text NOT NULL DEFAULT 'draft',
  cost numeric(10, 2) DEFAULT 0,
  support_category text,
  activities_performed text,
  outcomes text,
  participant_response text,
  progress_toward_goals text,
  body_markers jsonb NOT NULL DEFAULT '[]'::jsonb,
  restrictive_practice_detected boolean DEFAULT false,
  restrictive_practice_types jsonb,
  input_language text,
  voice_input text,
  incident_language_detected boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  incident_date timestamptz NOT NULL DEFAULT now(),
  reported_date timestamptz,
  incident_type text NOT NULL DEFAULT 'other',
  severity text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'reported',
  description text,
  location text,
  immediate_action text,
  follow_up_required boolean DEFAULT false,
  follow_up_date timestamptz,
  resolved_date timestamptz,
  ndis_reportable boolean DEFAULT false,
  ndis_reported_at timestamptz,
  practice_standard text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.practitioner_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  allocated_role text NOT NULL DEFAULT 'support_worker',
  assignment_role text,
  assigned_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  action text,
  action_type text,
  resource_type text,
  resource_id text,
  entity_type text,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  action text,
  purpose text,
  ip_address text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ndis_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid REFERENCES public.patients(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  start_date date,
  end_date date,
  total_budget numeric(12, 2) DEFAULT 0,
  used_budget numeric(12, 2) DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  alert_type text NOT NULL DEFAULT 'general',
  title text,
  message text,
  severity text NOT NULL DEFAULT 'medium',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_organization_id ON public.users(organization_id);
CREATE INDEX IF NOT EXISTS idx_organizations_owner_user_id ON public.organizations(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_organization_id ON public.invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON public.invitations(status);
CREATE INDEX IF NOT EXISTS idx_invitations_expires_at ON public.invitations(expires_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON public.password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON public.password_reset_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_patients_organization_id ON public.patients(organization_id);
CREATE INDEX IF NOT EXISTS idx_sessions_patient_id ON public.sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_sessions_organization_id ON public.sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_incidents_participant_id ON public.incidents(participant_id);
CREATE INDEX IF NOT EXISTS idx_incidents_organization_id ON public.incidents(organization_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_user_id ON public.practitioner_allocations(user_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_patient_id ON public.practitioner_allocations(patient_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_organization_id ON public.practitioner_allocations(organization_id);
