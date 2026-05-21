-- RBAC alignment migration. Non-destructive and safe to re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS organization_id uuid,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS owner_id uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.organizations
SET name = COALESCE(name, organization_name)
WHERE name IS NULL;

UPDATE public.organizations
SET owner_id = COALESCE(owner_id, owner_user_id)
WHERE owner_id IS NULL;

ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.organization_members
SET status = CASE WHEN is_active THEN 'active' ELSE 'removed' END
WHERE status IS NULL OR status = '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_members_org_user
  ON public.organization_members(organization_id, user_id);

CREATE INDEX IF NOT EXISTS idx_organization_members_user_id
  ON public.organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_organization_id
  ON public.organization_members(organization_id);

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS accepted_by uuid,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_organization_id ON public.invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON public.invitations(status);
CREATE INDEX IF NOT EXISTS idx_invitations_expires_at ON public.invitations(expires_at);
CREATE INDEX IF NOT EXISTS idx_invitations_token_hash ON public.invitations(token_hash);

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
  ON public.password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
  ON public.password_reset_tokens(expires_at);

ALTER TABLE public.practitioner_allocations
  ADD COLUMN IF NOT EXISTS organization_id uuid,
  ADD COLUMN IF NOT EXISTS assignment_role text,
  ADD COLUMN IF NOT EXISTS assigned_by uuid,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.practitioner_allocations
SET assignment_role = COALESCE(assignment_role, allocated_role, 'support_worker')
WHERE assignment_role IS NULL;

UPDATE public.practitioner_allocations
SET status = CASE WHEN is_active THEN 'active' ELSE 'removed' END
WHERE status IS NULL OR status = '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_practitioner_allocations_patient_user_role
  ON public.practitioner_allocations(patient_id, user_id, assignment_role)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_user_id
  ON public.practitioner_allocations(user_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_patient_id
  ON public.practitioner_allocations(patient_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_organization_id
  ON public.practitioner_allocations(organization_id);

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_user_id uuid,
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS resource_type text,
  ADD COLUMN IF NOT EXISTS resource_id text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS organization_id uuid;

CREATE INDEX IF NOT EXISTS idx_patients_organization_id ON public.patients(organization_id);
CREATE INDEX IF NOT EXISTS idx_sessions_patient_id ON public.sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_sessions_organization_id ON public.sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_incidents_participant_id ON public.incidents(participant_id);
CREATE INDEX IF NOT EXISTS idx_incidents_organization_id ON public.incidents(organization_id);

CREATE OR REPLACE VIEW public.participant_assignments AS
SELECT
  id,
  patient_id AS participant_id,
  user_id,
  organization_id,
  COALESCE(assignment_role, allocated_role) AS assignment_role,
  assigned_by,
  status,
  created_at,
  updated_at
FROM public.practitioner_allocations;
