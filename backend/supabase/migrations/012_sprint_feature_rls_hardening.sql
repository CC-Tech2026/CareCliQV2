-- ============================================================
-- CareScribe sprint feature RLS hardening.
--
-- Backend APIs use the service role and enforce RBAC in application
-- code. Direct client-side Supabase access to these tables should
-- not expose organisation-wide data, so authenticated users receive
-- no broad read policies here.
-- ============================================================

BEGIN;

ALTER TABLE IF EXISTS public.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.report_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.toolkit_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.toolkit_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.restock_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_report_history_created_at ON public.report_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_toolkit_items_expiry_date ON public.toolkit_items(expiry_date);
CREATE INDEX IF NOT EXISTS idx_toolkit_movements_created_at ON public.toolkit_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restock_requests_item_id ON public.restock_requests(item_id);
CREATE INDEX IF NOT EXISTS idx_restock_requests_updated_at ON public.restock_requests(updated_at DESC);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.invoices'::regclass
          AND conname = 'invoices_status_check'
    ) THEN
        ALTER TABLE public.invoices DROP CONSTRAINT invoices_status_check;
    END IF;

    ALTER TABLE public.invoices
    ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('draft', 'finalized', 'issued', 'sent', 'paid', 'void', 'overdue', 'cancelled'));
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'credentials'
          AND policyname = 'credentials_service_role_all'
    ) THEN
        CREATE POLICY credentials_service_role_all
        ON public.credentials
        FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'report_history'
          AND policyname = 'report_history_service_role_all'
    ) THEN
        CREATE POLICY report_history_service_role_all
        ON public.report_history
        FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'toolkit_items'
          AND policyname = 'toolkit_items_service_role_all'
    ) THEN
        CREATE POLICY toolkit_items_service_role_all
        ON public.toolkit_items
        FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'toolkit_movements'
          AND policyname = 'toolkit_movements_service_role_all'
    ) THEN
        CREATE POLICY toolkit_movements_service_role_all
        ON public.toolkit_movements
        FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'restock_requests'
          AND policyname = 'restock_requests_service_role_all'
    ) THEN
        CREATE POLICY restock_requests_service_role_all
        ON public.restock_requests
        FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    END IF;
END $$;

COMMIT;
