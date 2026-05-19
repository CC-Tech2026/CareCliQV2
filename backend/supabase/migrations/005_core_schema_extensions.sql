-- ============================================================
-- ENSURE MULTI-TENANT COLUMNS EXIST BEFORE ANY RLS
-- ============================================================

ALTER TABLE public.patients
ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.incidents
ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.alerts
ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.ndis_plans
ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.audit_logs
ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.access_logs
ADD COLUMN IF NOT EXISTS organization_id uuid;