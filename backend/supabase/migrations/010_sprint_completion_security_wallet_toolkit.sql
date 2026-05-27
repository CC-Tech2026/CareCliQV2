-- ============================================================
-- CareScribe sprint completion: security, onboarding, profile,
-- credentials, report history, invoicing, and toolkit persistence.
-- Safe to run repeatedly.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS email_verified boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS profile_completed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS role_specific_profile_completed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS phone text,
ADD COLUMN IF NOT EXISTS suburb text,
ADD COLUMN IF NOT EXISTS address text,
ADD COLUMN IF NOT EXISTS emergency_contact text,
ADD COLUMN IF NOT EXISTS discipline text,
ADD COLUMN IF NOT EXISTS ahpra_registration_number text,
ADD COLUMN IF NOT EXISTS professional_indemnity_confirmed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS business_name text,
ADD COLUMN IF NOT EXISTS profile_photo_path text,
ADD COLUMN IF NOT EXISTS profile_photo_url text,
ADD COLUMN IF NOT EXISTS onboarding_checklist jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS onboarding_policy jsonb DEFAULT '{}'::jsonb;

UPDATE public.users
SET
  profile_completed = true,
  onboarding_completed = true,
  role_specific_profile_completed = true
WHERE onboarding_complete IS TRUE;

CREATE TABLE IF NOT EXISTS public.credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id uuid,
  credential_type text NOT NULL,
  title text NOT NULL,
  credential_number text,
  issuer text,
  issue_date date,
  expiry_date date,
  status text NOT NULL DEFAULT 'pending_review',
  file_path text,
  file_url text,
  verified_by uuid REFERENCES public.users(id),
  verified_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT credentials_status_check CHECK (status IN ('valid','expiring','expired','rejected','pending_review'))
);

CREATE INDEX IF NOT EXISTS idx_credentials_user_id ON public.credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_credentials_org_id ON public.credentials(organization_id);
CREATE INDEX IF NOT EXISTS idx_credentials_status ON public.credentials(status);
CREATE INDEX IF NOT EXISTS idx_credentials_expiry_date ON public.credentials(expiry_date);

CREATE TABLE IF NOT EXISTS public.report_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  participant_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  generated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  report_type text NOT NULL,
  title text NOT NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  file_path text,
  file_url text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_history_org_id ON public.report_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_report_history_participant_id ON public.report_history(participant_id);
CREATE INDEX IF NOT EXISTS idx_report_history_generated_by ON public.report_history(generated_by);

ALTER TABLE public.invoices
ADD COLUMN IF NOT EXISTS pdf_path text,
ADD COLUMN IF NOT EXISTS pdf_url text,
ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
ADD COLUMN IF NOT EXISTS payment_date date,
ADD COLUMN IF NOT EXISTS payment_reference text,
ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id),
ADD COLUMN IF NOT EXISTS ndis_line_items jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS payer_type text,
ADD COLUMN IF NOT EXISTS duplicate_of_invoice_id uuid REFERENCES public.invoices(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_session_active
ON public.invoices(session_id)
WHERE session_id IS NOT NULL AND status NOT IN ('void', 'cancelled');

CREATE TABLE IF NOT EXISTS public.toolkit_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  assigned_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  sku text,
  quantity numeric(12,2) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'item',
  minimum_quantity numeric(12,2) NOT NULL DEFAULT 0,
  expiry_date date,
  batch_number text,
  fifo_order integer,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_toolkit_items_org_id ON public.toolkit_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_toolkit_items_assigned_user_id ON public.toolkit_items(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_toolkit_items_status ON public.toolkit_items(status);

CREATE TABLE IF NOT EXISTS public.toolkit_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.toolkit_items(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  movement_type text NOT NULL,
  quantity numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT toolkit_movements_type_check CHECK (movement_type IN ('assign','use','restock','adjust'))
);

CREATE INDEX IF NOT EXISTS idx_toolkit_movements_item_id ON public.toolkit_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_toolkit_movements_user_id ON public.toolkit_movements(user_id);

CREATE TABLE IF NOT EXISTS public.restock_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  item_id uuid REFERENCES public.toolkit_items(id) ON DELETE SET NULL,
  quantity_requested numeric(12,2) NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT restock_requests_status_check CHECK (status IN ('pending','approved','rejected','fulfilled'))
);

CREATE INDEX IF NOT EXISTS idx_restock_requests_org_id ON public.restock_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_restock_requests_requested_by ON public.restock_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_restock_requests_status ON public.restock_requests(status);
