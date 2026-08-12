-- Migration 094: Service agreement status on ndis_plans
-- Purpose: The compliance centre needs to show whether a participant's service
-- agreement is signed. There was previously no structured tracking of this
-- anywhere in the schema (only a free-text service_agreement_ref on invoices).
-- Agreement status is a natural attribute of the plan record itself — add it
-- directly to ndis_plans rather than a separate one-row-per-status table.

BEGIN;

ALTER TABLE public.ndis_plans
  ADD COLUMN IF NOT EXISTS agreement_status TEXT NOT NULL DEFAULT 'unsigned',
  ADD COLUMN IF NOT EXISTS agreement_signed_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.ndis_plans
  DROP CONSTRAINT IF EXISTS valid_agreement_status;
ALTER TABLE public.ndis_plans
  ADD CONSTRAINT valid_agreement_status
    CHECK (agreement_status IN ('unsigned', 'signed', 'expired'));

COMMENT ON COLUMN public.ndis_plans.agreement_status IS
  'Service agreement signing status for this plan: unsigned, signed, or expired.';
COMMENT ON COLUMN public.ndis_plans.agreement_signed_at IS
  'When the service agreement was signed (null if unsigned or expired without a record).';

COMMIT;
