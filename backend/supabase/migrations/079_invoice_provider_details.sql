-- Migration 079: Invoice provider details and plan management type
-- Adds columns needed for professional NDIS invoice PDF generation.
-- Action required: paste into Supabase SQL Editor and execute.

BEGIN;

-- ── 1. Extend organizations with NDIS provider details ───────────────────────

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS email                TEXT,
    ADD COLUMN IF NOT EXISTS org_address          TEXT,
    ADD COLUMN IF NOT EXISTS ndis_provider_number TEXT,
    ADD COLUMN IF NOT EXISTS invoice_sequence     INTEGER NOT NULL DEFAULT 0;

-- ── 2. Add plan management type to NDIS plans ─────────────────────────────────
-- PLAN = plan manager pays (most common)
-- NDIA = NDIA agency manages (agency-managed)
-- SELF = participant self-manages

ALTER TABLE public.ndis_plans
    ADD COLUMN IF NOT EXISTS plan_management_type TEXT
        CHECK (plan_management_type IN ('PLAN', 'NDIA', 'SELF'));

-- ── 3. Sequence function for NDIS-compliant invoice numbering ─────────────────
-- Atomically increments per-org counter and returns the new value.
-- Called by backend on every invoice creation.

CREATE OR REPLACE FUNCTION public.increment_invoice_sequence(p_org_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _new_seq INTEGER;
BEGIN
    UPDATE public.organizations
    SET    invoice_sequence = invoice_sequence + 1
    WHERE  id = p_org_id
    RETURNING invoice_sequence INTO _new_seq;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Organization % not found', p_org_id;
    END IF;

    RETURN _new_seq;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_invoice_sequence(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_invoice_sequence(UUID) TO service_role;

COMMIT;
